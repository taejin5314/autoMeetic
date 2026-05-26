import { log } from '../../telemetry/logger'
import type { ChatMessage } from '../types'
import { PLAN_JSON_SCHEMA, buildLeadMessages, parsePlan } from './prompts/lead.v1'
import type { Plan } from './types'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const LEAD_MODEL = process.env.MEMORY_DEEP_ASK_LEAD_MODEL ?? 'gpt-4o'

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

export interface LeadResult {
  plan: Plan
  inputTokens: number
  outputTokens: number
}

export async function callLeadAgent(args: {
  question: string
  history: ChatMessage[]
}): Promise<LeadResult> {
  const messages = buildLeadMessages(args)
  const res = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: LEAD_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: 'json_schema', json_schema: PLAN_JSON_SCHEMA },
    }),
  })
  if (!res.ok) {
    throw new Error(`Lead OpenAI ${res.status}: ${await res.text().catch(() => 'no body')}`)
  }
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>
    usage: { prompt_tokens: number; completion_tokens: number }
  }
  const raw = data.choices[0]?.message?.content
  if (!raw) throw new Error('Lead returned empty content')
  let plan: Plan
  try {
    plan = parsePlan(raw)
  } catch (err) {
    log('warn', 'memory-deep-ask', 'memory.deep-ask.lead.parse-failure', {
      error: err instanceof Error ? err.message : String(err),
      rawSnippet: raw.slice(0, 200),
    })
    throw err
  }
  return {
    plan,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  }
}
