# Answer Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual-trigger AI answer coach that reads recent transcript, optionally searches the web, and displays a bilingual answer in a floating card.

**Architecture:** Browser button collects last 3 min of committed transcript → POST /api/answer-assist → proxy calls OpenAI Responses API (gpt-4.1-mini + web_search_preview) → SSE stream back to browser → floating AnswerAssistCard renders answer in meeting language + Korean.

**Tech Stack:** React 19, TypeScript, Express 5, OpenAI Responses API (raw fetch), SSE streaming, CSS (existing App.css)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/renderer/answer-assist/types.ts` | SSE event types + AnswerAssistState interface |
| `src/renderer/answer-assist/useAnswerAssistStore.ts` | State management (useReducer) + SSE client logic |
| `src/renderer/answer-assist/AnswerAssistCard.tsx` | Floating card UI component |
| `server/proxy.mjs` | New POST /api/answer-assist endpoint (added to existing file) |
| `src/App.tsx` | Trigger button + keyboard shortcut + card mount |
| `src/renderer/overlay/useCaptionStore.ts` | Export getRecentTranscript() helper |
| `src/App.css` | Styles for answer-assist button and card |

---

### Task 1: Answer Assist Types

**Files:**
- Create: `src/renderer/answer-assist/types.ts`

- [ ] **Step 1: Create types file**

```ts
// src/renderer/answer-assist/types.ts

export type AnswerAssistStatus =
  | 'idle'
  | 'loading'
  | 'searching'
  | 'streaming'
  | 'done'
  | 'error'

export interface AnswerAssistState {
  status: AnswerAssistStatus
  searchQuery: string | null
  answer: string
  answerKo: string
  errorMessage: string | null
}

export type SSEEvent =
  | { type: 'searching'; query: string }
  | { type: 'delta'; content: string }
  | { type: 'section'; name: 'ko' }
  | { type: 'done'; answer: string; answer_ko: string }
  | { type: 'no_question' }
  | { type: 'error'; message: string }
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/answer-assist/types.ts
git commit -m "feat(answer-assist): add types for SSE events and state"
```

---

### Task 2: Expose getRecentTranscript from useCaptionStore

**Files:**
- Modify: `src/renderer/overlay/useCaptionStore.ts`

- [ ] **Step 1: Add getRecentTranscript callback to useCaptionStore**

Add a `getRecentTranscript` callback that returns concatenated text from recent committed items. Add it inside `useCaptionStore()` after the existing callbacks, and include it in the return object.

```ts
  const getRecentTranscript = useCallback(
    (windowMs: number): string => {
      const cutoff = Date.now() - windowMs
      const recent = state.items
        .filter((item) => item.createdAtMs >= cutoff)
        .map((item) => item.sourceText)
        .join(' ')
        .trim()
      return recent.length >= 20 ? recent : ''
    },
    [state.items]
  )
```

Add `getRecentTranscript` to the return object:

```ts
  return {
    currentPartial: state.currentPartial,
    items: state.items,
    applyTranscript,
    applyTranslation,
    clearPartial,
    clear,
    getRecentTranscript,
  }
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/overlay/useCaptionStore.ts
git commit -m "feat(answer-assist): expose getRecentTranscript from caption store"
```

---

### Task 3: Answer Assist Store (useAnswerAssistStore)

**Files:**
- Create: `src/renderer/answer-assist/useAnswerAssistStore.ts`

- [ ] **Step 1: Create store file**

```ts
// src/renderer/answer-assist/useAnswerAssistStore.ts

import { useCallback, useReducer, useRef } from 'react'
import type { AnswerAssistState, SSEEvent } from './types'

type Action =
  | { type: 'start' }
  | { type: 'searching'; query: string }
  | { type: 'delta'; content: string; section: 'source' | 'ko' }
  | { type: 'done'; answer: string; answerKo: string }
  | { type: 'error'; message: string }
  | { type: 'dismiss' }

const INITIAL: AnswerAssistState = {
  status: 'idle',
  searchQuery: null,
  answer: '',
  answerKo: '',
  errorMessage: null,
}

function reducer(state: AnswerAssistState, action: Action): AnswerAssistState {
  switch (action.type) {
    case 'start':
      return { ...INITIAL, status: 'loading' }
    case 'searching':
      return { ...state, status: 'searching', searchQuery: action.query }
    case 'delta':
      if (action.section === 'ko') {
        return { ...state, status: 'streaming', answerKo: state.answerKo + action.content }
      }
      return { ...state, status: 'streaming', answer: state.answer + action.content }
    case 'done':
      return { ...state, status: 'done', answer: action.answer, answerKo: action.answerKo }
    case 'error':
      return { ...state, status: 'error', errorMessage: action.message }
    case 'dismiss':
      return INITIAL
    default:
      return state
  }
}

const ANSWER_ASSIST_URL = '/api/answer-assist'

export function useAnswerAssistStore() {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const abortRef = useRef<AbortController | null>(null)
  const sectionRef = useRef<'source' | 'ko'>('source')

  const requestAnswer = useCallback(async (transcript: string, lang: string) => {
    // Abort previous request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    sectionRef.current = 'source'

    dispatch({ type: 'start' })

    try {
      const res = await fetch(ANSWER_ASSIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ transcript, lang }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
        dispatch({ type: 'error', message: body.error ?? `HTTP ${res.status}` })
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        dispatch({ type: 'error', message: 'No response body' })
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let fullAnswer = ''
      let fullAnswerKo = ''

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

          let event: SSEEvent
          try {
            event = JSON.parse(json) as SSEEvent
          } catch {
            continue
          }

          switch (event.type) {
            case 'searching':
              dispatch({ type: 'searching', query: event.query })
              break
            case 'delta':
              if (sectionRef.current === 'ko') {
                fullAnswerKo += event.content
              } else {
                fullAnswer += event.content
              }
              dispatch({ type: 'delta', content: event.content, section: sectionRef.current })
              break
            case 'section':
              if (event.name === 'ko') sectionRef.current = 'ko'
              break
            case 'done':
              dispatch({ type: 'done', answer: event.answer, answerKo: event.answer_ko })
              return
            case 'no_question':
              dispatch({ type: 'error', message: '질문이 감지되지 않았습니다' })
              return
            case 'error':
              dispatch({ type: 'error', message: event.message })
              return
          }
        }
      }

      // Stream ended without 'done' event — use accumulated text
      if (fullAnswer || fullAnswerKo) {
        dispatch({ type: 'done', answer: fullAnswer, answerKo: fullAnswerKo })
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const dismiss = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = null
    sectionRef.current = 'source'
    dispatch({ type: 'dismiss' })
  }, [])

  const copyAnswer = useCallback(
    async (section: 'source' | 'ko') => {
      const text = section === 'ko' ? state.answerKo : state.answer
      if (text) await navigator.clipboard.writeText(text)
    },
    [state.answer, state.answerKo]
  )

  return { ...state, requestAnswer, dismiss, copyAnswer }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/answer-assist/useAnswerAssistStore.ts
git commit -m "feat(answer-assist): add useAnswerAssistStore with SSE client"
```

---

### Task 4: AnswerAssistCard UI Component

**Files:**
- Create: `src/renderer/answer-assist/AnswerAssistCard.tsx`

- [ ] **Step 1: Create card component**

```tsx
// src/renderer/answer-assist/AnswerAssistCard.tsx

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnswerAssistStatus } from './types'

interface AnswerAssistCardProps {
  status: AnswerAssistStatus
  searchQuery: string | null
  answer: string
  answerKo: string
  errorMessage: string | null
  onDismiss: () => void
  onCopy: (section: 'source' | 'ko') => Promise<void>
}

export function AnswerAssistCard({
  status,
  searchQuery,
  answer,
  answerKo,
  errorMessage,
  onDismiss,
  onCopy,
}: AnswerAssistCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  )
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [copiedSection, setCopiedSection] = useState<'source' | 'ko' | null>(null)

  // Dismiss on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  // Drag handlers
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return
      const card = cardRef.current
      if (!card) return
      const rect = card.getBoundingClientRect()
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos?.x ?? rect.left,
        origY: pos?.y ?? rect.top,
      }
      card.setPointerCapture(e.pointerId)
    },
    [pos]
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setPos({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) })
  }, [])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const handleCopy = useCallback(
    async (section: 'source' | 'ko') => {
      await onCopy(section)
      setCopiedSection(section)
      setTimeout(() => setCopiedSection(null), 1500)
    },
    [onCopy]
  )

  if (status === 'idle') return null

  const posStyle = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : {}

  return (
    <div
      ref={cardRef}
      className="answer-assist-card"
      style={posStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="answer-assist-header">
        <span className="answer-assist-title">Answer Assist</span>
        <button type="button" className="answer-assist-close" onClick={onDismiss} aria-label="Close">
          ×
        </button>
      </div>

      <div className="answer-assist-body">
        {status === 'loading' && (
          <div className="answer-assist-loading">답변 준비 중...</div>
        )}

        {status === 'searching' && searchQuery && (
          <div className="answer-assist-searching">
            <span className="answer-assist-search-icon" aria-hidden="true">⟳</span>
            "{searchQuery}" 검색 중...
          </div>
        )}

        {status === 'error' && errorMessage && (
          <div className="answer-assist-error">{errorMessage}</div>
        )}

        {(status === 'streaming' || status === 'done') && (
          <>
            {answer && (
              <div className="answer-assist-section">
                <div className="answer-assist-text source">{answer}</div>
              </div>
            )}
            {answerKo && (
              <>
                <div className="answer-assist-divider" />
                <div className="answer-assist-section">
                  <div className="answer-assist-text ko">{answerKo}</div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {status === 'done' && (
        <div className="answer-assist-footer">
          <button
            type="button"
            className="answer-assist-copy-btn"
            onClick={() => void handleCopy('source')}
          >
            {copiedSection === 'source' ? 'Copied!' : 'Copy Source'}
          </button>
          <button
            type="button"
            className="answer-assist-copy-btn"
            onClick={() => void handleCopy('ko')}
          >
            {copiedSection === 'ko' ? 'Copied!' : 'Copy KR'}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/answer-assist/AnswerAssistCard.tsx
git commit -m "feat(answer-assist): add AnswerAssistCard floating UI component"
```

---

### Task 5: Proxy Endpoint — POST /api/answer-assist

**Files:**
- Modify: `server/proxy.mjs`

- [ ] **Step 1: Add answer-assist endpoint to proxy.mjs**

Add the following code after the existing `app.post('/api/translate', ...)` handler and before the health check comment. This includes the system prompt and the SSE streaming logic.

```js
// ── Answer Assist endpoint ──────────────────────────────────────────────────

const ANSWER_ASSIST_MODEL = process.env.ANSWER_ASSIST_MODEL ?? 'gpt-4.1-mini'
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

function buildAnswerAssistPrompt(lang) {
  const langName = LANGUAGE_NAME_BY_CODE.get(lang) ?? lang
  return `You are a real-time meeting answer coach. The user is in a live meeting and just received a question they need help answering.

Your job:
1. Read the transcript and identify the most recent question directed at the user.
2. If you need factual information to answer well, use web_search_preview to look it up.
3. Write a concise answer (3-5 sentences) in ${langName} that the user can speak aloud naturally.
4. Then write "---" on its own line.
5. Then write the Korean translation of your answer.

Rules:
- Be concise and direct — this is for speaking aloud, not reading.
- Use a natural conversational tone appropriate for a meeting.
- If the question is opinion-based, provide a balanced thoughtful response.
- If the question requires technical knowledge, be accurate and specific.
- Do NOT include any labels like "English:" or "Korean:" — just the text.
- If no question is found in the transcript, respond with exactly: [NO_QUESTION]`
}

app.post('/api/answer-assist', async (req, res) => {
  const { transcript, lang = 'en' } = req.body
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 20) {
    res.status(400).json({ error: 'transcript must be a string of at least 20 characters' })
    return
  }

  const openaiApiKey = process.env.OPENAI_API_KEY
  if (!openaiApiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' })
    return
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const requestBody = {
      model: ANSWER_ASSIST_MODEL,
      tools: [{ type: 'web_search_preview' }],
      input: [
        { role: 'system', content: buildAnswerAssistPrompt(lang) },
        { role: 'user', content: `Meeting transcript (most recent 3 minutes):\n\n${transcript.trim()}` },
      ],
      stream: true,
    }

    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })
      if (response.status === 429 && attempt < 2) {
        const waitMs = Math.min(
          Math.max(parseFloat(response.headers.get('retry-after') || '3') * 1000, 1000),
          10000
        )
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      break
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}))
      const message = errBody?.error?.message ?? `OpenAI API error: ${response.status}`
      sendSSE({ type: 'error', message })
      res.end()
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let sentSection = false
    let searchSent = false

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

        let event
        try {
          event = JSON.parse(json)
        } catch {
          continue
        }

        // Handle web search events
        if (event.type === 'response.web_search_call.in_progress' && !searchSent) {
          searchSent = true
          sendSSE({ type: 'searching', query: 'searching...' })
        }

        if (event.type === 'response.web_search_call.completed') {
          // Search completed, deltas will follow
        }

        // Handle text deltas
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          const delta = event.delta
          fullText += delta

          // Check for NO_QUESTION marker
          if (fullText.includes('[NO_QUESTION]')) {
            sendSSE({ type: 'no_question' })
            res.end()
            return
          }

          // Check for section separator
          if (!sentSection && fullText.includes('\n---\n')) {
            sentSection = true
            // Split: send remaining source text before ---, then section event
            const sepIdx = fullText.indexOf('\n---\n')
            const beforeSep = fullText.slice(0, sepIdx)
            // We may have already sent some deltas, so only send the part after last delta
            // For simplicity, just emit the section marker — the client tracks accumulated text
            sendSSE({ type: 'section', name: 'ko' })
            fullText = fullText.slice(sepIdx + 5) // after \n---\n
            continue
          }

          // Don't send the --- separator as delta content
          if (!sentSection && fullText.trimEnd().endsWith('---')) {
            // Might be building up to separator, hold this delta
            continue
          }

          sendSSE({ type: 'delta', content: delta })
        }

        // Handle completion
        if (event.type === 'response.completed') {
          const outputText = event.response?.output?.[0]?.content?.[0]?.text ?? fullText
          const parts = outputText.split(/\n---\n/)
          const answer = (parts[0] ?? '').trim()
          const answerKo = (parts[1] ?? '').trim()
          sendSSE({ type: 'done', answer, answer_ko: answerKo })
          res.end()
          return
        }
      }
    }

    // Stream ended without response.completed
    const parts = fullText.split(/\n---\n/)
    const answer = (parts[0] ?? '').trim()
    const answerKo = (parts[1] ?? '').trim()
    sendSSE({ type: 'done', answer, answer_ko: answerKo })
    res.end()
  } catch (err) {
    console.error('[proxy] answer-assist error:', err)
    sendSSE({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    res.end()
  }
})
```

- [ ] **Step 2: Verify server starts**

Run: `node -e "import('./server/proxy.mjs')"`
Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add server/proxy.mjs
git commit -m "feat(answer-assist): add POST /api/answer-assist SSE endpoint"
```

---

### Task 6: CSS Styles for Answer Assist

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: Add answer-assist styles to App.css**

Append the following CSS to the end of `src/App.css`:

```css
/* ── Answer Assist ──────────────────────────────────────────────────────── */

.answer-assist-trigger {
  position: fixed;
  bottom: 80px;
  right: 24px;
  z-index: 90;
  background: rgba(39, 39, 42, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #fafafa;
  font-size: 13px;
  padding: 8px 14px;
  border-radius: 10px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: transform 0.1s, background 0.15s;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.answer-assist-trigger:hover {
  background: rgba(63, 63, 70, 0.95);
}

.answer-assist-trigger:active {
  transform: scale(0.98);
}

.answer-assist-trigger.busy {
  opacity: 0.7;
  pointer-events: none;
}

.answer-assist-card {
  position: fixed;
  bottom: 120px;
  right: 24px;
  width: 400px;
  max-height: 50vh;
  z-index: 100;
  background: rgba(24, 24, 27, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  backdrop-filter: blur(12px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 8px 32px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: grab;
  user-select: none;
}

.answer-assist-card:active {
  cursor: grabbing;
}

.answer-assist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.answer-assist-title {
  font-size: 12px;
  font-weight: 600;
  color: #a1a1aa;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.answer-assist-close {
  background: none;
  border: none;
  color: #71717a;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.answer-assist-close:hover {
  color: #fafafa;
}

.answer-assist-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
}

.answer-assist-loading,
.answer-assist-searching {
  color: #a1a1aa;
  font-size: 13px;
}

.answer-assist-searching {
  display: flex;
  align-items: center;
  gap: 6px;
}

.answer-assist-search-icon {
  display: inline-block;
  animation: answer-assist-spin 1s linear infinite;
}

@keyframes answer-assist-spin {
  to { transform: rotate(360deg); }
}

.answer-assist-error {
  color: #f87171;
  font-size: 13px;
}

.answer-assist-section {
  margin-bottom: 8px;
}

.answer-assist-text {
  user-select: text;
  cursor: text;
}

.answer-assist-text.source {
  color: #f4f4f5;
  font-size: 14px;
  line-height: 1.6;
}

.answer-assist-text.ko {
  color: #a1a1aa;
  font-size: 13px;
  line-height: 1.6;
}

.answer-assist-divider {
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
  margin: 10px 0;
}

.answer-assist-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.answer-assist-copy-btn {
  background: rgba(63, 63, 70, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #d4d4d8;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.answer-assist-copy-btn:hover {
  background: rgba(82, 82, 91, 0.8);
  color: #fafafa;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.css
git commit -m "feat(answer-assist): add CSS styles for floating card and trigger button"
```

---

### Task 7: Integrate Answer Assist into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports at top of App.tsx**

Add after the existing imports (after the ExcalidrawCanvas import):

```ts
import { AnswerAssistCard } from './renderer/answer-assist/AnswerAssistCard'
import { useAnswerAssistStore } from './renderer/answer-assist/useAnswerAssistStore'
```

- [ ] **Step 2: Add useAnswerAssistStore hook inside App component**

Inside the `App()` function, after the `useCaptionStore()` destructuring line, add:

```ts
  const answerAssist = useAnswerAssistStore()
```

- [ ] **Step 3: Update useCaptionStore destructuring to include getRecentTranscript**

Change the existing destructuring:

```ts
  const { items, currentPartial, applyTranscript, applyTranslation, clearPartial, clear } =
    useCaptionStore()
```

to:

```ts
  const { items, currentPartial, applyTranscript, applyTranslation, clearPartial, clear, getRecentTranscript } =
    useCaptionStore()
```

- [ ] **Step 4: Add answer assist trigger handler**

Add after the `resetSession` callback, before the `return`:

```ts
  const triggerAnswerAssist = useCallback(() => {
    if (answerAssist.status === 'loading' || answerAssist.status === 'streaming') return
    const transcript = getRecentTranscript(180_000)
    if (!transcript) {
      return // Not enough transcript content
    }
    const sourceLang = sttLanguage === 'auto' ? (lockedLanguageRef.current ?? 'en') : sttLanguage
    void answerAssist.requestAnswer(transcript, sourceLang)
  }, [answerAssist, getRecentTranscript, sttLanguage])
```

- [ ] **Step 5: Add Ctrl+Shift+A keyboard shortcut**

Add a new `useEffect` after the existing keyboard listeners:

```ts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        triggerAnswerAssist()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [triggerAnswerAssist])
```

- [ ] **Step 6: Add trigger button and card to JSX**

Add the following JSX just before the closing `</main>` tag:

```tsx
      {/* Answer Assist — floating trigger + card */}
      {running && (
        <button
          type="button"
          className={`answer-assist-trigger ${answerAssist.status === 'loading' || answerAssist.status === 'streaming' ? 'busy' : ''}`}
          onClick={triggerAnswerAssist}
          title="AI Answer Assist (Ctrl+Shift+A)"
        >
          {answerAssist.status === 'loading' || answerAssist.status === 'streaming'
            ? 'Thinking...'
            : 'Answer Assist'}
        </button>
      )}
      {answerAssist.status !== 'idle' && (
        <AnswerAssistCard
          status={answerAssist.status}
          searchQuery={answerAssist.searchQuery}
          answer={answerAssist.answer}
          answerKo={answerAssist.answerKo}
          errorMessage={answerAssist.errorMessage}
          onDismiss={answerAssist.dismiss}
          onCopy={answerAssist.copyAnswer}
        />
      )}
```

- [ ] **Step 7: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(answer-assist): integrate trigger button, shortcut, and card into App"
```

---

### Task 8: Smoke Test Script

**Files:**
- Create: `scripts/test-answer-assist.js`

- [ ] **Step 1: Create smoke test script**

```js
// scripts/test-answer-assist.js
//
// Smoke test: send a sample transcript to /api/answer-assist and print SSE events.
// Usage: node scripts/test-answer-assist.js
//
// Requires the proxy server running on localhost:3211

const PROXY_URL = `http://localhost:${process.env.PROXY_PORT || 3211}/api/answer-assist`

const sampleTranscript = `
So we've been discussing the migration from our monolithic architecture to microservices.
The main concern is how to handle data consistency across services.
I think we should use event sourcing for the order management system.
But what do you think about using saga pattern versus two-phase commit for distributed transactions?
`

async function main() {
  console.log('[test] POST', PROXY_URL)
  console.log('[test] Transcript:', sampleTranscript.trim().slice(0, 80), '...')
  console.log()

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ transcript: sampleTranscript.trim(), lang: 'en' }),
  })

  if (!res.ok) {
    console.error('[test] HTTP error:', res.status, await res.text())
    process.exit(1)
  }

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
      if (!line.startsWith('data: ')) continue
      const json = line.slice(6).trim()
      if (!json) continue
      try {
        const event = JSON.parse(json)
        console.log('[SSE]', event.type, event.type === 'delta' ? event.content : JSON.stringify(event))
      } catch {
        console.log('[SSE] raw:', json)
      }
    }
  }

  console.log('\n[test] Stream complete.')
}

main().catch((err) => {
  console.error('[test] Fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
git add scripts/test-answer-assist.js
git commit -m "test(answer-assist): add smoke test script for proxy endpoint"
```

---

### Task 9: Manual QA Verification

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: Both proxy and vite start successfully.

- [ ] **Step 2: Run smoke test**

In a separate terminal:
Run: `node scripts/test-answer-assist.js`
Expected: SSE events stream in — `searching`, `delta`, `section`, `done`. No errors.

- [ ] **Step 3: Browser QA**

Open `http://localhost:5173` in browser:
1. Click "Start Listening" and share a tab with audio playing
2. Wait for transcript to accumulate (~30 seconds)
3. Click "Answer Assist" button (bottom-right corner)
4. Verify: floating card appears with loading state
5. Verify: answer streams in (source language + Korean translation)
6. Verify: Copy buttons work
7. Verify: Drag to move card works
8. Verify: Esc or × closes card
9. Verify: Ctrl+Shift+A triggers answer assist

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(answer-assist): complete answer assist feature integration"
```
