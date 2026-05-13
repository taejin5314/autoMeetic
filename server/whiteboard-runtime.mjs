const FILLER_WORDS = new Set([
  'uh',
  'uhh',
  'uhhh',
  'um',
  'umm',
  'ummm',
  'ah',
  'ahh',
  'er',
  'erm',
  'hmm',
  'hm',
  'huh',
  'mm',
  'mhm',
  'yeah',
  'yep',
  'yup',
  'yes',
  'ok',
  'okay',
  'right',
  'alright',
  'so',
  'well',
  'like',
])

const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond'])
const DRAWING_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'text'])
const CHAR_WIDTH_RATIO = 0.6
const PADDING_PER_SIDE = 24

export function createTranscriptTurnQueue({ runTurn, debounceMs = 150, cooldownMs = 0, isReady = () => true }) {
  let running = false
  let buffered = []
  let current = Promise.resolve()
  let pending = []
  let debounceTimer = null
  let cooldownTimer = null
  let lastTurnEnd = 0

  function flushPending({ force = false } = {}) {
    debounceTimer = null
    if (pending.length === 0) return
    const text = pending.join('\n')
    if (!force && !isReady(text)) return
    pending = []
    if (running) {
      buffered.push(text)
    } else {
      scheduleNext(text)
    }
  }

  function scheduleNext(text) {
    running = true
    const elapsed = Date.now() - lastTurnEnd
    const wait = cooldownMs - elapsed
    if (wait <= 0) {
      current = drain(text)
    } else {
      cooldownTimer = setTimeout(() => {
        cooldownTimer = null
        current = drain(text)
      }, wait)
    }
  }

  async function drain(text) {
    running = true
    try {
      await runTurn(text)
    } finally {
      lastTurnEnd = Date.now()
      if (buffered.length > 0) {
        const next = buffered.join('\n')
        buffered = []
        scheduleNext(next)
      } else {
        running = false
        if (pending.length > 0) {
          if (debounceTimer) clearTimeout(debounceTimer)
          flushPending()
        }
      }
    }
  }

  return {
    enqueue(text) {
      const trimmed = String(text ?? '').trim()
      if (!trimmed) return current
      pending.push(trimmed)
      if (debounceMs > 0) {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(flushPending, debounceMs)
      } else {
        flushPending()
      }
      return current
    },
    clear() {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (cooldownTimer) {
        clearTimeout(cooldownTimer)
        cooldownTimer = null
      }
      pending = []
      buffered = []
    },
    async idle() {
      while (debounceTimer || running || buffered.length > 0 || pending.length > 0) {
        if (debounceTimer || pending.length > 0) {
          if (debounceTimer) clearTimeout(debounceTimer)
          flushPending({ force: true })
        }
        await current
      }
    },
  }
}

export function isTrivialTranscript(text) {
  if (typeof text !== 'string') return true
  const trimmed = text.trim()
  if (!trimmed) return true
  const cleaned = trimmed.replace(/[.,!?;:'"()\-]/g, ' ').toLowerCase()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  if (words.length === 1) return FILLER_WORDS.has(words[0]) || words[0].length <= 2
  return words.length <= 3 && words.every((word) => FILLER_WORDS.has(word))
}

export function normalizeWhiteboardElements(elements) {
  if (!Array.isArray(elements)) return []
  return elements.flatMap((element) => {
    if (!element || typeof element !== 'object') return []
    if (typeof element.id !== 'string' || typeof element.type !== 'string') return []
    if (!['rectangle', 'ellipse', 'diamond', 'arrow', 'text'].includes(element.type)) return []
    const next = { ...element }
    if (typeof next.label === 'string') {
      next.label = { text: next.label, fontSize: 18 }
    }
    if (
      SHAPE_TYPES.has(next.type) &&
      (!next.label || typeof next.label !== 'object') &&
      typeof next.text === 'string'
    ) {
      next.label = { text: next.text, fontSize: next.fontSize ?? 18 }
      delete next.text
    }
    if (next.label && typeof next.label === 'object') {
      next.label = {
        ...next.label,
        text: String(next.label.text ?? '').trim(),
        fontSize: next.label.fontSize ?? 18,
      }
    }
    return [next]
  })
}

export function formatLineNumberedWhiteboard(elements) {
  if (!Array.isArray(elements) || elements.length === 0) return '(empty whiteboard)'
  const width = Math.max(3, String(elements.length).length)
  return elements
    .map(
      (element, index) => `${String(index + 1).padStart(width, '0')}: ${JSON.stringify(element)}`
    )
    .join('\n')
}

export function applyWhiteboardEditOperations(elements, operations) {
  const nextElements = [...elements]
  for (const operation of operations ?? []) {
    if (!operation || typeof operation !== 'object') continue

    // Map hallucinated types to valid ones
    const op = normalizeOperationType(operation)

    if (op && DRAWING_TYPES.has(op.type)) {
      nextElements.push(op)
      continue
    }

    if (op.type === 'replace') {
      if (!Number.isInteger(op.line) || op.line < 1 || op.line > nextElements.length) {
        console.warn(`[whiteboard] skipping replace: line ${op.line} out of range (${nextElements.length} elements)`)
        continue
      }
      nextElements[op.line - 1] = op.element
      continue
    }
    if (op.type === 'insert_after') {
      if (!Number.isInteger(op.line) || op.line < 0 || op.line > nextElements.length) {
        console.warn(`[whiteboard] skipping insert_after: line ${op.line} out of range (${nextElements.length} elements)`)
        continue
      }
      nextElements.splice(op.line, 0, op.element)
      continue
    }
    if (op.type === 'delete') {
      if (!Number.isInteger(op.line) || op.line < 1 || op.line > nextElements.length) {
        console.warn(`[whiteboard] skipping delete: line ${op.line} out of range (${nextElements.length} elements)`)
        continue
      }
      nextElements.splice(op.line - 1, 1)
      continue
    }
    console.warn(`[whiteboard] skipping unknown edit operation "${op.type ?? 'unknown'}"`, JSON.stringify(op).slice(0, 200))
  }
  return normalizeWhiteboardElements(nextElements)
}

/**
 * Map common hallucinated operation types to valid ones.
 * The model frequently invents types like "add", "create", "update", "modify", "unknown".
 * We aggressively try to recover a valid operation from the structure.
 */
function normalizeOperationType(op) {
  if (!op || typeof op !== 'object') return op
  if (DRAWING_TYPES.has(op.type) || ['replace', 'insert_after', 'delete'].includes(op.type)) {
    return op
  }

  // If has a "shape" field that's a valid drawing type, use it as the type
  if (typeof op.shape === 'string' && DRAWING_TYPES.has(op.shape)) {
    const { shape, ...rest } = op
    return { ...rest, type: shape }
  }

  // If has an "element" sub-object:
  if (op.element && typeof op.element === 'object') {
    // With a line number → replace
    if (typeof op.line === 'number') {
      return { ...op, type: 'replace' }
    }
    // Without line → extract the element and push it as a drawing
    if (DRAWING_TYPES.has(op.element.type)) {
      return op.element
    }
  }

  // "update"/"modify" with a line number → replace
  if (typeof op.line === 'number' && op.element) {
    return { ...op, type: 'replace' }
  }

  // If has drawing-like properties (x, y), infer as a drawing element
  if (typeof op.x === 'number' && typeof op.y === 'number') {
    if (typeof op.width === 'number' && typeof op.height === 'number') {
      const inferredType = (op.text && !op.label) ? 'text' : 'rectangle'
      return { ...op, type: inferredType }
    }
    // Arrow-like: has points or startBinding/endBinding
    if (op.points || op.startBinding || op.endBinding) {
      return { ...op, type: 'arrow' }
    }
    // Fallback: has a label or text → rectangle
    if (op.label || op.text) {
      return { ...op, type: 'rectangle', width: op.width ?? 200, height: op.height ?? 60 }
    }
  }

  // Last resort: if has an id and label/text, make it a rectangle with defaults
  if (typeof op.id === 'string' && (op.label || op.text)) {
    return { ...op, type: 'rectangle', x: op.x ?? 0, y: op.y ?? 0, width: op.width ?? 200, height: op.height ?? 60 }
  }

  return op
}

export function appendLayoutWarnings(formatted, elements) {
  const warnings = detectMalformedLayoutWarnings(elements)
  if (warnings.length === 0) return formatted
  return `${formatted}\n\nLayout warnings:\n${warnings.map((warning) => `  - ${warning}`).join('\n')}`
}

function detectMalformedLayoutWarnings(elements) {
  if (!Array.isArray(elements) || elements.length === 0) return []
  const warnings = []
  const shapes = elements.filter((element) => SHAPE_TYPES.has(element?.type))
  const texts = elements.filter((element) => element?.type === 'text')

  for (const text of texts) {
    if (typeof text.x !== 'number' || typeof text.y !== 'number') continue
    const estimated = estimateTextBox(text.text, text.fontSize)
    const textBox = {
      x: text.x,
      y: text.y,
      width: typeof text.width === 'number' ? text.width : estimated.width,
      height: typeof text.height === 'number' ? text.height : estimated.height,
    }
    for (const shape of shapes) {
      if (typeof shape.width !== 'number' || typeof shape.height !== 'number') continue
      if (!rectanglesOverlap(textBox, shape)) continue
      warnings.push(
        `Standalone text "${String(text.text ?? '').slice(0, 40)}" overlaps shape "${shape.id}". Use the shape label field instead of placing text on top of a shape.`
      )
      break
    }
  }

  for (const shape of shapes) {
    const labelText = shape?.label?.text
    if (typeof labelText !== 'string' || labelText.length === 0) continue
    const fontSize = shape.label.fontSize ?? 18
    const estimated = estimateTextBox(labelText, fontSize)
    const minWidth = estimated.width + PADDING_PER_SIDE * 2
    const minHeight = estimated.height + PADDING_PER_SIDE * 2
    if (typeof shape.width === 'number' && shape.width < minWidth) {
      warnings.push(
        `Shape "${shape.id}" is too narrow for label "${labelText.slice(0, 40)}"; widen it or shorten the label.`
      )
    }
    if (typeof shape.height === 'number' && shape.height < minHeight) {
      warnings.push(
        `Shape "${shape.id}" is too short for label "${labelText.slice(0, 40)}"; grow it or shorten the label.`
      )
    }
  }

  return warnings
}

function rectanglesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function estimateTextBox(text, fontSize) {
  const fs = fontSize ?? 18
  const lines = String(text ?? '').split('\n')
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  return {
    width: Math.ceil(longest * fs * CHAR_WIDTH_RATIO),
    height: Math.ceil(lines.length * fs * 1.25),
  }
}

function assertLineInRange(line, lineCount, message) {
  if (!Number.isInteger(line) || line < 1 || line > lineCount) {
    throw new Error(`${message}; whiteboard has ${lineCount} line${lineCount === 1 ? '' : 's'}.`)
  }
}

function assertLineInInsertRange(line, lineCount, message) {
  if (!Number.isInteger(line) || line < 0 || line > lineCount) {
    throw new Error(`${message}; whiteboard has ${lineCount} line${lineCount === 1 ? '' : 's'}.`)
  }
}

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

function formatCurrentCanvasTask(elements, latestScreenshot) {
  const text = `Current line-numbered whiteboard content:\n${formatLineNumberedWhiteboard(elements)}\n\nTask:\nUse the provided key points to update the canvas. Each key point has already been validated as worth visualizing.\n\nIf updating, use whiteboard_apply for targeted changes (operations + viewport in ONE call). Use whiteboard_overwrite only when you need to clear, reset, or start fresh. Keep the canvas to 5 nodes maximum \u2014 when adding new points, consolidate or replace existing nodes. In the same whiteboard_apply call, also include viewport with action "scroll_to_content" AND focus_ids naming the most relevant elements \u2014 never call scroll_to_content without focus_ids. Make ONE whiteboard_apply call per turn. The attached screenshot (when present) shows the audience's current viewport \u2014 use it to verify labels are visible and the layout is readable.`
  if (typeof latestScreenshot === 'string' && latestScreenshot) {
    return [
      { type: 'text', text },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: latestScreenshot.split(',').pop(),
        },
      },
    ]
  }
  return text
}

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
