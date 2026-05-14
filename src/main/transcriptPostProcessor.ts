import type { BrowserWindow } from 'electron'
import { enqueueTranscript as enqueueActionTranscript } from './actionItemService'
import type { ProcessedTranscriptTurn } from './stt/types'
import { enqueueTranscript as enqueueWhiteboardTranscript } from './whiteboardService'

const STT_POSTPROCESS_MODEL = process.env.STT_POSTPROCESS_MODEL ?? 'gpt-4.1-nano'
const STT_POSTPROCESS_MIN_CHARS = Number(process.env.STT_POSTPROCESS_MIN_CHARS ?? 1)
const STT_POSTPROCESS_FLOOR_FLUSH_MS = Number(process.env.STT_POSTPROCESS_FLOOR_FLUSH_MS ?? 2000)
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'

interface LanguageHints {
  sourceLanguageHint: string
  targetLanguage: string
}

interface PendingTranslation {
  id: string
  text: string
  hints: LanguageHints
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
let translationInFlight = false
let warnedMissingApiKey = false

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
  emitSourceAndQueueTranslation(combined, hints)
}

export async function flushPendingTranscript(options: { force?: boolean } = {}): Promise<void> {
  if (coalesceTimer) {
    clearTimeout(coalesceTimer)
    coalesceTimer = null
  }
  const pending = coalesceBuffer.trim()
  if (!pending) return
  if (!options.force && pending.length < STT_POSTPROCESS_MIN_CHARS) {
    coalesceBuffer = pending
    scheduleCoalesceFlush()
    return
  }
  coalesceBuffer = ''
  emitSourceAndQueueTranslation(pending, coalesceHints)
}

export function resetTranscriptPostProcessor(): void {
  coalesceBuffer = ''
  coalesceHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
  if (coalesceTimer) {
    clearTimeout(coalesceTimer)
    coalesceTimer = null
  }
  translationQueue.length = 0
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

function emitSourceAndQueueTranslation(text: string, hints: LanguageHints): void {
  const createdAtMs = Date.now()
  const id = makeTurnId(createdAtMs)

  const turn = buildTurn({
    id,
    text,
    translation: null,
    sourceLanguage: hints.sourceLanguageHint,
    targetLanguage: hints.targetLanguage,
    createdAtMs,
  })

  emitProcessedTurn(turn)

  const wantsTranslation =
    hints.targetLanguage !== 'off' && hints.targetLanguage !== hints.sourceLanguageHint
  if (!wantsTranslation) return

  translationQueue.push({ id, text, hints })
  void drainTranslationQueue()
}

async function drainTranslationQueue(): Promise<void> {
  if (translationInFlight) return
  const next = translationQueue.shift()
  if (!next) return

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
    if (response.translation) emitTranslationPatch(next.id, response.translation)
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

function emitProcessedTurn(turn: ProcessedTranscriptTurn): void {
  if (!turn.text.trim()) return
  mainWindowRef?.webContents.send('stt:processed', { turns: [turn] })
  const downstream = `${turn.speakerLabel}: ${turn.text}`
  enqueueWhiteboardTranscript(downstream)
  enqueueActionTranscript(downstream)
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
    emitSourceAndQueueTranslation(pending, coalesceHints)
  }, STT_POSTPROCESS_FLOOR_FLUSH_MS)
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}
