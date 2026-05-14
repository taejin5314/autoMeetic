# STT Speaker Turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a main-process STT post-processing layer that turns rough realtime transcription chunks into punctuated Speaker A/B/C turns while keeping live partial captions fast.

**Architecture:** Raw realtime deltas continue to emit `stt:partial` immediately for live captions. Rough final chunks are buffered in `src/main/transcriptPostProcessor.ts`, cleaned by OpenAI into structured speaker turns, then sent to the renderer via `stt:processed` and forwarded to whiteboard/action-item services. Renderer feed entries use processed turns and show speaker labels.

**Tech Stack:** Electron IPC, TypeScript, React, OpenAI Chat Completions API, existing `TranscriptBus`, existing caption store.

---

## File Structure

Create:

- `src/main/transcriptPostProcessor.ts` - buffers rough STT chunks, calls OpenAI, parses/falls back, emits `stt:processed`, forwards downstream.
- `scripts/smoke-transcript-postprocessor.mjs` - validates the post-processing prompt and response shape against a sample transcript.

Modify:

- `src/main/stt/types.ts` - add processed speaker-turn type and speaker fields on `TranscriptSegment`.
- `src/preload/types.ts` - expose `onSttProcessed` and `resetTranscriptPostProcessor`.
- `src/preload/index.ts` - bridge `stt:processed` and reset IPC.
- `src/main/index.ts` - initialize the post-processor with `mainWindow`.
- `src/main/ipc.ts` - add reset handler for post-processor.
- `src/main/sttService.ts` - route rough commits to the post-processor instead of directly to renderer/downstream services.
- `src/renderer/electronSttClient.ts` - consume `stt:processed`, emit final transcript segments with speaker fields, avoid duplicate rough commits.
- `src/renderer/overlay/types.ts` - store optional speaker metadata in caption items.
- `src/renderer/overlay/useCaptionStore.ts` - copy speaker metadata from transcript segments into caption items.
- `src/renderer/App.tsx` - render speaker label above feed lines.
- `src/renderer/App.css` - style speaker labels.
- `tsconfig.main.json` - include the new main-process module.

## Important Execution Notes

- The repository may already contain uncommitted Action Items and Ask-the-meeting fixes. Do not revert them.
- Stage only files listed in each task when committing.
- `src/main/sttService.ts` currently sends rough chunks to `stt:committed`, `whiteboardService.enqueueTranscript`, and `actionItemService.enqueueTranscript`. This plan moves those downstream calls into `transcriptPostProcessor`.
- Browser-mode `RealtimeSttClient` is left unchanged in this plan. The new post-processing path is Electron-only.

---

### Task 1: Extend Shared STT and Preload Types

**Files:**
- Modify: `src/main/stt/types.ts`
- Modify: `src/preload/types.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Extend `src/main/stt/types.ts`**

Replace the contents of `src/main/stt/types.ts` with:

```ts
export type SpeakerId = 'speaker_a' | 'speaker_b' | 'speaker_c' | 'unknown'

export type SpeakerLabel = 'Speaker A' | 'Speaker B' | 'Speaker C' | 'Unknown'

export interface ProcessedTranscriptTurn {
  id: string
  speakerId: SpeakerId
  speakerLabel: SpeakerLabel
  text: string
  createdAtMs: number
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

- [ ] **Step 2: Extend `src/preload/types.ts`**

Add these entries to `ElectronAPI`:

```ts
  resetTranscriptPostProcessor(): Promise<void>
  onSttProcessed(callback: (event: unknown) => void): () => void
```

Place `resetTranscriptPostProcessor()` near the other action methods, and place `onSttProcessed` near `onSttCommitted`.

- [ ] **Step 3: Extend `src/preload/index.ts`**

Add this method to `electronAPI` near `stopTranscription`:

```ts
  resetTranscriptPostProcessor: () => ipcRenderer.invoke('reset-transcript-postprocessor'),
```

Add this event listener near `onSttCommitted`:

```ts
  onSttProcessed: createEventListener('stt:processed') as ElectronAPI['onSttProcessed'],
```

- [ ] **Step 4: Verify types**

Run:

```bash
npm run typecheck
```

Expected: typecheck may fail because `reset-transcript-postprocessor` and `stt:processed` are not wired in main yet. Failures should be limited to missing implementations from later tasks.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/main/stt/types.ts src/preload/types.ts src/preload/index.ts
git commit -m "feat(stt): add processed speaker turn IPC types"
```

---

### Task 2: Create Transcript Post-Processor Service

**Files:**
- Create: `src/main/transcriptPostProcessor.ts`
- Modify: `tsconfig.main.json`

- [ ] **Step 1: Create `src/main/transcriptPostProcessor.ts`**

Create the file with this content:

```ts
import type { BrowserWindow } from 'electron'
import { enqueueTranscript as enqueueActionTranscript } from './actionItemService'
import type { ProcessedTranscriptTurn, SpeakerId, SpeakerLabel } from './stt/types'
import { enqueueTranscript as enqueueWhiteboardTranscript } from './whiteboardService'

const STT_POSTPROCESS_MODEL = process.env.STT_POSTPROCESS_MODEL ?? 'gpt-4.1-mini'
const STT_POSTPROCESS_FLUSH_MS = Number(process.env.STT_POSTPROCESS_FLUSH_MS ?? 7000)
const STT_POSTPROCESS_MIN_CHARS = Number(process.env.STT_POSTPROCESS_MIN_CHARS ?? 50)
const STT_POSTPROCESS_MAX_CHARS = Number(process.env.STT_POSTPROCESS_MAX_CHARS ?? 3500)
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const SENTENCE_END_RE = /[.!?。？！]\s*$/

type RawTurn = {
  speakerId?: unknown
  speakerLabel?: unknown
  text?: unknown
}

let mainWindowRef: BrowserWindow | null = null
let buffer = ''
let flushTimer: ReturnType<typeof setTimeout> | null = null
let retryBuffer: string | null = null
let retryCount = 0
let warnedMissingApiKey = false

export function init(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
}

export function enqueueRoughTranscript(text: string): void {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return
  buffer = trimBatch([buffer, trimmed].filter(Boolean).join(' '))
  if (shouldFlushNow(buffer)) {
    void flushPendingTranscript()
  } else {
    scheduleFlush()
  }
}

export async function flushPendingTranscript(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }

  const batch = retryBuffer ?? buffer.trim()
  if (!batch) return
  if (!retryBuffer && batch.length < STT_POSTPROCESS_MIN_CHARS) {
    scheduleFlush()
    return
  }

  if (!retryBuffer) buffer = ''

  try {
    const turns = await processTranscriptBatch(batch)
    retryBuffer = null
    retryCount = 0
    emitProcessedTurns(turns.length > 0 ? turns : [fallbackTurn(batch)])
  } catch (err) {
    if (retryCount < 1) {
      retryBuffer = batch
      retryCount += 1
      scheduleFlush()
      return
    }
    retryBuffer = null
    retryCount = 0
    console.warn(
      '[stt-postprocess] failed; emitting raw fallback:',
      err instanceof Error ? err.message : String(err)
    )
    emitProcessedTurns([fallbackTurn(batch)])
  } finally {
    if (buffer.trim()) scheduleFlush()
  }
}

export function resetTranscriptPostProcessor(): void {
  buffer = ''
  retryBuffer = null
  retryCount = 0
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}

export function parseProcessedTranscriptResponse(
  content: string,
  createdAtMs = Date.now()
): ProcessedTranscriptTurn[] {
  const parsed = JSON.parse(stripJsonFence(content)) as { turns?: RawTurn[] }
  if (!Array.isArray(parsed.turns)) return []
  return parsed.turns
    .map((turn) => toProcessedTurn(turn, createdAtMs))
    .filter((turn): turn is ProcessedTranscriptTurn => turn !== null)
}

async function processTranscriptBatch(batch: string): Promise<ProcessedTranscriptTurn[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    if (!warnedMissingApiKey) {
      warnedMissingApiKey = true
      console.warn('[stt-postprocess] OPENAI_API_KEY not configured; using raw fallback')
    }
    return [fallbackTurn(batch)]
  }

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
            'You clean rough live meeting transcripts.',
            'Return JSON only: {"turns":[{"speakerId":"speaker_a","speakerLabel":"Speaker A","text":"..."}]}.',
            'Do not translate, summarize, add facts, add commitments, or remove meaningful content.',
            'Fix punctuation, capitalization, sentence boundaries, and obvious filler only when meaning is preserved.',
            'Use speaker_a, speaker_b, speaker_c, or unknown.',
            'Use Speaker A, Speaker B, Speaker C, or Unknown.',
            'Split into speaker turns, not individual sentences.',
            'Keep the same speaker when uncertain.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Rough transcript batch:\n\n${batch}`,
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
  return parseProcessedTranscriptResponse(content)
}

function emitProcessedTurns(turns: ProcessedTranscriptTurn[]): void {
  const cleaned = turns.filter((turn) => turn.text.trim())
  if (cleaned.length === 0) return
  mainWindowRef?.webContents.send('stt:processed', { turns: cleaned })
  for (const turn of cleaned) {
    enqueueWhiteboardTranscript(formatTurnForDownstream(turn))
    enqueueActionTranscript(formatTurnForDownstream(turn))
  }
}

function formatTurnForDownstream(turn: ProcessedTranscriptTurn): string {
  return `${turn.speakerLabel}: ${turn.text}`
}

function toProcessedTurn(turn: RawTurn, createdAtMs: number): ProcessedTranscriptTurn | null {
  const text = typeof turn.text === 'string' ? turn.text.trim() : ''
  if (!text) return null
  const speakerId = normalizeSpeakerId(turn.speakerId)
  return {
    id: `turn_${createdAtMs}_${Math.random().toString(36).slice(2, 8)}`,
    speakerId,
    speakerLabel: normalizeSpeakerLabel(turn.speakerLabel, speakerId),
    text,
    createdAtMs,
  }
}

function fallbackTurn(text: string): ProcessedTranscriptTurn {
  return {
    id: `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    speakerId: 'unknown',
    speakerLabel: 'Unknown',
    text: text.trim(),
    createdAtMs: Date.now(),
  }
}

function normalizeSpeakerId(value: unknown): SpeakerId {
  if (value === 'speaker_a' || value === 'speaker_b' || value === 'speaker_c') return value
  return 'unknown'
}

function normalizeSpeakerLabel(value: unknown, speakerId: SpeakerId): SpeakerLabel {
  if (value === 'Speaker A' || value === 'Speaker B' || value === 'Speaker C') return value
  if (speakerId === 'speaker_a') return 'Speaker A'
  if (speakerId === 'speaker_b') return 'Speaker B'
  if (speakerId === 'speaker_c') return 'Speaker C'
  return 'Unknown'
}

function stripJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushPendingTranscript()
  }, STT_POSTPROCESS_FLUSH_MS)
}

function shouldFlushNow(text: string): boolean {
  if (text.length >= STT_POSTPROCESS_MAX_CHARS) return true
  return text.length >= STT_POSTPROCESS_MIN_CHARS && SENTENCE_END_RE.test(text)
}

function trimBatch(text: string): string {
  if (text.length <= STT_POSTPROCESS_MAX_CHARS) return text
  return text.slice(text.length - STT_POSTPROCESS_MAX_CHARS)
}
```

- [ ] **Step 2: Include the new module in `tsconfig.main.json`**

Add this path in the `include` array after `src/main/sttService.ts`:

```json
"src/main/transcriptPostProcessor.ts",
```

- [ ] **Step 3: Verify compilation**

Run:

```bash
npm run typecheck
```

Expected: typecheck may still fail because the post-processor is not initialized or wired. There should be no syntax errors in `transcriptPostProcessor.ts`.

- [ ] **Step 4: Commit Task 2**

```bash
git add src/main/transcriptPostProcessor.ts tsconfig.main.json
git commit -m "feat(stt): add transcript post processor"
```

---

### Task 3: Wire Main Process STT Flow

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/sttService.ts`

- [ ] **Step 1: Initialize post-processor in `src/main/index.ts`**

Add the import near the other main services:

```ts
import { init as initTranscriptPostProcessor } from './transcriptPostProcessor'
```

After `initWhiteboard(mainWindow!)`, add:

```ts
  initTranscriptPostProcessor(mainWindow!)
```

- [ ] **Step 2: Add reset IPC in `src/main/ipc.ts`**

Add this handler after the `stop-transcription` handler:

```ts
  ipcMain.handle('reset-transcript-postprocessor', async () => {
    const { resetTranscriptPostProcessor } = await import('./transcriptPostProcessor')
    resetTranscriptPostProcessor()
  })
```

- [ ] **Step 3: Update imports in `src/main/sttService.ts`**

Remove these imports:

```ts
import { enqueueTranscript as enqueueActionTranscript } from './actionItemService'
import { enqueueTranscript } from './whiteboardService'
```

Add this import:

```ts
import {
  enqueueRoughTranscript,
  flushPendingTranscript,
  resetTranscriptPostProcessor,
} from './transcriptPostProcessor'
```

- [ ] **Step 4: Route rough commits to the post-processor**

In `commitDelta()`, replace:

```ts
  if (text) {
    mainWindowRef?.webContents.send('stt:committed', text)
    enqueueTranscript(text)
    enqueueActionTranscript(text)
  }
```

with:

```ts
  if (text) {
    enqueueRoughTranscript(text)
  }
```

In the `conversation.item.input_audio_transcription.completed` block, replace:

```ts
    if (transcript && transcript !== deltaBuffer.trim()) {
      mainWindowRef?.webContents.send('stt:committed', transcript)
      enqueueTranscript(transcript)
      enqueueActionTranscript(transcript)
    }
```

with:

```ts
    if (transcript && transcript !== deltaBuffer.trim()) {
      enqueueRoughTranscript(transcript)
    }
```

- [ ] **Step 5: Flush processed transcript on stop and close**

Change `stopTranscription` to async:

```ts
export async function stopTranscription(): Promise<void> {
```

At the end of `stopTranscription`, add:

```ts
  await flushPendingTranscript()
```

In the WebSocket `close` handler, replace:

```ts
    if (deltaBuffer.trim()) commitDelta()
```

with:

```ts
    if (deltaBuffer.trim()) commitDelta()
    void flushPendingTranscript()
```

- [ ] **Step 6: Reset post-processor at transcription start**

In `startTranscription`, immediately after `stopTranscription()`, add:

```ts
  resetTranscriptPostProcessor()
```

Keep the existing `stopTranscription()` call. Do not await it inside `startTranscription`; this function currently returns `void` and is invoked by IPC as a start command.

- [ ] **Step 7: Await stop in `src/main/ipc.ts`**

In the `stop-transcription` handler, replace:

```ts
    stopTranscription()
```

with:

```ts
    await stopTranscription()
```

- [ ] **Step 8: Verify main flow**

Run:

```bash
npm run typecheck
```

Expected: typecheck should pass for main-process files. Renderer errors from missing `onSttProcessed` consumption are handled in the next task.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/main/index.ts src/main/ipc.ts src/main/sttService.ts
git commit -m "feat(stt): route rough transcripts through post processor"
```

---

### Task 4: Consume Processed Turns in Electron Renderer Client

**Files:**
- Modify: `src/renderer/electronSttClient.ts`

- [ ] **Step 1: Import the processed turn type**

Add this import:

```ts
import type { ProcessedTranscriptTurn } from '../main/stt/types'
```

If `TranscriptBus` and `ProcessedTranscriptTurn` imports can share one type import from separate paths, keep both imports explicit.

- [ ] **Step 2: Add validator helper**

Add this helper above `export class ElectronSttClient`:

```ts
function isProcessedTurn(value: unknown): value is ProcessedTranscriptTurn {
  if (!value || typeof value !== 'object') return false
  const turn = value as Partial<ProcessedTranscriptTurn>
  return (
    typeof turn.id === 'string' &&
    typeof turn.text === 'string' &&
    typeof turn.createdAtMs === 'number' &&
    typeof turn.speakerId === 'string' &&
    typeof turn.speakerLabel === 'string'
  )
}
```

- [ ] **Step 3: Add `onSttProcessed` listener**

Inside `connect()`, after `offCommitted`, add:

```ts
      const offProcessed = api.onSttProcessed((event: unknown) => {
        const payload = event as { turns?: unknown[] }
        if (!Array.isArray(payload.turns)) return
        for (const turn of payload.turns.filter(isProcessedTurn)) {
          this.bus.emitTranscript({
            id: turn.id,
            text: turn.text,
            isFinal: true,
            createdAtMs: turn.createdAtMs,
            source: 'openai-realtime',
            speakerId: turn.speakerId,
            speakerLabel: turn.speakerLabel,
          })
        }
      })
```

- [ ] **Step 4: Keep rough committed listener as fallback only**

Replace the existing `offCommitted` body with:

```ts
      const offCommitted = api.onSttCommitted((text: string) => {
        this.bus.emitTranscript({
          id: makeId('stt'),
          text,
          isFinal: true,
          createdAtMs: Date.now(),
          source: 'openai-realtime',
          speakerId: 'unknown',
          speakerLabel: 'Unknown',
        })
      })
```

This keeps legacy compatibility if the main process emits `stt:committed`. The new main path should primarily emit `stt:processed`.

- [ ] **Step 5: Register cleanup**

Replace:

```ts
      this.cleanupFns = [offReady, offPartial, offCommitted, offError]
```

with:

```ts
      this.cleanupFns = [offReady, offPartial, offCommitted, offProcessed, offError]
```

- [ ] **Step 6: Verify renderer client**

Run:

```bash
npm run typecheck
```

Expected: typecheck should pass for `electronSttClient.ts`. Any UI speaker label work is handled in the next task.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/renderer/electronSttClient.ts
git commit -m "feat(stt): consume processed speaker turns"
```

---

### Task 5: Store and Render Speaker Labels in the Transcript Feed

**Files:**
- Modify: `src/renderer/overlay/types.ts`
- Modify: `src/renderer/overlay/useCaptionStore.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.css`

- [ ] **Step 1: Extend caption item type**

In `src/renderer/overlay/types.ts`, add optional speaker fields:

```ts
export interface CaptionItem {
  id: string
  sourceText: string
  translatedText?: string
  createdAtMs: number
  updatedAtMs: number
  speakerId?: string
  speakerLabel?: string
}
```

- [ ] **Step 2: Persist speaker metadata in caption store**

In `src/renderer/overlay/useCaptionStore.ts`, update the `item` created for committed transcripts:

```ts
    const item: CaptionItem = {
      id: action.payload.id,
      sourceText: action.payload.text,
      createdAtMs: action.payload.createdAtMs,
      updatedAtMs: Date.now(),
      speakerId: action.payload.speakerId,
      speakerLabel: action.payload.speakerLabel,
    }
```

- [ ] **Step 3: Render speaker label in original transcript column**

In `src/renderer/App.tsx`, find this block inside `items.map` for original lines:

```tsx
                    <div className="v4p-line-text">{item.sourceText}</div>
```

Replace it with:

```tsx
                    <div className="v4p-line-text">
                      {item.speakerLabel && (
                        <span className="v4p-line-speaker">{item.speakerLabel}</span>
                      )}
                      {item.sourceText}
                    </div>
```

- [ ] **Step 4: Render speaker label in translated column**

In the translated column `items.map`, find:

```tsx
                      <div className="v4p-line-text">
                        {item.translatedText || <span className="v4p-line-pending">…</span>}
                      </div>
```

Replace it with:

```tsx
                      <div className="v4p-line-text">
                        {item.speakerLabel && (
                          <span className="v4p-line-speaker">{item.speakerLabel}</span>
                        )}
                        {item.translatedText || <span className="v4p-line-pending">…</span>}
                      </div>
```

- [ ] **Step 5: Add speaker label CSS**

Add this block near `.v4p-line-text` in `src/renderer/App.css`:

```css
.v4p-line-speaker {
  display: block;
  margin-bottom: 3px;
  font-family: var(--p-mono);
  font-size: 10.5px;
  line-height: 1.2;
  color: var(--p-faint);
  text-transform: uppercase;
  letter-spacing: 0;
}
```

- [ ] **Step 6: Verify UI types**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both commands pass.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/renderer/overlay/types.ts src/renderer/overlay/useCaptionStore.ts src/renderer/App.tsx src/renderer/App.css
git commit -m "feat(stt): show speaker labels in transcript feed"
```

---

### Task 6: Reset Post-Processor From Session Reset

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Reset main post-processor on session reset**

In `resetSession`, near the existing Electron reset calls, add:

```ts
    if (isElectron) {
      void window.electronAPI?.resetTranscriptPostProcessor()
    }
```

If the function already has an `if (isElectron)` block for action items, combine the calls into one block:

```ts
    if (isElectron) {
      void window.electronAPI?.resetActionItems()
      void window.electronAPI?.resetTranscriptPostProcessor()
    }
```

- [ ] **Step 2: Verify reset wiring**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both commands pass.

- [ ] **Step 3: Commit Task 6**

```bash
git add src/renderer/App.tsx
git commit -m "feat(stt): reset transcript post processor with session"
```

---

### Task 7: Add Post-Processor Smoke Script

**Files:**
- Create: `scripts/smoke-transcript-postprocessor.mjs`

- [ ] **Step 1: Create `scripts/smoke-transcript-postprocessor.mjs`**

Create the file with this content:

```js
import 'dotenv/config'

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  console.error('OPENAI_API_KEY is not configured')
  process.exit(1)
}

const model = process.env.STT_POSTPROCESS_MODEL ?? 'gpt-4.1-mini'
const sample = `
we should ship the beta next friday can you prepare the rollout checklist
yeah i can draft it today and send it to sarah
great please make sure the customer migration risk is called out
`

const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You clean rough live meeting transcripts.',
          'Return JSON only: {"turns":[{"speakerId":"speaker_a","speakerLabel":"Speaker A","text":"..."}]}.',
          'Do not translate, summarize, add facts, add commitments, or remove meaningful content.',
          'Fix punctuation, capitalization, sentence boundaries, and obvious filler only when meaning is preserved.',
          'Use speaker_a, speaker_b, speaker_c, or unknown.',
          'Use Speaker A, Speaker B, Speaker C, or Unknown.',
          'Split into speaker turns, not individual sentences.',
          'Keep the same speaker when uncertain.',
        ].join(' '),
      },
      { role: 'user', content: `Rough transcript batch:\n\n${sample}` },
    ],
  }),
})

if (!response.ok) {
  const text = await response.text()
  console.error(`OpenAI error ${response.status}: ${text}`)
  process.exit(1)
}

const payload = await response.json()
const content = payload.choices?.[0]?.message?.content ?? ''
console.log(content)

const parsed = JSON.parse(String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''))
if (!Array.isArray(parsed.turns)) {
  console.error('Expected parsed.turns to be an array')
  process.exit(1)
}
if (parsed.turns.length === 0) {
  console.error('Expected at least one processed turn')
  process.exit(1)
}
for (const turn of parsed.turns) {
  if (typeof turn.text !== 'string' || turn.text.trim().length === 0) {
    console.error('Each turn must include non-empty text')
    process.exit(1)
  }
  if (typeof turn.speakerId !== 'string' || typeof turn.speakerLabel !== 'string') {
    console.error('Each turn must include speakerId and speakerLabel')
    process.exit(1)
  }
}
console.log(`Processed ${parsed.turns.length} speaker turn(s)`)
```

- [ ] **Step 2: Run smoke script**

Run:

```bash
node scripts/smoke-transcript-postprocessor.mjs
```

Expected: command prints JSON containing `turns`, then prints `Processed <N> speaker turn(s)`.

- [ ] **Step 3: Commit Task 7**

```bash
git add scripts/smoke-transcript-postprocessor.mjs
git commit -m "test(stt): add transcript postprocessor smoke script"
```

---

### Task 8: Final Verification

**Files:**
- No source files should be edited in this task unless verification exposes a concrete defect.

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: `tsc --noEmit` exits with code 0.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: `eslint .` exits with code 0.

- [ ] **Step 3: Run post-processor smoke script**

```bash
node scripts/smoke-transcript-postprocessor.mjs
```

Expected: script exits with code 0 and prints `Processed <N> speaker turn(s)`.

- [ ] **Step 4: Manual Electron verification**

Run the Electron app:

```bash
npm run dev:electron
```

Manual checks:

- Start capture and share a tab/window with speech audio.
- Confirm live partial caption updates immediately while speech is ongoing.
- Wait 5-10 seconds after a spoken segment.
- Confirm the transcript feed shows punctuated final entries.
- Confirm each final entry shows `Speaker A`, `Speaker B`, `Speaker C`, or `Unknown`.
- Confirm translation appears for processed entries when translation target is enabled and differs from source language.
- Confirm whiteboard and action item behavior still receive transcript content.
- Click Stop and confirm the final buffered text appears in the feed.
- Click Reset twice and confirm feed clears and no stale processed transcript appears afterward.

- [ ] **Step 5: Commit any verification fix**

If Step 4 required a code fix, commit only that fix:

```bash
git add <fixed-files>
git commit -m "fix(stt): address speaker turn verification issue"
```

If Step 4 required no code changes, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Low-latency partial captions are preserved by leaving `stt:partial` unchanged in Tasks 3 and 4.
- Sentence cleanup and punctuation are implemented in `transcriptPostProcessor.ts` in Task 2.
- Speaker A/B/C best-effort turns are implemented in the post-processing prompt and processed turn model in Tasks 1 and 2.
- `stt:processed` IPC is added in Tasks 1 and 4.
- Renderer speaker labels are implemented in Task 5.
- Downstream whiteboard/action item forwarding is implemented in Task 2.
- Stop flush is implemented in Task 3.
- Reset clearing is implemented in Tasks 3 and 6.
- Fallback raw `Unknown` turn behavior is implemented in Task 2.

Completeness scan:

- This plan contains no unspecified implementation steps.
- Every code-changing step includes exact code blocks or exact replacements.

Type consistency:

- `ProcessedTranscriptTurn`, `speakerId`, and `speakerLabel` names are consistent across main, preload, renderer client, and caption store tasks.
- IPC event name is consistently `stt:processed`.
- Reset invoke name is consistently `reset-transcript-postprocessor`.
