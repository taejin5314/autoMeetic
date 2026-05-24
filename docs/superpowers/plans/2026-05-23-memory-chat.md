# Memory Library Chat — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Checkbox (`- [ ]`) tracking. Phase-by-phase. Each phase ends in clean typecheck + lint + tests before moving on. Read `HANDOFF.md` first for environment quirks.

**Goal:** Ship a cross-meeting RAG chat in the Memory Library "Ask" tab. Users type natural-language questions, the existing `SearchService` retrieves relevant segments, and `gpt-4o-mini` streams a cited answer.

**Architecture:** New `chatService` in main orchestrates `SearchService` → prompt build → OpenAI stream → `normalizePreserveTerms` post-pass. IPC mirrors Answer Assist's SSE pattern. Renderer adds an `<AskTab>` inside `<MemoryLibraryPanel>` (now a tab container), with a `useChatStore` hook persisting to localStorage. Citations are clickable footnote chips that switch to the Meetings tab and flash the source segment.

**Tech Stack:** Electron, React 19, TypeScript strict (NO `any`), better-sqlite3 (unchanged), vitest, OpenAI Chat Completions (gpt-4o-mini, stream=true).

**Spec:** `docs/superpowers/specs/2026-05-23-memory-chat-design.md`

**Scope reminder (do NOT exceed):** Plain text rendering. Single rolling chat. No markdown library. No filter UI. No mind-map auto-visualization. No voice. No export.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/main/memory/types.ts` | Modify | Add `ChatSource`, `ChatMessage`, `ChatHistoryStored` |
| `src/main/memory/prompts/chat.v1.ts` | Create | `buildChatSystemPrompt` + `formatSourcesBlock` + `stripCitations` |
| `src/main/memory/chatService.ts` | Create | `runChat(args, sendEvent)` orchestration |
| `src/main/ipc-memory-handlers.ts` | Modify | `'memory:chat'` handler |
| `src/preload/index.ts` | Modify | Expose `memory.chat` + `memory.onChatEvent` |
| `src/preload/types.ts` | Modify | Type additions |
| `src/renderer/ask/types.ts` | Create | Re-export `ChatSource`, `ChatMessage` |
| `src/renderer/ask/parseAnswerWithCitations.ts` | Create | Marker → parts helper |
| `src/renderer/ask/useChatStore.ts` | Create | Store with submit/stop/newChat + localStorage |
| `src/renderer/ask/AskInput.tsx` | Create | Input box |
| `src/renderer/ask/ChatMessageView.tsx` | Create | Single message render |
| `src/renderer/ask/SourcesList.tsx` | Create | Sources card |
| `src/renderer/ask/AskTab.tsx` | Create | Tab container assembling above |
| `src/renderer/library/MeetingsTab.tsx` | Create | Wrapper around existing meeting list |
| `src/renderer/library/MemoryLibraryPanel.tsx` | Modify | Tab container; pass `highlightSegmentId` to MeetingsTab |
| `src/renderer/App.css` | Modify | Chat styles + flash animation + tab styles |
| `src/test/chat-prompt.test.ts` | Create | 7+ tests |
| `src/test/chat-service.test.ts` | Create | 6+ tests |
| `src/test/chat-ipc.test.ts` | Create | 4+ tests |

---

## Phase 1 — Types + prompt helpers (TDD)

### Task 1.1 — Add chat types

**Files:** `src/main/memory/types.ts`

- [ ] **Step 1: Append types**

```ts
export interface ChatSource {
  marker: number
  kind: 'segment' | 'meeting-title' | 'meeting-summary'
  meetingId: string
  meetingTitle: string
  segmentId?: string
  segmentText: string
  timestampMs: number
  meetingStartedAt: number
  score: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  createdAt: number
  error?: string
}

export interface ChatHistoryStored {
  version: 1
  messages: ChatMessage[]
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/main/memory/types.ts
git commit -m "feat(memory-chat): add ChatSource + ChatMessage types"
```

---

### Task 1.2 — `chat.v1.ts` prompt helpers (TDD)

**Files:** `src/main/memory/prompts/chat.v1.ts`, `src/test/chat-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/chat-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildChatSystemPrompt,
  enforceContextBudget,
  formatSourcesBlock,
  stripCitations,
} from '../main/memory/prompts/chat.v1'
import type { ChatSource } from '../main/memory/types'

function src(over: Partial<ChatSource>): ChatSource {
  return {
    marker: 1,
    kind: 'segment',
    meetingId: 'mtg_1',
    meetingTitle: 'Meeting',
    segmentId: 's1',
    segmentText: 'hello world',
    timestampMs: 0,
    meetingStartedAt: 1_700_000_000_000,
    score: 0.9,
    ...over,
  }
}

describe('formatSourcesBlock', () => {
  it('renders each source with marker, title, timestamp, preview', () => {
    const block = formatSourcesBlock([
      src({ marker: 1, meetingTitle: 'Q4 OKR', segmentText: 'defer mobile' }),
      src({ marker: 2, meetingTitle: '1:1 with Sarah', segmentText: 'migration risk' }),
    ])
    expect(block).toMatch(/\[1\] Meeting "Q4 OKR"/)
    expect(block).toContain('defer mobile')
    expect(block).toMatch(/\[2\] Meeting "1:1 with Sarah"/)
    expect(block).toContain('migration risk')
  })

  it('marks meeting-summary kind explicitly', () => {
    const block = formatSourcesBlock([src({ kind: 'meeting-summary' })])
    expect(block).toContain('[summary]')
  })
})

describe('buildChatSystemPrompt', () => {
  it('includes sources block and rules', () => {
    const out = buildChatSystemPrompt({
      sources: [src({ segmentText: 'foo' })],
      glossaryBlock: '',
    })
    expect(out).toContain('SOURCES')
    expect(out).toContain('Use ONLY information from the SOURCES')
    expect(out).toContain('foo')
  })

  it('appends glossary block when present', () => {
    const out = buildChatSystemPrompt({
      sources: [src({})],
      glossaryBlock: 'GLOSSARY: keep GPU verbatim',
    })
    expect(out).toContain('GLOSSARY: keep GPU verbatim')
  })

  it('omits glossary section when empty', () => {
    const out = buildChatSystemPrompt({ sources: [src({})], glossaryBlock: '' })
    expect(out).not.toContain('GLOSSARY')
  })
})

describe('enforceContextBudget', () => {
  it('keeps every source when under budget', () => {
    const list = [src({ segmentText: 'a'.repeat(50) }), src({ segmentText: 'b'.repeat(50) })]
    expect(enforceContextBudget(list, 1000)).toHaveLength(2)
  })

  it('stops at the first source that would exceed budget', () => {
    const list = [
      src({ marker: 1, segmentText: 'a'.repeat(900) }),
      src({ marker: 2, segmentText: 'b'.repeat(900) }),
      src({ marker: 3, segmentText: 'c'.repeat(900) }),
    ]
    const out = enforceContextBudget(list, 1500)
    expect(out.map((s) => s.marker)).toEqual([1])
  })
})

describe('stripCitations', () => {
  it('removes single [^N] markers', () => {
    expect(stripCitations('mobile defer [^1] confirmed')).toBe('mobile defer confirmed')
  })

  it('removes multiple markers including multi-digit', () => {
    expect(stripCitations('foo [^1] bar [^23] baz [^4]')).toBe('foo bar baz')
  })

  it('collapses extra whitespace after removal', () => {
    expect(stripCitations('foo   [^1]    bar')).toBe('foo bar')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/chat-prompt.test.ts
```

Expect FAIL — module not found.

- [ ] **Step 3: Implement** `src/main/memory/prompts/chat.v1.ts`:

```ts
import type { ChatSource } from '../types'

const RULES = `Rules:
- Use ONLY information from the SOURCES above. Do not speculate or use
  outside knowledge.
- Every factual claim must be backed by a citation [^N] pointing to a
  source in the list above.
- If the SOURCES don't contain enough information to answer, say so
  explicitly. Do not fabricate facts, meeting titles, dates, or speakers.
- Be concise. 1-4 short paragraphs max.
- Answer in the language of the user's question.
- A direct quotation is encouraged when it sharpens the answer — keep
  quotations short (1-2 sentences) and always cite.
- Do not invent citation numbers beyond what is listed.
- Output plain prose. Do not use markdown formatting.`

function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatSourcesBlock(sources: ChatSource[]): string {
  return sources
    .map((s) => {
      const ts = formatMmSs(s.timestampMs)
      const kind = s.kind === 'meeting-summary' ? ' [summary]' : ''
      const date = formatDate(s.meetingStartedAt)
      return `[${s.marker}] Meeting "${s.meetingTitle}" (${date}, ${ts})${kind}:\n    "${s.segmentText}"`
    })
    .join('\n')
}

interface BuildArgs {
  sources: ChatSource[]
  glossaryBlock: string
}

export function buildChatSystemPrompt(args: BuildArgs): string {
  const sources = formatSourcesBlock(args.sources)
  const glossaryTail = args.glossaryBlock ? `\n\n${args.glossaryBlock}` : ''
  return `You are a meeting knowledge assistant for autoMeetic. The user is asking
about their past meetings. Answer using ONLY the SOURCES below.

SOURCES (cite by [^N] when referencing):
${sources}

${RULES}${glossaryTail}`
}

export function enforceContextBudget(
  sources: ChatSource[],
  maxChars: number
): ChatSource[] {
  let total = 0
  const out: ChatSource[] = []
  for (const s of sources) {
    const cost = s.segmentText.length + 80
    if (total + cost > maxChars) break
    out.push(s)
    total += cost
  }
  return out
}

export function stripCitations(text: string): string {
  return text.replace(/\[\^\d+\]/g, '').replace(/[ \t]{2,}/g, ' ').trim()
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/chat-prompt.test.ts
npm run typecheck
git add src/main/memory/prompts/chat.v1.ts src/test/chat-prompt.test.ts
git commit -m "feat(memory-chat): prompt builder + citation helpers"
```

---

## Phase 2 — Chat service (TDD)

### Task 2.1 — `chatService.runChat` orchestration

**Files:** `src/main/memory/chatService.ts`, `src/test/chat-service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/chat-service.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { runChat } from '../main/memory/chatService'
import type { SearchHit } from '../main/memory/types'

interface FakeSearch {
  search: (q: string, k: number) => Promise<SearchHit[]>
}

interface FakeRepo {
  activeGlossary: () => []
}

function makeFakes(searchResults: SearchHit[]): {
  search: FakeSearch
  repo: FakeRepo
  events: unknown[]
  sendEvent: (e: unknown) => void
} {
  const events: unknown[] = []
  return {
    search: { search: async () => searchResults },
    repo: { activeGlossary: () => [] },
    events,
    sendEvent: (e) => events.push(e),
  }
}

const originalFetch = globalThis.fetch

beforeEach(() => {
  // OpenAI API key required by service; set fake one for tests.
  process.env.OPENAI_API_KEY = 'test-key'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

function makeFetchResponse(streamLines: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const line of streamLines) controller.enqueue(encoder.encode(line + '\n'))
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
  })

  it('emits searching → retrieved → delta(s) → done in order', async () => {
    const f = makeFakes([
      {
        kind: 'segment',
        meetingId: 'm1',
        meetingTitle: 'Q4',
        meetingStartedAt: 1_700_000_000_000,
        segmentId: 's1',
        sourceText: 'defer mobile',
        createdAt: 1_700_000_001_000,
        score: 0.9,
      } as SearchHit,
    ])
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
  })

  it('emits error on fetch non-ok', async () => {
    const f = makeFakes([
      {
        kind: 'segment',
        meetingId: 'm1',
        meetingTitle: 'Q4',
        meetingStartedAt: 1_700_000_000_000,
        segmentId: 's1',
        sourceText: 'x',
        createdAt: 1_700_000_001_000,
        score: 0.9,
      } as SearchHit,
    ])
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch
    await runChat({ question: 'q', history: [] }, f.sendEvent, f.search, f.repo)
    const last = f.events[f.events.length - 1] as { type: string }
    expect(last.type).toBe('error')
  })

  it('maps SearchHit segments to ChatSource with marker 1..N', async () => {
    const f = makeFakes([
      {
        kind: 'segment',
        meetingId: 'm1',
        meetingTitle: 'A',
        meetingStartedAt: 1_700_000_000_000,
        segmentId: 's1',
        sourceText: 'first',
        createdAt: 1_700_000_001_000,
        score: 0.9,
      } as SearchHit,
      {
        kind: 'segment',
        meetingId: 'm2',
        meetingTitle: 'B',
        meetingStartedAt: 1_700_000_000_000,
        segmentId: 's2',
        sourceText: 'second',
        createdAt: 1_700_000_002_000,
        score: 0.7,
      } as SearchHit,
    ])
    globalThis.fetch = vi.fn(async () => makeFetchResponse(['data: [DONE]'])) as typeof fetch
    await runChat({ question: 'q', history: [] }, f.sendEvent, f.search, f.repo)
    const retrieved = f.events.find((e) => (e as { type: string }).type === 'retrieved') as {
      type: string
      sources: Array<{ marker: number; segmentText: string }>
    }
    expect(retrieved.sources.map((s) => s.marker)).toEqual([1, 2])
    expect(retrieved.sources[0].segmentText).toBe('first')
  })

  it('passes recent history to OpenAI (citation stripped)', async () => {
    const f = makeFakes([
      {
        kind: 'segment',
        meetingId: 'm1',
        meetingTitle: 'A',
        meetingStartedAt: 1_700_000_000_000,
        segmentId: 's1',
        sourceText: 'foo',
        createdAt: 1_700_000_001_000,
        score: 0.9,
      } as SearchHit,
    ])
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
    const assistantMsg = body.messages.find((m) => m.role === 'assistant')!
    expect(assistantMsg.content).toBe('answer cite')
  })

  it('runs normalizePreserveTerms on final answer', async () => {
    // glossary has 'GPU' preserve; LLM streams 'gpu test'; final should be 'GPU test'
    const f = makeFakes([
      {
        kind: 'segment',
        meetingId: 'm1',
        meetingTitle: 'A',
        meetingStartedAt: 1_700_000_000_000,
        segmentId: 's1',
        sourceText: 'GPU stuff',
        createdAt: 1_700_000_001_000,
        score: 0.9,
      } as SearchHit,
    ])
    f.repo.activeGlossary = () =>
      [
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
      ] as never
    globalThis.fetch = vi.fn(async () =>
      makeFetchResponse(['data: {"choices":[{"delta":{"content":"gpu test"}}]}', 'data: [DONE]'])
    ) as typeof fetch
    await runChat({ question: 'q', history: [] }, f.sendEvent, f.search, f.repo)
    const done = f.events[f.events.length - 1] as { type: string; content: string }
    expect(done.content).toBe('GPU test')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/chat-service.test.ts
```

Expect FAIL.

- [ ] **Step 3: Implement `chatService.ts`**

Create `src/main/memory/chatService.ts`:

```ts
import { normalizePreserveTerms, formatGlossaryPromptSection } from '../glossary/promptInjection'
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

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + '…'
}

function mapHitsToSources(hits: SearchHit[]): ChatSource[] {
  return hits.map((h, i) => {
    const isSegment = h.kind === 'segment'
    const preview = truncate(h.sourceText ?? h.summary ?? '', SEGMENT_PREVIEW_CHARS)
    return {
      marker: i + 1,
      kind: h.kind,
      meetingId: h.meetingId,
      meetingTitle: h.meetingTitle,
      segmentId: isSegment ? h.segmentId : undefined,
      segmentText: preview,
      timestampMs: isSegment ? Math.max(0, h.createdAt - h.meetingStartedAt) : 0,
      meetingStartedAt: h.meetingStartedAt,
      score: h.score,
    }
  })
}

export async function runChat(
  args: { question: string; history: ChatMessage[] },
  sendEvent: SendEvent,
  search: ChatSearchAdapter,
  repo: ChatGlossaryAdapter
): Promise<void> {
  sendEvent({ type: 'searching' })

  let hits: SearchHit[]
  try {
    hits = await search.search(args.question, RETRIEVAL_K)
  } catch (err) {
    sendEvent({ type: 'error', message: `Search failed: ${err instanceof Error ? err.message : String(err)}` })
    return
  }

  if (hits.length === 0) {
    sendEvent({ type: 'no_context' })
    return
  }

  const allSources = mapHitsToSources(hits)
  const sources = enforceContextBudget(allSources, MAX_CONTEXT_CHARS)
  sendEvent({ type: 'retrieved', sources })

  const glossary = repo.activeGlossary(null)
  const glossaryBlock =
    glossary.length > 0 ? formatGlossaryPromptSection(glossary, null) : ''
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
    sendEvent({ type: 'error', message: `Network error: ${err instanceof Error ? err.message : String(err)}` })
    return
  }

  if (!res.ok) {
    sendEvent({ type: 'error', message: `OpenAI ${res.status}` })
    return
  }

  let fullText = ''
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const json = line.slice(6).trim()
      if (!json || json === '[DONE]') continue
      let evt: { choices?: Array<{ delta?: { content?: string } }> }
      try {
        evt = JSON.parse(json)
      } catch {
        continue
      }
      const delta = evt.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        fullText += delta
        sendEvent({ type: 'delta', content: delta })
      }
    }
  }

  const normalized = normalizePreserveTerms(fullText, glossary)
  sendEvent({ type: 'done', content: normalized, sources })
}
```

**Note:** The `SearchHit` import requires `meetingTitle`, `meetingStartedAt`, and a discriminated `kind` field on each hit. If the existing `SearchHit` type in `types.ts` doesn't expose those, extend the type or adjust the repository's `lookupSearchHits` helper to include them. Grep for `interface SearchHit` first; the v1 glossary work and memory library already use most of these fields.

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/chat-service.test.ts
npm run typecheck
git add src/main/memory/chatService.ts src/test/chat-service.test.ts
git commit -m "feat(memory-chat): chat service orchestration"
```

---

## Phase 3 — IPC + preload (TDD)

### Task 3.1 — IPC handler

**Files:** `src/main/ipc-memory-handlers.ts`

- [ ] **Step 1: Read the file's existing handler shape**

Grep for `getMemoryService` and `memoryServiceRef` to understand how existing handlers access the repository. Memory handlers receive `getMemory` factory in `buildMemoryHandlers` per Phase 4 of glossary v1.

- [ ] **Step 2: Add `memory:chat` handler**

Inside `buildMemoryHandlers`, register:

```ts
'memory:chat': async (
  args: { question: string; history: ChatMessage[] },
  context: { sendEvent: (channel: string, payload: unknown) => void }
) => {
  const memory = await getReadyMemory(getMemory)
  const { runChat } = await import('./memory/chatService')
  await runChat(
    args,
    (event) => context.sendEvent('memory:chat:event', event),
    memory.searchService,
    memory.repository
  )
}
```

If the handler factory does not currently pass a `context.sendEvent` (only returns the value), introduce a small ipc wrapper that uses `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, payload))`. Look at the auto-suggestions implementation in `ipc-glossary-handlers.ts` for the `broadcastSuggestionsUpdated` pattern — copy that idiom.

The simplest path: register `memory:chat` directly in `registerIpcHandlers` (not inside `buildMemoryHandlers`), since it needs side-channel event emission. Match how `start-answer-assist` is wired in `src/main/ipc.ts`:

```ts
// in src/main/ipc.ts registerIpcHandlers
ipcMain.handle(
  'memory:chat',
  async (_event, args: { question: string; history: ChatMessage[] }) => {
    const memory = await getMemoryService()
    const { runChat } = await import('./memory/chatService')
    await runChat(
      args,
      (event) => mainWindowRef?.webContents.send('memory:chat:event', event),
      memory.searchService,
      memory.repository
    )
  }
)
```

This mirrors the existing `start-answer-assist` handler shape (callback for event delivery via `mainWindowRef.webContents.send`).

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
git add src/main/ipc.ts
git commit -m "feat(memory-chat): IPC handler for memory:chat"
```

---

### Task 3.2 — Preload bridge

**Files:** `src/preload/index.ts`, `src/preload/types.ts`

- [ ] **Step 1: Expose bridge**

Inside the existing `memory: {...}` object in `src/preload/index.ts`:

```ts
chat: (args: { question: string; history: ChatMessage[] }) =>
  ipcRenderer.invoke('memory:chat', args),
onChatEvent: createEventListener('memory:chat:event'),
```

- [ ] **Step 2: Extend types**

In `src/preload/types.ts`, add to `MemoryAPI`:

```ts
chat(args: { question: string; history: ChatMessage[] }): Promise<void>
onChatEvent(handler: (event: unknown) => void): () => void
```

Add `ChatMessage` to the import line at the top from `'../main/memory/types'`.

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
git add src/preload/index.ts src/preload/types.ts
git commit -m "feat(memory-chat): preload bridge for chat + events"
```

---

### Task 3.3 — IPC smoke test

**Files:** `src/test/chat-ipc.test.ts`

- [ ] **Step 1: Skeleton smoke test (parallels other IPC tests)**

Mirror the existing `glossary-ipc-handlers.test.ts` pattern. Tests verify:

- `memory:chat` handler awaits the memory service before invoking `runChat`
- A mocked `mainWindowRef.webContents.send` receives each event from `runChat`
- Preload's `memory.chat` invokes the correct channel

If the IPC layer in `src/main/ipc.ts` is hard to test in isolation (uses singleton `mainWindowRef`), wrap the relevant block in a small exported factory function that takes the window reference as an argument; then unit-test that. Plan ~4 tests.

- [ ] **Step 2: Run + commit**

```bash
npx vitest run src/test/chat-ipc.test.ts
git add src/test/chat-ipc.test.ts src/main/ipc.ts
git commit -m "test(memory-chat): IPC round-trip smoke tests"
```

---

## Phase 4 — Renderer types + store + parser

### Task 4.1 — Renderer type re-export + citation parser

**Files:** `src/renderer/ask/types.ts`, `src/renderer/ask/parseAnswerWithCitations.ts`

- [ ] **Step 1: Create re-export**

`src/renderer/ask/types.ts`:

```ts
export type { ChatMessage, ChatSource } from '../../main/memory/types'
```

- [ ] **Step 2: Implement parser (no tests — pure function, will be covered indirectly via render testing)**

`src/renderer/ask/parseAnswerWithCitations.ts`:

```ts
import type { ChatSource } from './types'

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'cite'; source: ChatSource; marker: number }

export function parseAnswerWithCitations(
  content: string,
  sources: ChatSource[]
): ChatPart[] {
  const markerRe = /\[\^(\d+)\]/g
  const parts: ChatPart[] = []
  let lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = markerRe.exec(content)) !== null) {
    if (m.index > lastIdx) parts.push({ type: 'text', text: content.slice(lastIdx, m.index) })
    const marker = Number.parseInt(m[1], 10)
    const source = sources.find((s) => s.marker === marker)
    if (source) parts.push({ type: 'cite', source, marker })
    else parts.push({ type: 'text', text: m[0] })
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < content.length) parts.push({ type: 'text', text: content.slice(lastIdx) })
  return parts
}
```

- [ ] **Step 3: Commit**

```bash
npm run typecheck
git add src/renderer/ask/types.ts src/renderer/ask/parseAnswerWithCitations.ts
git commit -m "feat(memory-chat): renderer types + citation parser"
```

---

### Task 4.2 — `useChatStore`

**Files:** `src/renderer/ask/useChatStore.ts`

- [ ] **Step 1: Implement**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ChatSource } from './types'

const STORAGE_KEY = 'automeetic.askHistory'
const MAX_MESSAGES = 50

interface StoredHistory {
  version: 1
  messages: ChatMessage[]
}

function loadHistory(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredHistory
    if (parsed.version !== 1 || !Array.isArray(parsed.messages)) return []
    return parsed.messages
  } catch {
    return []
  }
}

function saveHistory(messages: ChatMessage[]): void {
  if (typeof window === 'undefined') return
  try {
    const capped = messages.slice(-MAX_MESSAGES)
    const payload: StoredHistory = { version: 1, messages: capped }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // quota / SecurityError: in-memory state still works
  }
}

function newId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export interface ChatStore {
  messages: ChatMessage[]
  isStreaming: boolean
  meetingCount: number
  submit(question: string): void
  stop(): void
  newChat(): void
}

export function useChatStore(): ChatStore {
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory)
  const [isStreaming, setIsStreaming] = useState(false)
  const [meetingCount, setMeetingCount] = useState(0)
  const requestIdRef = useRef<string | null>(null)
  const streamingMsgIdRef = useRef<string | null>(null)
  const messagesRef = useRef<ChatMessage[]>(messages)
  messagesRef.current = messages

  // Persist to localStorage on every change
  useEffect(() => {
    saveHistory(messages)
  }, [messages])

  // Load meeting count on mount
  useEffect(() => {
    const api = window.electronAPI?.memory
    if (!api?.listMeetings) return
    void api.listMeetings({ limit: 1, offset: 0 }).then((list) => {
      if (Array.isArray(list)) setMeetingCount(list.length > 0 ? -1 : 0)
    })
    // ^ if a `count-meetings` IPC is available later, replace this.
  }, [])

  // Subscribe to chat events
  useEffect(() => {
    const api = window.electronAPI?.memory
    if (!api?.onChatEvent) return
    return api.onChatEvent((rawEvent: unknown) => {
      const event = rawEvent as
        | { type: 'searching' }
        | { type: 'retrieved'; sources: ChatSource[] }
        | { type: 'no_context' }
        | { type: 'delta'; content: string }
        | { type: 'done'; content: string; sources: ChatSource[] }
        | { type: 'error'; message: string }

      const msgId = streamingMsgIdRef.current
      if (!msgId) return

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msgId)
        if (idx === -1) return prev
        const next = [...prev]
        const cur = { ...next[idx] }
        if (event.type === 'retrieved') {
          cur.sources = event.sources
        } else if (event.type === 'no_context') {
          cur.content = 'No relevant meetings found.'
        } else if (event.type === 'delta') {
          cur.content = (cur.content ?? '') + event.content
        } else if (event.type === 'done') {
          cur.content = event.content
          cur.sources = event.sources
        } else if (event.type === 'error') {
          cur.error = event.message
        }
        next[idx] = cur
        return next
      })

      if (event.type === 'done' || event.type === 'error' || event.type === 'no_context') {
        setIsStreaming(false)
        streamingMsgIdRef.current = null
      }
    })
  }, [])

  const submit = useCallback((question: string) => {
    const trimmed = question.trim()
    if (!trimmed) return
    const api = window.electronAPI?.memory
    if (!api?.chat) return

    const userMsg: ChatMessage = {
      id: newId(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    }
    const assistantMsg: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    }
    streamingMsgIdRef.current = assistantMsg.id
    requestIdRef.current = assistantMsg.id
    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setIsStreaming(true)

    // History sent to backend: prior messages only (exclude the new assistant placeholder)
    const history = messagesRef.current
    void api.chat({ question: trimmed, history })
  }, [])

  const stop = useCallback(() => {
    const msgId = streamingMsgIdRef.current
    streamingMsgIdRef.current = null
    requestIdRef.current = null
    setIsStreaming(false)
    if (msgId) {
      setMessages((prev) => prev.filter((m) => m.id !== msgId || m.content.length > 0))
    }
  }, [])

  const newChat = useCallback(() => {
    if (streamingMsgIdRef.current) {
      stop()
    }
    setMessages([])
  }, [stop])

  return { messages, isStreaming, meetingCount, submit, stop, newChat }
}
```

**Note:** `meetingCount` loading uses `listMeetings({ limit: 1, offset: 0 })` as a stand-in for a proper count query. The empty-state UI just needs "0 vs. >0" granularity to display "no meetings yet" vs. examples. If a real count IPC exists or gets added, swap in.

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/renderer/ask/useChatStore.ts
git commit -m "feat(memory-chat): renderer chat store"
```

---

## Phase 5 — Renderer UI (AskTab + sub-components + styles)

### Task 5.1 — `AskInput.tsx`

**Files:** `src/renderer/ask/AskInput.tsx`

- [ ] **Step 1: Create input component**

```tsx
import { useState } from 'react'

interface Props {
  isStreaming: boolean
  onSubmit: (question: string) => void
  onStop: () => void
}

export function AskInput({ isStreaming, onSubmit, onStop }: Props) {
  const [value, setValue] = useState('')

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setValue('')
  }

  return (
    <form
      className="ask-input"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <textarea
        className="ask-input-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={isStreaming ? 'Streaming…' : 'Ask anything about your past meetings…'}
        disabled={isStreaming}
        rows={2}
        maxLength={2000}
      />
      {isStreaming ? (
        <button type="button" className="ask-input-stop" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button
          type="submit"
          className="ask-input-send"
          disabled={value.trim().length === 0}
        >
          Send →
        </button>
      )}
    </form>
  )
}
```

- [ ] **Step 2: Commit**

```bash
npm run typecheck
git add src/renderer/ask/AskInput.tsx
git commit -m "feat(memory-chat): AskInput component"
```

---

### Task 5.2 — `SourcesList.tsx`

**Files:** `src/renderer/ask/SourcesList.tsx`

- [ ] **Step 1: Create**

```tsx
import type { ChatSource } from './types'

interface Props {
  sources: ChatSource[]
  onClickSource: (source: ChatSource) => void
}

function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

export function SourcesList({ sources, onClickSource }: Props) {
  if (sources.length === 0) return null
  return (
    <div className="ask-sources">
      <div className="ask-sources-title">Sources</div>
      <ul className="ask-sources-list">
        {sources.map((s) => (
          <li key={s.marker}>
            <button
              type="button"
              className="ask-sources-item"
              onClick={() => onClickSource(s)}
            >
              <span className="ask-sources-marker amw-mono">{s.marker}</span>
              <span className="ask-sources-meta">
                {s.meetingTitle} · {formatDate(s.meetingStartedAt)} {formatMmSs(s.timestampMs)}
              </span>
              <span className="ask-sources-preview">"{s.segmentText}"</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
npm run typecheck
git add src/renderer/ask/SourcesList.tsx
git commit -m "feat(memory-chat): SourcesList component"
```

---

### Task 5.3 — `ChatMessageView.tsx`

**Files:** `src/renderer/ask/ChatMessageView.tsx`

- [ ] **Step 1: Create**

```tsx
import { parseAnswerWithCitations } from './parseAnswerWithCitations'
import { SourcesList } from './SourcesList'
import type { ChatMessage, ChatSource } from './types'

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface Props {
  message: ChatMessage
  isStreaming: boolean
  onCitationClick: (source: ChatSource) => void
}

export function ChatMessageView({ message, isStreaming, onCitationClick }: Props) {
  if (message.role === 'user') {
    return (
      <div className="ask-msg ask-msg-user">
        <div className="ask-msg-role amw-mono">You · {formatTime(message.createdAt)}</div>
        <div className="ask-msg-content">{message.content}</div>
      </div>
    )
  }

  const parts = parseAnswerWithCitations(message.content, message.sources ?? [])

  return (
    <div className="ask-msg ask-msg-assistant">
      <div className="ask-msg-role amw-mono">
        Assistant · {formatTime(message.createdAt)}
      </div>
      {message.error ? (
        <div className="ask-msg-error">{message.error}</div>
      ) : (
        <>
          <div className="ask-msg-content">
            {parts.map((p, i) =>
              p.type === 'text' ? (
                <span key={i}>{p.text}</span>
              ) : (
                <button
                  key={i}
                  type="button"
                  className="ask-citation amw-mono"
                  title={p.source.meetingTitle}
                  onClick={() => onCitationClick(p.source)}
                >
                  {p.marker}
                </button>
              )
            )}
            {isStreaming && <span className="ask-cursor">▍</span>}
          </div>
          {message.sources && message.sources.length > 0 && (
            <SourcesList sources={message.sources} onClickSource={onCitationClick} />
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
npm run typecheck
git add src/renderer/ask/ChatMessageView.tsx
git commit -m "feat(memory-chat): ChatMessageView component"
```

---

### Task 5.4 — `AskTab.tsx`

**Files:** `src/renderer/ask/AskTab.tsx`

- [ ] **Step 1: Create**

```tsx
import { useEffect, useRef } from 'react'
import { AskInput } from './AskInput'
import { ChatMessageView } from './ChatMessageView'
import type { ChatSource } from './types'
import { useChatStore } from './useChatStore'

interface Props {
  meetingCount: number
  onCitationClick: (source: ChatSource) => void
}

export function AskTab({ meetingCount, onCitationClick }: Props) {
  const store = useChatStore()
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new message or streaming token
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [store.messages])

  const streamingMsgId = store.isStreaming
    ? store.messages[store.messages.length - 1]?.id
    : null

  return (
    <div className="ask-tab">
      <header className="ask-tab-header">
        <div className="ask-tab-title">
          Ask your meetings
          {meetingCount > 0 && (
            <span className="ask-tab-count amw-mono"> · {meetingCount} meetings</span>
          )}
        </div>
        <button
          type="button"
          className="ask-tab-new"
          onClick={store.newChat}
          disabled={store.messages.length === 0 && !store.isStreaming}
        >
          + New chat
        </button>
      </header>

      <div className="ask-tab-list amw-scroll" ref={listRef}>
        {store.messages.length === 0 ? (
          <div className="ask-empty">
            <h3>Ask anything about your past meetings</h3>
            {meetingCount === 0 ? (
              <p>No meetings yet. Start a meeting to build your searchable memory.</p>
            ) : (
              <ul className="ask-examples">
                <li>"What were our Q4 OKR conclusions?"</li>
                <li>"Who pushed back on the migration timeline?"</li>
                <li>"Summarize all decisions about pricing"</li>
              </ul>
            )}
          </div>
        ) : (
          store.messages.map((m) => (
            <ChatMessageView
              key={m.id}
              message={m}
              isStreaming={store.isStreaming && m.id === streamingMsgId}
              onCitationClick={onCitationClick}
            />
          ))
        )}
      </div>

      <AskInput
        isStreaming={store.isStreaming}
        onSubmit={store.submit}
        onStop={store.stop}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
npm run typecheck
git add src/renderer/ask/AskTab.tsx
git commit -m "feat(memory-chat): AskTab container"
```

---

### Task 5.5 — Convert `MemoryLibraryPanel` to tab container

**Files:** `src/renderer/library/MeetingsTab.tsx` (new), `src/renderer/library/MemoryLibraryPanel.tsx` (refactor)

- [ ] **Step 1: Read existing `MemoryLibraryPanel`**

Read the file to identify the existing meeting list + detail UI block. Extract that block into a new component `<MeetingsTab>` that accepts the same props plus a new optional `highlightSegmentId?: string` prop.

- [ ] **Step 2: Create `MeetingsTab.tsx`**

Move the existing meeting-list-and-detail JSX from `MemoryLibraryPanel` into this new file. Wire `highlightSegmentId` to flash the matching segment row in the detail view:
- Add `data-highlight` attribute on the segment element when its id equals `highlightSegmentId`
- After component mount or `highlightSegmentId` change, scroll that element into view via `ref.scrollIntoView({ behavior: 'smooth', block: 'center' })`

If extracting is non-trivial, do this in two commits: first a structural extract with no behavior change, then add the `highlightSegmentId` prop.

- [ ] **Step 3: Refactor `MemoryLibraryPanel.tsx` to a tab container**

```tsx
import { useState } from 'react'
import { AskTab } from '../ask/AskTab'
import { MeetingsTab } from './MeetingsTab'
import type { ChatSource } from '../ask/types'

interface Props {
  open: boolean
  onClose: () => void
}

type Tab = 'meetings' | 'ask'

export function MemoryLibraryPanel({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('meetings')
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [highlightSegmentId, setHighlightSegmentId] = useState<string | null>(null)
  const [meetingCount, setMeetingCount] = useState(0)
  // ...load meetingCount via electronAPI.memory.listMeetings as before...

  if (!open) return null

  const handleCitationClick = (source: ChatSource) => {
    setTab('meetings')
    setSelectedMeetingId(source.meetingId)
    if (source.segmentId) {
      setHighlightSegmentId(source.segmentId)
      window.setTimeout(() => setHighlightSegmentId(null), 800)
    }
  }

  return (
    <div className="memory-library-overlay" role="dialog" aria-label="Meeting memory">
      <div className="memory-library-panel">
        <header className="memory-library-head">
          <h2>Meeting Memory</h2>
          <button type="button" className="memory-library-close" onClick={onClose}>×</button>
        </header>
        <div className="memory-library-tabs">
          <button
            type="button"
            className={`memory-library-tab ${tab === 'meetings' ? 'on' : ''}`}
            onClick={() => setTab('meetings')}
          >
            Meetings{meetingCount > 0 ? ` (${meetingCount})` : ''}
          </button>
          <button
            type="button"
            className={`memory-library-tab ${tab === 'ask' ? 'on' : ''}`}
            onClick={() => setTab('ask')}
          >
            Ask
          </button>
        </div>
        <div className="memory-library-body">
          {tab === 'meetings' ? (
            <MeetingsTab
              selectedMeetingId={selectedMeetingId}
              onSelectMeeting={setSelectedMeetingId}
              highlightSegmentId={highlightSegmentId}
              onMeetingCountChange={setMeetingCount}
            />
          ) : (
            <AskTab meetingCount={meetingCount} onCitationClick={handleCitationClick} />
          )}
        </div>
      </div>
    </div>
  )
}
```

Adapt prop names + state lifting to whatever the existing panel uses. Goal: zero regression for the Meetings tab (the wrapped behavior must be identical to today).

- [ ] **Step 4: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/library/MeetingsTab.tsx src/renderer/library/MemoryLibraryPanel.tsx
git commit -m "feat(memory-chat): convert MemoryLibraryPanel to tab container"
```

---

### Task 5.6 — Styles

**Files:** `src/renderer/App.css`

- [ ] **Step 1: Append styles**

```css
/* =============================================================
   MEMORY CHAT (Ask tab)
   ============================================================= */

.memory-library-tabs {
  display: flex;
  border-bottom: 1px solid var(--p-border);
  padding: 0 24px;
}
.memory-library-tab {
  padding: 10px 14px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--p-mute);
  font-family: var(--p-sans);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.memory-library-tab.on {
  color: var(--p-text);
  border-bottom-color: var(--p-primary);
}

.ask-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.ask-tab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid var(--p-border);
}
.ask-tab-title {
  font-family: var(--p-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text);
}
.ask-tab-count {
  color: var(--p-mute);
  font-weight: 400;
}
.ask-tab-new {
  height: 26px;
  padding: 0 10px;
  border-radius: 5px;
  border: 1px solid var(--p-border);
  background: var(--p-bg-card);
  color: var(--p-mute);
  font-size: 11.5px;
  cursor: pointer;
}
.ask-tab-new:hover:not(:disabled) {
  background: var(--p-bg-sub);
  color: var(--p-text);
}
.ask-tab-new:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ask-tab-list {
  flex: 1;
  padding: 14px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.ask-empty {
  margin: auto;
  text-align: center;
  color: var(--p-mute);
  padding: 32px;
}
.ask-empty h3 {
  font-family: var(--p-sans);
  font-size: 16px;
  color: var(--p-text);
  margin: 0 0 12px;
}
.ask-examples {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
}
.ask-examples li {
  padding: 4px 0;
  color: var(--p-mute);
}

.ask-msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 8px;
}
.ask-msg-user {
  background: var(--p-bg-sub);
  border: 1px solid var(--p-border);
}
.ask-msg-assistant {
  background: var(--p-bg-card);
  border: 1px solid var(--p-border);
}
.ask-msg-role {
  font-size: 10px;
  font-weight: 600;
  color: var(--p-faint);
  letter-spacing: 0.04em;
}
.ask-msg-content {
  font-family: var(--p-sans);
  font-size: 14px;
  line-height: 1.55;
  color: var(--p-text);
  white-space: pre-wrap;
}
.ask-msg-error {
  font-size: 12px;
  color: var(--p-error-ink);
  background: var(--p-error-soft);
  padding: 8px 10px;
  border-radius: 5px;
  border: 1px solid var(--p-error);
}

.ask-citation {
  display: inline-flex;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  margin: 0 2px;
  border-radius: 9px;
  background: var(--p-primary-soft);
  color: var(--p-primary-ink);
  border: none;
  font-size: 10px;
  font-weight: 700;
  vertical-align: super;
  line-height: 18px;
  cursor: pointer;
}
.ask-citation:hover {
  background: var(--p-primary);
  color: var(--p-primary-on);
}

.ask-cursor {
  display: inline-block;
  width: 2px;
  margin-left: 1px;
  color: var(--p-primary);
  animation: ask-blink 1s steps(1) infinite;
}
@keyframes ask-blink {
  50% { opacity: 0; }
}

.ask-sources {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--p-bg-sub);
  border-radius: 6px;
}
.ask-sources-title {
  font-family: var(--p-mono);
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--p-faint);
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}
.ask-sources-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ask-sources-item {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 8px;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  text-align: left;
  cursor: pointer;
  font-family: var(--p-sans);
}
.ask-sources-item:hover {
  background: var(--p-bg-card);
  border-color: var(--p-border);
}
.ask-sources-marker {
  grid-row: 1 / span 2;
  align-self: start;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  background: var(--p-primary-soft);
  color: var(--p-primary-ink);
  text-align: center;
  line-height: 18px;
  font-size: 10px;
  font-weight: 700;
}
.ask-sources-meta {
  font-size: 11px;
  color: var(--p-mute);
}
.ask-sources-preview {
  font-size: 12px;
  color: var(--p-text);
  margin-top: 2px;
}

.ask-input {
  display: flex;
  gap: 8px;
  padding: 10px 24px 14px;
  border-top: 1px solid var(--p-border);
}
.ask-input-textarea {
  flex: 1;
  resize: none;
  padding: 8px 10px;
  border: 1px solid var(--p-border);
  border-radius: 6px;
  background: var(--p-bg-card);
  color: var(--p-text);
  font-family: var(--p-sans);
  font-size: 13px;
  line-height: 1.4;
}
.ask-input-textarea:focus {
  outline: none;
  border-color: var(--p-primary);
}
.ask-input-send,
.ask-input-stop {
  height: 36px;
  padding: 0 14px;
  border-radius: 6px;
  font-family: var(--p-sans);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.ask-input-send {
  background: var(--p-primary);
  color: var(--p-primary-on);
  border: 1px solid var(--p-primary);
}
.ask-input-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ask-input-stop {
  background: var(--p-bg-card);
  color: var(--p-mute);
  border: 1px solid var(--p-border);
}

/* Flash highlight for cited segment in Meetings tab detail */
[data-highlight='true'] {
  animation: ask-flash 0.8s ease-out;
  background: var(--p-primary-soft);
}
@keyframes ask-flash {
  0% { background: var(--p-primary); }
  100% { background: transparent; }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/App.css
git commit -m "feat(memory-chat): styles for AskTab + chat messages + flash highlight"
```

---

## Phase 6 — Telemetry

### Task 6.1 — Counters

**Files:** `src/main/memory/chatService.ts`, `src/main/ipc.ts`, `src/renderer/ask/useChatStore.ts`

- [ ] **Step 1: Add counters to chatService events**

Inside `chatService.runChat`, add `log(...)` calls using the existing telemetry logger (match how `glossary.suggestion.*` events are emitted in `ipc-glossary-handlers.ts`):

```ts
// on submit start (just before sendEvent({ type: 'searching' }))
log('info', 'memory-chat', 'memory.chat.submit', { questionLength: args.question.length })

// after search resolves
log('info', 'memory-chat', 'memory.chat.retrieved', {
  sourceCount: hits.length,
  queryDurationMs,
})

// no_context branch
log('info', 'memory-chat', 'memory.chat.no-context', {
  questionLength: args.question.length,
})

// on done
log('info', 'memory-chat', 'memory.chat.completed', {
  answerChars: normalized.length,
  llmDurationMs,
  citationCount: countCitations(normalized),
})

// on error branches
log('warn', 'memory-chat', 'memory.chat.error', { reason: 'llm' | 'network' | 'search' })
```

`countCitations` is a small helper: `(s.match(/\[\^\d+\]/g) ?? []).length`.

- [ ] **Step 2: Citation click telemetry from renderer**

In `MemoryLibraryPanel.handleCitationClick`, optionally invoke a small renderer-side log via `window.electronAPI.checkHealth` analog or a new dedicated channel. For v1, skip renderer-side telemetry — only the main-side counters fire (avoids new IPC for cosmetic events).

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
git add src/main/memory/chatService.ts
git commit -m "feat(memory-chat): telemetry counters"
```

---

## Phase 7 — Final regression + manual smoke + ship

### Task 7.1 — Full regression

- [ ] **Step 1: Run all checks**

```bash
npm run typecheck                # clean
npm run lint                     # 0 errors
npx vitest run                   # all suites pass; new tests add ~17 (prompt 11 + service 6 + ipc 4)
```

If anything fails, fix in-place before continuing.

- [ ] **Step 2: Manual smoke (Electron)**

`npm run dev:electron`. Walk through success criteria 1-12 from the spec:

1. Open Memory Library, see new Ask tab
2. Click Ask, see empty state + examples
3. Type a question, press Enter, observe `searching → sources card → token stream → done`
4. Citation chips render in the answer
5. Click a chip → switch to Meetings tab → meeting opens → segment flashes
6. Submit a follow-up question; sources for the new turn are fresh
7. Click "New chat" → history cleared
8. Restart app, history restored
9. Try a nonsense question (gibberish) → "No relevant meetings found"
10. With 0 meetings (or fresh db), empty state shows "No meetings yet" message
11. Add a `preserve=true` glossary entry, ask a question that should mention it → entry is preserved verbatim in the answer
12. Switch back to Meetings tab → existing behavior unchanged

- [ ] **Step 3: Update `HANDOFF.md`**

Move the active stream to "completed." Add a notes paragraph summarizing what shipped + known gaps (no markdown, no export, no filter).

- [ ] **Step 4: Commit + push**

```bash
git add HANDOFF.md
git commit -m "docs(memory-chat): mark stream complete"
git push origin master
```

---

## Self-review notes (resolved inline)

**Spec coverage:**

- Types → Task 1.1
- Prompt + helpers → Task 1.2
- Chat service → Task 2.1
- IPC handler → Task 3.1
- Preload bridge → Task 3.2
- IPC tests → Task 3.3
- Renderer types + parser → Task 4.1
- Chat store → Task 4.2
- AskInput → Task 5.1
- SourcesList → Task 5.2
- ChatMessageView → Task 5.3
- AskTab → Task 5.4
- MemoryLibraryPanel refactor + MeetingsTab → Task 5.5
- Styles → Task 5.6
- Telemetry → Task 6.1
- Regression + ship → Task 7.1

**Type consistency:** `ChatSource`, `ChatMessage`, `ChatHistoryStored`, function names (`buildChatSystemPrompt`, `formatSourcesBlock`, `enforceContextBudget`, `stripCitations`, `parseAnswerWithCitations`, `runChat`), IPC channels (`memory:chat`, `memory:chat:event`), preload methods (`memory.chat`, `memory.onChatEvent`) — all match across tasks.

**Known assumptions to verify during execution:**

- `SearchHit` already exposes `meetingTitle` and `meetingStartedAt`. If not, extend the type and update `lookupSearchHits` in `repository.ts` accordingly (additive only). Grep `interface SearchHit` early.
- `MemoryService` exposes both `searchService` and `repository`. Verify before Task 3.1; existing v1 memory IPC already uses `repository`, `searchService` is a separate field in `memoryService.ts`.
- `MemoryLibraryPanel.tsx` extraction (Task 5.5) is the biggest mechanical step. If the file has tight coupling between sub-components and state, split in two commits (structural extract → behavior addition).
- The existing IPC pattern uses `mainWindowRef?.webContents.send(...)` for event delivery (see `start-answer-assist`). Use the same pattern for `memory:chat:event` — no new infrastructure required.

**No web-mode parity:** This is Electron-only. `server/proxy.mjs` is not touched. Web users continue to use Memory Library's Meetings tab only.

**No new dependencies:** All work uses existing libraries (electron, react, vitest, fetch). No react-markdown, no syntax-highlighter, no chat-UI kit.
