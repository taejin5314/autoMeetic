# Feed Typewriter + Bundled Translation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the V4 live feed feel like an AI chat — each processed turn types out word-by-word in both source and translation columns, with a speaker eyebrow on speaker changes — by bundling translation into the existing `transcriptPostProcessor` LLM call and adding a renderer-side typewriter animator.

**Architecture:** The Now-Speaking hero remains immediate (raw STT partials, unchanged). The feed listens to `stt:processed` (already wired); the post-processor's LLM call is extended to also produce a translation per turn so source/translation arrive together. A renderer typewriter hook drives `displayedSource` / `displayedTranslation` on each item via `requestAnimationFrame`, then renders them in the bilingual columns. Speaker eyebrow appears only on `speakerId` change vs. previous item.

**Tech Stack:** Electron IPC, TypeScript, React, OpenAI Chat Completions (gpt-4.1-mini, structured JSON), existing `transcriptPostProcessor`, existing caption store.

---

## File Structure

**Create:**
- `src/renderer/feed/useFeedTypewriter.ts` — RAF-based hook that walks the typewriter queue, advancing `displayedSource` / `displayedTranslation` per item until `typing=false`.

**Modify:**
- `src/main/transcriptPostProcessor.ts` — accept `{ sourceLanguageHint, targetLanguage }` per flush; extend system prompt and JSON schema to include `translation`; pass through to `stt:processed` event.
- `src/main/stt/types.ts` — add `translation?: string` to `ProcessedTranscriptTurn` and the renderer event shape.
- `src/main/sttService.ts` — pass source/target language hints to `enqueueRoughTranscript` (called when forwarding committed text to the post-processor).
- `src/preload/types.ts` — refine `onSttProcessed` callback signature with concrete turn type.
- `src/renderer/overlay/types.ts` — add `displayedSource: string`, `displayedTranslation: string`, `typing: boolean`, `fullSource: string`, `fullTranslation: string | null` to `CaptionItem`.
- `src/renderer/overlay/useCaptionStore.ts` — new actions `append-processed`, `advance-typing`, `complete-typing`; keep existing `clear`, `partial`, etc.
- `src/renderer/App.tsx` — consume `onSttProcessed` (replace any direct rough-final → feed wiring), feed turns into the typewriter, render columns from `displayedSource` / `displayedTranslation`, show speaker eyebrow on change. Coordinate reset/stop with the typewriter.
- `src/renderer/App.css` — `.v4p-eyebrow` (Speaker A/B header on change), `.v4p-line-typing::after` (blinking caret).

**Out of scope:**
- Real OpenAI streaming (we use simulated typewriter — switch later if latency is an issue).
- Mic capture / dual-source.
- Speaker rename UI.

---

## Important Execution Notes

- The renderer **already** receives `stt:processed` and renders speaker fields. Do not regress that — extend it.
- `enqueueRoughTranscript` already buffers and flushes via `STT_POSTPROCESS_FLUSH_MS` and `STT_POSTPROCESS_MAX_CHARS`. Leave defaults alone unless explicitly retuning. They are env-configurable.
- Translation is part of the same LLM call. The standalone `translate(text, targetLang)` IPC and the renderer's `enqueueTranslation` / `translationQueueRef` flow should be **disconnected from feed items** (still usable for one-off translations, but not driving feed). Remove only what's clearly orphaned to avoid breaking other features (e.g., Answer Assist may still use translate).
- Browser/non-Electron mode (`RealtimeSttClient`) is **out of scope** for this plan. Feed typewriter is Electron-only.
- Stage only files listed in each task when committing.

---

### Task 1: Extend Processed Turn Type with Translation

**Files:**
- Modify: `src/main/stt/types.ts`
- Modify: `src/preload/types.ts`

- [ ] **Step 1: Add `translation` to `ProcessedTranscriptTurn`**

Open `src/main/stt/types.ts` and update:

```ts
export type SpeakerId = 'speaker_a' | 'speaker_b' | 'speaker_c' | 'unknown'

export type SpeakerLabel = 'Speaker A' | 'Speaker B' | 'Speaker C' | 'Unknown'

export interface ProcessedTranscriptTurn {
  id: string
  speakerId: SpeakerId
  speakerLabel: SpeakerLabel
  text: string
  /** Translation of `text` into the user's target language. Null when target is 'off' or matches the source language. */
  translation: string | null
  /** Source language code as decided by the post-processor (e.g. 'en', 'ko'). */
  sourceLanguage: string
  /** Target language requested at flush time (or 'off'). */
  targetLanguage: string
  createdAtMs: number
}

export interface ProcessedTurnsEvent {
  turns: ProcessedTranscriptTurn[]
}

export interface TranscriptSegment {
  id: string
  text: string
  isFinal: boolean
  createdAtMs: number
  source?: 'openai-realtime'
  speakerId?: string
  speakerLabel?: string
}

export interface TranslationSegment {
  segmentId: string
  text: string
  createdAtMs: number
  provider: 'openai-async'
}
```

- [ ] **Step 2: Type the preload event**

Open `src/preload/types.ts` and replace the `onSttProcessed` line:

```ts
import type { ProcessedTurnsEvent } from '../main/stt/types'

// ...inside ElectronAPI interface:
onSttProcessed(callback: (event: ProcessedTurnsEvent) => void): () => void
```

(Leave other methods unchanged.)

- [ ] **Step 3: Verify build**

Run:
```bash
npx tsc --noEmit -p tsconfig.main.json
npx tsc --noEmit -p tsconfig.renderer.json
```

Expected: both clean (pre-existing unrelated errors in `whiteboardService.ts:260` and `main/index.ts:46-47` may persist — ignore those, but no NEW errors from these changes).

- [ ] **Step 4: Commit**

```bash
git add src/main/stt/types.ts src/preload/types.ts
git commit -m "feat(stt): add translation + language fields to processed turn"
```

---

### Task 2: Thread Language Hints Into the Post-Processor

**Files:**
- Modify: `src/main/transcriptPostProcessor.ts`
- Modify: `src/main/sttService.ts`

- [ ] **Step 1: Update `enqueueRoughTranscript` and flush to carry language hints**

Open `src/main/transcriptPostProcessor.ts`. Add the hints to module state and update signatures:

```ts
import type {
  ProcessedTranscriptTurn,
  ProcessedTurnsEvent,
  SpeakerId,
  SpeakerLabel,
} from './stt/types'
// ...keep existing imports

interface LanguageHints {
  sourceLanguageHint: string
  targetLanguage: string
}

let buffer = ''
let pendingHints: LanguageHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
let flushTimer: ReturnType<typeof setTimeout> | null = null
let retryBuffer: string | null = null
let retryHints: LanguageHints | null = null
let retryCount = 0
let warnedMissingApiKey = false

export function enqueueRoughTranscript(text: string, hints: LanguageHints): void {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return
  pendingHints = hints
  buffer = trimBatch([buffer, trimmed].filter(Boolean).join(' '))
  if (shouldFlushNow(buffer)) {
    void flushPendingTranscript()
  } else {
    scheduleFlush()
  }
}
```

In `flushPendingTranscript`, capture the hints at the time of flush:

```ts
export async function flushPendingTranscript(options: { force?: boolean } = {}): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }

  const batch = retryBuffer ?? buffer.trim()
  const hints = retryHints ?? pendingHints
  if (!batch) return
  if (!options.force && !retryBuffer && batch.length < STT_POSTPROCESS_MIN_CHARS) {
    scheduleFlush()
    return
  }

  if (!retryBuffer) buffer = ''

  try {
    const turns = await processTranscriptBatch(batch, hints)
    retryBuffer = null
    retryHints = null
    retryCount = 0
    emitProcessedTurns(turns.length > 0 ? turns : [fallbackTurn(batch, hints)])
  } catch (err) {
    if (retryCount < 1) {
      retryBuffer = batch
      retryHints = hints
      retryCount += 1
      scheduleFlush()
      return
    }
    retryBuffer = null
    retryHints = null
    retryCount = 0
    console.warn(
      '[stt-postprocess] failed; emitting raw fallback:',
      err instanceof Error ? err.message : String(err)
    )
    emitProcessedTurns([fallbackTurn(batch, hints)])
  } finally {
    if (buffer.trim()) scheduleFlush()
  }
}
```

Also update `resetTranscriptPostProcessor` to clear `retryHints`:

```ts
export function resetTranscriptPostProcessor(): void {
  buffer = ''
  pendingHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
  retryBuffer = null
  retryHints = null
  retryCount = 0
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}
```

- [ ] **Step 2: Update `sttService.ts` callers**

Open `src/main/sttService.ts`. Find every `enqueueRoughTranscript(...)` call and add a hints argument sourced from the service's current language state. If `sttService` doesn't already track `targetLanguage`, expose a setter:

```ts
import { enqueueRoughTranscript } from './transcriptPostProcessor'

let currentSourceLanguage = 'auto'
let currentTargetLanguage = 'off'

export function setPostProcessorLanguages(args: {
  sourceLanguage: string
  targetLanguage: string
}): void {
  currentSourceLanguage = args.sourceLanguage || 'auto'
  currentTargetLanguage = args.targetLanguage || 'off'
}

// At every call site, replace:
//   enqueueRoughTranscript(text)
// with:
enqueueRoughTranscript(text, {
  sourceLanguageHint: currentSourceLanguage,
  targetLanguage: currentTargetLanguage,
})
```

- [ ] **Step 3: Verify**

Run:
```bash
npx tsc --noEmit -p tsconfig.main.json
```

Expected: compiles. If errors complain about missing arguments to `enqueueRoughTranscript`, find the missed call sites and add the hints.

- [ ] **Step 4: Commit**

```bash
git add src/main/transcriptPostProcessor.ts src/main/sttService.ts
git commit -m "feat(stt): thread source/target language hints into post-processor"
```

---

### Task 3: Add Translation to the LLM Call

**Files:**
- Modify: `src/main/transcriptPostProcessor.ts`

- [ ] **Step 1: Extend `processTranscriptBatch` with language-aware prompt + schema**

Replace `processTranscriptBatch` with:

```ts
async function processTranscriptBatch(
  batch: string,
  hints: LanguageHints
): Promise<ProcessedTranscriptTurn[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    if (!warnedMissingApiKey) {
      warnedMissingApiKey = true
      console.warn('[stt-postprocess] OPENAI_API_KEY not configured; using raw fallback')
    }
    return [fallbackTurn(batch, hints)]
  }

  const wantsTranslation = hints.targetLanguage !== 'off'

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: STT_POSTPROCESS_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You clean rough live meeting transcripts AND produce translations.',
            `Return JSON only: {"turns":[{"speakerId":"speaker_a","speakerLabel":"Speaker A","text":"...","translation":${wantsTranslation ? '"..."' : 'null'},"sourceLanguage":"en"}]}.`,
            'Do not summarize, add facts, or remove meaningful content.',
            'Fix punctuation, capitalization, sentence boundaries, and obvious filler only when meaning is preserved.',
            'Detect the source language and emit its ISO code (en, ko, ja, zh, es, fr, de) per turn.',
            'Use speaker_a, speaker_b, speaker_c, or unknown.',
            'Use Speaker A, Speaker B, Speaker C, or Unknown.',
            'Split into speaker turns, not individual sentences.',
            'Keep the same speaker when uncertain.',
            wantsTranslation
              ? `Translate each turn's text into ${hints.targetLanguage}. If source language equals target, set translation to null.`
              : 'Set translation to null on every turn.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Source language hint: ${hints.sourceLanguageHint}`,
            `Target language: ${hints.targetLanguage}`,
            '',
            'Rough transcript batch:',
            '',
            batch,
          ].join('\n'),
        },
      ],
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OpenAI STT postprocess error ${response.status}: ${text.slice(0, 300)}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content?.trim() ?? ''
  if (!content) return []
  return parseProcessedTranscriptResponse(content, Date.now(), hints)
}
```

- [ ] **Step 2: Update `parseProcessedTranscriptResponse` and helpers**

Update the parser signature + helpers in the same file:

```ts
export function parseProcessedTranscriptResponse(
  content: string,
  createdAtMs = Date.now(),
  hints: LanguageHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
): ProcessedTranscriptTurn[] {
  const parsed = JSON.parse(stripJsonFence(content)) as { turns?: RawTurn[] }
  if (!Array.isArray(parsed.turns)) return []
  return parsed.turns
    .map((turn) => toProcessedTurn(turn, createdAtMs, hints))
    .filter((turn): turn is ProcessedTranscriptTurn => turn !== null)
}

type RawTurn = {
  speakerId?: unknown
  speakerLabel?: unknown
  text?: unknown
  translation?: unknown
  sourceLanguage?: unknown
}

function toProcessedTurn(
  turn: RawTurn,
  createdAtMs: number,
  hints: LanguageHints
): ProcessedTranscriptTurn | null {
  const text = typeof turn.text === 'string' ? turn.text.trim() : ''
  if (!text) return null
  const speakerId = normalizeSpeakerId(turn.speakerId)
  const sourceLanguage =
    typeof turn.sourceLanguage === 'string' && turn.sourceLanguage.length === 2
      ? turn.sourceLanguage
      : hints.sourceLanguageHint
  const wantsTranslation =
    hints.targetLanguage !== 'off' && hints.targetLanguage !== sourceLanguage
  const rawTranslation = typeof turn.translation === 'string' ? turn.translation.trim() : ''
  return {
    id: `turn_${createdAtMs}_${Math.random().toString(36).slice(2, 8)}`,
    speakerId,
    speakerLabel: normalizeSpeakerLabel(turn.speakerLabel, speakerId),
    text,
    translation: wantsTranslation && rawTranslation ? rawTranslation : null,
    sourceLanguage,
    targetLanguage: hints.targetLanguage,
    createdAtMs,
  }
}

function fallbackTurn(text: string, hints: LanguageHints): ProcessedTranscriptTurn {
  return {
    id: `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    speakerId: 'unknown',
    speakerLabel: 'Unknown',
    text: text.trim(),
    translation: null,
    sourceLanguage: hints.sourceLanguageHint,
    targetLanguage: hints.targetLanguage,
    createdAtMs: Date.now(),
  }
}
```

- [ ] **Step 3: Verify type-check**

Run:
```bash
npx tsc --noEmit -p tsconfig.main.json
```

Expected: clean.

- [ ] **Step 4: Smoke-test parse with a hand-crafted JSON**

Open a Node REPL or temporarily edit `scripts/smoke-transcript-postprocessor.mjs` (if it exists) to import and call `parseProcessedTranscriptResponse` with a sample:

```js
import { parseProcessedTranscriptResponse } from '../src/main/transcriptPostProcessor.ts'

const sample = JSON.stringify({
  turns: [
    {
      speakerId: 'speaker_a',
      speakerLabel: 'Speaker A',
      text: 'Hello, how are you today?',
      translation: '안녕하세요, 오늘 어떠세요?',
      sourceLanguage: 'en',
    },
  ],
})

console.log(
  parseProcessedTranscriptResponse(sample, Date.now(), {
    sourceLanguageHint: 'en',
    targetLanguage: 'ko',
  })
)
```

Expected: array of one turn with `translation: '안녕하세요, 오늘 어떠세요?'` and `sourceLanguage: 'en'`.

If the smoke script doesn't exist, skip this step.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcriptPostProcessor.ts
git commit -m "feat(stt): bundle translation into post-processor LLM call"
```

---

### Task 4: Wire Renderer Translation State Changes Into the Service

**Files:**
- Modify: `src/main/ipc.ts` (or wherever `setSttLanguage` / `setTranslationTarget` IPC handlers live)
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add a renderer → main IPC to update target language**

Open `src/preload/types.ts` and add:

```ts
// inside ElectronAPI
setTranscriptLanguages(args: { sourceLanguage: string; targetLanguage: string }): Promise<void>
```

Open `src/preload/index.ts` and bridge:

```ts
setTranscriptLanguages: (args) => ipcRenderer.invoke('stt:set-languages', args),
```

Open `src/main/ipc.ts` and register the handler:

```ts
ipcMain.handle('stt:set-languages', (_event, args: { sourceLanguage: string; targetLanguage: string }) => {
  void import('./sttService').then(({ setPostProcessorLanguages }) => {
    setPostProcessorLanguages(args)
  })
})
```

- [ ] **Step 2: Call it from the renderer on lang change**

Open `src/renderer/App.tsx`. Find `onLanguageChange` and `onTranslationChange`. Right after each setter, push the new pair to main:

```ts
const onLanguageChange = (next: string): void => {
  setSttLanguage(next)
  setLanguageLock(null)
  setDetectedLanguage(null)
  lockedLanguageRef.current = null
  reconnectLanguageRef.current = null
  languageVotesRef.current = {}
  acceptedFinalTranscriptIdsRef.current.clear()
  rejectedFinalTranscriptIdsRef.current.clear()
  if (isElectron && window.electronAPI) {
    void window.electronAPI.setTranscriptLanguages({
      sourceLanguage: next,
      targetLanguage: translationTarget,
    })
  }
}

const onTranslationChange = (next: string): void => {
  setTranslationTarget(next)
  updateHealth(
    'translation',
    next === 'off' ? 'disconnected' : 'connected',
    next === 'off' ? 'not connected' : `to ${next}`
  )
  window.localStorage.setItem(TRANSLATION_TARGET_STORAGE_KEY, next)
  if (isElectron && window.electronAPI) {
    void window.electronAPI.setTranscriptLanguages({
      sourceLanguage: sttLanguage,
      targetLanguage: next,
    })
  }
}
```

Also push initial state once on mount:

```ts
useEffect(() => {
  if (isElectron && window.electronAPI) {
    void window.electronAPI.setTranscriptLanguages({
      sourceLanguage: sttLanguage,
      targetLanguage: translationTarget,
    })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

- [ ] **Step 3: Verify**

Run:
```bash
npx tsc --noEmit -p tsconfig.main.json
npx tsc --noEmit -p tsconfig.renderer.json
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/preload/types.ts src/preload/index.ts src/main/ipc.ts src/renderer/App.tsx
git commit -m "feat(stt): renderer pushes language pair to post-processor"
```

---

### Task 5: Extend CaptionItem for Typewriter State

**Files:**
- Modify: `src/renderer/overlay/types.ts`
- Modify: `src/renderer/overlay/useCaptionStore.ts`

- [ ] **Step 1: Add typewriter fields**

Replace the contents of `src/renderer/overlay/types.ts`:

```ts
export interface CaptionItem {
  id: string
  /** Full source text, set when the processed turn arrives. */
  fullSource: string
  /** Full translation text, or null when not translated. */
  fullTranslation: string | null
  /** Characters currently revealed by the typewriter (<= fullSource.length). */
  displayedSource: string
  /** Characters currently revealed for translation (<= fullTranslation.length). */
  displayedTranslation: string
  /** True while typewriter is still advancing this item. */
  typing: boolean
  createdAtMs: number
  updatedAtMs: number
  speakerId?: string
  speakerLabel?: string
  /** ISO source-language code from the processed turn, used by the typewriter to pick speed. */
  sourceLanguage?: string
  /** Legacy alias for fullSource so existing consumers (Answer Assist transcript window) keep working. */
  sourceText: string
  /** Legacy alias for displayed translation. */
  translatedText?: string
}
```

- [ ] **Step 2: Rework caption store reducer**

Open `src/renderer/overlay/useCaptionStore.ts`. Replace the file with:

```ts
import { useCallback, useReducer } from 'react'
import type { ProcessedTranscriptTurn } from '../../main/stt/types'
import type { CaptionItem } from './types'

interface CaptionState {
  currentPartial: string
  items: CaptionItem[]
}

type CaptionAction =
  | { type: 'partial'; text: string }
  | { type: 'append-processed'; payload: ProcessedTranscriptTurn[] }
  | { type: 'advance-typing'; id: string; sourceChars: number; translationChars: number }
  | { type: 'complete-typing'; id: string }
  | { type: 'clear-partial' }
  | { type: 'clear' }

const MAX_ITEMS = 50

function turnToItem(turn: ProcessedTranscriptTurn): CaptionItem {
  return {
    id: turn.id,
    fullSource: turn.text,
    fullTranslation: turn.translation,
    displayedSource: '',
    displayedTranslation: '',
    typing: true,
    createdAtMs: turn.createdAtMs,
    updatedAtMs: Date.now(),
    speakerId: turn.speakerId,
    speakerLabel: turn.speakerLabel,
    sourceLanguage: turn.sourceLanguage,
    sourceText: turn.text,
    translatedText: turn.translation ?? undefined,
  }
}

function reducer(state: CaptionState, action: CaptionAction): CaptionState {
  if (action.type === 'partial') {
    return { ...state, currentPartial: action.text.trim() }
  }

  if (action.type === 'append-processed') {
    const newItems = action.payload.map(turnToItem)
    return {
      currentPartial: '',
      items: [...state.items, ...newItems].slice(-MAX_ITEMS),
    }
  }

  if (action.type === 'advance-typing') {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === action.id
          ? {
              ...item,
              displayedSource: item.fullSource.slice(0, action.sourceChars),
              displayedTranslation:
                item.fullTranslation === null
                  ? ''
                  : item.fullTranslation.slice(0, action.translationChars),
              updatedAtMs: Date.now(),
            }
          : item
      ),
    }
  }

  if (action.type === 'complete-typing') {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === action.id
          ? {
              ...item,
              displayedSource: item.fullSource,
              displayedTranslation: item.fullTranslation ?? '',
              typing: false,
              translatedText: item.fullTranslation ?? undefined,
              updatedAtMs: Date.now(),
            }
          : item
      ),
    }
  }

  if (action.type === 'clear-partial') {
    return { ...state, currentPartial: '' }
  }

  if (action.type === 'clear') {
    return { currentPartial: '', items: [] }
  }

  return state
}

export function useCaptionStore() {
  const [state, dispatch] = useReducer(reducer, { currentPartial: '', items: [] })

  const applyPartial = useCallback((text: string) => {
    dispatch({ type: 'partial', text })
  }, [])

  const appendProcessed = useCallback((turns: ProcessedTranscriptTurn[]) => {
    dispatch({ type: 'append-processed', payload: turns })
  }, [])

  const advanceTyping = useCallback(
    (id: string, sourceChars: number, translationChars: number) => {
      dispatch({ type: 'advance-typing', id, sourceChars, translationChars })
    },
    []
  )

  const completeTyping = useCallback((id: string) => {
    dispatch({ type: 'complete-typing', id })
  }, [])

  const clear = useCallback(() => {
    dispatch({ type: 'clear' })
  }, [])

  const clearPartial = useCallback(() => {
    dispatch({ type: 'clear-partial' })
  }, [])

  const getRecentTranscript = useCallback(
    (windowMs: number): string => {
      const cutoff = Date.now() - windowMs
      const recent = state.items
        .filter((item) => item.createdAtMs >= cutoff)
        .map((item) => item.fullSource)
        .join(' ')
        .trim()
      return recent.length >= 20 ? recent : ''
    },
    [state.items]
  )

  return {
    currentPartial: state.currentPartial,
    items: state.items,
    applyPartial,
    appendProcessed,
    advanceTyping,
    completeTyping,
    clearPartial,
    clear,
    getRecentTranscript,
  }
}
```

- [ ] **Step 3: Verify type-check + lint**

Run:
```bash
npx tsc --noEmit -p tsconfig.renderer.json
npx eslint src/renderer/overlay/useCaptionStore.ts src/renderer/overlay/types.ts
```

Expected: type-check clean. Lint may flag the missing dispatch deps; if so, the callbacks are already deps-empty because `dispatch` is stable.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/overlay/types.ts src/renderer/overlay/useCaptionStore.ts
git commit -m "feat(feed): typewriter fields on CaptionItem and store actions"
```

---

### Task 6: Build the Typewriter Hook

**Files:**
- Create: `src/renderer/feed/useFeedTypewriter.ts`

- [ ] **Step 1: Create the hook**

```ts
import { useEffect, useRef } from 'react'
import type { CaptionItem } from '../overlay/types'

interface UseFeedTypewriterArgs {
  items: CaptionItem[]
  advanceTyping: (id: string, sourceChars: number, translationChars: number) => void
  completeTyping: (id: string) => void
}

/** Characters revealed per RAF tick by source language. CJK = slower (more dense). */
function charsPerTickForLang(lang: string | undefined): number {
  if (!lang) return 2
  if (lang === 'ko' || lang === 'ja' || lang === 'zh') return 1
  return 2
}

/**
 * Walks the caption items queue. For the FIRST item with typing=true,
 * advances displayedSource and displayedTranslation by charsPerTickForLang
 * each frame until both reach their full text, then calls completeTyping
 * and moves on to the next.
 *
 * Hero is unaffected — this hook only touches feed items.
 */
export function useFeedTypewriter({
  items,
  advanceTyping,
  completeTyping,
}: UseFeedTypewriterArgs): void {
  const stateRef = useRef<{ id: string; src: number; tr: number } | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const tick = (): void => {
      const typingItem = items.find((item) => item.typing)
      if (!typingItem) {
        stateRef.current = null
        frameRef.current = null
        return
      }

      if (!stateRef.current || stateRef.current.id !== typingItem.id) {
        stateRef.current = { id: typingItem.id, src: 0, tr: 0 }
      }

      const step = charsPerTickForLang(typingItem.sourceLanguage)
      const cursor = stateRef.current
      const fullSrcLen = typingItem.fullSource.length
      const fullTrLen = typingItem.fullTranslation?.length ?? 0

      cursor.src = Math.min(cursor.src + step, fullSrcLen)
      // Translation starts when source is at least 30% done; CJK-aware ratio keeps both columns synced.
      const ratio = fullSrcLen === 0 ? 1 : cursor.src / fullSrcLen
      if (ratio >= 0.3 && fullTrLen > 0) {
        const targetTr = Math.ceil(ratio * fullTrLen)
        cursor.tr = Math.min(targetTr, fullTrLen)
      }

      const allDone = cursor.src >= fullSrcLen && cursor.tr >= fullTrLen
      if (allDone) {
        completeTyping(typingItem.id)
        stateRef.current = null
        frameRef.current = requestAnimationFrame(tick)
        return
      }

      advanceTyping(typingItem.id, cursor.src, cursor.tr)
      frameRef.current = requestAnimationFrame(tick)
    }

    if (frameRef.current === null && items.some((item) => item.typing)) {
      frameRef.current = requestAnimationFrame(tick)
    }

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [items, advanceTyping, completeTyping])
}
```

- [ ] **Step 2: Verify type-check**

Run:
```bash
npx tsc --noEmit -p tsconfig.renderer.json
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/feed/useFeedTypewriter.ts
git commit -m "feat(feed): typewriter hook that walks the caption queue"
```

---

### Task 7: Wire App.tsx — Consume Processed Turns + Drive Typewriter

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Import the hook + consume `onSttProcessed`**

Near the top of the imports:

```ts
import { useFeedTypewriter } from './feed/useFeedTypewriter'
import type { ProcessedTurnsEvent } from '../main/stt/types'
```

Inside the App component, destructure the new caption store API:

```ts
const {
  items,
  currentPartial,
  applyPartial,
  appendProcessed,
  advanceTyping,
  completeTyping,
  clearPartial,
  clear,
  getRecentTranscript,
} = useCaptionStore()
```

Replace any previous `applyTranscript` / `applyTranslation` references in the file. Where rough partials are received (the existing `onSttPartial` listener wiring), switch to:

```ts
useEffect(() => {
  if (!isElectron) return
  const api = window.electronAPI
  if (!api) return

  const offPartial = api.onSttPartial((text) => {
    applyPartial(text)
    if (text.trim()) setCaptionText(text)
  })

  const offProcessed = api.onSttProcessed((event: ProcessedTurnsEvent) => {
    if (!event?.turns?.length) return
    appendProcessed(event.turns)
  })

  return () => {
    offPartial()
    offProcessed()
  }
}, [applyPartial, appendProcessed])
```

Delete any leftover code that called `applyTranscript`, `enqueueTranslation`, `flushFeedBuffer`, `translationQueueRef`, or `drainTranslationQueue` for feed purposes. Search-and-destroy:

```bash
grep -n "applyTranscript\|enqueueTranslation\|flushFeedBuffer\|translationQueueRef\|drainTranslationQueue" src/renderer/App.tsx
```

For each hit: if it's about feed items, remove it. If it's about Answer Assist or another consumer, keep it but route it through `applyPartial` / `appendProcessed` semantics.

- [ ] **Step 2: Drive the typewriter**

Inside the App component, after the `useCaptionStore` destructure, add:

```ts
useFeedTypewriter({ items, advanceTyping, completeTyping })
```

- [ ] **Step 3: Render columns from displayed fields + show speaker eyebrow on change**

Find the JSX that renders the EN / KO columns. Replace the per-item map with this pattern (inside each column):

```tsx
{items.map((item, index) => {
  const previous = index > 0 ? items[index - 1] : null
  const showEyebrow =
    item.speakerLabel && (!previous || previous.speakerLabel !== item.speakerLabel)
  return (
    <Fragment key={`en-${item.id}`}>
      {showEyebrow && (
        <div className="v4p-eyebrow">
          <span className="v4p-eyebrow-name">{item.speakerLabel}</span>
          <span className="v4p-eyebrow-rule" />
        </div>
      )}
      <div className="v4p-line">
        <div className="v4p-line-time amw-mono">
          {formatDuration(
            Math.max(item.createdAtMs - (sessionStartMs ?? item.createdAtMs), 0)
          )}
        </div>
        <div
          className={`v4p-line-text${item.typing ? ' v4p-line-typing' : ''}`}
        >
          {item.displayedSource}
        </div>
      </div>
    </Fragment>
  )
})}
```

Do the same in the translation column, but read `item.displayedTranslation` (and skip the line entirely when `item.fullTranslation === null && !item.typing`).

Make sure to add `Fragment` to the React import line:

```ts
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

- [ ] **Step 4: Coordinate reset/stop with typewriter**

Find `resetSession` and `onStop`. In `resetSession`, after `clear()` is called, the typewriter naturally stops (nothing has `typing=true`). No extra code needed.

In `onStop`, the post-processor in main will flush remaining buffer because the user calls `stopTranscription`. To ensure the feed shows the last turn without a jarring half-typed state, force-complete any in-flight typing **after** the final processed event arrives. Since `appendProcessed` adds new items in typing state, and the typewriter advances them, no extra action is needed; the last item will type to completion.

If the user closes the modal mid-typing, the typewriter keeps running off-screen — that's fine since the items remain in the store.

- [ ] **Step 5: Verify**

Run:
```bash
npx tsc --noEmit -p tsconfig.renderer.json
npx eslint src/renderer/App.tsx
```

Expected: type-check clean. Lint clean (pre-existing `react-hooks/set-state-in-effect` at line ~520 in the whiteboard WebSocket effect persists — that's unrelated).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(feed): drive bilingual feed via processed turns + typewriter"
```

---

### Task 8: Speaker Eyebrow + Blinking Caret Styles

**Files:**
- Modify: `src/renderer/App.css`

- [ ] **Step 1: Add styles**

Append to `App.css`:

```css
/* ── Speaker eyebrow inside feed columns ───────────────────────────────── */

.v4p-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 18px 0 8px;
}

.v4p-eyebrow:first-child {
  margin-top: 0;
}

.v4p-eyebrow-name {
  font-family: var(--p-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--p-accent);
  white-space: nowrap;
}

.v4p-eyebrow-rule {
  flex: 1;
  height: 1px;
  background: var(--p-border);
}

/* ── Blinking caret while typewriter advances ──────────────────────────── */

.v4p-line-typing::after {
  content: '▍';
  display: inline-block;
  margin-left: 2px;
  color: var(--p-accent);
  font-weight: 400;
  animation: v4p-caret-blink 1s steps(1) infinite;
}

@keyframes v4p-caret-blink {
  50% {
    opacity: 0;
  }
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
npm run dev:ui
```

Open `http://localhost:5175/` in a browser and inspect the columns visually (no STT needed — the empty state should still render correctly).

Stop the dev server (Ctrl+C).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.css
git commit -m "feat(feed): speaker eyebrow + caret animation styles"
```

---

### Task 9: Manual QA Pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full app**

Run:
```bash
npm run dev:electron
```

(Or `npm run dev` for web mode if Electron is unavailable.)

- [ ] **Step 2: Walk the checklist**

For each item, mark PASS / FAIL in your notes:

- [ ] Start a session with a short English clip → hero (`Now Speaking`) shows partial text immediately
- [ ] Wait ~1.5–2s → first turn appears in feed, types out left-to-right with caret, speaker eyebrow "Speaker A"
- [ ] Translation column types out in sync (slightly behind by ratio)
- [ ] Long monologue with no sentence end → flush triggers via MAX_CHARS cap; feed keeps up
- [ ] Change target language to `en` while session is running → next turn shows new target; prior turns unchanged
- [ ] Change target to `off` mid-session → next turn's translation column shows nothing (full row, no caret on KO side)
- [ ] Set source to a different language (e.g., paste in a Korean clip via system audio) → feed shows source in Korean cleaned, translation in target
- [ ] Conversation with two clear voices → speaker label flips to "Speaker B" with a new eyebrow row
- [ ] Press Stop → hero pulse stops, last turn completes typing, duration freezes (validated by previous fix)
- [ ] Press Reset → feed clears, speakers reset to A on the next session
- [ ] Close the right panel, reopen via header toggle → no error, feed continues
- [ ] Disconnect network briefly during a flush → fallback turn appears with raw text, speaker "Unknown"

- [ ] **Step 3: Commit a QA notes file (optional)**

If you tracked QA notes in a file (e.g., `docs/superpowers/qa/2026-05-14-feed-typewriter.md`), commit it.

---

## Self-Review

- **Spec coverage:**
  - §1 architecture (hero / feed split) → Tasks 1, 5, 7 ✓
  - §1.5 typewriter UX → Tasks 5, 6, 8 ✓
  - §2 trigger logic → already in `transcriptPostProcessor` defaults; Task 2 only touches plumbing ✓
  - §3 LLM schema (cleanup + speaker + translation in one call, json strict-style, fallback) → Tasks 1, 3 ✓
  - §4 component map → covered across Tasks 1–7 ✓
  - §5 multi-lang + edge cases → Tasks 1, 3, 4, 9 ✓
- **Placeholder scan:** No "TBD" / "TODO" / "add appropriate error handling" — every step shows the change or command.
- **Type consistency:** `ProcessedTranscriptTurn` shape is the same in Tasks 1 / 3 / 5 / 7. `LanguageHints` is internal to the post-processor, no leak. `CaptionItem` shape is consistent between Task 5 (definition) and Task 7 (consumers).
- **Scope check:** Single subsystem (renderer feed pipeline + post-processor enhancement). Self-contained.
