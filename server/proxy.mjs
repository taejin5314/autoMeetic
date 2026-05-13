/**
 * autoMeetic proxy server
 *
 * Bridges the browser to:
 *   - OpenAI Realtime transcription WebSocket (keeps API key server-side)
 *   - OpenAI translation API
 *
 * Architecture ported from autopreso by Kun Chen (MIT License)
 * https://github.com/kunchenguid/autopreso
 *
 * Run: node server/proxy.mjs
 * Default port: 3211 (set PROXY_PORT env var to override)
 */

import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  appendLayoutWarnings,
  applyWhiteboardEditOperations,
  buildWhiteboardAgentMessages,
  formatLineNumberedWhiteboard,
  isTrivialTranscript,
  normalizeWhiteboardElements,
  whiteboardSystemPrompt,
} from './whiteboard-runtime.mjs'

const app = express()
app.use(express.json())

// ΓöÇΓöÇ Translation endpoint ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL ?? 'gpt-4.1-mini'
const GATEKEEPER_MODEL = process.env.GATEKEEPER_MODEL ?? 'gpt-4.1-nano'
const RENDERER_MODEL = process.env.RENDERER_MODEL ?? 'gpt-4.1-mini'
const GATEKEEPER_ENABLED = process.env.GATEKEEPER_ENABLED !== 'false'
const BUFFER_MAX_WORDS = Number(process.env.WB_BUFFER_MAX_WORDS ?? 200)
const BUFFER_MAX_MS = Number(process.env.WB_BUFFER_MAX_MS ?? 30000)
const BUFFER_MIN_WORDS = Number(process.env.WB_BUFFER_MIN_WORDS ?? 40)
const GATEKEEPER_COOLDOWN_MS = Number(process.env.WB_GATEKEEPER_COOLDOWN_MS ?? 15000)
const RENDERER_COOLDOWN_MS = Number(process.env.WB_RENDERER_COOLDOWN_MS ?? 30000)
const OPENAI_TRANSLATION_URL = 'https://api.openai.com/v1/chat/completions'
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
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' })
      return
    }

    const targetLanguage = LANGUAGE_NAME_BY_CODE.get(targetLang) ?? targetLang
    const translationBody = JSON.stringify({
      model: TRANSLATION_MODEL,
      max_tokens: Math.min(Math.max(Math.ceil(text.length * 1.8), 96), 512),
      messages: [
        {
          role: 'system',
          content:
            'You are a precise translation engine. Return only translated text with no quotes, labels, or explanations.',
        },
        {
          role: 'user',
          content: `Translate the following text to ${targetLanguage}. Return ONLY the translation. Do not explain, quote, identify languages, or add a preamble:\n\n${text}`,
        },
      ],
    })

    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(OPENAI_TRANSLATION_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: translationBody,
      })
      if (response.status === 429 && attempt < 2) {
        const waitMs = Math.min(
          Math.max(parseFloat(response.headers.get('retry-after') || '3') * 1000, 1000),
          10000
        )
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      break
    }

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = payload?.error?.message
      throw new Error(
        message ? `OpenAI translation error: ${message}` : 'OpenAI translation failed'
      )
    }

    const translation =
      typeof payload?.choices?.[0]?.message?.content === 'string'
        ? payload.choices[0].message.content.trim()
        : ''
    if (!translation) {
      throw new Error('OpenAI translation returned empty text')
    }

    res.json({ translation })
  } catch (err) {
    console.error('[proxy] translation error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ── Answer Assist endpoint ──────────────────────────────────────────────────────────────────

const ANSWER_ASSIST_MODEL = process.env.ANSWER_ASSIST_MODEL ?? 'gpt-4.1-mini'
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

function buildAnswerAssistPrompt(lang) {
  const langName = LANGUAGE_NAME_BY_CODE.get(lang) ?? lang
  return `You are a real-time meeting answer coach. The user is in a live meeting and needs help responding to what is being discussed.

Your job:
1. Read the transcript and identify the most recent topic, question, or point that the user might need to respond to.
2. If you need factual information to answer well, use web_search_preview to look it up.
3. Write a concise response (3-5 sentences) in ${langName} that the user can speak aloud naturally. This should be a thoughtful contribution to the discussion — an answer if there was a question, or a relevant comment if there was a statement.
4. Then write "---" on its own line.
5. Then write the Korean translation of your response.

Rules:
- Be concise and direct — this is for speaking aloud, not reading.
- Use a natural conversational tone appropriate for a meeting.
- If the topic is opinion-based, provide a balanced thoughtful response.
- If the topic requires technical or factual knowledge, be accurate and specific.
- Do NOT include any labels like "English:" or "Korean:" — just the text.
- Always provide a response. Even if the transcript is casual or lacks a clear question, offer a useful contribution the user could make to the conversation.`
}

app.post('/api/answer-assist', async (req, res) => {
  const { transcript, lang = 'en' } = req.body
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 20) {
    res.status(400).json({ error: 'transcript must be a string of at least 20 characters' })
    return
  }

  const openaiApiKey = process.env.OPENAI_API_KEY
  if (!openaiApiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' })
    return
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const requestBody = {
      model: ANSWER_ASSIST_MODEL,
      tools: [{ type: 'web_search_preview' }],
      input: [
        { role: 'system', content: buildAnswerAssistPrompt(lang) },
        { role: 'user', content: `Meeting transcript (most recent 3 minutes):\n\n${transcript.trim()}` },
      ],
      stream: true,
    }

    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })
      if (response.status === 429 && attempt < 2) {
        const waitMs = Math.min(
          Math.max(parseFloat(response.headers.get('retry-after') || '3') * 1000, 1000),
          10000
        )
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      break
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}))
      const message = errBody?.error?.message ?? `OpenAI API error: ${response.status}`
      sendSSE({ type: 'error', message })
      res.end()
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let sentSection = false
    let searchSent = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const json = line.slice(6).trim()
        if (!json || json === '[DONE]') continue

        let event
        try {
          event = JSON.parse(json)
        } catch {
          continue
        }

        // Handle web search events
        if (event.type === 'response.web_search_call.in_progress' && !searchSent) {
          searchSent = true
          sendSSE({ type: 'searching', query: 'searching...' })
        }

        // Handle text deltas
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          const delta = event.delta
          fullText += delta

          // Check for NO_QUESTION marker
          if (fullText.includes('[NO_QUESTION]')) {
            sendSSE({ type: 'no_question' })
            res.end()
            return
          }

          // Check for section separator
          if (!sentSection && fullText.includes('\n---\n')) {
            sentSection = true
            sendSSE({ type: 'section', name: 'ko' })
            fullText = fullText.slice(fullText.indexOf('\n---\n') + 5)
            continue
          }

          // Don't send the --- separator as delta content
          if (!sentSection && fullText.trimEnd().endsWith('---')) {
            continue
          }

          sendSSE({ type: 'delta', content: delta })
        }

        // Handle completion
        if (event.type === 'response.completed') {
          const outputText = event.response?.output?.[0]?.content?.[0]?.text ?? fullText
          const parts = outputText.split(/\n---\n/)
          const answer = (parts[0] ?? '').trim()
          const answerKo = (parts[1] ?? '').trim()
          sendSSE({ type: 'done', answer, answer_ko: answerKo })
          res.end()
          return
        }
      }
    }

    // Stream ended without response.completed
    const parts = fullText.split(/\n---\n/)
    const answer = (parts[0] ?? '').trim()
    const answerKo = (parts[1] ?? '').trim()
    sendSSE({ type: 'done', answer, answer_ko: answerKo })
    res.end()
  } catch (err) {
    console.error('[proxy] answer-assist error:', err)
    sendSSE({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    res.end()
  }
})

// ΓöÇΓöÇ Health check ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() })
})

// ΓöÇΓöÇ Vocabulary endpoint (autopreso pattern: vocabulary biasing) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

let globalVocabulary = []

app.post('/api/vocabulary', (req, res) => {
  const { keywords } = req.body
  if (Array.isArray(keywords)) {
    globalVocabulary = keywords.filter((k) => typeof k === 'string' && k.length >= 3)
    console.log(`[proxy] vocabulary updated: ${globalVocabulary.length} keywords`)
  }
  res.json({ ok: true, count: globalVocabulary.length })
})

// ΓöÇΓöÇ OpenAI Realtime transcription WebSocket bridge ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
//
// Browser connects to ws://localhost:5173/api/ws/transcribe (proxied here).
// Each browser connection spawns one OpenAI Realtime WebSocket.
//
// Architecture ported from autopreso/src/openai-transcription.js (MIT)
//
// Browser ΓåÆ server messages:
//   { type: 'audio:start', sessionId: '...' }
//   { type: 'audio', sessionId: '...', data: '<base64 pcm16 24kHz mono>' }
//   { type: 'stop' }
//
// Server ΓåÆ browser messages:
//   { type: 'ready' }
//   { type: 'partial', text: '...' }
//   { type: 'committed', text: '...' }
//   { type: 'error', message: '...' }
//   { type: 'closed' }
//
// Delta-quiet flushing (from autopreso): when no new delta arrives for
// DELTA_QUIET_MS, the accumulated partial is committed as one transcript turn.
// More reliable than waiting for transcription.completed ΓÇö some models
// (notably gpt-realtime-whisper) wipe turn_detection on every session.update,
// so server-VAD never auto-commits and completed never fires.

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-realtime-whisper'
const OPENAI_TRANSCRIPTION_LANGUAGE = process.env.OPENAI_TRANSCRIPTION_LANGUAGE ?? 'auto'
const DELTA_QUIET_MS = Number(process.env.STT_DELTA_QUIET_MS ?? 1200)
const TRANSCRIPT_MAX_CHARS = Number(process.env.STT_MAX_CHARS ?? 180)
const TRANSCRIPT_MAX_MS = Number(process.env.STT_MAX_MS ?? 2200)
const TRANSCRIPT_SENTENCE_END_RE = /[.!?πÇé∩╝ƒ∩╝ü]\s*$/
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
  { includeEmptyPrompt = false, language = OPENAI_TRANSCRIPTION_LANGUAGE } = {}
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

// ΓöÇΓöÇ Whiteboard agent WebSocket endpoint ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
//
// Browser connects to ws://localhost:5173/api/ws/whiteboard (proxied here).
// Handles whiteboard:update and whiteboard:screenshot messages.
//
// Architecture ported from autopreso/src/server.js whiteboard agent (MIT)
//
// Browser ΓåÆ server messages:
//   { type: 'whiteboard:user-elements', elements: [...] }
//   { type: 'whiteboard:screenshot', image: 'data:...' }
//   { type: 'whiteboard:agent-run', transcript: '...' }
//
// Server ΓåÆ browser messages:
//   { type: 'whiteboard:update', elements: [...] }
//   { type: 'whiteboard:viewport', action: '...', ... }
//   { type: 'whiteboard:agent-status', status: '...' }

const wssWhiteboard = new WebSocketServer({ noServer: true, perMessageDeflate: false })

// Manual upgrade routing ΓÇö required when multiple WebSocketServers share one HTTP server
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
  resetVersion: 0,
  /** @type {AbortController | null} */
  abortController: null,
}

// ── 2-stage whiteboard pipeline: accumulation buffer → gatekeeper → renderer ──

const whiteboardBuffer = {
  text: '',
  wordCount: 0,
  lastGatekeeperMs: Date.now(),
  lastRendererMs: 0,
  flushTimer: null,
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length
}

function shouldFlushBuffer() {
  const now = Date.now()
  const sinceGatekeeper = now - whiteboardBuffer.lastGatekeeperMs
  if (whiteboardBuffer.wordCount === 0) return false
  // Volume trigger: >= 200 words
  if (whiteboardBuffer.wordCount >= BUFFER_MAX_WORDS) return true
  // Time trigger: >= 30s since last gatekeeper + enough words accumulated
  if (sinceGatekeeper >= BUFFER_MAX_MS && whiteboardBuffer.wordCount >= BUFFER_MIN_WORDS)
    return true
  // Sentence-complete trigger: >= 100 words + sentence ending
  if (
    whiteboardBuffer.wordCount >= BUFFER_MIN_WORDS &&
    /[.!?。？！]\s*$/.test(whiteboardBuffer.text)
  )
    return true
  return false
}

function scheduleBufferCheck() {
  if (whiteboardBuffer.flushTimer) return
  whiteboardBuffer.flushTimer = setTimeout(() => {
    whiteboardBuffer.flushTimer = null
    if (shouldFlushBuffer()) {
      void flushWhiteboardBuffer()
    } else if (whiteboardBuffer.wordCount > 0) {
      scheduleBufferCheck()
    }
  }, 5000)
}

async function flushWhiteboardBuffer() {
  const now = Date.now()
  // Gatekeeper cooldown check
  if (now - whiteboardBuffer.lastGatekeeperMs < GATEKEEPER_COOLDOWN_MS) {
    scheduleBufferCheck()
    return
  }

  const transcript = whiteboardBuffer.text.trim()
  whiteboardBuffer.text = ''
  whiteboardBuffer.wordCount = 0
  whiteboardBuffer.lastGatekeeperMs = now

  if (!transcript || isTrivialTranscript(transcript)) return

  const turnResetVersion = whiteboardState.resetVersion
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return

  try {
    // Empty canvas bypass: skip gatekeeper and send directly to renderer
    const canvasEmpty = whiteboardState.elements.length === 0

    // Stage 1: Gatekeeper (skip when canvas is empty — always render the first diagram)
    if (GATEKEEPER_ENABLED && !canvasEmpty) {
      const existingConcepts = extractExistingConcepts(whiteboardState.elements)
      console.log(
        `[proxy] gatekeeper: evaluating ${countWords(transcript)} words, ${existingConcepts.length} existing concepts`
      )
      const decision = await runGatekeeper(transcript, apiKey, existingConcepts)

      if (turnResetVersion !== whiteboardState.resetVersion) return

      if (decision.action === 'skip') {
        console.log(`[proxy] gatekeeper: SKIP — ${decision.reason}`)
        return
      }

      console.log(
        `[proxy] gatekeeper: UPDATE — ${decision.key_points.length} key points, hint: ${decision.diagram_hint}`
      )

      // Renderer cooldown check
      const sinceRenderer = Date.now() - whiteboardBuffer.lastRendererMs
      if (sinceRenderer < RENDERER_COOLDOWN_MS) {
        console.log(
          `[proxy] renderer cooldown: ${RENDERER_COOLDOWN_MS - sinceRenderer}ms remaining, deferring`
        )
        // Put key points back conceptually — re-buffer a summary
        whiteboardBuffer.text = decision.key_points
          .map((kp) => `${kp.concept} ${kp.relation} ${kp.target}`)
          .join('. ')
        whiteboardBuffer.wordCount = countWords(whiteboardBuffer.text)
        scheduleBufferCheck()
        return
      }

      // Stage 2: Renderer (with gatekeeper key points)
      whiteboardBuffer.lastRendererMs = Date.now()
      whiteboardState.agentBusy = true
      broadcastWhiteboard({ type: 'whiteboard:agent-status', status: 'thinking' })

      try {
        const result = await runWhiteboardAgentProxy(
          decision.key_points,
          decision.diagram_hint,
          apiKey,
          turnResetVersion
        )
        if (turnResetVersion !== whiteboardState.resetVersion) return

        console.log(
          '[proxy] renderer: applying result — elements:',
          result.elements?.length ?? 0,
          'viewport:',
          !!result.viewport
        )
        if (result.elements) {
          whiteboardState.elements = result.elements
          broadcastWhiteboard({ type: 'whiteboard:update', elements: result.elements })
        }
        if (result.viewport) {
          broadcastWhiteboard({ type: 'whiteboard:viewport', ...result.viewport })
        }
      } finally {
        whiteboardState.agentBusy = false
        broadcastWhiteboard({ type: 'whiteboard:agent-status', status: 'idle' })
      }
    } else if (!GATEKEEPER_ENABLED || canvasEmpty) {
      // Gatekeeper disabled OR canvas is empty — pass transcript directly to renderer
      if (canvasEmpty)
        console.log(
          `[proxy] canvas empty: bypassing gatekeeper, sending ${countWords(transcript)} words directly to renderer`
        )
      // Gatekeeper disabled — pass transcript directly to renderer (rollback mode)
      whiteboardBuffer.lastRendererMs = Date.now()
      whiteboardState.agentBusy = true
      broadcastWhiteboard({ type: 'whiteboard:agent-status', status: 'thinking' })

      try {
        const result = await runWhiteboardAgentProxy(
          null,
          null,
          apiKey,
          turnResetVersion,
          transcript
        )
        if (turnResetVersion !== whiteboardState.resetVersion) return

        if (result.elements) {
          whiteboardState.elements = result.elements
          broadcastWhiteboard({ type: 'whiteboard:update', elements: result.elements })
        }
        if (result.viewport) {
          broadcastWhiteboard({ type: 'whiteboard:viewport', ...result.viewport })
        }
      } finally {
        whiteboardState.agentBusy = false
        broadcastWhiteboard({ type: 'whiteboard:agent-status', status: 'idle' })
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('[proxy] whiteboard pipeline call aborted (reset)')
      return
    }
    console.error('[proxy] whiteboard pipeline error:', err.message)
    broadcastWhiteboard({ type: 'whiteboard:agent-status', status: 'error', message: err.message })
    whiteboardState.agentBusy = false
    broadcastWhiteboard({ type: 'whiteboard:agent-status', status: 'idle' })
  }
}

// Compatibility shim: whiteboardQueue.enqueue and .clear used by WS message handlers
const whiteboardQueue = {
  enqueue(text) {
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return
    whiteboardBuffer.text += (whiteboardBuffer.text ? ' ' : '') + trimmed
    whiteboardBuffer.wordCount = countWords(whiteboardBuffer.text)
    if (shouldFlushBuffer()) {
      void flushWhiteboardBuffer()
    } else {
      scheduleBufferCheck()
    }
  },
  clear() {
    whiteboardBuffer.text = ''
    whiteboardBuffer.wordCount = 0
    if (whiteboardBuffer.flushTimer) {
      clearTimeout(whiteboardBuffer.flushTimer)
      whiteboardBuffer.flushTimer = null
    }
  },
}

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
  clientWs.send(
    JSON.stringify({
      type: 'whiteboard:update',
      elements: whiteboardState.elements,
    })
  )

  clientWs.on('message', async (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    console.log('[proxy] whiteboard WS received:', msg.type)

    // User drew on the canvas ΓÇö update server state (autopreso pattern)
    if (msg.type === 'whiteboard:user-elements' && Array.isArray(msg.elements)) {
      whiteboardState.elements = normalizeWhiteboardElements(msg.elements)
      whiteboardState.canvasDirtyForAgent = true
    }

    if (msg.type === 'whiteboard:reset') {
      console.log(
        '[proxy] whiteboard:reset received, version:',
        whiteboardState.resetVersion,
        '->',
        whiteboardState.resetVersion + 1,
        'agentBusy:',
        whiteboardState.agentBusy,
        'abortController:',
        !!whiteboardState.abortController
      )
      whiteboardState.resetVersion += 1
      if (whiteboardState.abortController) {
        whiteboardState.abortController.abort()
        whiteboardState.abortController = null
        console.log('[proxy] aborted in-flight whiteboard fetch')
      }
      whiteboardQueue.clear()
      whiteboardBuffer.lastGatekeeperMs = 0
      whiteboardBuffer.lastRendererMs = 0
      whiteboardState.elements = []
      whiteboardState.agentHistory = []
      whiteboardState.latestScreenshot = null
      whiteboardState.canvasDirtyForAgent = false
      whiteboardState.agentBusy = false
      broadcastWhiteboard({ type: 'whiteboard:update', elements: [] })
      broadcastWhiteboard({ type: 'whiteboard:agent-status', status: 'idle' })
      console.log(
        '[proxy] whiteboard state after reset — elements:',
        whiteboardState.elements.length,
        'history:',
        whiteboardState.agentHistory.length
      )
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
 * Stage 1: Gatekeeper — evaluate whether transcript contains visualizable key points.
 * Uses gpt-4.1-nano with structured JSON output.
 * Returns { action: 'update', key_points, diagram_hint } or { action: 'skip', reason }.
 */
async function runGatekeeper(transcript, apiKey, existingConcepts) {
  const systemPrompt = `You are a content filter for a real-time whiteboard agent.
Your job: decide whether the transcript chunk contains ANY topic worth visualizing.

When to UPDATE (action: "update"):
- The speaker introduces a topic, person, concept, or idea — even casually.
- There are names, roles, comparisons, opinions, plans, or any discussable subject.
- Self-introductions count: extract name + role/context.
- ANY substantive content that a viewer might want to see summarized.

When to SKIP (action: "skip"):
- The transcript is ONLY filler words (uh, um, yeah, ok) with zero topical content.
- The transcript is exact repetition of what is already on the canvas.

Key point extraction:
- Each key_point: concept (short label), relation (verb), target (what it relates to).
- Be generous — extract 1-3 key points if there is any real content.
- diagram_hint: choose the best visualization type.

Bias toward UPDATE. When in doubt, update.`

  const userContent = `Existing concepts on canvas: ${JSON.stringify(existingConcepts)}

Transcript chunk:
${transcript}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GATEKEEPER_MODEL,
      max_tokens: 512,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'gatekeeper_decision',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['update', 'skip'] },
              reason: { type: 'string' },
              key_points: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    concept: { type: 'string' },
                    relation: { type: 'string' },
                    target: { type: 'string' },
                  },
                  required: ['concept', 'relation', 'target'],
                  additionalProperties: false,
                },
              },
              diagram_hint: {
                type: 'string',
                enum: ['comparison', 'flow', 'timeline', 'concept-map', 'hierarchy'],
              },
            },
            required: ['action', 'reason', 'key_points', 'diagram_hint'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gatekeeper API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Gatekeeper returned empty content')

  return JSON.parse(content)
}

/**
 * Extract concept labels from current whiteboard elements for dedup.
 */
function extractExistingConcepts(elements) {
  const concepts = []
  for (const el of elements) {
    if (el?.label?.text) concepts.push(el.label.text)
    if (el?.type === 'text' && el?.text) concepts.push(el.text)
  }
  return concepts
}

/**
 * Stage 2: Renderer — update the whiteboard canvas based on gatekeeper key points.
 * When gatekeeper is disabled, rawTranscript is passed instead.
 */
async function runWhiteboardAgentProxy(
  keyPoints,
  diagramHint,
  apiKey,
  expectedResetVersion = whiteboardState.resetVersion,
  rawTranscript = null
) {
  const screenshotForAgent = whiteboardState.canvasDirtyForAgent
    ? whiteboardState.latestScreenshot
    : null
  whiteboardState.canvasDirtyForAgent = false
  const messages = buildWhiteboardAgentMessages({
    elements: whiteboardState.elements,
    agentHistory: whiteboardState.agentHistory,
    latestScreenshot: screenshotForAgent,
    keyPoints,
    diagramHint,
    rawTranscript,
  })

  // Convert messages to OpenAI format (system goes separately)
  const openaiMessages = [
    { role: 'system', content: whiteboardSystemPrompt() },
    ...messages.map((m) => {
      if (Array.isArray(m.content)) {
        return {
          role: m.role,
          content: m.content.map((part) => {
            if (part.type === 'text') return { type: 'text', text: part.text }
            if (part.type === 'image') {
              const base64 = part.source?.data ?? ''
              const mediaType = part.source?.media_type ?? 'image/png'
              return {
                type: 'image_url',
                image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'low' },
              }
            }
            return part
          }),
        }
      }
      return { role: m.role, content: m.content }
    }),
  ]

  const tools = [
    {
      type: 'function',
      function: {
        name: 'whiteboard_apply',
        description:
          'Apply edits and/or move the viewport in a SINGLE call. Either operations, viewport, or both must be provided. For scroll_to_content, pass focus_ids.',
        parameters: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              description:
                'Array of operations. Two kinds:\n' +
                '1) Drawing element: type MUST be one of "rectangle","ellipse","diamond","arrow","text". Include id, x, y, width, height, and label (for shapes) or text (for text type).\n' +
                '2) Edit command: type MUST be "replace" (with line + element), "insert_after" (with line + element), or "delete" (with line).\n' +
                'INVALID types that will be rejected: create, update, add, modify, unknown, move.',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: [
                      'rectangle',
                      'ellipse',
                      'diamond',
                      'arrow',
                      'text',
                      'replace',
                      'insert_after',
                      'delete',
                    ],
                    description:
                      'MUST be one of the listed values. Never use create/update/add/modify.',
                  },
                  id: { type: 'string', description: 'Unique element ID (for drawing elements)' },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  width: { type: 'number' },
                  height: { type: 'number' },
                  label: {
                    type: 'object',
                    properties: {
                      text: { type: 'string' },
                      fontSize: { type: 'number' },
                    },
                    description: 'Label inside a shape (rectangle/ellipse/diamond)',
                  },
                  text: { type: 'string', description: 'Text content (for type "text" only)' },
                  backgroundColor: { type: 'string' },
                  fillStyle: { type: 'string' },
                  line: {
                    type: 'integer',
                    description: 'Line number (for replace/insert_after/delete)',
                  },
                  element: {
                    type: 'object',
                    description: 'Replacement element (for replace/insert_after)',
                  },
                },
                required: ['type'],
              },
            },
            viewport: {
              type: 'object',
              description: 'Viewport command applied AFTER edits',
              properties: {
                action: {
                  type: 'string',
                  enum: ['scroll_to_content', 'set_zoom', 'zoom_in', 'zoom_out', 'reset_zoom'],
                },
                zoom: { type: 'number' },
                focus_ids: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whiteboard_overwrite',
        description: 'Replace entire whiteboard. Use only for clearing/resetting/starting fresh.',
        parameters: {
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
    },
  ]

  const body = {
    model: RENDERER_MODEL,
    max_tokens: 2048,
    messages: openaiMessages,
    tools,
    tool_choice:
      whiteboardState.elements.length === 0
        ? { type: 'function', function: { name: 'whiteboard_apply' } }
        : 'auto',
  }

  const abortController = new AbortController()
  whiteboardState.abortController = abortController

  // Retry loop for rate limits (429)
  let res
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    })

    if (res.status === 429 && attempt < 2) {
      const retryAfter = parseFloat(res.headers.get('retry-after') || '5')
      const waitMs = Math.min(Math.max(retryAfter * 1000, 2000), 15000)
      console.log(`[proxy] whiteboard 429, retrying in ${waitMs}ms (attempt ${attempt + 1})`)
      await new Promise((r) => setTimeout(r, waitMs))
      if (expectedResetVersion !== whiteboardState.resetVersion) {
        return { elements: null, viewport: null }
      }
      continue
    }
    break
  }

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`OpenAI whiteboard API error ${res.status}: ${errText}`)
  }

  const data = await res.json()

  // Bail immediately if reset happened while waiting for the response
  if (expectedResetVersion !== whiteboardState.resetVersion) {
    return { elements: null, viewport: null }
  }

  const choice = data.choices?.[0]?.message

  const result = { elements: null, viewport: null }
  const toolResults = []
  let workingElements = whiteboardState.elements

  const toolCalls = choice?.tool_calls ?? []
  for (const call of toolCalls) {
    // Check again inside the loop — reset can happen mid-processing
    if (expectedResetVersion !== whiteboardState.resetVersion) {
      return { elements: null, viewport: null }
    }
    if (call.type !== 'function') continue
    let input
    try {
      input = JSON.parse(call.function.arguments)
    } catch {
      continue
    }

    if (call.function.name === 'whiteboard_overwrite') {
      const normalized = normalizeWhiteboardElements(input.elements ?? [])
      workingElements = normalized
      result.elements = normalized
      const formatted = appendLayoutWarnings(formatLineNumberedWhiteboard(normalized), normalized)
      toolResults.push(formatted)
    }

    if (call.function.name === 'whiteboard_apply') {
      const { operations, viewport } = input
      let nextElements = workingElements

      if (Array.isArray(operations) && operations.length > 0) {
        nextElements = applyWhiteboardEditOperations(workingElements, operations)
        workingElements = nextElements
        result.elements = nextElements
      }

      if (viewport) {
        result.viewport = viewport
      }

      const formatted = appendLayoutWarnings(
        formatLineNumberedWhiteboard(nextElements),
        nextElements
      )
      toolResults.push(
        result.viewport ? `${formatted}\n\nViewport: ${JSON.stringify(result.viewport)}` : formatted
      )
    }
  }

  const assistantText = choice?.content ?? ''

  // Drop stale in-flight result if reset happened while this call was running.
  if (expectedResetVersion !== whiteboardState.resetVersion) {
    return { elements: null, viewport: null }
  }

  const turnSummary = rawTranscript
    ? `Speaker turn:\n${rawTranscript}`
    : `Key points:\n${JSON.stringify(keyPoints)}\nDiagram hint: ${diagramHint}`
  whiteboardState.agentHistory.push({ role: 'user', content: turnSummary })
  whiteboardState.agentHistory.push({
    role: 'assistant',
    content: toolResults.length > 0 ? toolResults.join('\n\n') : assistantText || 'DONE',
  })
  whiteboardState.agentHistory = whiteboardState.agentHistory.slice(-4)

  return result
}

wss.on('connection', (clientWs, req) => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    clientWs.send(
      JSON.stringify({ type: 'error', message: 'OPENAI_API_KEY not configured on server' })
    )
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

  // ΓöÇΓöÇ Open OpenAI Realtime connection ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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
      })
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

    // Transcription completed ΓÇö fallback flush (autopreso pattern)
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

    // Audio buffer committed ΓÇö server VAD drained the buffer (autopreso pattern)
    if (msg.type === 'input_audio_buffer.committed') {
      bufferedSinceCommit = false
      return
    }

    // Errors ΓÇö suppress benign race condition (autopreso pattern)
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

  // ΓöÇΓöÇ Handle messages from browser (autopreso protocol) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  clientWs.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    // Session start ΓÇö track active session ID (autopreso pattern)
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
      // Stop is a hard signal ΓÇö flush pending partial NOW (autopreso pattern)
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

// ΓöÇΓöÇ Start server ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const PORT = Number(process.env.PROXY_PORT ?? 3211)
server.listen(PORT, '127.0.0.1', () => {
  console.log(`autoMeetic proxy server ready at http://127.0.0.1:${PORT}`)
  console.log(`  WebSocket transcription: ws://127.0.0.1:${PORT}/api/ws/transcribe`)
  console.log(`  Translation API:         http://127.0.0.1:${PORT}/api/translate`)
  console.log(`  OpenAI transcription model: ${OPENAI_TRANSCRIPTION_MODEL}`)
  console.log(`  OpenAI transcription language: ${OPENAI_TRANSCRIPTION_LANGUAGE}`)
  console.log(`  Whiteboard gatekeeper: ${GATEKEEPER_ENABLED ? GATEKEEPER_MODEL : 'disabled'}`)
  console.log(`  Whiteboard renderer:   ${RENDERER_MODEL}`)
})
