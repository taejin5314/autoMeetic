import { WebSocket } from 'ws'
import type { BrowserWindow } from 'electron'
import { getVocabulary } from './proxyService'

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-realtime-whisper'
const DELTA_QUIET_MS = Number(process.env.STT_DELTA_QUIET_MS ?? 1200)
const TRANSCRIPT_MAX_CHARS = Number(process.env.STT_MAX_CHARS ?? 180)
const TRANSCRIPT_MAX_MS = Number(process.env.STT_MAX_MS ?? 2200)
const TRANSCRIPT_SENTENCE_END_RE = /[.!?。？！]\s*$/
const DEFAULT_KOREAN_TRANSCRIPTION_PROMPT =
  'The audio is Korean. Transcribe only in Korean Hangul. Do not output Japanese, Chinese, English, or romanized text unless those words are clearly spoken.'
const MODELS_WITHOUT_PROMPT_SUPPORT = new Set(['gpt-realtime-whisper'])

let openaiWs: WebSocket | null = null
let mainWindowRef: BrowserWindow | null = null
let deltaBuffer = ''
let deltaQuietTimer: ReturnType<typeof setTimeout> | null = null
let turnStartMs = 0

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
  if (deltaQuietTimer) {
    clearTimeout(deltaQuietTimer)
    deltaQuietTimer = null
  }
  const text = deltaBuffer.trim()
  deltaBuffer = ''
  turnStartMs = 0
  if (text) {
    mainWindowRef?.webContents.send('stt:committed', text)
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
      (deltaBuffer.length >= TRANSCRIPT_MAX_CHARS) ||
      (Date.now() - turnStartMs >= TRANSCRIPT_MAX_MS && TRANSCRIPT_SENTENCE_END_RE.test(deltaBuffer))

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
    if (deltaBuffer.trim()) commitDelta()
    if (transcript && transcript !== deltaBuffer.trim()) {
      mainWindowRef?.webContents.send('stt:committed', transcript)
    }
    return
  }

  if (msg.type === 'error') {
    const errorMsg =
      ((msg as Record<string, Record<string, string>>).error?.message) ?? 'Unknown OpenAI error'
    mainWindowRef?.webContents.send('stt:error', errorMsg)
  }
}

export function startTranscription(language: string, mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
  stopTranscription()

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
      'OpenAI-Beta': 'realtime=v1',
    },
  })

  openaiWs.on('open', () => {
    openaiWs?.send(JSON.stringify({ type: 'session.update', session }))
  })

  openaiWs.on('message', (data: Buffer) => {
    handleOpenAiMessage(data.toString())
  })

  openaiWs.on('error', (err: Error) => {
    mainWindowRef?.webContents.send('stt:error', err.message)
  })

  openaiWs.on('close', () => {
    openaiWs = null
    if (deltaBuffer.trim()) commitDelta()
  })
}

export function stopTranscription(): void {
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
