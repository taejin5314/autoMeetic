import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlossaryEntry, SearchHit } from '../main/memory/types'

const logger = vi.hoisted(() => ({
  log: vi.fn(),
}))

vi.mock('../main/telemetry/logger', () => ({
  log: logger.log,
}))

import { runChat } from '../main/memory/chatService'

interface FakeSearch {
  search: (query: string, limit: number) => Promise<SearchHit[]>
}

interface FakeRepo {
  activeGlossary: (meetingId: string | null) => GlossaryEntry[]
}

function hit(over: Partial<SearchHit> & { createdAt?: number }): SearchHit {
  return {
    kind: 'segment',
    meetingId: 'm1',
    meetingTitle: 'Q4',
    startedAt: 1_700_000_000_000,
    segmentId: 's1',
    seq: 1,
    speakerLabel: null,
    sourceText: 'defer mobile',
    translatedText: null,
    score: 0.9,
    ...over,
  } as SearchHit
}

function makeFakes(searchResults: SearchHit[]): {
  search: FakeSearch
  repo: FakeRepo
  events: unknown[]
  sendEvent: (e: unknown) => void
} {
  const events: unknown[] = []
  return {
    search: { search: vi.fn(async () => searchResults) },
    repo: { activeGlossary: vi.fn(() => []) },
    events,
    sendEvent: (e) => events.push(e),
  }
}

const originalFetch = globalThis.fetch

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key'
  logger.log.mockReset()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

function makeFetchResponse(streamLines: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const line of streamLines) controller.enqueue(encoder.encode(`${line}\n`))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('chatService.runChat', () => {
  it('fires no_context when search returns nothing', async () => {
    const f = makeFakes([])
    await runChat({ question: 'q', history: [] }, f.sendEvent, f.search, f.repo)
    expect(f.events).toEqual([{ type: 'searching' }, { type: 'no_context' }])
    expect(f.search.search).toHaveBeenCalledWith('q', 10)
    expect(logger.log).toHaveBeenCalledWith('info', 'memory-chat', 'memory.chat.submit', {
      questionLength: 1,
    })
    expect(logger.log).toHaveBeenCalledWith('info', 'memory-chat', 'memory.chat.no-context', {
      questionLength: 1,
    })
  })

  it('emits searching -> retrieved -> delta(s) -> done in order', async () => {
    const f = makeFakes([hit({ createdAt: 1_700_000_001_000 })])
    globalThis.fetch = vi.fn(async () =>
      makeFetchResponse([
        'data: {"choices":[{"delta":{"content":"hello "}}]}',
        'data: {"choices":[{"delta":{"content":"world"}}]}',
        'data: [DONE]',
      ])
    ) as typeof fetch

    await runChat({ question: 'q', history: [] }, f.sendEvent, f.search, f.repo)

    const types = f.events.map((e) => (e as { type: string }).type)
    expect(types[0]).toBe('searching')
    expect(types[1]).toBe('retrieved')
    expect(types).toContain('delta')
    expect(types[types.length - 1]).toBe('done')
    const done = f.events[f.events.length - 1] as { type: string; content: string }
    expect(done.content).toBe('hello world')
    expect(logger.log).toHaveBeenCalledWith(
      'info',
      'memory-chat',
      'memory.chat.retrieved',
      expect.objectContaining({ sourceCount: 1 })
    )
    expect(logger.log).toHaveBeenCalledWith(
      'info',
      'memory-chat',
      'memory.chat.completed',
      expect.objectContaining({ answerChars: 11, citationCount: 0 })
    )
  })

  it('emits error on fetch non-ok', async () => {
    const f = makeFakes([hit({ sourceText: 'x' })])
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch

    await runChat({ question: 'q', history: [] }, f.sendEvent, f.search, f.repo)

    const last = f.events[f.events.length - 1] as { type: string; message: string }
    expect(last.type).toBe('error')
    expect(last.message).toContain('OpenAI 500')
    expect(logger.log).toHaveBeenCalledWith('warn', 'memory-chat', 'memory.chat.error', {
      reason: 'llm',
    })
  })

  it('maps SearchHit results to ChatSource with marker 1..N', async () => {
    const f = makeFakes([
      hit({
        meetingId: 'm1',
        meetingTitle: 'A',
        segmentId: 's1',
        sourceText: 'first',
        createdAt: 1_700_000_001_000,
        score: 0.9,
      }),
      hit({
        meetingId: 'm2',
        meetingTitle: 'B',
        segmentId: 's2',
        sourceText: 'second',
        createdAt: 1_700_000_002_000,
        score: 0.7,
      }),
    ])
    globalThis.fetch = vi.fn(async () => makeFetchResponse(['data: [DONE]'])) as typeof fetch

    await runChat({ question: 'q', history: [] }, f.sendEvent, f.search, f.repo)

    const retrieved = f.events.find((e) => (e as { type: string }).type === 'retrieved') as {
      type: string
      sources: Array<{ marker: number; segmentText: string; timestampMs: number }>
    }
    expect(retrieved.sources.map((s) => s.marker)).toEqual([1, 2])
    expect(retrieved.sources[0].segmentText).toBe('first')
    expect(retrieved.sources[0].timestampMs).toBe(1000)
  })

  it('maps title and summary hits to chat source kinds', async () => {
    const f = makeFakes([
      hit({ kind: 'title', segmentId: null, sourceText: 'Roadmap Review' }),
      hit({ kind: 'summary', segmentId: null, sourceText: 'Decision summary' }),
    ])
    globalThis.fetch = vi.fn(async () => makeFetchResponse(['data: [DONE]'])) as typeof fetch

    await runChat({ question: 'q', history: [] }, f.sendEvent, f.search, f.repo)

    const retrieved = f.events.find((e) => (e as { type: string }).type === 'retrieved') as {
      sources: Array<{ kind: string; segmentId?: string }>
    }
    expect(retrieved.sources.map((s) => s.kind)).toEqual(['meeting-title', 'meeting-summary'])
    expect(retrieved.sources[0].segmentId).toBeUndefined()
  })

  it('passes recent history to OpenAI with assistant citations stripped', async () => {
    const f = makeFakes([hit({ sourceText: 'foo' })])
    const fetchSpy = vi.fn(async () => makeFetchResponse(['data: [DONE]']))
    globalThis.fetch = fetchSpy as typeof fetch

    await runChat(
      {
        question: 'q',
        history: [
          { id: '1', role: 'user', content: 'earlier q', createdAt: 0 },
          { id: '2', role: 'assistant', content: 'answer [^1] cite', createdAt: 0 },
        ],
      },
      f.sendEvent,
      f.search,
      f.repo
    )

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      messages: Array<{ role: string; content: string }>
    }
    const assistantMsg = body.messages.find((m) => m.role === 'assistant')
    expect(assistantMsg?.content).toBe('answer cite')
  })

  it('runs normalizePreserveTerms on final answer', async () => {
    const f = makeFakes([hit({ sourceText: 'GPU stuff' })])
    f.repo.activeGlossary = vi.fn(() => [
      {
        id: 'g1',
        scope: 'global',
        meetingId: null,
        sourceTerm: 'GPU',
        translations: {},
        preserve: true,
        note: null,
        createdAt: 0,
        updatedAt: 0,
      },
    ])
    globalThis.fetch = vi.fn(async () =>
      makeFetchResponse(['data: {"choices":[{"delta":{"content":"gpu test"}}]}', 'data: [DONE]'])
    ) as typeof fetch

    await runChat({ question: 'q', history: [] }, f.sendEvent, f.search, f.repo)

    const done = f.events[f.events.length - 1] as { type: string; content: string }
    expect(done.content).toBe('GPU test')
    expect(f.repo.activeGlossary).toHaveBeenCalledWith(null)
  })

  it('counts citations in completed telemetry', async () => {
    const f = makeFakes([hit({ sourceText: 'citation source' })])
    globalThis.fetch = vi.fn(async () =>
      makeFetchResponse([
        'data: {"choices":[{"delta":{"content":"answer [^1] "}}]}',
        'data: {"choices":[{"delta":{"content":"and [^2]"}}]}',
        'data: [DONE]',
      ])
    ) as typeof fetch

    await runChat({ question: 'q', history: [] }, f.sendEvent, f.search, f.repo)

    expect(logger.log).toHaveBeenCalledWith(
      'info',
      'memory-chat',
      'memory.chat.completed',
      expect.objectContaining({ citationCount: 2 })
    )
  })
})
