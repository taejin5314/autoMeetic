import type { BrowserWindow } from 'electron'
import { WebSocket } from 'ws'
import { getVocabulary } from './proxyService'
import {
  enqueueRoughTranscript,
  flushPendingTranscript,
  resetTranscriptPostProcessor,
} from './transcriptPostProcessor'

const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-realtime-whisper'
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'
const DELTA_QUIET_MS = Number(process.env.STT_DELTA_QUIET_MS ?? 500)
const TRANSCRIPT_MAX_CHARS = Number(process.env.STT_MAX_CHARS ?? 90)
const TRANSCRIPT_MAX_MS = Number(process.env.STT_MAX_MS ?? 1000)
const TRANSCRIPT_SENTENCE_END_RE = /[.!?。？！]\s*$/
const DEFAULT_KOREAN_TRANSCRIPTION_PROMPT =
  'The audio is Korean. Transcribe only in Korean Hangul. Do not output Japanese, Chinese, English, or romanized text unless those words are clearly spoken.'
const MODELS_WITHOUT_PROMPT_SUPPORT = new Set(['gpt-realtime-whisper'])

let openaiWs: WebSocket | null = null
let mainWindowRef: BrowserWindow | null = null
let deltaBuffer = ''
let deltaQuietTimer: ReturnType<typeof setTimeout> | null = null
let turnStartMs = 0
let emittedRoughForCurrentItem = false
let currentSourceLanguage = 'auto'
let currentTargetLanguage = 'off'

export function setPostProcessorLanguages(args: {
  sourceLanguage: string
  targetLanguage: string
}): void {
  currentSourceLanguage = args.sourceLanguage || 'auto'
  currentTargetLanguage = args.targetLanguage || 'off'
}

function emitRoughCommitted(text: string): void {
  mainWindowRef?.webContents.send('stt:committed', text)
}

function clearDeltaState(): void {
  if (deltaQuietTimer) {
    clearTimeout(deltaQuietTimer)
    deltaQuietTimer = null
  }
  deltaBuffer = ''
  turnStartMs = 0
}

function buildTranscriptionSession(
  model: string,
  vocabularyPrompt: string,
  language: string
): Record<string, unknown> {
  const transcription: Record<string, unknown> = { model }
  if (language && language !== 'auto') transcription.language = language
  if (!MODELS_WITHOUT_PROMPT_SUPPORT.has(model)) {
    const promptParts: string[] = []
    if (language === 'ko') promptParts.push(DEFAULT_KOREAN_TRANSCRIPTION_PROMPT)
    if (vocabularyPrompt) promptParts.push(vocabularyPrompt)
    const prompt = promptParts.join('\n')
    if (prompt) transcription.prompt = prompt
  }
  return {
    type: 'transcription',
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription,
      },
    },
  }
}

function buildVocabularyPrompt(keywords: string[]): string {
  if (keywords.length === 0) return ''
  const prefix = 'Domain vocabulary that may appear: '
  const suffix = '.'
  let body = ''
  for (const term of keywords) {
    const next = body.length === 0 ? term : `${body}, ${term}`
    if (prefix.length + next.length + suffix.length > 500) continue
    body = next
  }
  if (!body) return ''
  return `${prefix}${body}${suffix}`
}

function commitDelta(): void {
  const text = deltaBuffer.trim()
  clearDeltaState()
  if (text) {
    emitRoughCommitted(text)
    enqueueRoughTranscript(text, {
      sourceLanguageHint: currentSourceLanguage,
      targetLanguage: currentTargetLanguage,
    })
    emittedRoughForCurrentItem = true
    // Clear the hero partial immediately so the committed sentence doesn't linger
    mainWindowRef?.webContents.send('stt:partial', '')
  }
}

function handleOpenAiMessage(raw: string): void {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }

  if (msg.type === 'session.created' || msg.type === 'session.updated') {
    mainWindowRef?.webContents.send('stt:ready')
    return
  }

  if (msg.type === 'conversation.item.input_audio_transcription.delta') {
    const delta = (msg as Record<string, string>).delta ?? ''
    if (!delta) return

    if (!turnStartMs) turnStartMs = Date.now()
    deltaBuffer += delta

    mainWindowRef?.webContents.send('stt:partial', deltaBuffer.trim())

    const shouldCommit =
      deltaBuffer.length >= TRANSCRIPT_MAX_CHARS ||
      Date.now() - turnStartMs >= TRANSCRIPT_MAX_MS ||
      TRANSCRIPT_SENTENCE_END_RE.test(deltaBuffer)

    if (shouldCommit) {
      commitDelta()
    } else {
      if (deltaQuietTimer) clearTimeout(deltaQuietTimer)
      deltaQuietTimer = setTimeout(commitDelta, DELTA_QUIET_MS)
    }
    return
  }

  if (msg.type === 'conversation.item.input_audio_transcription.completed') {
    const transcript = (msg as Record<string, string>).transcript?.trim() ?? ''
    const pendingDelta = deltaBuffer.trim()
    if (pendingDelta) commitDelta()
    if (transcript && !emittedRoughForCurrentItem) {
      emitRoughCommitted(transcript)
      enqueueRoughTranscript(transcript, {
        sourceLanguageHint: currentSourceLanguage,
        targetLanguage: currentTargetLanguage,
      })
      mainWindowRef?.webContents.send('stt:partial', '')
    }
    emittedRoughForCurrentItem = false
    clearDeltaState()
    return
  }

  if (msg.type === 'error') {
    const errorMsg =
      (msg as Record<string, Record<string, string>>).error?.message ?? 'Unknown OpenAI error'
    console.error('[stt] OpenAI error:', errorMsg)
    mainWindowRef?.webContents.send('stt:error', errorMsg)
  }
}

export function startTranscription(language: string, mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
  stopTranscription()
  resetTranscriptPostProcessor()
  emittedRoughForCurrentItem = false

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    mainWindow.webContents.send('stt:error', 'OPENAI_API_KEY not configured')
    return
  }

  const vocabPrompt = buildVocabularyPrompt(getVocabulary())
  const session = buildTranscriptionSession(OPENAI_TRANSCRIPTION_MODEL, vocabPrompt, language)

  openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  openaiWs.on('open', () => {
    console.log('[stt] WebSocket open, sending session.update')
    openaiWs?.send(JSON.stringify({ type: 'session.update', session }))
  })

  openaiWs.on('message', (data: Buffer) => {
    handleOpenAiMessage(data.toString())
  })

  openaiWs.on('error', (err: Error) => {
    console.error('[stt] WebSocket error:', err.message)
    mainWindowRef?.webContents.send('stt:error', err.message)
  })

  openaiWs.on('close', (code: number, reason: Buffer) => {
    console.log('[stt] WebSocket closed:', code, reason.toString())
    openaiWs = null
    if (deltaBuffer.trim()) commitDelta()
    void flushPendingTranscript({ force: true })
  })
}

export async function stopTranscription(): Promise<void> {
  if (openaiWs) {
    openaiWs.close()
    openaiWs = null
  }
  if (deltaQuietTimer) {
    clearTimeout(deltaQuietTimer)
    deltaQuietTimer = null
  }
  if (deltaBuffer.trim()) commitDelta()
  deltaBuffer = ''
  turnStartMs = 0
  emittedRoughForCurrentItem = false
  await flushPendingTranscript({ force: true })
}

export function sendAudioChunk(base64Chunk: string): void {
  if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return
  openaiWs.send(
    JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: base64Chunk,
    })
  )
}
