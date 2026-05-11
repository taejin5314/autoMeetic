/**
 * autoMeetic proxy server
 *
 * Bridges the browser to:
 *   - OpenAI Realtime transcription WebSocket (keeps API key server-side)
 *   - Anthropic translation API
 *
 * Architecture ported from autopreso by Kun Chen (MIT License)
 * https://github.com/kunchenguid/autopreso
 *
 * Run: node server/proxy.mjs
 * Default port: 3211 (set PROXY_PORT env var to override)
 */

import 'dotenv/config'
import { createServer } from 'http'
import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import Anthropic from '@anthropic-ai/sdk'
import {
  appendLayoutWarnings,
  applyWhiteboardEditOperations,
  buildWhiteboardAgentMessages,
  createTranscriptTurnQueue,
  formatLineNumberedWhiteboard,
  isTrivialTranscript,
  normalizeWhiteboardElements,
  whiteboardSystemPrompt,
} from './whiteboard-runtime.mjs'

const app = express()
app.use(express.json())

// ── Translation endpoint ─────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL ?? 'claude-sonnet-4-6'
const LANGUAGE_NAME_BY_CODE = new Map([
  ['ko', 'Korean'],
  ['en', 'English'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
])

app.post('/api/translate', async (req, res) => {
  const { text, targetLang = 'ko' } = req.body
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text (string) is required' })
    return
  }

  try {
    const targetLanguage = LANGUAGE_NAME_BY_CODE.get(targetLang) ?? targetLang
    const message = await anthropic.messages.create({
      model: TRANSLATION_MODEL,
      max_tokens: Math.min(Math.max(Math.ceil(text.length * 1.8), 96), 512),
      messages: [
        {
          role: 'user',
          content: `Translate the following text to ${targetLanguage}. Return ONLY the translation. Do not explain, quote, identify languages, or add a preamble:\n\n${text}`,
        },
      ],
    })

    const block = message.content[0]
    const translation = block.type === 'text' ? block.text : ''
    res.json({ translation })
  } catch (err) {
    console.error('[proxy] translation error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() })
})

// ── Vocabulary endpoint (autopreso pattern: vocabulary biasing) ──────────────

let globalVocabulary = []

app.post('/api/vocabulary', (req, res) => {
  const { keywords } = req.body
  if (Array.isArray(keywords)) {
    globalVocabulary = keywords.filter((k) => typeof k === 'string' && k.length >= 3)
    console.log(`[proxy] vocabulary updated: ${globalVocabulary.length} keywords`)
  }
  res.json({ ok: true, count: globalVocabulary.length })
})

// ── OpenAI Realtime transcription WebSocket bridge ───────────────────────────
//
// Browser connects to ws://localhost:5173/api/ws/transcribe (proxied here).
// Each browser connection spawns one OpenAI Realtime WebSocket.
//
// Architecture ported from autopreso/src/openai-transcription.js (MIT)
//
// Browser → server messages:
//   { type: 'audio:start', sessionId: '...' }
//   { type: 'audio', sessionId: '...', data: '<base64 pcm16 24kHz mono>' }
//   { type: 'stop' }
//
// Server → browser messages:
//   { type: 'ready' }
//   { type: 'partial', text: '...' }
//   { type: 'committed', text: '...' }
//   { type: 'error', message: '...' }
//   { type: 'closed' }
//
// Delta-quiet flushing (from autopreso): when no new delta arrives for
// DELTA_QUIET_MS, the accumulated partial is committed as one transcript turn.
// More reliable than waiting for transcription.completed — some models
// (notably gpt-realtime-whisper) wipe turn_detection on every session.update,
// so server-VAD never auto-commits and completed never fires.

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-realtime-whisper'
const OPENAI_TRANSCRIPTION_LANGUAGE = process.env.OPENAI_TRANSCRIPTION_LANGUAGE ?? 'auto'
const DELTA_QUIET_MS = Number(process.env.STT_DELTA_QUIET_MS ?? 650)
const TRANSCRIPT_MAX_CHARS = Number(process.env.STT_MAX_CHARS ?? 180)
const TRANSCRIPT_MAX_MS = Number(process.env.STT_MAX_MS ?? 2200)
const TRANSCRIPT_SENTENCE_END_RE = /[.!?。？！]\s*$/
const DEFAULT_KOREAN_TRANSCRIPTION_PROMPT =
  'The audio is Korean. Transcribe only in Korean Hangul. Do not output Japanese, Chinese, English, or romanized text unless those words are clearly spoken.'

// Models that reject the `prompt` parameter. For these we silently skip
// vocabulary biasing rather than failing the whole session.update.
// (Ported from autopreso/src/openai-transcription.js)
const MODELS_WITHOUT_PROMPT_SUPPORT = new Set(['gpt-realtime-whisper'])

/**
 * Build the transcription session config for OpenAI Realtime.
 * Ported from autopreso/src/openai-transcription.js buildTranscriptionSession()
 */
function buildTranscriptionSession(
  model,
  vocabularyPrompt = '',
  { includeEmptyPrompt = false, language = OPENAI_TRANSCRIPTION_LANGUAGE } = {},
) {
  const transcription = { model }
  if (language && language !== 'auto') {
    transcription.language = language
  }
  if (!MODELS_WITHOUT_PROMPT_SUPPORT.has(model)) {
    const promptParts = []
    if (language === 'ko') promptParts.push(DEFAULT_KOREAN_TRANSCRIPTION_PROMPT)
    if (vocabularyPrompt) promptParts.push(vocabularyPrompt)
    const prompt = promptParts.join('\n')
    if (prompt) transcription.prompt = prompt
    else if (includeEmptyPrompt) transcription.prompt = ''
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

/**
 * Build a vocabulary prompt from keywords (autopreso pattern).
 * Ported from autopreso/src/whiteboard-keywords.js buildTranscriptionVocabularyPrompt()
 */
function buildVocabularyPrompt(keywords, { maxChars = 500 } = {}) {
  if (!Array.isArray(keywords) || keywords.length === 0) return ''
  const prefix = 'Domain vocabulary that may appear: '
  const suffix = '.'
  let body = ''
  for (const term of keywords) {
    const next = body.length === 0 ? term : `${body}, ${term}`
    if (prefix.length + next.length + suffix.length > maxChars) continue
    body = next
  }
  if (!body) return ''
  return `${prefix}${body}${suffix}`
}

const server = createServer(app)
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })

// ── Whiteboard agent WebSocket endpoint ──────────────────────────────────────
//
// Browser connects to ws://localhost:5173/api/ws/whiteboard (proxied here).
// Handles whiteboard:update and whiteboard:screenshot messages.
//
// Architecture ported from autopreso/src/server.js whiteboard agent (MIT)
//
// Browser → server messages:
//   { type: 'whiteboard:user-elements', elements: [...] }
//   { type: 'whiteboard:screenshot', image: 'data:...' }
//   { type: 'whiteboard:agent-run', transcript: '...' }
//
// Server → browser messages:
//   { type: 'whiteboard:update', elements: [...] }
//   { type: 'whiteboard:viewport', action: '...', ... }
//   { type: 'whiteboard:agent-status', status: '...' }

const wssWhiteboard = new WebSocketServer({ noServer: true, perMessageDeflate: false })

// Manual upgrade routing — required when multiple WebSocketServers share one HTTP server
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname === '/api/ws/transcribe') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  } else if (pathname === '/api/ws/whiteboard') {
    wssWhiteboard.handleUpgrade(req, socket, head, (ws) => {
      wssWhiteboard.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

// Whiteboard session state (from autopreso's whiteboard-session.js)
const whiteboardState = {
  mode: 'live',
  elements: [],
  agentHistory: [],
  agentBusy: false,
  latestScreenshot: null,
  canvasDirtyForAgent: false,
}

const whiteboardQueue = createTranscriptTurnQueue({
  debounceMs: 0,
  isReady: (text) => !isTrivialTranscript(text),
  runTurn: async (transcript) => {
    whiteboardState.agentBusy = true
    broadcastWhiteboard({ type: 'whiteboard:agent-status', status: 'thinking' })
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

      const result = await runWhiteboardAgentProxy(transcript, apiKey)
      if (result.elements) {
        whiteboardState.elements = result.elements
        broadcastWhiteboard({ type: 'whiteboard:update', elements: result.elements })
      }
      if (result.viewport) {
        broadcastWhiteboard({ type: 'whiteboard:viewport', ...result.viewport })
      }
    } catch (err) {
      console.error('[proxy] whiteboard agent error:', err.message)
      broadcastWhiteboard({
        type: 'whiteboard:agent-status',
        status: 'error',
        message: err.message,
      })
    } finally {
      whiteboardState.agentBusy = false
      broadcastWhiteboard({ type: 'whiteboard:agent-status', status: 'idle' })
    }
  },
})

function broadcastWhiteboard(message) {
  const serialized = JSON.stringify(message)
  for (const client of wssWhiteboard.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized)
    }
  }
}

wssWhiteboard.on('connection', (clientWs) => {
  console.log('[proxy] whiteboard client connected')

  // Send current state to new client
  clientWs.send(JSON.stringify({
    type: 'whiteboard:update',
    elements: whiteboardState.elements,
  }))

  clientWs.on('message', async (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    // User drew on the canvas — update server state (autopreso pattern)
    if (msg.type === 'whiteboard:user-elements' && Array.isArray(msg.elements)) {
      whiteboardState.elements = normalizeWhiteboardElements(msg.elements)
      whiteboardState.canvasDirtyForAgent = true
    }

    if (msg.type === 'whiteboard:reset') {
      whiteboardState.elements = []
      whiteboardState.agentHistory = []
      whiteboardState.latestScreenshot = null
      whiteboardState.canvasDirtyForAgent = false
      broadcastWhiteboard({ type: 'whiteboard:update', elements: [] })
      broadcastWhiteboard({ type: 'whiteboard:agent-status', status: 'idle' })
    }

    // Screenshot from frontend for agent context (autopreso pattern)
    if (msg.type === 'whiteboard:screenshot' && typeof msg.image === 'string') {
      whiteboardState.latestScreenshot = msg.image
    }

    // Run whiteboard agent on transcript chunk
    if (msg.type === 'whiteboard:agent-run' && typeof msg.transcript === 'string') {
      const transcript = msg.transcript.trim()
      if (!transcript) return
      void whiteboardQueue.enqueue(transcript)
    }
  })

  clientWs.on('close', () => {
    console.log('[proxy] whiteboard client disconnected')
  })
})

/**
 * Run the whiteboard agent via Anthropic API.
 * Ported from autopreso/src/server.js runWhiteboardAgent()
 */
async function runWhiteboardAgentProxy(transcript, apiKey) {
  const screenshotForAgent = whiteboardState.canvasDirtyForAgent ? whiteboardState.latestScreenshot : null
  whiteboardState.canvasDirtyForAgent = false
  const messages = buildWhiteboardAgentMessages({
    elements: whiteboardState.elements,
    agentHistory: whiteboardState.agentHistory,
    latestScreenshot: screenshotForAgent,
    transcript,
  })

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: whiteboardSystemPrompt(),
    messages,
    tool_choice: whiteboardState.elements.length === 0 ? { type: 'any' } : { type: 'auto' },
    tools: [
      {
        name: 'whiteboard_apply',
        description:
          'Apply edits and/or move the viewport in a SINGLE call. Either operations, viewport, or both must be provided. For scroll_to_content, pass focus_ids.',
        input_schema: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              description: 'Edit operations applied in order',
              items: { type: 'object' },
            },
            viewport: {
              type: 'object',
              description: 'Viewport command applied AFTER edits',
              properties: {
                action: { type: 'string', enum: ['scroll_to_content', 'set_zoom', 'zoom_in', 'zoom_out', 'reset_zoom'] },
                zoom: { type: 'number' },
                focus_ids: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      {
        name: 'whiteboard_overwrite',
        description: 'Replace entire whiteboard. Use only for clearing/resetting/starting fresh.',
        input_schema: {
          type: 'object',
          properties: {
            elements: {
              type: 'array',
              description: 'Complete replacement element array',
              items: { type: 'object' },
            },
          },
        },
      },
    ],
  })

  const result = { elements: null, viewport: null }
  const toolResults = []
  let workingElements = whiteboardState.elements

  for (const block of response.content) {
    if (block.type !== 'tool_use') continue

    if (block.name === 'whiteboard_overwrite') {
      const normalized = normalizeWhiteboardElements(block.input.elements ?? [])
      workingElements = normalized
      result.elements = normalized
      const formatted = appendLayoutWarnings(formatLineNumberedWhiteboard(normalized), normalized)
      toolResults.push(formatted)
    }

    if (block.name === 'whiteboard_apply') {
      const { operations, viewport } = block.input
      let nextElements = workingElements

      // Apply edit operations
      if (Array.isArray(operations) && operations.length > 0) {
        nextElements = applyWhiteboardEditOperations(workingElements, operations)
        workingElements = nextElements
        result.elements = nextElements
      }

      if (viewport) {
        result.viewport = viewport
      }

      const formatted = appendLayoutWarnings(formatLineNumberedWhiteboard(nextElements), nextElements)
      toolResults.push(
        result.viewport ? `${formatted}\n\nViewport: ${JSON.stringify(result.viewport)}` : formatted,
      )
    }
  }

  const assistantText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
  whiteboardState.agentHistory.push({ role: 'user', content: `Speaker turn:\n${transcript}` })
  whiteboardState.agentHistory.push({
    role: 'assistant',
    content: toolResults.length > 0 ? toolResults.join('\n\n') : assistantText || 'DONE',
  })
  whiteboardState.agentHistory = whiteboardState.agentHistory.slice(-10)

  return result
}

wss.on('connection', (clientWs, req) => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'OPENAI_API_KEY not configured on server' }))
    clientWs.close()
    return
  }

  /** @type {WebSocket | null} */
  let openaiWs = null
  let configured = false
  const pendingAudio = []
  let partialText = ''
  let lastQueuedText = ''
  let bufferedSinceCommit = false
  let deltaQuietTimer = null
  let partialStartedAtMs = 0
  let activeSessionId = null
  const requestedLanguage =
    new URL(req.url ?? '', 'http://localhost').searchParams.get('language') ||
    OPENAI_TRANSCRIPTION_LANGUAGE

  function cancelDeltaQuietTimer() {
    if (deltaQuietTimer) {
      clearTimeout(deltaQuietTimer)
      deltaQuietTimer = null
    }
  }

  /**
   * Drain the accumulated partial as one turn. Idempotent: if the partial
   * is empty (already flushed), do nothing.
   * Ported from autopreso/src/openai-transcription.js flushPartialAsTurn()
   */
  function flushPartialAsTurn() {
    cancelDeltaQuietTimer()
    const text = partialText.trim()
    if (!text) return
    partialText = ''
    partialStartedAtMs = 0
    lastQueuedText = text
    safeSend({ type: 'committed', text })
    // Commit OpenAI audio buffer to start fresh for next utterance
    if (openaiWs && configured && bufferedSinceCommit) {
      openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
      bufferedSinceCommit = false
    }
  }

  function scheduleDeltaQuiet() {
    cancelDeltaQuietTimer()
    if (DELTA_QUIET_MS <= 0) return
    deltaQuietTimer = setTimeout(() => {
      deltaQuietTimer = null
      flushPartialAsTurn()
    }, DELTA_QUIET_MS)
  }

  function shouldFlushPartialNow(text) {
    if (!text) return false
    const trimmed = text.trim()
    if (trimmed.length >= TRANSCRIPT_MAX_CHARS) return true
    if (
      TRANSCRIPT_MAX_MS > 0 &&
      partialStartedAtMs > 0 &&
      Date.now() - partialStartedAtMs >= TRANSCRIPT_MAX_MS
    ) {
      return true
    }
    return trimmed.length >= 40 && TRANSCRIPT_SENTENCE_END_RE.test(trimmed)
  }

  function safeSend(payload) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(payload))
    }
  }

  // ── Open OpenAI Realtime connection ──────────────────────────────────────

  openaiWs = new WebSocket(OPENAI_REALTIME_URL, undefined, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  openaiWs.on('open', () => {
    configured = true
    // Build session config with optional vocabulary prompt (autopreso pattern)
    const vocabPrompt = buildVocabularyPrompt(globalVocabulary)
    if (vocabPrompt) {
      console.log(`[proxy] applying vocabulary prompt (${globalVocabulary.length} terms)`)
    }
    openaiWs.send(
      JSON.stringify({
        type: 'session.update',
        session: buildTranscriptionSession(OPENAI_TRANSCRIPTION_MODEL, vocabPrompt, {
          language: requestedLanguage,
        }),
      }),
    )
    // Flush any audio that arrived before the socket was ready
    for (const audio of pendingAudio) {
      openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }))
    }
    pendingAudio.length = 0
  })

  /**
   * Handle messages from OpenAI Realtime.
   * Ported from autopreso/src/openai-transcription.js handleSocketMessage()
   */
  openaiWs.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString('utf8'))
    } catch {
      return
    }

    // Session ready
    if (
      msg.type === 'transcription_session.created' ||
      msg.type === 'transcription_session.updated' ||
      msg.type === 'session.created' ||
      msg.type === 'session.updated'
    ) {
      safeSend({ type: 'ready' })
      return
    }

    // Streaming transcript delta
    if (msg.type === 'conversation.item.input_audio_transcription.delta') {
      if (!partialStartedAtMs) partialStartedAtMs = Date.now()
      partialText += msg.delta ?? ''
      safeSend({ type: 'partial', text: partialText })
      if (shouldFlushPartialNow(partialText)) {
        flushPartialAsTurn()
        return
      }
      // Re-arm the quiet timer on every delta. When deltas stop arriving
      // for DELTA_QUIET_MS, flushPartialAsTurn fires. (autopreso pattern)
      if (partialText) scheduleDeltaQuiet()
      return
    }

    // Transcription completed — fallback flush (autopreso pattern)
    // We do NOT use completed to drive turns. Delta-quiet does that.
    // completed is a fallback for the rare case where deltas stopped without
    // our quiet timer having fired (e.g., user clicked Stop).
    if (msg.type === 'conversation.item.input_audio_transcription.completed') {
      bufferedSinceCommit = false
      const fallback = msg.transcript?.trim()
      if (!partialText.trim() && fallback && fallback !== lastQueuedText) {
        partialText = fallback
      }
      flushPartialAsTurn()
      return
    }

    // Audio buffer committed — server VAD drained the buffer (autopreso pattern)
    if (msg.type === 'input_audio_buffer.committed') {
      bufferedSinceCommit = false
      return
    }

    // Errors — suppress benign race condition (autopreso pattern)
    if (msg.type === 'error') {
      // input_audio_buffer_commit_empty fires when server VAD already drained
      // the buffer before our manual commit landed. Safe to ignore.
      if (msg.error?.code === 'input_audio_buffer_commit_empty') return
      console.warn('[proxy] OpenAI error:', msg.error)
      safeSend({ type: 'error', message: msg.error?.message ?? 'OpenAI realtime error' })
    }
  })

  openaiWs.on('error', (err) => {
    console.error('[proxy] OpenAI WebSocket error:', err.message)
    safeSend({ type: 'error', message: err.message })
  })

  openaiWs.on('close', () => {
    openaiWs = null
    configured = false
    cancelDeltaQuietTimer()
    safeSend({ type: 'closed' })
  })

  // ── Handle messages from browser (autopreso protocol) ────────────────────

  clientWs.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    // Session start — track active session ID (autopreso pattern)
    if (msg.type === 'audio:start') {
      if (typeof msg.sessionId === 'string') {
        activeSessionId = msg.sessionId
        console.log(`[proxy] audio session started: ${activeSessionId}`)
      }
    }

    if (msg.type === 'audio') {
      const audio = msg.data
      if (!audio) return
      // Session ID validation (autopreso pattern)
      if (typeof msg.sessionId === 'string' && msg.sessionId !== activeSessionId) return
      if (!configured || !openaiWs) {
        pendingAudio.push(audio)
        bufferedSinceCommit = true
        return
      }
      openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }))
      bufferedSinceCommit = true
    } else if (msg.type === 'stop') {
      // Stop is a hard signal — flush pending partial NOW (autopreso pattern)
      flushPartialAsTurn()
      if (openaiWs && configured && bufferedSinceCommit) {
        openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
        bufferedSinceCommit = false
      }
      activeSessionId = null
    }
  })

  clientWs.on('close', () => {
    cancelDeltaQuietTimer()
    if (openaiWs) {
      openaiWs.close()
      openaiWs = null
    }
  })

  clientWs.on('error', (err) => {
    console.error('[proxy] browser WebSocket error:', err.message)
  })
})

// ── Start server ─────────────────────────────────────────────────────────────

const PORT = Number(process.env.PROXY_PORT ?? 3211)
server.listen(PORT, '127.0.0.1', () => {
  console.log(`autoMeetic proxy server ready at http://127.0.0.1:${PORT}`)
  console.log(`  WebSocket transcription: ws://127.0.0.1:${PORT}/api/ws/transcribe`)
  console.log(`  Translation API:         http://127.0.0.1:${PORT}/api/translate`)
  console.log(`  OpenAI transcription model: ${OPENAI_TRANSCRIPTION_MODEL}`)
  console.log(`  OpenAI transcription language: ${OPENAI_TRANSCRIPTION_LANGUAGE}`)
})
