import { log } from '../../telemetry/logger'
import { buildSubagentSystemPrompt } from './prompts/subagent.v1'
import { TOOL_DEFS, type ToolDeps, invokeTool, isFinalizeCall, parseFinalize } from './tools'
import type { DeepAskEvent, SubagentBrief, SubagentResult } from './types'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const SUBAGENT_MODEL = process.env.MEMORY_DEEP_ASK_SUBAGENT_MODEL ?? 'gpt-4o-mini'
const SUBAGENT_TIMEOUT_MS = 120_000

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

export interface SubagentDeps extends ToolDeps {
  fetchFn?: typeof fetch
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export async function runSubagent(
  brief: SubagentBrief,
  deps: SubagentDeps,
  sendEvent: (e: DeepAskEvent) => void
): Promise<SubagentResult> {
  const startedAt = Date.now()
  sendEvent({ type: 'subagent-started', idx: brief.idx, brief })

  const fetchFn = deps.fetchFn ?? fetch
  const messages: OpenAIMessage[] = [
    { role: 'system', content: buildSubagentSystemPrompt(brief) },
    { role: 'user', content: brief.objective },
  ]
  let toolCallsUsed = 0
  let tokensIn = 0
  let tokensOut = 0
  const maxIterations = brief.boundaries.maxToolCalls + 3

  for (let iter = 0; iter < maxIterations; iter++) {
    if (toolCallsUsed >= brief.boundaries.maxToolCalls) {
      messages.push({
        role: 'system',
        content:
          'You have hit your tool-call cap. Call finalize_summary now with whatever evidence you have.',
      })
    }
    let res: Response
    try {
      res = await fetchWithTimeout(fetchFn, {
        url: OPENAI_CHAT_URL,
        body: {
          model: SUBAGENT_MODEL,
          messages,
          tools: TOOL_DEFS,
          tool_choice: 'auto',
          temperature: 0.2,
          max_tokens: 1500,
        },
        timeoutMs: SUBAGENT_TIMEOUT_MS,
        requireApiKey: fetchFn === fetch,
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      sendEvent({ type: 'subagent-failed', idx: brief.idx, error })
      return failed(brief, error, startedAt, toolCallsUsed, tokensIn, tokensOut)
    }
    if (!res.ok) {
      const error = `OpenAI ${res.status}`
      sendEvent({ type: 'subagent-failed', idx: brief.idx, error })
      return failed(brief, error, startedAt, toolCallsUsed, tokensIn, tokensOut)
    }
    const data = (await res.json()) as {
      choices: Array<{ message: OpenAIMessage }>
      usage: { prompt_tokens: number; completion_tokens: number }
    }
    tokensIn += data.usage?.prompt_tokens ?? 0
    tokensOut += data.usage?.completion_tokens ?? 0
    const msg = data.choices[0]?.message
    if (!msg) {
      sendEvent({ type: 'subagent-failed', idx: brief.idx, error: 'empty response' })
      return failed(brief, 'empty response', startedAt, toolCallsUsed, tokensIn, tokensOut)
    }
    messages.push(msg)

    const calls = msg.tool_calls ?? []
    if (calls.length === 0) {
      sendEvent({ type: 'subagent-failed', idx: brief.idx, error: 'no tool call' })
      return failed(brief, 'no tool call', startedAt, toolCallsUsed, tokensIn, tokensOut)
    }

    for (const call of calls) {
      sendEvent({
        type: 'subagent-tool-call',
        idx: brief.idx,
        toolName: call.function.name as never,
      })
      if (isFinalizeCall(call.function.name)) {
        const args = safeJson(call.function.arguments)
        const { summary, evidence } = parseFinalize(args)
        const status = toolCallsUsed >= brief.boundaries.maxToolCalls ? 'capped' : 'ok'
        const result: SubagentResult = {
          idx: brief.idx,
          status,
          summary,
          evidence,
          toolCallsUsed,
          durationMs: Date.now() - startedAt,
          tokensIn,
          tokensOut,
        }
        sendEvent({
          type: 'subagent-result',
          idx: brief.idx,
          summary,
          evidence,
          toolCallsUsed,
          durationMs: result.durationMs,
        })
        return result
      }
      if (!brief.toolsAllowed.includes(call.function.name as never)) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Tool "${call.function.name}" is not allowed for this subagent.`,
        })
        continue
      }
      const args = safeJson(call.function.arguments)
      try {
        const out = await invokeTool(call.function.name, args, deps)
        toolCallsUsed++
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(out.result).slice(0, 8000),
        })
      } catch (err) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }
  }

  const error = 'iteration cap exceeded without finalize'
  log('warn', 'memory-deep-ask', 'memory.deep-ask.subagent.iter-cap', { idx: brief.idx })
  sendEvent({ type: 'subagent-failed', idx: brief.idx, error })
  return failed(brief, error, startedAt, toolCallsUsed, tokensIn, tokensOut)
}

function failed(
  brief: SubagentBrief,
  error: string,
  startedAt: number,
  toolCallsUsed: number,
  tokensIn: number,
  tokensOut: number
): SubagentResult {
  return {
    idx: brief.idx,
    status: 'failed',
    summary: `Subagent ${brief.idx} failed: ${error}`,
    evidence: [],
    toolCallsUsed,
    durationMs: Date.now() - startedAt,
    error,
    tokensIn,
    tokensOut,
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  args: { url: string; body: unknown; timeoutMs: number; requireApiKey: boolean }
): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), args.timeoutMs)
  try {
    return await fetchFn(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.requireApiKey ? getApiKey() : 'test'}`,
      },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(t)
  }
}
