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
