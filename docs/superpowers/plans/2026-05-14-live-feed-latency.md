# Live Feed Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the live feed end-to-end latency from ~2.5-7s to <1.5s P50 by removing post-processor buffering, simplifying the LLM call to translation-only, and speeding up the renderer typewriter — at the cost of raw STT punctuation and dropped speaker labels.

**Architecture:** Three independent changes. The post-processor flushes every STT commit immediately (serialized to preserve order) and calls the LLM with a translation-only prompt that echoes raw STT as the displayed source. The renderer typewriter speed multiplier is raised. The speaker A/B/Unknown eyebrow in the feed columns is removed.

**Tech Stack:** Electron main + renderer, TypeScript (strict), React 19, OpenAI Chat Completions, existing `transcriptPostProcessor` and `useFeedTypewriter` modules.

---

## File Structure

**Modify:**
- `src/renderer/feed/useFeedTypewriter.ts` — bump `charsPerTickForLang` from 1/2 to 5/8.
- `src/renderer/App.tsx` — remove the two `v4p-eyebrow` render blocks (source column and translation column).
- `src/main/transcriptPostProcessor.ts` — replace buffering, prompt, and emit logic.

**No changes:**
- `src/main/sttService.ts` — STT commit thresholds stay.
- `src/main/stt/types.ts` — `ProcessedTranscriptTurn` shape stays (speaker fields filled with constants).
- `src/renderer/overlay/useCaptionStore.ts` — already handles single-turn or multi-turn payloads.
- Downstream (`actionItemService`, `whiteboardService`) — receive `formatTurnForDownstream` output unchanged.

**Out of scope:** see spec section "Out of Scope".

---

## Important Execution Notes

- **No test runner is installed.** Project verification is `npm run typecheck`, `npm run lint`, and manual QA. Each task ends with typecheck + lint + commit. The manual QA pass happens once at the end (Task 4).
- TypeScript strict mode — no `any`. Project CLAUDE.md forbids it.
- The post-processor is module-scoped (top-level `let buffer`, etc.). Do not introduce a class — keep the existing module-level state pattern.
- Use `process.env.STT_POSTPROCESS_MODEL ?? 'gpt-4.1-nano'` as the new default. If the engineer discovers at runtime that `gpt-4.1-nano` is not a valid model on the user's account, fall back to `gpt-4.1-mini` and note this in the commit. The env var lets the user override either way.
- `ProcessedTranscriptTurn.speakerId` / `speakerLabel` stay populated with constants (`'unknown'` / `'Unknown'`) so downstream `formatTurnForDownstream` keeps producing `Unknown: <text>` strings without breaking action items / whiteboard pipelines.
- Commit messages use the existing prefix style visible in `git log` (e.g. `feat(stt):`, `tweak(stt):`, `fix(feed):`).

---

## Task 1: Speed up the feed typewriter

**Files:**
- Modify: `src/renderer/feed/useFeedTypewriter.ts:11-15`

- [ ] **Step 1: Edit `charsPerTickForLang`**

Replace the body of `charsPerTickForLang` so CJK reveals 5 chars/RAF and Latin reveals 8 chars/RAF. Final state of lines 10-15:

```ts
/** Characters revealed per RAF tick by source language. CJK = slower (more dense). */
function charsPerTickForLang(lang: string | undefined): number {
  if (!lang) return 8
  if (lang === 'ko' || lang === 'ja' || lang === 'zh') return 5
  return 8
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no output.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/feed/useFeedTypewriter.ts
git commit -m "tweak(feed): raise typewriter speed to 5/8 chars per RAF"
```

---

## Task 2: Remove speaker eyebrow from feed columns

**Files:**
- Modify: `src/renderer/App.tsx` (two `v4p-eyebrow` blocks, currently around lines 978-1001 and 1023-1050)

The eyebrow block renders a `Speaker A` / `Speaker B` header above the first line whenever the speaker label changes. With speaker classification dropped (always `'Unknown'`), this block would render `Unknown` repeatedly or once at the start — visually noisy and meaningless.

- [ ] **Step 1: Locate both eyebrow render blocks**

Run: `grep -n "v4p-eyebrow" src/renderer/App.tsx`
Expected: about 4 matches (className references), within two `items.map` blocks (source column and translation column).

- [ ] **Step 2: Remove eyebrow logic from the source column**

In the first `items.map` block, the current rendering computes `showEyebrow` from speaker label and renders a `<div className="v4p-eyebrow">…</div>`. Replace this map block (currently around lines 978-1002) so it no longer references speaker eyebrow. Final state of that map (keep surrounding markup and `<div className="v4p-trail">…</div>` as-is):

```tsx
{items.map((item) => (
  <div className="v4p-line" key={`en-${item.id}`}>
    <div className="v4p-line-time amw-mono">
      {formatDuration(
        Math.max(item.createdAtMs - (sessionStartMs ?? item.createdAtMs), 0)
      )}
    </div>
    <div className={`v4p-line-text${item.typing ? ' v4p-line-typing' : ''}`}>
      {item.displayedSource}
    </div>
  </div>
))}
```

If `Fragment` is no longer used anywhere in `App.tsx` after this edit, remove its import. Run `grep -n "Fragment" src/renderer/App.tsx` to confirm before removing.

- [ ] **Step 3: Remove eyebrow logic from the translation column**

In the second `items.map` block (translation column, currently around lines 1023-1051), apply the same transformation. Final state:

```tsx
{items.map((item) => {
  if (item.fullTranslation === null) return null
  return (
    <div className="v4p-line" key={`tr-${item.id}`}>
      <div className="v4p-line-time amw-mono">
        {formatDuration(
          Math.max(item.createdAtMs - (sessionStartMs ?? item.createdAtMs), 0)
        )}
      </div>
      <div className={`v4p-line-text${item.typing ? ' v4p-line-typing' : ''}`}>
        {item.displayedTranslation}
      </div>
    </div>
  )
})}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(feed): drop speaker eyebrow from feed columns"
```

---

## Task 3: Rewrite the transcript post-processor

This is the high-impact change. It replaces buffering, the LLM prompt, and emit logic. We keep the public surface (`init`, `enqueueRoughTranscript`, `flushPendingTranscript`, `resetTranscriptPostProcessor`, `parseProcessedTranscriptResponse`) so callers in `sttService.ts` and `index.ts` keep compiling.

**Files:**
- Modify: `src/main/transcriptPostProcessor.ts` (full rewrite)

- [ ] **Step 1: Replace the file contents**

Write the following as the complete new contents of `src/main/transcriptPostProcessor.ts`:

```ts
import type { BrowserWindow } from 'electron'
import { enqueueTranscript as enqueueActionTranscript } from './actionItemService'
import type { ProcessedTranscriptTurn } from './stt/types'
import { enqueueTranscript as enqueueWhiteboardTranscript } from './whiteboardService'

const STT_POSTPROCESS_MODEL = process.env.STT_POSTPROCESS_MODEL ?? 'gpt-4.1-nano'
const STT_POSTPROCESS_MIN_CHARS = Number(process.env.STT_POSTPROCESS_MIN_CHARS ?? 3)
const STT_POSTPROCESS_FLOOR_FLUSH_MS = Number(process.env.STT_POSTPROCESS_FLOOR_FLUSH_MS ?? 2000)
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'

interface LanguageHints {
  sourceLanguageHint: string
  targetLanguage: string
}

interface TranslationResponse {
  translation: string | null
  sourceLanguage: string
}

let mainWindowRef: BrowserWindow | null = null
let buffer = ''
let bufferHints: LanguageHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
let floorTimer: ReturnType<typeof setTimeout> | null = null
let inFlight = false
let warnedMissingApiKey = false

export function init(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
}

export function enqueueRoughTranscript(text: string, hints: LanguageHints): void {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return
  buffer = buffer ? `${buffer} ${trimmed}` : trimmed
  bufferHints = hints
  void tryDrain()
}

export async function flushPendingTranscript(options: { force?: boolean } = {}): Promise<void> {
  if (floorTimer) {
    clearTimeout(floorTimer)
    floorTimer = null
  }
  if (!buffer.trim()) return
  if (!options.force && buffer.length < STT_POSTPROCESS_MIN_CHARS) {
    scheduleFloorFlush()
    return
  }
  await tryDrain({ force: true })
}

export function resetTranscriptPostProcessor(): void {
  buffer = ''
  bufferHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
  if (floorTimer) {
    clearTimeout(floorTimer)
    floorTimer = null
  }
  inFlight = false
}

/**
 * Back-compat parser for any external callers / tests. Accepts either the
 * new single-turn schema { translation, sourceLanguage } or the legacy
 * { turns: [...] } and returns a normalized array.
 */
export function parseProcessedTranscriptResponse(
  content: string,
  createdAtMs = Date.now(),
  hints: LanguageHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
): ProcessedTranscriptTurn[] {
  const parsed = JSON.parse(stripJsonFence(content)) as Record<string, unknown>
  if (typeof parsed.translation !== 'undefined' || typeof parsed.sourceLanguage !== 'undefined') {
    return [
      buildTurn({
        text: typeof parsed.text === 'string' ? parsed.text : '',
        translation: typeof parsed.translation === 'string' ? parsed.translation : null,
        sourceLanguage:
          typeof parsed.sourceLanguage === 'string' ? parsed.sourceLanguage : hints.sourceLanguageHint,
        targetLanguage: hints.targetLanguage,
        createdAtMs,
      }),
    ].filter((turn) => turn.text.trim().length > 0)
  }
  return []
}

async function tryDrain(options: { force?: boolean } = {}): Promise<void> {
  if (inFlight) return
  const text = buffer.trim()
  if (!text) return
  if (!options.force && text.length < STT_POSTPROCESS_MIN_CHARS) {
    scheduleFloorFlush()
    return
  }
  if (floorTimer) {
    clearTimeout(floorTimer)
    floorTimer = null
  }
  buffer = ''
  const hints = bufferHints
  inFlight = true
  try {
    const turn = await processSingleTurn(text, hints)
    emitProcessedTurn(turn)
  } catch (err) {
    console.warn(
      '[stt-postprocess] failed; emitting raw fallback:',
      err instanceof Error ? err.message : String(err)
    )
    emitProcessedTurn(buildFallbackTurn(text, hints))
  } finally {
    inFlight = false
    if (buffer.trim()) void tryDrain()
  }
}

async function processSingleTurn(
  text: string,
  hints: LanguageHints
): Promise<ProcessedTranscriptTurn> {
  const createdAtMs = Date.now()

  // Translation off, or source already matches target: skip LLM entirely.
  const wantsTranslation =
    hints.targetLanguage !== 'off' && hints.targetLanguage !== hints.sourceLanguageHint
  if (!wantsTranslation) {
    return buildTurn({
      text,
      translation: null,
      sourceLanguage: hints.sourceLanguageHint,
      targetLanguage: hints.targetLanguage,
      createdAtMs,
    })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    if (!warnedMissingApiKey) {
      warnedMissingApiKey = true
      console.warn('[stt-postprocess] OPENAI_API_KEY not configured; using raw fallback')
    }
    return buildFallbackTurn(text, hints)
  }

  const response = await callTranslationApi(text, hints, apiKey)
  return buildTurn({
    text,
    translation: response.translation,
    sourceLanguage: response.sourceLanguage || hints.sourceLanguageHint,
    targetLanguage: hints.targetLanguage,
    createdAtMs,
  })
}

async function callTranslationApi(
  text: string,
  hints: LanguageHints,
  apiKey: string
): Promise<TranslationResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  let response: Response
  try {
    response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
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
              'You translate one short live transcript chunk at a time.',
              `Return JSON only: {"translation":"...","sourceLanguage":"en"}.`,
              'Detect the source language and emit its ISO code (en, ko, ja, zh, es, fr, de).',
              `Translate into ${hints.targetLanguage}. If source language equals target, set translation to null.`,
              'Translate exactly; do not add, remove, or summarize meaning. Do not fix grammar.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              `Source language hint: ${hints.sourceLanguageHint}`,
              `Target language: ${hints.targetLanguage}`,
              '',
              'Transcript chunk:',
              '',
              text,
            ].join('\n'),
          },
        ],
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI translation error ${response.status}: ${body.slice(0, 300)}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content?.trim() ?? ''
  if (!content) throw new Error('Empty translation response')

  const parsed = JSON.parse(stripJsonFence(content)) as Record<string, unknown>
  const translation =
    typeof parsed.translation === 'string' && parsed.translation.trim()
      ? parsed.translation.trim()
      : null
  const sourceLanguage =
    typeof parsed.sourceLanguage === 'string' && parsed.sourceLanguage.length === 2
      ? parsed.sourceLanguage
      : hints.sourceLanguageHint
  return { translation, sourceLanguage }
}

function buildTurn(args: {
  text: string
  translation: string | null
  sourceLanguage: string
  targetLanguage: string
  createdAtMs: number
}): ProcessedTranscriptTurn {
  return {
    id: `turn_${args.createdAtMs}_${Math.random().toString(36).slice(2, 8)}`,
    speakerId: 'unknown',
    speakerLabel: 'Unknown',
    text: args.text.trim(),
    translation: args.translation,
    sourceLanguage: args.sourceLanguage,
    targetLanguage: args.targetLanguage,
    createdAtMs: args.createdAtMs,
  }
}

function buildFallbackTurn(text: string, hints: LanguageHints): ProcessedTranscriptTurn {
  return buildTurn({
    text,
    translation: null,
    sourceLanguage: hints.sourceLanguageHint,
    targetLanguage: hints.targetLanguage,
    createdAtMs: Date.now(),
  })
}

function emitProcessedTurn(turn: ProcessedTranscriptTurn): void {
  if (!turn.text.trim()) return
  mainWindowRef?.webContents.send('stt:processed', { turns: [turn] })
  const downstream = `${turn.speakerLabel}: ${turn.text}`
  enqueueWhiteboardTranscript(downstream)
  enqueueActionTranscript(downstream)
}

function scheduleFloorFlush(): void {
  if (floorTimer) return
  floorTimer = setTimeout(() => {
    floorTimer = null
    void tryDrain({ force: true })
  }, STT_POSTPROCESS_FLOOR_FLUSH_MS)
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}
```

- [ ] **Step 2: Verify no callers were broken**

Run: `grep -rn "transcriptPostProcessor\|enqueueRoughTranscript\|flushPendingTranscript\|resetTranscriptPostProcessor\|parseProcessedTranscriptResponse" src/`
Expected: only `src/main/sttService.ts` and `src/main/transcriptPostProcessor.ts` (and possibly `src/main/index.ts` for `init`) reference these names. All exported names from the rewrite must match.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. If errors mention removed symbols (`STT_POSTPROCESS_FLUSH_MS`, `STT_POSTPROCESS_MAX_CHARS`), find the caller and verify it does not depend on them; the rewrite intentionally drops those names.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcriptPostProcessor.ts
git commit -m "feat(stt): per-commit translation-only post-processor for low-latency feed"
```

---

## Task 4: Manual end-to-end verification

The success criteria from the spec are perceptual and integration-level. Run the app and confirm them.

- [ ] **Step 1: Build / start dev electron**

Run: `npm run dev:electron`
Expected: window opens, no console errors on startup.

- [ ] **Step 2: Start a session and speak short sentences**

In the app: press Start, share a tab with audio (or speak through system audio loopback). Say 3-5 short sentences with pauses (e.g. "Hello. This is a test. Let's check the latency.").

- [ ] **Step 3: Verify latency target**

Watch the feed. Each sentence should appear within ~1.5 seconds of finishing it (P50). The feed should NOT wait for multiple sentences to batch — each completed sentence becomes its own line. If consistent latency exceeds 2.5s, check the dev console for `[stt-postprocess]` warnings (likely model name issue → switch env var to `gpt-4.1-mini`).

- [ ] **Step 4: Verify column sync**

The source and translation columns should reveal each line in lockstep (both start typing together). If source appears alone, the translation flow is broken — re-check Task 3 emit logic.

- [ ] **Step 5: Verify no speaker labels render**

Scroll the feed: no `Speaker A` / `Speaker B` / `Unknown` headers should appear above lines.

- [ ] **Step 6: Verify chunk size**

Lines should be roughly one sentence each, not multi-sentence batches. Two short sentences may rarely combine when STT commits both before the previous LLM call returns — acceptable.

- [ ] **Step 7: Verify translation OFF path**

In the app's language settings (or by setting `targetLanguage` to `'off'` in renderer state), turn translation off and speak again. Lines should appear with no translation column entry and even lower latency (no LLM round-trip).

- [ ] **Step 8: Verify downstream untouched**

Confirm action items panel and whiteboard agent still receive transcripts (any prior agent behavior continues; new lines appear in their input streams labeled `Unknown: <text>`).

- [ ] **Step 9: No commit**

No code changed in this task. If a regression is found, return to the relevant earlier task and fix.

---

## Rollback

Each task is its own commit. To roll back a single layer:

```bash
git revert <commit-sha>
```

If only the post-processor needs rollback, revert just that commit — the typewriter speed and eyebrow removal can stand alone.

The model default is env-overridable. To switch without code change: `STT_POSTPROCESS_MODEL=gpt-4.1-mini`.
