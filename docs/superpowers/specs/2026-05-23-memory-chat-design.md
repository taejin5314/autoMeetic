# Memory Library Chat (Cross-meeting RAG) — Design Spec

**Date:** 2026-05-23
**Status:** Draft — pending implementation
**Positioning lever:** Table-stakes catchup. Granola/Otter/Fellow/Supernormal all ship this — cross-meeting search is the "deciding factor between leaders and laggards in 2026" per market research. autoMeetic needs it to stay competitive. Differentiation comes from our existing unique stack (whiteboard, glossary, bilingual columns) layered around it.

## One-line

Add an "Ask" tab to the Memory Library where the user types a natural-language question, the existing `SearchService` retrieves relevant segments across all past meetings, and `gpt-4o-mini` streams a cited answer with clickable footnote markers that jump back to the source segment.

## Why this stream

Internet research (2026-05) showed:
- 75% of professionals use AI note-takers; 67% of Fortune 500 deployed
- Granola, Otter, Fellow, Supernormal all have "Ask my meetings" features
- Quote: *"Cross-meeting search is the feature that moves AI note-takers from 'a tool that helps me write less' to 'the company's living memory' — and it's the capability that is increasingly defining the gap between the leaders and the laggards in 2026."*
- autoMeetic already has the embedding + search infrastructure (`Xenova/multilingual-e5-small` worker, `segment_embeddings` table, `SearchService`) — only the LLM answer + UI layer is missing
- Decision: ship the basic form as table stakes; defer "differentiated" variants (e.g., answer-to-mind-map auto-visualization) to a separate follow-up wedge

## Success criteria

1. Open Memory Library → click new "Ask" tab → see empty chat with example prompts and meeting count
2. Type "지난주 Sarah와 OKR 논의 결론은?" → submit → sources card appears within ~500ms → answer streams token by token within ~3-8s
3. Answer contains `[^1]`, `[^2]` style markers rendered as clickable chips
4. Clicking a chip switches to Meetings tab, opens the referenced meeting, and flashes the cited segment
5. Sources card below the answer lists each cited segment with meeting title, timestamp, preview text — clickable identically
6. Follow-up question ("그 결정 누가 반대했어?") uses prior turns as context but retrieves fresh sources for the new turn
7. "New chat" button clears history (persists empty state in localStorage)
8. App restart restores chat history from localStorage
9. Zero search results → assistant says "No relevant meetings found" without calling the LLM
10. Zero meetings indexed → empty state explains how to begin
11. Glossary preserve terms (e.g., `RealtimeOrchestrator`) survive verbatim in answers
12. With chat unused, no regression to Meetings tab or other Memory Library behavior

## In scope

- New IPC channel `memory:chat` (event-stream contract mirroring `start-answer-assist`)
- New main-process modules:
  - `chatService.ts` — orchestrates search → format sources → LLM stream → post-pass → broadcast
  - `prompts/chat.v1.ts` — system prompt builder + plain-string `parseAnswerWithCitations` helper
- Reuse `SearchService.search(query, K=10)` unchanged
- Reuse `EmbeddingService.embedQuery` unchanged
- Reuse `formatGlossaryPromptSection` + `normalizePreserveTerms` unchanged
- Reuse Answer Assist's SSE event pattern (`memory:chat:event` channel)
- Renderer additions:
  - `MemoryLibraryPanel` becomes a tab container (`Meetings` | `Ask`); existing meetings UI wrapped as `<MeetingsTab>`
  - `AskTab`, `ChatMessageView`, `SourcesList`, `AskInput`, `useChatStore`, `parseAnswerWithCitations`
- LocalStorage persistence (`automeetic.askHistory`, version 1, capped at 50 messages)
- Citation click → switch to Meetings tab + select meeting + flash segment (small `highlightSegmentId` prop on meeting detail)
- Telemetry counters for submit / retrieved / completed / error / citation-clicked
- Plain text rendering (no markdown library)
- AbortController-based cancellation on new submission

## Out of scope (deferred)

- Markdown rendering of answer (bold, lists, code blocks)
- Voice input for the question
- Answer thumbs-up / thumbs-down feedback loop
- Answer-to-mind-map auto-visualization (the "differentiated" variant C from brainstorming)
- Multi-meeting filter UI (date range, specific meetings)
- Multi-thread conversations (single rolling chat only)
- Memory-aware extension of live Answer Assist (separate wedge)
- Answer export (Notion / Slack / clipboard formatting)
- "Recently asked" suggestions
- Backfilling chat history across devices (single-device localStorage only)
- Citation deep-linking via URL (no external sharing)
- Streaming retry on transient error
- Confidence calibration / "AI may be wrong" disclaimers

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Surface | Memory Library new tab | Stays within existing panel; consistent shelf approach; no new header entry point |
| Retrieval | Existing `SearchService.search(query, 10)` | Already implements title + summary + literal + semantic in one call |
| LLM | `gpt-4o-mini`, stream, temp 0.2, max_tokens 1500 | Same as auto-suggestions; cheap; JSON not needed (free-form text) |
| Citation format | LLM emits `[^N]`, renderer parses to clickable chips | Common academic-footnote idiom LLMs understand |
| Multi-turn history | Last 6 messages, citations stripped before passing | gpt-4o-mini context plenty; strip avoids stale-marker confusion |
| Session model | Single rolling chat, localStorage persistence | v1 simplicity; threading is v2 |
| Retrieval scope | All meetings, no filter | v1 simplicity; date/meeting filter is v2 |
| Streaming | SSE pattern mirrored from Answer Assist | Proven; same `sendEvent(...)` shape |
| Source preview | First 300 chars of segment text | Long enough to be useful, short enough to keep prompt bounded |
| Context budget | 20K chars total source text | Safe within gpt-4o-mini 128K window; truncate lowest-score first |
| K (retrieval count) | 10 | Generally produces 3-7 actually cited; bounded prompt |
| Glossary integration | Preserve terms via `normalizePreserveTerms` post-pass | Reuse v1 infrastructure |
| Answer language | LLM auto-detects question language | No explicit label-language setting needed |
| Markdown | Plain text + line breaks only | Avoid adding react-markdown dependency; v2 if needed |
| Persistence | `localStorage automeetic.askHistory` (v1 schema) | Matches glossary/translation-target patterns; no sqlite |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer — Memory Library Panel                              │
│                                                                │
│   [Meetings] [Ask]   ← new tab container                      │
│     │           │                                              │
│     │           ▼                                              │
│     │       AskTab                                             │
│     │         ├ MessageList (ChatMessageView, SourcesList)    │
│     │         ├ AskInput                                       │
│     │         └ useChatStore                                   │
│     │             │                                            │
│     │             │ submit(question)                           │
│     │             │ append user msg                            │
│     │             │ window.electronAPI.memory.chat({...})      │
│     │             │ listen memory:chat:event                   │
│     ▼                                                          │
│   MeetingsTab (existing meeting list, unchanged)              │
│       receives highlightSegmentId prop on citation click      │
└────────────────────┬─────────────────────────────────────────┘
                     │ IPC
                     ▼
┌──────────────────────────────────────────────────────────────┐
│ Main process                                                   │
│                                                                │
│   ipc-memory-handlers: 'memory:chat' handler                  │
│       │                                                        │
│       ▼                                                        │
│   chatService.runChat(args, sendEvent)                        │
│       │                                                        │
│       ├─ SearchService.search(question, 10)  ─── existing     │
│       │     └─ EmbeddingService.embedQuery   ─── existing     │
│       │                                                        │
│       ├─ hits → ChatSource[] (marker + meeting metadata)      │
│       ├─ enforceContextBudget(20_000)                          │
│       ├─ buildChatSystemPrompt({ sources, glossary })         │
│       ├─ messages = [system, ...stripCitations(history), user]│
│       │                                                        │
│       ├─ fetch OpenAI /v1/chat/completions stream=true        │
│       │   on each delta → sendEvent('delta', token)           │
│       │                                                        │
│       └─ normalizePreserveTerms(full) → sendEvent('done')     │
│                                                                │
│   Broadcasts 'memory:chat:event' to mainWindow                │
└──────────────────────────────────────────────────────────────┘
```

## Data model

### TypeScript types (`src/main/memory/types.ts` + re-exported in `src/renderer/ask/types.ts`)

```ts
export interface ChatSource {
  marker: number                          // 1-based, matches [^N]
  kind: 'segment' | 'meeting-title' | 'meeting-summary'
  meetingId: string
  meetingTitle: string
  segmentId?: string                       // segment kind only
  segmentText: string                      // up to 300 chars
  timestampMs: number                      // segment's createdAt - meeting.startedAt
  meetingStartedAt: number                 // for "May 15" rendering
  score: number                            // 0-1 from SearchService
}

export interface ChatMessage {
  id: string                               // 'msg_<base36>_<rand6>'
  role: 'user' | 'assistant'
  content: string                          // raw text; assistant may contain [^N] markers
  sources?: ChatSource[]                   // assistant only
  createdAt: number
  error?: string                           // populated when error event received
}

export interface ChatHistoryStored {
  version: 1
  messages: ChatMessage[]
}
```

### sqlite schema

**No changes.** All chat state lives in main-process in-memory plus renderer localStorage. Embeddings already persisted in `segment_embeddings` (existing).

### IPC contract

```ts
// Renderer → Main
'memory:chat' (args: {
  question: string
  history: ChatMessage[]  // recent messages, citations may be present (main strips them)
}) → void

// Main → Renderer event channel: 'memory:chat:event'
{ type: 'searching' }
{ type: 'retrieved'; sources: ChatSource[] }
{ type: 'no_context' }
{ type: 'delta'; content: string }
{ type: 'done'; content: string; sources: ChatSource[] }
{ type: 'error'; message: string }
```

Mirrors the Answer Assist `start-answer-assist` + `answer-assist:event` pattern.

### Preload bridge addition

```ts
memory: {
  // ...existing...
  chat: (args: { question: string; history: ChatMessage[] }) =>
    ipcRenderer.invoke('memory:chat', args),
  onChatEvent: createEventListener('memory:chat:event'),
}
```

### LocalStorage

Key: `automeetic.askHistory`. Schema:

```json
{ "version": 1, "messages": [ChatMessage, ...] }
```

Cap: 50 messages (oldest dropped). Loaded on `useChatStore` mount, saved after every change (debounced is unnecessary at this scale — synchronous JSON write).

## LLM prompt

System prompt (`src/main/memory/prompts/chat.v1.ts`):

```
You are a meeting knowledge assistant for autoMeetic. The user is asking
about their past meetings. Answer using ONLY the SOURCES below.

SOURCES (cite by [^N] when referencing):
{sourcesBlock}

Rules:
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
- Output plain prose. Do not use markdown formatting.

{glossaryBlock}
```

`sourcesBlock` format:

```
[1] Meeting "Q4 OKR Review" (2026-05-15, 03:24):
    "We decided to defer the mobile rewrite to Q1..."
[2] Meeting "1:1 with Sarah" (2026-05-17, 12:08):
    "Sarah pushed back on the migration timeline..."
[3] Meeting "Engineering Standup" (2026-05-18, 05:11) [summary]:
    "Standup summary: platform team is at capacity..."
```

Multi-turn history processing:

```ts
function stripCitations(text: string): string {
  return text.replace(/\[\^\d+\]/g, '').replace(/[ \t]{2,}/g, ' ')
}
```

Then prepended to OpenAI messages array:

```ts
[
  { role: 'system', content: systemPrompt },
  ...history.slice(-6).map(m => ({
    role: m.role,
    content: m.role === 'assistant' ? stripCitations(m.content) : m.content,
  })),
  { role: 'user', content: question },
]
```

## Context budget

```ts
function enforceContextBudget(sources: ChatSource[], maxChars: number): ChatSource[] {
  let total = 0
  const out: ChatSource[] = []
  for (const s of sources) {  // assume already score DESC
    const cost = s.segmentText.length + 80  // metadata overhead
    if (total + cost > maxChars) break
    out.push(s)
    total += cost
  }
  return out
}
```

Highest-score sources kept first. No user-visible indication when truncated (single-line note in telemetry instead).

## Citation parsing (renderer side)

```ts
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
    else parts.push({ type: 'text', text: m[0] })  // hallucinated marker → plain
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < content.length) parts.push({ type: 'text', text: content.slice(lastIdx) })
  return parts
}
```

## UI surfaces

### `MemoryLibraryPanel` becomes a tab container

```
┌─ Meeting Memory ────────────────────────────────────────[✕]┐
│ [📋 Meetings (47)]  [💬 Ask]                                │
├─────────────────────────────────────────────────────────────┤
│ <MeetingsTab> or <AskTab>                                    │
└─────────────────────────────────────────────────────────────┘
```

Active tab state lives in `MemoryLibraryPanel` (`activeTab: 'meetings' | 'ask'`, defaults to `'meetings'` for zero regression). Tab buttons styled like existing `v4p-shelf-tab` (reuse `v4p-shelf-tabs` CSS by aliasing or referencing).

### `<AskTab>` layout

```
┌─ AskTab (flex column, height: 100%) ──────────────────────┐
│ ┌─ Header ─────────────────────────────────────────────┐ │
│ │ Ask your meetings  ·  47 meetings indexed              │ │
│ │                                       [+ New chat]      │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ Message list (amw-scroll, flex: 1) ───────────────────┐ │
│ │ <Empty state> OR <ChatMessageView/>+<SourcesList/>     │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ AskInput (flex-shrink: 0) ────────────────────────────┐ │
│ │ [textarea, auto-resize 2-6 lines]   [Send →] / [Stop]  │ │
│ └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### Message rendering rules

- User message: bg `--p-bg-sub`, role label "You · 14:32"
- Assistant message: bg `--p-bg-card`, role label "Assistant · 14:32", streaming cursor `▍` while in-flight
- Citation chip: `--p-primary-soft` bg, `--p-primary-ink` text, font-mono, `superscript` style, clickable
- Error: `--p-error-soft` banner inside the assistant bubble, no retry button (v1)
- Sources card: below the answer, `--p-bg-card` + `--p-border`, one row per source (marker + meeting title + timestamp + preview)

### `useChatStore` shape

```ts
interface ChatStore {
  messages: ChatMessage[]
  isStreaming: boolean
  meetingCount: number  // from memory:list-meetings on mount
  submit(question: string): void
  stop(): void
  newChat(): void
}
```

Subscribes to `memory:chat:event` on mount; cleans up on unmount. `submit` appends a user message and an empty streaming assistant message, then calls IPC. Each `delta` event appends to the streaming assistant message in-place. `done` finalizes content + sources. `error` writes `error` field.

`stop` cancels client-side only: the store records a `currentRequestId` and ignores any subsequent events whose id doesn't match. Main-process fetch runs to completion (cheap, ~$0.003 per call), but the renderer drops the orphaned response. The aborted assistant message bubble is removed from history. If cost becomes meaningful in v2, add a real `memory:chat:abort` IPC that signals main to abort its fetch via `AbortController`.

### Citation click handler

```ts
function handleCitationClick(source: ChatSource): void {
  setActiveTab('meetings')
  setSelectedMeetingId(source.meetingId)
  if (source.segmentId) {
    setHighlightSegmentId(source.segmentId)
    setTimeout(() => setHighlightSegmentId(null), 800)
  }
}
```

Meetings tab gets a small `highlightSegmentId?: string` prop that:
- Scrolls the segment into view on mount/change
- Adds `data-highlight="true"` attribute → CSS animates a brief flash (`animation: ask-flash 0.8s ease-out`)

## Telemetry

```
memory.chat.submit         (questionLength)
memory.chat.retrieved      (sourceCount, queryDurationMs)
memory.chat.no-context     (questionLength)
memory.chat.completed      (answerChars, llmDurationMs, citationCount)
memory.chat.error          (reason: 'llm' | 'network' | 'parse' | 'abort')
memory.chat.citation-clicked (kind: 'segment' | 'meeting-title' | 'meeting-summary')
memory.chat.new-chat-clicked (previousMessageCount)
```

## Testing strategy

Unit (vitest):

- `src/test/chat-prompt.test.ts` (~7): `buildChatSystemPrompt` includes/excludes glossary; `enforceContextBudget` keeps top-score within budget; `stripCitations` removes all `[^N]` patterns; `parseAnswerWithCitations` mixed parts; hallucinated marker fallback
- `src/test/chat-service.test.ts` (~6): mock fetch + repo; verify `searching → retrieved → delta(s) → done` order; `no_context` when retrieval empty; `error` on 4xx; `normalizePreserveTerms` applied on done
- `src/test/chat-ipc.test.ts` (~4): preload signature round-trip; event delivery via mocked `BrowserWindow.send`

Manual smoke (Phase 7): success criteria 1-12 walked through end-to-end.

## Edge cases

| Case | Handling |
|---|---|
| LLM emits `[^99]` for marker that doesn't exist | `parseAnswerWithCitations` falls back to plain text; no crash |
| User submits while previous still streaming | Renderer drops in-flight assistant message, fires new IPC; main process completes old call silently |
| LLM returns "I don't have enough information" | Display verbatim; no retry loop |
| Network drop mid-stream | `error` event → assistant bubble shows error banner |
| OpenAI 429 | `error` event with rate-limit message |
| Citation click after meeting deleted | Meetings tab shows "Meeting not found" inline; chat unaffected |
| localStorage quota exceeded | `save` wraps in try/catch; messages stay in memory; warning logged |
| localStorage corrupt JSON | `load` falls back to empty history |
| Markdown in answer (`**bold**`) | Rendered as literal characters (v1); prompt instructs LLM to avoid markdown anyway |
| Live meeting in progress when chat runs | Live meeting's segments may not yet be embedded; they're excluded from retrieval; acceptable |
| Glossary changes mid-stream | Prompt was built at call time; in-flight answer keeps original glossary semantics |

## Files touched

```
src/main/memory/types.ts                    — add ChatSource, ChatMessage, ChatHistoryStored
src/main/memory/chatService.ts              — new: runChat orchestration
src/main/memory/prompts/chat.v1.ts          — new: buildChatSystemPrompt + sources block
src/main/ipc-memory-handlers.ts             — add 'memory:chat' handler
src/preload/index.ts                        — expose memory.chat + memory.onChatEvent
src/preload/types.ts                        — type additions
src/renderer/ask/types.ts                   — re-export ChatSource/ChatMessage
src/renderer/ask/AskTab.tsx                 — new container
src/renderer/ask/ChatMessageView.tsx        — new message renderer
src/renderer/ask/SourcesList.tsx            — new sources card
src/renderer/ask/AskInput.tsx               — new input box
src/renderer/ask/useChatStore.ts            — new store
src/renderer/ask/parseAnswerWithCitations.ts — new helper
src/renderer/library/MemoryLibraryPanel.tsx — convert to tab container, accept highlightSegmentId
src/renderer/library/MeetingsTab.tsx        — extract existing meeting list (split refactor)
src/renderer/App.css                        — chat styles + flash animation
src/test/chat-prompt.test.ts                — new
src/test/chat-service.test.ts               — new
src/test/chat-ipc.test.ts                   — new
```

## Estimated effort

~25-30 hours, ~3-4 days solo. Plan breaks this into 7 phases (see companion implementation plan).

## Open questions (resolve during implementation plan)

- `MemoryLibraryPanel` currently has a fairly tight layout; extracting `<MeetingsTab>` may surface coupling between meeting selection state and panel state. Phase 1 should resolve this with a shallow split (props lifted to panel level if needed).
- `MeetingDetail` view's existing scroll behavior — confirm there's a stable per-segment element with a queryable selector so `highlightSegmentId` flash can target it.
- The renderer's `useChatStore` reads `meetingCount` from `window.electronAPI.memory.listMeetings({ limit: 1, offset: 0 })` for the empty-state hint — confirm the existing IPC also returns total count or add a small `memory:count-meetings` helper if not.
