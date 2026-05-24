import { formatGlossaryPromptSection, normalizePreserveTerms } from '../glossary/promptInjection'
import { log } from '../telemetry/logger'
import {
  buildChatSystemPrompt,
  enforceContextBudget,
  stripCitations,
} from './prompts/chat.v1'
import type { ChatMessage, ChatSource, GlossaryEntry, SearchHit } from './types'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const MODEL = process.env.MEMORY_CHAT_MODEL ?? 'gpt-4o-mini'
const MAX_CONTEXT_CHARS = 20_000
const HISTORY_LIMIT = 6
const RETRIEVAL_K = 10
const SEGMENT_PREVIEW_CHARS = 300

export interface ChatSearchAdapter {
  search(query: string, limit: number): Promise<SearchHit[]>
}

export interface ChatGlossaryAdapter {
  activeGlossary(meetingId: string | null): GlossaryEntry[]
}

type SendEvent = (event: unknown) => void

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string
    }
  }>
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}...`
}

function mapKind(kind: SearchHit['kind']): ChatSource['kind'] {
  if (kind === 'title') return 'meeting-title'
  if (kind === 'summary') return 'meeting-summary'
  return 'segment'
}

function mapHitsToSources(hits: SearchHit[]): ChatSource[] {
  return hits.map((h, i) => {
    const isSegment = h.kind === 'segment'
    const createdAt = h.createdAt ?? h.startedAt
    return {
      marker: i + 1,
      kind: mapKind(h.kind),
      meetingId: h.meetingId,
      meetingTitle: h.meetingTitle,
      segmentId: isSegment && h.segmentId ? h.segmentId : undefined,
      segmentText: truncate(h.sourceText, SEGMENT_PREVIEW_CHARS),
      timestampMs: isSegment ? Math.max(0, createdAt - h.startedAt) : 0,
      meetingStartedAt: h.startedAt,
      score: h.score,
    }
  })
}

function parseDelta(line: string): string | null {
  if (!line.startsWith('data: ')) return null
  const json = line.slice(6).trim()
  if (!json || json === '[DONE]') return null
  let evt: ChatCompletionChunk
  try {
    evt = JSON.parse(json) as ChatCompletionChunk
  } catch {
    return null
  }
  const delta = evt.choices?.[0]?.delta?.content
  return typeof delta === 'string' && delta.length > 0 ? delta : null
}

function countCitations(text: string): number {
  return (text.match(/\[\^\d+\]/g) ?? []).length
}

export async function runChat(
  args: { question: string; history: ChatMessage[] },
  sendEvent: SendEvent,
  search: ChatSearchAdapter,
  repo: ChatGlossaryAdapter
): Promise<void> {
  log('info', 'memory-chat', 'memory.chat.submit', { questionLength: args.question.length })
  sendEvent({ type: 'searching' })

  let hits: SearchHit[]
  const queryStartedAt = Date.now()
  try {
    hits = await search.search(args.question, RETRIEVAL_K)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('warn', 'memory-chat', 'memory.chat.error', { reason: 'search' })
    sendEvent({ type: 'error', message: `Search failed: ${message}` })
    return
  }
  const queryDurationMs = Date.now() - queryStartedAt
  log('info', 'memory-chat', 'memory.chat.retrieved', {
    sourceCount: hits.length,
    queryDurationMs,
  })

  if (hits.length === 0) {
    log('info', 'memory-chat', 'memory.chat.no-context', {
      questionLength: args.question.length,
    })
    sendEvent({ type: 'no_context' })
    return
  }

  const sources = enforceContextBudget(mapHitsToSources(hits), MAX_CONTEXT_CHARS)
  sendEvent({ type: 'retrieved', sources })

  const glossary = repo.activeGlossary(null)
  const glossaryBlock = glossary.length > 0 ? formatGlossaryPromptSection(glossary, null) : ''
  const systemPrompt = buildChatSystemPrompt({ sources, glossaryBlock })
  const messages = [
    { role: 'system', content: systemPrompt },
    ...args.history.slice(-HISTORY_LIMIT).map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? stripCitations(m.content) : m.content,
    })),
    { role: 'user', content: args.question },
  ]

  let res: Response
  const llmStartedAt = Date.now()
  try {
    res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: true,
        temperature: 0.2,
        max_tokens: 1500,
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('warn', 'memory-chat', 'memory.chat.error', { reason: 'network' })
    sendEvent({ type: 'error', message: `Network error: ${message}` })
    return
  }

  if (!res.ok) {
    log('warn', 'memory-chat', 'memory.chat.error', { reason: 'llm' })
    sendEvent({ type: 'error', message: `OpenAI ${res.status}` })
    return
  }
  if (!res.body) {
    log('warn', 'memory-chat', 'memory.chat.error', { reason: 'llm' })
    sendEvent({ type: 'error', message: 'OpenAI response missing body' })
    return
  }

  let fullText = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const delta = parseDelta(line)
      if (delta === null) continue
      fullText += delta
      sendEvent({ type: 'delta', content: delta })
    }
  }

  const tail = decoder.decode()
  if (tail) buffer += tail
  for (const line of buffer.split('\n')) {
    const delta = parseDelta(line)
    if (delta === null) continue
    fullText += delta
    sendEvent({ type: 'delta', content: delta })
  }

  const normalized = normalizePreserveTerms(fullText, glossary)
  log('info', 'memory-chat', 'memory.chat.completed', {
    answerChars: normalized.length,
    llmDurationMs: Date.now() - llmStartedAt,
    citationCount: countCitations(normalized),
  })
  sendEvent({ type: 'done', content: normalized, sources })
}
