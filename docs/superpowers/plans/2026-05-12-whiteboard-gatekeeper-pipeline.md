# Whiteboard 2-Stage Gatekeeper Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-stage whiteboard agent (GPT-4.1, every chunk) with a 2-stage pipeline: nano gatekeeper filters content → mini renderer draws only key points.

**Architecture:** Transcript chunks accumulate in a buffer (~30s / 200 words). Stage 1 (gpt-4.1-nano) evaluates whether the buffer contains visualizable key points. If yes, it extracts structured key_points + diagram_hint and passes them to Stage 2 (gpt-4.1-mini), which updates the Excalidraw canvas. If no, it skips entirely.

**Tech Stack:** Node.js (ESM), OpenAI Chat Completions API, Express WebSocket server

**Spec:** `docs/superpowers/specs/2026-05-12-whiteboard-gatekeeper-pipeline-design.md`

---

## File Structure

| File                            | Role                                                                        | Action |
| ------------------------------- | --------------------------------------------------------------------------- | ------ |
| `server/proxy.mjs`              | Proxy server — gatekeeper call, accumulation buffer, pipeline orchestration | Modify |
| `server/whiteboard-runtime.mjs` | Whiteboard agent messages, system prompt, layout utils                      | Modify |

No new files. No frontend changes.

---

### Task 1: Add gatekeeper constants and model config to proxy.mjs

**Files:**

- Modify: `server/proxy.mjs:33-36` (near existing `WHITEBOARD_MODEL` constant)

- [ ] **Step 1: Add new constants after existing model constants**

Find the line `const WHITEBOARD_MODEL = process.env.WHITEBOARD_MODEL ?? 'gpt-4.1'` and replace the block with:

```js
const GATEKEEPER_MODEL = process.env.GATEKEEPER_MODEL ?? 'gpt-4.1-nano'
const RENDERER_MODEL = process.env.RENDERER_MODEL ?? 'gpt-4.1-mini'
const GATEKEEPER_ENABLED = process.env.GATEKEEPER_ENABLED !== 'false'
const BUFFER_MAX_WORDS = Number(process.env.WB_BUFFER_MAX_WORDS ?? 200)
const BUFFER_MAX_MS = Number(process.env.WB_BUFFER_MAX_MS ?? 30000)
const BUFFER_MIN_WORDS = Number(process.env.WB_BUFFER_MIN_WORDS ?? 100)
const GATEKEEPER_COOLDOWN_MS = Number(process.env.WB_GATEKEEPER_COOLDOWN_MS ?? 15000)
const RENDERER_COOLDOWN_MS = Number(process.env.WB_RENDERER_COOLDOWN_MS ?? 30000)
```

Remove the old `const WHITEBOARD_MODEL` line — it is replaced by `RENDERER_MODEL`.

- [ ] **Step 2: Update the startup log to show new config**

Find the `server.listen` callback at the bottom of the file. After the existing log lines, add:

```js
console.log(`  Whiteboard gatekeeper: ${GATEKEEPER_ENABLED ? GATEKEEPER_MODEL : 'disabled'}`)
console.log(`  Whiteboard renderer:   ${RENDERER_MODEL}`)
```

- [ ] **Step 3: Verify the server starts without errors**

Run: `node server/proxy.mjs`
Expected: Server starts and prints the new gatekeeper/renderer config lines. Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add server/proxy.mjs
git commit -m "feat(whiteboard): add gatekeeper pipeline constants"
```

---

### Task 2: Implement the gatekeeper call function in proxy.mjs

**Files:**

- Modify: `server/proxy.mjs` (add function before `runWhiteboardAgentProxy`)

- [ ] **Step 1: Add `runGatekeeper` function**

Insert this function right before the existing `async function runWhiteboardAgentProxy(` definition (around line 420):

```js
/**
 * Stage 1: Gatekeeper — evaluate whether transcript contains visualizable key points.
 * Uses gpt-4.1-nano with structured JSON output.
 * Returns { action: 'update', key_points, diagram_hint } or { action: 'skip', reason }.
 */
async function runGatekeeper(transcript, apiKey, existingConcepts) {
  const systemPrompt = `You are a content filter for a real-time whiteboard agent.
Your job: decide whether the transcript chunk contains NEW key points worth visualizing.

Rules:
- In a 5-minute meeting, the final canvas should have only 3-5 nodes. Be extremely selective.
- Skip if the transcript only contains filler, self-corrections, repetition, or trivial commentary.
- Skip if the key concepts are already on the canvas (see existing_concepts list).
- Extract only concepts with concrete meaning: named entities, decisions, comparisons, causal relationships, concrete numbers or dates.
- Each key_point must have: concept (short label), relation (verb describing relationship), target (what it relates to).
- diagram_hint: choose the best visualization type for this content.

Respond with JSON only.`

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
```

- [ ] **Step 2: Add helper to extract existing concepts from canvas elements**

Insert this right after `runGatekeeper`:

```js
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
```

- [ ] **Step 3: Verify the server still starts**

Run: `node server/proxy.mjs`
Expected: Server starts without errors. Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add server/proxy.mjs
git commit -m "feat(whiteboard): add gatekeeper call function"
```

---

### Task 3: Implement accumulation buffer and replace whiteboardQueue

**Files:**

- Modify: `server/proxy.mjs` (replace `whiteboardQueue` creation, lines ~282-320)

- [ ] **Step 1: Replace the whiteboardQueue with a 2-stage accumulation buffer**

Find the block starting with:

```js
const whiteboardQueue = createTranscriptTurnQueue({
  debounceMs: 3000,
  cooldownMs: 12000,
```

Replace the entire `const whiteboardQueue = createTranscriptTurnQueue({ ... })` block (through the closing `})`) with:

```js
// ── 2-stage whiteboard pipeline: accumulation buffer → gatekeeper → renderer ──

const whiteboardBuffer = {
  text: '',
  wordCount: 0,
  lastGatekeeperMs: 0,
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
  // Time trigger: >= 30s since last gatekeeper + buffer has text
  if (sinceGatekeeper >= BUFFER_MAX_MS && whiteboardBuffer.wordCount > 0) return true
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
    // Stage 1: Gatekeeper
    if (GATEKEEPER_ENABLED) {
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

      // Stage 2: Renderer
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
    } else {
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
```

- [ ] **Step 2: Verify the server starts and the WS handlers still reference whiteboardQueue**

Run: `node server/proxy.mjs`
Expected: Server starts. The `whiteboardQueue.enqueue` and `whiteboardQueue.clear` calls in the WS handlers still work because we provide the compatibility shim.

- [ ] **Step 3: Commit**

```bash
git add server/proxy.mjs
git commit -m "feat(whiteboard): replace queue with 2-stage accumulation buffer"
```

---

### Task 4: Refactor runWhiteboardAgentProxy to accept key_points instead of transcript

**Files:**

- Modify: `server/proxy.mjs` (the `runWhiteboardAgentProxy` function, ~line 420+)

- [ ] **Step 1: Change the function signature and message building**

Replace the existing function signature and first section:

```js
/**
 * Run the whiteboard agent via OpenAI API (gpt-4.1-mini).
 */
async function runWhiteboardAgentProxy(
  transcript,
  apiKey,
  expectedResetVersion = whiteboardState.resetVersion
) {
  const screenshotForAgent = whiteboardState.canvasDirtyForAgent
    ? whiteboardState.latestScreenshot
    : null
  whiteboardState.canvasDirtyForAgent = false
  const messages = buildWhiteboardAgentMessages({
    elements: whiteboardState.elements,
    agentHistory: whiteboardState.agentHistory,
    latestScreenshot: screenshotForAgent,
    transcript,
  })
```

With:

```js
/**
 * Stage 2: Renderer — update the whiteboard canvas based on gatekeeper key points.
 * When gatekeeper is disabled, rawTranscript is passed instead.
 */
async function runWhiteboardAgentProxy(
  keyPoints,
  diagramHint,
  apiKey,
  expectedResetVersion = whiteboardState.resetVersion,
  rawTranscript = null,
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
```

- [ ] **Step 2: Change the model reference from WHITEBOARD_MODEL to RENDERER_MODEL**

In the same function, find:

```js
    model: WHITEBOARD_MODEL,
```

Replace with:

```js
    model: RENDERER_MODEL,
```

- [ ] **Step 3: Update the history push to use key_points format**

In the same function, near the end, find:

```js
whiteboardState.agentHistory.push({ role: 'user', content: `Speaker turn:\n${transcript}` })
```

Replace with:

```js
const turnSummary = rawTranscript
  ? `Speaker turn:\n${rawTranscript}`
  : `Key points:\n${JSON.stringify(keyPoints)}\nDiagram hint: ${diagramHint}`
whiteboardState.agentHistory.push({ role: 'user', content: turnSummary })
```

- [ ] **Step 4: Reduce history window from 4 to 2 turns**

In the same function, find:

```js
whiteboardState.agentHistory = whiteboardState.agentHistory.slice(-10)
```

Replace with:

```js
whiteboardState.agentHistory = whiteboardState.agentHistory.slice(-4)
```

(4 entries = 2 turns of user+assistant pairs)

- [ ] **Step 5: Verify the server starts**

Run: `node server/proxy.mjs`
Expected: Server starts without errors.

- [ ] **Step 6: Commit**

```bash
git add server/proxy.mjs
git commit -m "feat(whiteboard): refactor renderer to accept key_points from gatekeeper"
```

---

### Task 5: Update buildWhiteboardAgentMessages to accept key_points

**Files:**

- Modify: `server/whiteboard-runtime.mjs` (the `buildWhiteboardAgentMessages` function and `formatCurrentCanvasTask` function)

- [ ] **Step 1: Update buildWhiteboardAgentMessages signature and body**

Find the existing function:

```js
export function buildWhiteboardAgentMessages({
  elements,
  agentHistory,
  latestScreenshot,
  transcript,
}) {
  const messages = []
  for (const message of agentHistory.slice(-4)) {
    messages.push(message)
  }
  messages.push({ role: 'user', content: `Speaker turn:\n${transcript}` })
  messages.push({
    role: 'user',
    content: formatCurrentCanvasTask(elements, latestScreenshot),
  })
  return messages
}
```

Replace with:

```js
export function buildWhiteboardAgentMessages({
  elements,
  agentHistory,
  latestScreenshot,
  keyPoints,
  diagramHint,
  rawTranscript,
}) {
  const messages = []
  for (const message of agentHistory.slice(-4)) {
    messages.push(message)
  }

  // Build input message: key_points from gatekeeper, or raw transcript (rollback mode)
  if (keyPoints && keyPoints.length > 0) {
    const pointsText = keyPoints
      .map((kp) => `- ${kp.concept} ${kp.relation} ${kp.target}`)
      .join('\n')
    messages.push({
      role: 'user',
      content: `Key points to visualize (diagram type: ${diagramHint ?? 'concept-map'}):\n${pointsText}`,
    })
  } else if (rawTranscript) {
    messages.push({ role: 'user', content: `Speaker turn:\n${rawTranscript}` })
  }

  messages.push({
    role: 'user',
    content: formatCurrentCanvasTask(elements, latestScreenshot),
  })
  return messages
}
```

- [ ] **Step 2: Update formatCurrentCanvasTask to reference key points instead of speaker turn**

Find the existing `formatCurrentCanvasTask` function and replace its `text` assignment:

```js
function formatCurrentCanvasTask(elements, latestScreenshot) {
  const text = `Current line-numbered whiteboard content:\n${formatLineNumberedWhiteboard(elements)}\n\nTask:\nUse the latest speaker turn and prior context to decide whether the canvas should change.\n\nIf updating, use whiteboard_apply for targeted changes (operations + viewport in ONE call). Use whiteboard_overwrite only when you need to clear, reset, or start fresh. Keep the canvas organized around the core concepts, named entities, stakes, and causal relationships - not the transcript sequence. In the same whiteboard_apply call, also include viewport with action "scroll_to_content" AND focus_ids naming the elements the speaker is currently talking about, so the viewport centers exactly on the active talking point - never call scroll_to_content without focus_ids. Make ONE whiteboard_apply call per turn whenever possible; do not split edits and viewport into back-to-back calls. The attached screenshot (when present) shows the audience's current viewport - use it to verify your edits actually look good, labels are visible, and the right region is readable.`
```

Replace the `const text = ...` with:

```js
function formatCurrentCanvasTask(elements, latestScreenshot) {
  const text = `Current line-numbered whiteboard content:\n${formatLineNumberedWhiteboard(elements)}\n\nTask:\nUse the provided key points to update the canvas. Each key point has already been validated as worth visualizing.\n\nIf updating, use whiteboard_apply for targeted changes (operations + viewport in ONE call). Use whiteboard_overwrite only when you need to clear, reset, or start fresh. Keep the canvas to 5 nodes maximum — when adding new points, consolidate or replace existing nodes. In the same whiteboard_apply call, also include viewport with action "scroll_to_content" AND focus_ids naming the most relevant elements — never call scroll_to_content without focus_ids. Make ONE whiteboard_apply call per turn. The attached screenshot (when present) shows the audience's current viewport — use it to verify labels are visible and the layout is readable.`
```

The rest of the function (screenshot handling) stays the same.

- [ ] **Step 3: Verify the server starts**

Run: `node server/proxy.mjs`
Expected: Server starts without errors.

- [ ] **Step 4: Commit**

```bash
git add server/whiteboard-runtime.mjs
git commit -m "feat(whiteboard): update message builder for key_points input"
```

---

### Task 6: Simplify the renderer system prompt

**Files:**

- Modify: `server/whiteboard-runtime.mjs` (the `whiteboardSystemPrompt` function)

- [ ] **Step 1: Replace the entire whiteboardSystemPrompt function**

Find `export function whiteboardSystemPrompt() {` and replace the entire function (through its closing `}`) with:

```js
export function whiteboardSystemPrompt() {
  return `You are AutoMeetic, a real-time visual note-taking agent.

You receive pre-filtered key points (already validated as worth visualizing) and update a canvas diagram.
The key points include a diagram_hint suggesting the best visualization type.

Diagram type guidelines:
- comparison: 2-column layout, items side by side
- flow: left-to-right cause/effect chain
- timeline: horizontal timeline with events
- concept-map: central concept with radiating connections
- hierarchy: top-down tree structure

Canvas rules:
- Maximum 5 primary nodes. When adding new points, consolidate or replace existing nodes rather than appending.
- Build one dominant structure, not scattered mini-diagrams.
- Keep important content inside an approximate 1000 px wide by 780 px tall frame.

When updating the canvas:
- Use whiteboard_apply for normal incremental changes.
- Use whiteboard_overwrite only when you need to clear, reset, or start fresh.
- If the whiteboard is empty, create a first meaningful diagram with labeled nodes.
- Combine all edits and viewport into a single whiteboard_apply call per turn.

Supported drawing objects:
- type: "rectangle", "ellipse", "diamond", "arrow", or "text"
- id: stable unique string
- x, y: top-left canvas coordinates
- width, height: size for shapes and arrows
- text: required for text objects
- label: for shapes and arrows, as { "text": "...", "fontSize": 18 }
- backgroundColor: optional fill color (hex)
- fillStyle: optional, usually "solid"
- roundness: optional for rectangles, usually { "type": 3 }

Color rules:
- Use at most 2-3 background colors. Color encodes meaning (same color = same category).
- Default: one neutral (#e7f5ff) for most shapes, one accent for the most important node.

Label rules:
- ALWAYS use a shape's "label" field for text inside a shape.
- NEVER place standalone "text" on top of a shape.
- Standalone text is only for canvas title, section headers outside shapes, and axis labels.
- Keep labels 3-7 words, 2-3 lines max.
- Make shapes large enough for labels plus 24px padding.
- Every shape must have a non-empty label.

Arrow rules:
- Connect visually adjacent shapes only. Prefer horizontal or vertical arrows.
- Do not let arrows cross other shapes or labels.
- Avoid long-distance arrows; restructure layout instead.

Layout rules:
- Font sizes >= 16. At least 60px between shapes, 80px between columns.
- Generous spacing. Prefer a small clear diagram over a crowded canvas.

Viewport:
- After every update, pass viewport with action "scroll_to_content" and focus_ids (1-5 element IDs).
- Available actions: scroll_to_content, set_zoom, zoom_in, zoom_out, reset_zoom.

When no update is useful, do not call a tool.
After all updates are complete, respond with exactly: DONE`
}
```

- [ ] **Step 2: Verify the server starts**

Run: `node server/proxy.mjs`
Expected: Server starts without errors.

- [ ] **Step 3: Commit**

```bash
git add server/whiteboard-runtime.mjs
git commit -m "feat(whiteboard): simplify renderer prompt for 2-stage pipeline"
```

---

### Task 7: Update whiteboard reset handler for new buffer

**Files:**

- Modify: `server/proxy.mjs` (the `whiteboard:reset` message handler)

- [ ] **Step 1: Add buffer reset to the reset handler**

Find the `whiteboard:reset` handler block. After the line:

```js
whiteboardQueue.clear()
```

Add:

```js
whiteboardBuffer.lastGatekeeperMs = 0
whiteboardBuffer.lastRendererMs = 0
```

This ensures cooldown timers reset when the user clears the whiteboard.

- [ ] **Step 2: Verify the server starts**

Run: `node server/proxy.mjs`
Expected: Server starts without errors.

- [ ] **Step 3: Commit**

```bash
git add server/proxy.mjs
git commit -m "fix(whiteboard): reset buffer cooldowns on whiteboard reset"
```

---

### Task 8: End-to-end manual smoke test

**Files:**

- No file changes — manual verification only

- [ ] **Step 1: Start the full app**

Run: `npm run dev`
Expected: Proxy server and Vite dev server both start.

- [ ] **Step 2: Open the app and start a capture session**

Open `http://localhost:5173` in Chrome. Click the start button, share a browser tab playing a 3-5 minute YouTube video or podcast.

- [ ] **Step 3: Observe console logs for gatekeeper decisions**

Watch the terminal running the proxy server. Look for:

- `[proxy] gatekeeper: evaluating N words, M existing concepts` — buffer flush
- `[proxy] gatekeeper: SKIP — ...` — gatekeeper decided not to update
- `[proxy] gatekeeper: UPDATE — N key points, hint: ...` — key points extracted
- `[proxy] renderer: applying result — elements: N, viewport: true/false` — canvas updated

- [ ] **Step 4: Verify success criteria**

Check:

1. Gatekeeper skip messages appear (target: >= 50% of evaluations)
2. Final canvas has 3-5 meaningful nodes (not 10+ cluttered ones)
3. Renderer called <= 5 times during the session
4. No crashes or uncaught errors

- [ ] **Step 5: Commit any log/tuning fixes if needed**

If constants need adjustment based on testing:

```bash
git add -A
git commit -m "fix(whiteboard): tune pipeline parameters after smoke test"
```
