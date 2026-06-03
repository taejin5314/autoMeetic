import { normalizePreserveTerms } from '../../glossary/promptInjection'
import type { MemoryService } from '../memoryService'
import type { NumberedCitation } from './citationMerger'
import { buildSynthesizerMessages } from './prompts/synthesizer.v1'
import type { DeepAskEvent, Plan, SubagentResult } from './types'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const SYNTHESIZER_MODEL = process.env.MEMORY_DEEP_ASK_SYNTH_MODEL ?? 'gpt-4o'

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

interface OpenAIStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>
  usage?: { prompt_tokens: number; completion_tokens: number }
}

export interface SynthesizerResult {
  answer: string
  inputTokens: number
  outputTokens: number
}

export async function runSynthesizer(args: {
  question: string
  plan: Plan
  results: SubagentResult[]
  numbered: NumberedCitation[]
  memory: Pick<MemoryService, 'activeGlossary'>
  sendEvent: (e: DeepAskEvent) => void
  fetchFn?: typeof fetch
}): Promise<SynthesizerResult> {
  args.sendEvent({ type: 'synthesizing', sourceCount: args.numbered.length })
  const messages = buildSynthesizerMessages({
    question: args.question,
    plan: args.plan,
    results: args.results,
    numbered: args.numbered,
  })
  const fetchFn = args.fetchFn ?? fetch
  const res = await fetchFn(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${fetchFn === fetch ? getApiKey() : 'test'}`,
    },
    body: JSON.stringify({
      model: SYNTHESIZER_MODEL,
      messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 1500,
      stream_options: { include_usage: true },
    }),
  })
  if (!res.ok || !res.body) throw new Error(`Synthesizer OpenAI ${res.status}`)

  let fullText = ''
  let usage: { prompt_tokens: number; completion_tokens: number } | undefined
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const consumeLine = (line: string) => {
    if (!line.startsWith('data: ')) return
    const json = line.slice(6).trim()
    if (!json || json === '[DONE]') return
    try {
      const evt = JSON.parse(json) as OpenAIStreamChunk
      const delta = evt.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        fullText += delta
        args.sendEvent({ type: 'delta', content: delta })
      }
      if (evt.usage) usage = evt.usage
    } catch {
      // Ignore malformed chunks.
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) consumeLine(line)
  }
  for (const line of buffer.split('\n')) consumeLine(line)

  const glossary = args.memory.activeGlossary(null)
  const normalized = normalizePreserveTerms(fullText, glossary).text
  return {
    answer: normalized,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  }
}
