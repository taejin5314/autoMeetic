import type { BrowserWindow } from 'electron'
import { enqueueTranscript as enqueueActionTranscript } from './actionItemService'
import { notifyTranslation, notifyTurnFinalized } from './memory/transcriptHook'
import type { ProcessedTranscriptTurn } from './stt/types'
import { enqueueTranscript as enqueueWhiteboardTranscript } from './whiteboardService'

const STT_POSTPROCESS_MODEL = process.env.STT_POSTPROCESS_MODEL ?? 'gpt-4.1-nano'
const STT_POSTPROCESS_MIN_CHARS = Number(process.env.STT_POSTPROCESS_MIN_CHARS ?? 1)
const STT_POSTPROCESS_FLOOR_FLUSH_MS = Number(process.env.STT_POSTPROCESS_FLOOR_FLUSH_MS ?? 2000)
const STT_LIVE_SENTENCE_FINALIZE_MS = Number(process.env.STT_LIVE_SENTENCE_FINALIZE_MS ?? 3200)
const STT_LIVE_SENTENCE_SHORT_FINALIZE_MS = Number(
  process.env.STT_LIVE_SENTENCE_SHORT_FINALIZE_MS ?? 5200
)
const STT_LIVE_SENTENCE_MAX_CHARS = Number(process.env.STT_LIVE_SENTENCE_MAX_CHARS ?? 220)
const STT_TRANSLATION_DEBOUNCE_MS = Number(process.env.STT_TRANSLATION_DEBOUNCE_MS ?? 650)
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const SENTENCE_END_RE = /[.!?。？！]\s*$/
const NO_SPACE_BEFORE_RE = /^[.!?,;:。？！、，；：]+/
const INCOMPLETE_ENGLISH_END_RE =
  /\b(a|an|and|are|as|at|because|but|for|from|if|in|is|of|or|so|that|the|then|to|uh|um|with|who|what|when|where|which|while|would|you|your)$/i

interface LanguageHints {
  sourceLanguageHint: string
  targetLanguage: string
}

interface PendingTranslation {
  id: string
  text: string
  hints: LanguageHints
  version: number
}

interface ActiveSourceTurn {
  id: string
  text: string
  hints: LanguageHints
  createdAtMs: number
  finalizeTimer: ReturnType<typeof setTimeout> | null
  translationTimer: ReturnType<typeof setTimeout> | null
  translationVersion: number
  downstreamSent: boolean
}

interface TranslationResponse {
  translation: string | null
  sourceLanguage: string
}

let mainWindowRef: BrowserWindow | null = null

let coalesceBuffer = ''
let coalesceHints: LanguageHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
let coalesceTimer: ReturnType<typeof setTimeout> | null = null

const translationQueue: PendingTranslation[] = []
const translationVersionsById = new Map<string, number>()
let translationInFlight = false
let warnedMissingApiKey = false
let activeSourceTurn: ActiveSourceTurn | null = null

export function init(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
}

export function enqueueRoughTranscript(text: string, hints: LanguageHints): void {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return

  const combined = coalesceBuffer ? `${coalesceBuffer} ${trimmed}` : trimmed
  coalesceHints = hints

  if (combined.length < STT_POSTPROCESS_MIN_CHARS) {
    coalesceBuffer = combined
    scheduleCoalesceFlush()
    return
  }

  if (coalesceTimer) {
    clearTimeout(coalesceTimer)
    coalesceTimer = null
  }
  coalesceBuffer = ''
  emitSourceFragment(combined, hints)
}

export async function flushPendingTranscript(options: { force?: boolean } = {}): Promise<void> {
  if (coalesceTimer) {
    clearTimeout(coalesceTimer)
    coalesceTimer = null
  }
  const pending = coalesceBuffer.trim()
  if (!pending) {
    if (options.force) finalizeActiveSourceTurn({ translateImmediately: true })
    return
  }
  if (!options.force && pending.length < STT_POSTPROCESS_MIN_CHARS) {
    coalesceBuffer = pending
    scheduleCoalesceFlush()
    return
  }
  coalesceBuffer = ''
  emitSourceFragment(pending, coalesceHints)
  if (options.force) finalizeActiveSourceTurn({ translateImmediately: true })
}

export function resetTranscriptPostProcessor(): void {
  coalesceBuffer = ''
  coalesceHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
  if (coalesceTimer) {
    clearTimeout(coalesceTimer)
    coalesceTimer = null
  }
  clearActiveSourceTurn()
  translationQueue.length = 0
  translationVersionsById.clear()
  translationInFlight = false
}

/**
 * Back-compat parser for any external callers / tests. Accepts the
 * single-turn schema { translation, sourceLanguage } and returns a normalized array.
 */
export function parseProcessedTranscriptResponse(
  content: string,
  createdAtMs = Date.now(),
  hints: LanguageHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
): ProcessedTranscriptTurn[] {
  const parsed = JSON.parse(stripJsonFence(content)) as Record<string, unknown>
  if (typeof parsed.translation === 'undefined' && typeof parsed.sourceLanguage === 'undefined') {
    return []
  }
  const text = typeof parsed.text === 'string' ? parsed.text : ''
  if (!text.trim()) return []
  return [
    buildTurn({
      id: makeTurnId(createdAtMs),
      text,
      translation: typeof parsed.translation === 'string' ? parsed.translation : null,
      sourceLanguage:
        typeof parsed.sourceLanguage === 'string'
          ? parsed.sourceLanguage
          : hints.sourceLanguageHint,
      targetLanguage: hints.targetLanguage,
      createdAtMs,
    }),
  ]
}

function emitSourceFragment(text: string, hints: LanguageHints): void {
  const fragment = text.trim()
  if (!fragment) return

  if (
    activeSourceTurn &&
    (activeSourceTurn.hints.sourceLanguageHint !== hints.sourceLanguageHint ||
      activeSourceTurn.hints.targetLanguage !== hints.targetLanguage)
  ) {
    finalizeActiveSourceTurn({ translateImmediately: true })
  }

  if (!activeSourceTurn) {
    startActiveSourceTurn(fragment, hints)
  } else {
    appendActiveSourceTurn(fragment)
  }

  const active = activeSourceTurn
  if (!active) return

  if (shouldFinalizeSourceTurn(active.text)) {
    finalizeActiveSourceTurn({ translateImmediately: true })
    return
  }

  scheduleSourceFinalization(active)
  scheduleTranslation(active, STT_TRANSLATION_DEBOUNCE_MS)
}

function startActiveSourceTurn(text: string, hints: LanguageHints): void {
  const createdAtMs = Date.now()
  const id = makeTurnId(createdAtMs)
  activeSourceTurn = {
    id,
    text,
    hints,
    createdAtMs,
    finalizeTimer: null,
    translationTimer: null,
    translationVersion: 0,
    downstreamSent: false,
  }

  const turn = buildTurn({
    id,
    text,
    translation: null,
    sourceLanguage: hints.sourceLanguageHint,
    targetLanguage: hints.targetLanguage,
    createdAtMs,
  })

  emitProcessedTurn(turn, { sendDownstream: false })
}

function appendActiveSourceTurn(fragment: string): void {
  const active = activeSourceTurn
  if (!active) return
  active.text = joinSourceFragments(active.text, fragment)
  emitSourcePatch(active.id, active.text)
}

function finalizeActiveSourceTurn(options: { translateImmediately: boolean }): void {
  const active = activeSourceTurn
  if (!active) return
  activeSourceTurn = null
  clearActiveTimers(active)
  emitSourcePatch(active.id, active.text)
  emitFinalDownstream(active)
  notifyTurnFinalized({
    id: active.id,
    text: active.text.trim(),
    sourceLanguage: active.hints.sourceLanguageHint,
    targetLanguage: active.hints.targetLanguage,
    createdAtMs: active.createdAtMs,
    speakerId: 'unknown',
    speakerLabel: 'Unknown',
  })
  if (options.translateImmediately) scheduleTranslation(active, 0)
}

function clearActiveSourceTurn(): void {
  if (!activeSourceTurn) return
  clearActiveTimers(activeSourceTurn)
  activeSourceTurn = null
}

function clearActiveTimers(active: ActiveSourceTurn): void {
  if (active.finalizeTimer) {
    clearTimeout(active.finalizeTimer)
    active.finalizeTimer = null
  }
  if (active.translationTimer) {
    clearTimeout(active.translationTimer)
    active.translationTimer = null
  }
}

function scheduleSourceFinalization(active: ActiveSourceTurn): void {
  if (active.finalizeTimer) clearTimeout(active.finalizeTimer)
  active.finalizeTimer = setTimeout(() => {
    if (activeSourceTurn?.id !== active.id) return
    finalizeActiveSourceTurn({ translateImmediately: true })
  }, sourceFinalizeDelayMs(active.text))
}

function scheduleTranslation(active: ActiveSourceTurn, delayMs: number): void {
  const wantsTranslation =
    active.hints.targetLanguage !== 'off' &&
    active.hints.targetLanguage !== active.hints.sourceLanguageHint
  if (!wantsTranslation) return

  if (active.translationTimer) clearTimeout(active.translationTimer)
  active.translationVersion += 1
  const version = active.translationVersion
  translationVersionsById.set(active.id, version)
  active.translationTimer = setTimeout(() => {
    active.translationTimer = null
    translationQueue.push({ id: active.id, text: active.text, hints: active.hints, version })
    void drainTranslationQueue()
  }, delayMs)
}

function shouldFinalizeSourceTurn(text: string): boolean {
  return text.length >= STT_LIVE_SENTENCE_MAX_CHARS || SENTENCE_END_RE.test(text)
}

function sourceFinalizeDelayMs(text: string): number {
  const normalized = text.trim()
  if (isLikelyIncompleteSource(normalized)) return STT_LIVE_SENTENCE_SHORT_FINALIZE_MS
  return STT_LIVE_SENTENCE_FINALIZE_MS
}

function isLikelyIncompleteSource(text: string): boolean {
  if (!text) return false
  if (SENTENCE_END_RE.test(text)) return false
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= 3) return true
  if (/[,\-–—]\s*$/.test(text)) return true
  return INCOMPLETE_ENGLISH_END_RE.test(text)
}

function joinSourceFragments(previous: string, next: string): string {
  const trimmedPrevious = previous.trim()
  const trimmedNext = next.trim()
  if (!trimmedPrevious) return trimmedNext
  if (!trimmedNext) return trimmedPrevious
  if (NO_SPACE_BEFORE_RE.test(trimmedNext)) return `${trimmedPrevious}${trimmedNext}`
  return `${trimmedPrevious} ${trimmedNext}`
}

async function drainTranslationQueue(): Promise<void> {
  if (translationInFlight) return
  const next = translationQueue.shift()
  if (!next) return
  if (translationVersionsById.get(next.id) !== next.version) {
    if (translationQueue.length > 0) void drainTranslationQueue()
    return
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    if (!warnedMissingApiKey) {
      warnedMissingApiKey = true
      console.warn('[stt-postprocess] OPENAI_API_KEY not configured; skipping translation')
    }
    if (translationQueue.length > 0) void drainTranslationQueue()
    return
  }

  translationInFlight = true
  try {
    const response = await callTranslationApi(next.text, next.hints, apiKey)
    if (translationVersionsById.get(next.id) === next.version && response.translation) {
      emitTranslationPatch(next.id, response.translation)
      notifyTranslation(next.id, response.translation)
    }
  } catch (err) {
    console.warn(
      '[stt-postprocess] translation failed:',
      err instanceof Error ? err.message : String(err)
    )
  } finally {
    translationInFlight = false
    if (translationQueue.length > 0) void drainTranslationQueue()
  }
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
  id: string
  text: string
  translation: string | null
  sourceLanguage: string
  targetLanguage: string
  createdAtMs: number
}): ProcessedTranscriptTurn {
  return {
    id: args.id,
    speakerId: 'unknown',
    speakerLabel: 'Unknown',
    text: args.text.trim(),
    translation: args.translation,
    sourceLanguage: args.sourceLanguage,
    targetLanguage: args.targetLanguage,
    createdAtMs: args.createdAtMs,
  }
}

function makeTurnId(createdAtMs: number): string {
  return `turn_${createdAtMs}_${Math.random().toString(36).slice(2, 8)}`
}

function emitProcessedTurn(
  turn: ProcessedTranscriptTurn,
  options: { sendDownstream: boolean } = { sendDownstream: true }
): void {
  if (!turn.text.trim()) return
  mainWindowRef?.webContents.send('stt:processed', { turns: [turn] })
  if (!options.sendDownstream) return
  const downstream = `${turn.speakerLabel}: ${turn.text}`
  enqueueWhiteboardTranscript(downstream)
  enqueueActionTranscript(downstream)
}

function emitFinalDownstream(active: ActiveSourceTurn): void {
  if (active.downstreamSent || !active.text.trim()) return
  active.downstreamSent = true
  const downstream = `Unknown: ${active.text.trim()}`
  enqueueWhiteboardTranscript(downstream)
  enqueueActionTranscript(downstream)
}

function emitSourcePatch(id: string, text: string): void {
  mainWindowRef?.webContents.send('stt:source-patch', { id, text })
}

function emitTranslationPatch(id: string, translation: string): void {
  mainWindowRef?.webContents.send('stt:translation-patch', { id, translation })
}

function scheduleCoalesceFlush(): void {
  if (coalesceTimer) return
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null
    const pending = coalesceBuffer.trim()
    if (!pending) return
    coalesceBuffer = ''
    emitSourceFragment(pending, coalesceHints)
  }, STT_POSTPROCESS_FLOOR_FLUSH_MS)
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}
