/**
 * Electron-mode whiteboard pipeline — ported from server/proxy.mjs.
 *
 * 2-stage pipeline:
 *   1. Buffer accumulation → Gatekeeper (decides if update needed)
 *   2. Renderer agent (applies changes via OpenAI tool calls)
 *
 * Committed transcripts flow in via enqueueTranscript() called by sttService.
 * Results are sent to the renderer via mainWindow.webContents.send().
 */
import type { BrowserWindow } from 'electron'
import type { WhiteboardElement, ViewportCommand } from './whiteboard/types'
import { formatLineNumberedWhiteboard } from './whiteboard/tools'
import {
  appendLayoutWarnings,
  normalizeWhiteboardElements,
  repairWhiteboardLayout,
} from './whiteboard/elements'
import { isTrivialTranscript } from './whiteboard/session'
import { whiteboardSystemPrompt, type WhiteboardViewport } from './whiteboard/prompt'

// Viewport size the whiteboard agent should lay out for. Matches the maximize
// modal at typical desktop sizing; can be made dynamic later via IPC.
const WHITEBOARD_VIEWPORT: WhiteboardViewport = { width: 1280, height: 720 }

// ── Configuration (mirrors proxy.mjs) ───────────────────────────────────────

const GATEKEEPER_MODEL = process.env.GATEKEEPER_MODEL ?? 'gpt-4.1-nano'
const RENDERER_MODEL = process.env.RENDERER_MODEL ?? 'gpt-4.1-mini'
const GATEKEEPER_ENABLED = process.env.GATEKEEPER_ENABLED === 'true'
const WHITEBOARD_UPDATE_INTERVAL_MS = Number(process.env.WB_UPDATE_INTERVAL_MS ?? 30000)
const GATEKEEPER_COOLDOWN_MS = Number(
  process.env.WB_GATEKEEPER_COOLDOWN_MS ?? WHITEBOARD_UPDATE_INTERVAL_MS
)
const RENDERER_COOLDOWN_MS = Number(
  process.env.WB_RENDERER_COOLDOWN_MS ?? WHITEBOARD_UPDATE_INTERVAL_MS
)

const DRAWING_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'text'])

// ── State ───────────────────────────────────────────────────────────────────

interface PipelineState {
  elements: WhiteboardElement[]
  agentHistory: Array<{ role: string; content: string }>
  agentBusy: boolean
  latestScreenshot: string | null
  canvasDirtyForAgent: boolean
  resetVersion: number
}

const state: PipelineState = {
  elements: [],
  agentHistory: [],
  agentBusy: false,
  latestScreenshot: null,
  canvasDirtyForAgent: false,
  resetVersion: 0,
}

interface BufferState {
  text: string
  wordCount: number
  lastGatekeeperMs: number
  lastRendererMs: number
  flushTimer: ReturnType<typeof setTimeout> | null
}

const buffer: BufferState = {
  text: '',
  wordCount: 0,
  lastGatekeeperMs: Date.now(),
  lastRendererMs: 0,
  flushTimer: null,
}

let mainWindowRef: BrowserWindow | null = null

// ── Public API ──────────────────────────────────────────────────────────────

export function init(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
}

export function handleUserElements(elements: unknown[], mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
  state.elements = normalizeWhiteboardElements(elements)
  state.canvasDirtyForAgent = true
}

export function handleScreenshot(imageDataUrl: string): void {
  state.latestScreenshot = imageDataUrl
}

export function getWhiteboardState(): PipelineState {
  return state
}

/**
 * Feed a committed transcript chunk into the whiteboard pipeline.
 * Called by sttService when a committed transcript is produced.
 */
export function enqueueTranscript(text: string): void {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return
  buffer.text += (buffer.text ? ' ' : '') + trimmed
  buffer.wordCount = countWords(buffer.text)
  console.log(
    `[whiteboard] queued transcript: ${buffer.wordCount} words; next review in ${Math.ceil(
      msUntilNextWhiteboardUpdate() / 1000
    )}s`
  )
  if (shouldFlushBuffer()) {
    void flushWhiteboardBuffer()
  } else {
    scheduleBufferCheck()
  }
}

export function resetWhiteboard(): void {
  state.elements = []
  state.agentHistory = []
  state.resetVersion++
  state.agentBusy = false
  state.latestScreenshot = null
  state.canvasDirtyForAgent = false
  buffer.text = ''
  buffer.wordCount = 0
  buffer.lastGatekeeperMs = Date.now()
  buffer.lastRendererMs = 0
  if (buffer.flushTimer) {
    clearTimeout(buffer.flushTimer)
    buffer.flushTimer = null
  }
  sendToRenderer('whiteboard:update', { elements: [] })
}

// ── Buffer logic (ported from proxy.mjs) ────────────────────────────────────

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function shouldFlushBuffer(): boolean {
  const now = Date.now()
  const sinceGatekeeper = now - buffer.lastGatekeeperMs
  if (buffer.wordCount === 0) return false
  return sinceGatekeeper >= WHITEBOARD_UPDATE_INTERVAL_MS
}

function msUntilNextWhiteboardUpdate(): number {
  const elapsed = Date.now() - buffer.lastGatekeeperMs
  return Math.max(WHITEBOARD_UPDATE_INTERVAL_MS - elapsed, 1000)
}

function scheduleBufferCheck(): void {
  if (buffer.flushTimer) return
  buffer.flushTimer = setTimeout(() => {
    buffer.flushTimer = null
    if (shouldFlushBuffer()) {
      void flushWhiteboardBuffer()
    } else if (buffer.wordCount > 0) {
      scheduleBufferCheck()
    }
  }, msUntilNextWhiteboardUpdate())
}

// ── Pipeline: gatekeeper → renderer ─────────────────────────────────────────

async function flushWhiteboardBuffer(): Promise<void> {
  if (state.agentBusy) {
    scheduleBufferCheck()
    return
  }

  const now = Date.now()
  if (now - buffer.lastGatekeeperMs < GATEKEEPER_COOLDOWN_MS) {
    scheduleBufferCheck()
    return
  }

  const transcript = buffer.text.trim()
  buffer.text = ''
  buffer.wordCount = 0
  buffer.lastGatekeeperMs = now

  if (!transcript || isTrivialTranscript(transcript)) return
  console.log(`[whiteboard] scheduled review: ${countWords(transcript)} words`)

  const turnResetVersion = state.resetVersion
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return

  try {
    const canvasEmpty = state.elements.length === 0

    // Stage 1: Gatekeeper
    if (GATEKEEPER_ENABLED && !canvasEmpty) {
      const existingConcepts = extractExistingConcepts(state.elements)
      console.log(
        `[whiteboard] gatekeeper: evaluating ${countWords(transcript)} words, ${existingConcepts.length} existing concepts`
      )
      const decision = await runGatekeeper(transcript, apiKey, existingConcepts)

      if (turnResetVersion !== state.resetVersion) return

      if (decision.action === 'skip') {
        console.log(`[whiteboard] gatekeeper: SKIP — ${decision.reason}`)
        return
      }

      console.log(
        `[whiteboard] gatekeeper: UPDATE — ${decision.key_points.length} key points, hint: ${decision.diagram_hint}`
      )

      // Renderer cooldown
      const sinceRenderer = Date.now() - buffer.lastRendererMs
      if (sinceRenderer < RENDERER_COOLDOWN_MS) {
        console.log(`[whiteboard] renderer cooldown: ${RENDERER_COOLDOWN_MS - sinceRenderer}ms remaining`)
        buffer.text = decision.key_points
          .map((kp: GatekeeperKeyPoint) => `${kp.concept} ${kp.relation} ${kp.target}`)
          .join('. ')
        buffer.wordCount = countWords(buffer.text)
        scheduleBufferCheck()
        return
      }

      // Stage 2: Renderer (with gatekeeper key points)
      buffer.lastRendererMs = Date.now()
      state.agentBusy = true
      sendToRenderer('whiteboard:agent-status', { status: 'thinking' })

      try {
        const result = await runRenderer(decision.key_points, decision.diagram_hint, apiKey, turnResetVersion)
        if (turnResetVersion !== state.resetVersion) return

        applyResult(result)
      } finally {
        state.agentBusy = false
        sendToRenderer('whiteboard:agent-status', { status: 'idle' })
      }
    } else {
      // Gatekeeper disabled or canvas empty — send directly to renderer
      if (canvasEmpty) {
        console.log(`[whiteboard] canvas empty: bypassing gatekeeper, sending ${countWords(transcript)} words to renderer`)
      }
      buffer.lastRendererMs = Date.now()
      state.agentBusy = true
      sendToRenderer('whiteboard:agent-status', { status: 'thinking' })

      try {
        const result = await runRenderer(null, null, apiKey, turnResetVersion, transcript)
        if (turnResetVersion !== state.resetVersion) return

        applyResult(result)
      } finally {
        state.agentBusy = false
        sendToRenderer('whiteboard:agent-status', { status: 'idle' })
      }
    }
  } catch (err) {
    const error = err as Error
    if (error.name === 'AbortError') {
      console.log('[whiteboard] pipeline call aborted (reset)')
      return
    }
    console.error('[whiteboard] pipeline error:', error.message)
    sendToRenderer('whiteboard:agent-status', { status: 'error', message: error.message })
    state.agentBusy = false
  }
}

function applyResult(result: { elements: WhiteboardElement[] | null; viewport: ViewportCommand | null }): void {
  if (result.elements) {
    state.elements = result.elements
    sendToRenderer('whiteboard:update', { elements: result.elements })
    console.log(`[whiteboard] applied update: ${result.elements.length} elements`)
  }
  if (result.viewport) {
    sendToRenderer('whiteboard:viewport', result.viewport)
  }
}

function sendToRenderer(channel: string, data: unknown): void {
  mainWindowRef?.webContents.send(channel, data)
}

// ── Gatekeeper (ported from proxy.mjs) ──────────────────────────────────────

interface GatekeeperKeyPoint {
  concept: string
  relation: string
  target: string
}

interface GatekeeperDecision {
  action: 'update' | 'skip'
  reason: string
  key_points: GatekeeperKeyPoint[]
  diagram_hint: string
}

async function runGatekeeper(
  transcript: string,
  apiKey: string,
  existingConcepts: string[]
): Promise<GatekeeperDecision> {
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
- concept: 1-4 word abstract keyword. NEVER copy transcript verbatim.
  Good: "Iran proposal", "survival odds", "US stance"
  Bad: "Most recent proposal from Iran is garbage"
- relation: choose the most fitting verb from the allowed set.
- target: 1-4 word abstract keyword, same rules as concept.
- If the transcript is about ONE topic, emit 1 key_point with the core idea.
- If comparing/contrasting, emit 2-3 key_points showing the relationship.
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
                    relation: {
                      type: 'string',
                      enum: ['causes', 'opposes', 'supports', 'leads-to', 'part-of', 'compares-to', 'defines', 'blocks'],
                    },
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

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Gatekeeper returned empty content')

  return JSON.parse(content) as GatekeeperDecision
}

function extractExistingConcepts(elements: WhiteboardElement[]): string[] {
  const concepts: string[] = []
  for (const el of elements) {
    if (el?.label?.text) concepts.push(el.label.text)
    if (el?.type === 'text' && el?.text) concepts.push(el.text)
  }
  return concepts
}

// ── Renderer (ported from proxy.mjs) ────────────────────────────────────────

interface RendererResult {
  elements: WhiteboardElement[] | null
  viewport: ViewportCommand | null
}

interface RendererToolCall {
  type: string
  function: { name: string; arguments: string }
}

interface RendererChoice {
  content?: string
  tool_calls?: RendererToolCall[]
}

interface RendererParseResult extends RendererResult {
  assistantText: string
  operationCount: number
  toolCallCount: number
  toolResults: string[]
}

async function runRenderer(
  keyPoints: GatekeeperKeyPoint[] | null,
  diagramHint: string | null,
  apiKey: string,
  expectedResetVersion: number,
  rawTranscript: string | null = null
): Promise<RendererResult> {
  const screenshotForAgent = state.canvasDirtyForAgent ? state.latestScreenshot : null
  state.canvasDirtyForAgent = false

  const messages = buildAgentMessages({
    elements: state.elements,
    agentHistory: state.agentHistory,
    latestScreenshot: screenshotForAgent,
    keyPoints,
    diagramHint,
    rawTranscript,
  })

  // Build OpenAI messages
  const openaiMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: whiteboardSystemPrompt({ viewport: WHITEBOARD_VIEWPORT }) },
    ...messages.map((m) => {
      if (Array.isArray(m.content)) {
        return {
          role: m.role,
          content: (m.content as Array<Record<string, unknown>>).map((part) => {
            if (part.type === 'text') return { type: 'text', text: part.text }
            if (part.type === 'image') {
              const source = part.source as { data?: string; media_type?: string } | undefined
              const base64 = source?.data ?? ''
              const mediaType = source?.media_type ?? 'image/png'
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
          'Apply drawing edits in a SINGLE call. Provide at least one operation whenever you call this tool.',
        parameters: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['rectangle', 'ellipse', 'diamond', 'arrow', 'text', 'replace', 'insert_after', 'delete'],
                  },
                  id: { type: 'string' },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  width: { type: 'number' },
                  height: { type: 'number' },
                  label: {
                    type: 'object',
                    properties: { text: { type: 'string' }, fontSize: { type: 'number' } },
                  },
                  text: { type: 'string' },
                  backgroundColor: { type: 'string' },
                  fillStyle: { type: 'string' },
                  line: { type: 'integer' },
                  element: { type: 'object' },
                },
                required: ['type'],
              },
            },
            viewport: {
              type: 'object',
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
          required: ['operations'],
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
              items: { type: 'object' },
            },
          },
        },
      },
    },
  ]

  const initialDiagramRequired = state.elements.length === 0 && Boolean(rawTranscript?.trim())
  let parsed: RendererParseResult | null = null
  const maxRenderAttempts = initialDiagramRequired ? 2 : 1

  for (let renderAttempt = 0; renderAttempt < maxRenderAttempts; renderAttempt += 1) {
    const attemptMessages =
      renderAttempt === 0
        ? openaiMessages
        : [
            ...openaiMessages,
            {
              role: 'user',
              content: [
                'The previous renderer response did not create any drawing operations.',
                'The canvas is empty, so this turn MUST create an initial diagram from the transcript.',
                'Call whiteboard_apply with 3-4 labeled shapes, 2-3 labeled arrows, and a scroll_to_content viewport.',
                'Do not answer DONE and do not provide viewport-only output.',
              ].join(' '),
            },
          ]

    const body = {
      model: RENDERER_MODEL,
      max_tokens: 2048,
      messages: attemptMessages,
      tools,
      tool_choice:
        state.elements.length === 0
          ? { type: 'function', function: { name: 'whiteboard_apply' } }
          : 'auto',
    }

    const data = await requestWhiteboardCompletion(body, apiKey, expectedResetVersion)
    if (!data) return { elements: null, viewport: null }
    if (expectedResetVersion !== state.resetVersion) return { elements: null, viewport: null }

    const choice = data.choices?.[0]?.message
    parsed = parseRendererChoice(choice)
    console.log(
      `[whiteboard] renderer response: toolCalls=${parsed.toolCallCount}, operations=${parsed.operationCount}, elements=${parsed.elements?.length ?? 0}`
    )

    if (parsed.elements || !initialDiagramRequired) {
      break
    }

    console.warn('[whiteboard] initial renderer returned no drawing operations; retrying')
  }

  if (!parsed) return { elements: null, viewport: null }
  if (initialDiagramRequired && !parsed.elements) {
    throw new Error('Whiteboard renderer returned no drawing operations for the initial diagram')
  }

  const turnSummary = rawTranscript
    ? `Speaker turn:\n${rawTranscript}`
    : `Key points:\n${JSON.stringify(keyPoints)}\nDiagram hint: ${diagramHint}`
  state.agentHistory.push({ role: 'user', content: turnSummary })
  state.agentHistory.push({
    role: 'assistant',
    content:
      parsed.toolResults.length > 0
        ? parsed.toolResults.join('\n\n')
        : parsed.assistantText || 'DONE',
  })
  state.agentHistory = state.agentHistory.slice(-4)

  return { elements: parsed.elements, viewport: parsed.viewport }
}

async function requestWhiteboardCompletion(
  body: Record<string, unknown>,
  apiKey: string,
  expectedResetVersion: number
): Promise<{
  choices?: Array<{
    message?: RendererChoice
  }>
} | null> {
  let res: Response | undefined
  for (let attempt = 0; attempt < 3; attempt += 1) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (res.status === 429 && attempt < 2) {
      const retryAfter = parseFloat(res.headers.get('retry-after') ?? '5')
      const waitMs = Math.min(Math.max(retryAfter * 1000, 2000), 15000)
      console.log(`[whiteboard] 429, retrying in ${waitMs}ms (attempt ${attempt + 1})`)
      await new Promise((r) => setTimeout(r, waitMs))
      if (expectedResetVersion !== state.resetVersion) return null
      continue
    }
    break
  }

  if (!res || !res.ok) {
    const errText = res ? await res.text() : 'No response'
    throw new Error(`OpenAI whiteboard API error ${res?.status ?? 0}: ${errText}`)
  }

  return (await res.json()) as {
    choices?: Array<{
      message?: RendererChoice
    }>
  }
}

function parseRendererChoice(choice: RendererChoice | undefined): RendererParseResult {
  const result: RendererResult = { elements: null, viewport: null }
  const toolResults: string[] = []
  let operationCount = 0
  let workingElements = state.elements

  for (const call of choice?.tool_calls ?? []) {
    if (call.type !== 'function') continue
    let input: Record<string, unknown>
    try {
      input = JSON.parse(call.function.arguments) as Record<string, unknown>
    } catch {
      continue
    }

    if (call.function.name === 'whiteboard_overwrite') {
      const normalized = repairWhiteboardLayout(normalizeWhiteboardElements(input.elements ?? []))
      workingElements = normalized
      result.elements = normalized
      operationCount += normalized.length
      const formatted = appendLayoutWarnings(formatLineNumberedWhiteboard(normalized), normalized)
      toolResults.push(formatted)
    }

    if (call.function.name === 'whiteboard_apply') {
      const operations = input.operations as unknown[] | undefined
      const viewport = input.viewport as ViewportCommand | undefined

      let nextElements = workingElements
      if (Array.isArray(operations) && operations.length > 0) {
        operationCount += operations.length
        nextElements = repairWhiteboardLayout(applyEditOperations(workingElements, operations))
        workingElements = nextElements
        result.elements = nextElements
      }

      if (viewport) {
        result.viewport = viewport
      }

      const formatted = appendLayoutWarnings(formatLineNumberedWhiteboard(nextElements), nextElements)
      toolResults.push(
        result.viewport ? `${formatted}\n\nViewport: ${JSON.stringify(result.viewport)}` : formatted
      )
    }
  }

  return {
    elements: result.elements,
    viewport: result.viewport,
    assistantText: choice?.content ?? '',
    operationCount,
    toolCallCount: choice?.tool_calls?.length ?? 0,
    toolResults,
  }
}

// ── Agent message building (ported from whiteboard-runtime.mjs) ─────────────

interface AgentMessage {
  role: string
  content: string | Array<Record<string, unknown>>
}

function buildAgentMessages(opts: {
  elements: WhiteboardElement[]
  agentHistory: Array<{ role: string; content: string }>
  latestScreenshot: string | null
  keyPoints: GatekeeperKeyPoint[] | null
  diagramHint: string | null
  rawTranscript: string | null
}): AgentMessage[] {
  const messages: AgentMessage[] = []

  for (const message of opts.agentHistory.slice(-4)) {
    messages.push(message)
  }

  if (opts.keyPoints && opts.keyPoints.length > 0) {
    const pointsText = opts.keyPoints
      .map((kp) => `- ${kp.concept} ${kp.relation} ${kp.target}`)
      .join('\n')
    messages.push({
      role: 'user',
      content: `Key points to visualize (diagram type: ${opts.diagramHint ?? 'concept-map'}):\n${pointsText}`,
    })
  } else if (opts.rawTranscript) {
    messages.push({ role: 'user', content: `Speaker turn:\n${opts.rawTranscript}` })
  }

  if (opts.elements.length === 0 && opts.rawTranscript) {
    messages.push({
      role: 'user',
      content: [
        'The canvas is empty.',
        'If the speaker turn contains concrete content, create the first diagram now instead of waiting.',
        'Use 3-4 concise concept nodes and labeled arrows that show relationships.',
        'Call whiteboard_apply with drawing operations and viewport in the same call.',
      ].join(' '),
    })
  }

  messages.push({
    role: 'user',
    content: formatCanvasTask(opts.elements, opts.latestScreenshot),
  })

  return messages
}

function formatCanvasTask(
  elements: WhiteboardElement[],
  latestScreenshot: string | null
): string | Array<Record<string, unknown>> {
  const text = `Current line-numbered whiteboard content:\n${formatLineNumberedWhiteboard(elements)}\n\nTask:\nThis is the scheduled 30-second whiteboard review. First inspect the existing diagram for overlap, clipping, weak labels, confusing arrows, and stale or redundant components. Then use the provided transcript or key points to add, replace, or consolidate components only when they improve the diagram.\n\nIf updating, use whiteboard_apply for targeted changes (operations + viewport in ONE call). Use whiteboard_overwrite when the existing diagram needs cleanup, relayout, or consolidation before adding new content. Keep the canvas to 5 nodes maximum - when adding new points, consolidate or replace existing nodes. In the same whiteboard_apply call, also include viewport with action "scroll_to_content" AND focus_ids naming the most relevant elements - never call scroll_to_content without focus_ids. Make ONE whiteboard_apply call per turn. The attached screenshot (when present) shows the audience's current viewport - use it to verify labels are visible and the layout is readable.\n\nLabel quality:\n- Labels must be 1-4 word keywords - never sentences or transcript quotes.\n- Every relationship from transcript or key_points should be shown as a labeled arrow when it improves the diagram.\n- Follow the diagram type layout pattern strictly.`

  if (typeof latestScreenshot === 'string' && latestScreenshot) {
    return [
      { type: 'text', text },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: latestScreenshot.split(',').pop() ?? '',
        },
      },
    ]
  }

  return text
}

// ── Forgiving edit operation application (from whiteboard-runtime.mjs) ──────

function applyEditOperations(
  elements: WhiteboardElement[],
  operations: unknown[]
): WhiteboardElement[] {
  const nextElements = [...elements]
  for (const raw of operations) {
    if (!raw || typeof raw !== 'object') continue
    const op = normalizeOperationType(raw as Record<string, unknown>)

    if (op && DRAWING_TYPES.has(op.type as string)) {
      upsertElementById(nextElements, op as unknown as WhiteboardElement)
      continue
    }

    if (op.type === 'replace') {
      const line = op.line as number
      if (!Number.isInteger(line) || line < 1 || line > nextElements.length) {
        console.warn(`[whiteboard] skipping replace: line ${line} out of range`)
        continue
      }
      nextElements[line - 1] = op.element as WhiteboardElement
      continue
    }
    if (op.type === 'insert_after') {
      const line = op.line as number
      if (!Number.isInteger(line) || line < 0 || line > nextElements.length) {
        console.warn(`[whiteboard] skipping insert_after: line ${line} out of range`)
        continue
      }
      nextElements.splice(line, 0, op.element as WhiteboardElement)
      continue
    }
    if (op.type === 'delete') {
      const line = op.line as number
      if (!Number.isInteger(line) || line < 1 || line > nextElements.length) {
        console.warn(`[whiteboard] skipping delete: line ${line} out of range`)
        continue
      }
      nextElements.splice(line - 1, 1)
      continue
    }

    console.warn(`[whiteboard] skipping unknown edit operation "${(op as Record<string, unknown>).type ?? 'unknown'}"`)
  }
  return normalizeWhiteboardElements(nextElements)
}

function upsertElementById(elements: WhiteboardElement[], element: WhiteboardElement): void {
  if (!element || typeof element.id !== 'string') return
  const existingIndex = elements.findIndex((candidate) => candidate?.id === element.id)
  if (existingIndex >= 0) {
    elements[existingIndex] = element
    return
  }
  elements.push(element)
}

/**
 * Map common hallucinated operation types to valid ones.
 * Ported from whiteboard-runtime.mjs normalizeOperationType().
 */
function normalizeOperationType(op: Record<string, unknown>): Record<string, unknown> {
  if (DRAWING_TYPES.has(op.type as string) || ['replace', 'insert_after', 'delete'].includes(op.type as string)) {
    return op
  }

  if (typeof op.shape === 'string' && DRAWING_TYPES.has(op.shape)) {
    const { shape, ...rest } = op
    return { ...rest, type: shape }
  }

  if (op.element && typeof op.element === 'object') {
    if (typeof op.line === 'number') return { ...op, type: 'replace' }
    const elType = (op.element as Record<string, unknown>).type as string | undefined
    if (elType && DRAWING_TYPES.has(elType)) return op.element as Record<string, unknown>
  }

  if (typeof op.line === 'number' && op.element) return { ...op, type: 'replace' }

  if (typeof op.x === 'number' && typeof op.y === 'number') {
    if (typeof op.width === 'number' && typeof op.height === 'number') {
      const inferredType = op.text && !op.label ? 'text' : 'rectangle'
      return { ...op, type: inferredType }
    }
    if (op.points || op.startBinding || op.endBinding) return { ...op, type: 'arrow' }
    if (op.label || op.text) {
      return { ...op, type: 'rectangle', width: op.width ?? 200, height: op.height ?? 60 }
    }
  }

  if (typeof op.id === 'string' && (op.label || op.text)) {
    return {
      ...op,
      type: 'rectangle',
      x: op.x ?? 0,
      y: op.y ?? 0,
      width: op.width ?? 200,
      height: op.height ?? 60,
    }
  }

  return op
}
