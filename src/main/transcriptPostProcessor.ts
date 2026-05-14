import type { BrowserWindow } from 'electron'
import { enqueueTranscript as enqueueActionTranscript } from './actionItemService'
import type { ProcessedTranscriptTurn, SpeakerId, SpeakerLabel } from './stt/types'
import { enqueueTranscript as enqueueWhiteboardTranscript } from './whiteboardService'

const STT_POSTPROCESS_MODEL = process.env.STT_POSTPROCESS_MODEL ?? 'gpt-4.1-mini'
const STT_POSTPROCESS_FLUSH_MS = Number(process.env.STT_POSTPROCESS_FLUSH_MS ?? 2000)
const STT_POSTPROCESS_MIN_CHARS = Number(process.env.STT_POSTPROCESS_MIN_CHARS ?? 60)
const STT_POSTPROCESS_MAX_CHARS = Number(process.env.STT_POSTPROCESS_MAX_CHARS ?? 1200)
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const SENTENCE_END_RE = /[.!?。？！]\s*$/

type RawTurn = {
  speakerId?: unknown
  speakerLabel?: unknown
  text?: unknown
  translation?: unknown
  sourceLanguage?: unknown
}

interface LanguageHints {
  sourceLanguageHint: string
  targetLanguage: string
}

let mainWindowRef: BrowserWindow | null = null
let buffer = ''
let flushTimer: ReturnType<typeof setTimeout> | null = null
let retryBuffer: string | null = null
let retryCount = 0
let pendingHints: LanguageHints = { sourceLanguageHint: 'auto', targetLanguage: 'off' }
let retryHints: LanguageHints | null = null
let warnedMissingApiKey = false

export function init(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
}

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

  const wantsTranslation =
    hints.targetLanguage !== 'off' && hints.targetLanguage !== hints.sourceLanguageHint

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
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
              'You clean rough live meeting transcripts AND produce translations.',
              `Return JSON only: {"turns":[{"speakerId":"speaker_a","speakerLabel":"Speaker A","text":"...","translation":${wantsTranslation ? '"..."' : 'null'},"sourceLanguage":"en"}]}.`,
              'Each turn MUST contain one or more complete sentences. Never emit partial or cut-off sentences.',
              'If the input ends mid-sentence, include that sentence in full by fixing the ending naturally.',
              'Fix punctuation, capitalization, sentence boundaries, and obvious filler only when meaning is preserved.',
              'Do not summarize, add facts, or remove meaningful content.',
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
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

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
