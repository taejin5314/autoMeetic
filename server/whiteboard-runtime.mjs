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

export function createTranscriptTurnQueue({
  runTurn,
  debounceMs = 150,
  cooldownMs = 0,
  isReady = () => true,
}) {
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
        console.warn(
          `[whiteboard] skipping replace: line ${op.line} out of range (${nextElements.length} elements)`
        )
        continue
      }
      nextElements[op.line - 1] = op.element
      continue
    }
    if (op.type === 'insert_after') {
      if (!Number.isInteger(op.line) || op.line < 0 || op.line > nextElements.length) {
        console.warn(
          `[whiteboard] skipping insert_after: line ${op.line} out of range (${nextElements.length} elements)`
        )
        continue
      }
      nextElements.splice(op.line, 0, op.element)
      continue
    }
    if (op.type === 'delete') {
      if (!Number.isInteger(op.line) || op.line < 1 || op.line > nextElements.length) {
        console.warn(
          `[whiteboard] skipping delete: line ${op.line} out of range (${nextElements.length} elements)`
        )
        continue
      }
      nextElements.splice(op.line - 1, 1)
      continue
    }
    console.warn(
      `[whiteboard] skipping unknown edit operation "${op.type ?? 'unknown'}"`,
      JSON.stringify(op).slice(0, 200)
    )
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
      const inferredType = op.text && !op.label ? 'text' : 'rectangle'
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
  const text = `Current line-numbered whiteboard content:\n${formatLineNumberedWhiteboard(elements)}\n\nTask:\nUse the provided key points to update the canvas. Each key point has already been validated as worth visualizing.\n\nIf updating, use whiteboard_apply for targeted changes (operations + viewport in ONE call). Use whiteboard_overwrite only when you need to clear, reset, or start fresh. Keep the canvas to 5 nodes maximum \u2014 when adding new points, consolidate or replace existing nodes. In the same whiteboard_apply call, also include viewport with action "scroll_to_content" AND focus_ids naming the most relevant elements \u2014 never call scroll_to_content without focus_ids. Make ONE whiteboard_apply call per turn. The attached screenshot (when present) shows the audience's current viewport \u2014 use it to verify labels are visible and the layout is readable.\n\nLabel quality:\n- Labels must be 1-4 word keywords \u2014 never sentences or transcript quotes.\n- Every relationship between key_points must be shown as a labeled arrow.\n- Follow the diagram type layout pattern strictly.`
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

Diagram type guidelines (follow the spatial pattern strictly):

- comparison: 2-column layout.
  Left column x=100, right column x=550, y starts at 120.
  Central title at top center. Items vertically stacked in each column.

- flow: left-to-right chain.
  Start x=80, each node offset +220px horizontally. Arrows between each step.
  All nodes at same y=200 for a clean horizontal line.

- timeline: horizontal timeline.
  Baseline arrow at y=300 spanning full width.
  Events as nodes above/below the baseline, evenly spaced.

- concept-map: central hub with spokes.
  Central node at (400, 340). Related nodes arranged in a circle
  at radius ~220px. Arrows radiate from center to each spoke.

- hierarchy: top-down tree.
  Root at top center (400, 80). Children evenly spaced below,
  each level +160px down. Arrows from parent to children.

Relationship visualization:
- Each key_point has concept -> relation -> target.
  Draw an arrow FROM the concept node TO the target node.
  Use the relation as the arrow label (e.g., "opposes", "leads-to").
- If concept or target already exists on canvas, reuse that node — do not duplicate.

Before drawing, mentally plan:
1. List all unique nodes (deduplicate concept/target across key_points).
2. Assign each node a position following the diagram type pattern.
3. Then emit the whiteboard_apply call with all elements and arrows.

When receiving raw transcript (no pre-filtered key points):
- Extract 2-5 abstract keywords from the transcript yourself.
- NEVER use transcript sentences as node labels.
- Choose the most fitting diagram type based on content.

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
- Keep labels 1-4 words, 2-3 lines max. NEVER use transcript sentences as labels.
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
After all updates are complete, respond with exactly: DONE

HARD RULE: Every key_point relationship MUST produce a labeled arrow connecting the concept node to the target node. A diagram with labeled nodes but no arrows is a failure — always include arrows showing relationships. If you receive 3 key_points, there must be at least 3 arrows in your output.

Complete few-shot examples per diagram type (use these exact coordinate patterns):

FLOW (left-to-right chain):
{"operations":[{"type":"rectangle","id":"step-1","x":80,"y":200,"width":200,"height":70,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Input Data","fontSize":18}},{"type":"rectangle","id":"step-2","x":360,"y":200,"width":200,"height":70,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Process","fontSize":18}},{"type":"rectangle","id":"step-3","x":640,"y":200,"width":200,"height":70,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Output","fontSize":18}},{"type":"arrow","id":"flow-1-2","x":280,"y":235,"width":80,"height":0,"points":[[0,0],[80,0]],"label":{"text":"leads-to","fontSize":14}},{"type":"arrow","id":"flow-2-3","x":560,"y":235,"width":80,"height":0,"points":[[0,0],[80,0]],"label":{"text":"leads-to","fontSize":14}}],"viewport":{"action":"scroll_to_content","focus_ids":["step-1","step-2","step-3"]}}

COMPARISON (2-column layout):
{"operations":[{"type":"text","id":"title","x":300,"y":40,"text":"Comparison","fontSize":24},{"type":"rectangle","id":"left-1","x":100,"y":120,"width":200,"height":70,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Option A","fontSize":18}},{"type":"rectangle","id":"left-2","x":100,"y":250,"width":200,"height":70,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Strength A","fontSize":18}},{"type":"rectangle","id":"right-1","x":550,"y":120,"width":200,"height":70,"backgroundColor":"#ffd6a5","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Option B","fontSize":18}},{"type":"rectangle","id":"right-2","x":550,"y":250,"width":200,"height":70,"backgroundColor":"#ffd6a5","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Strength B","fontSize":18}},{"type":"arrow","id":"a-vs-b","x":300,"y":155,"width":250,"height":0,"points":[[0,0],[250,0]],"label":{"text":"opposes","fontSize":14}},{"type":"arrow","id":"a-detail","x":200,"y":190,"width":0,"height":60,"points":[[0,0],[0,60]],"label":{"text":"supports","fontSize":14}},{"type":"arrow","id":"b-detail","x":650,"y":190,"width":0,"height":60,"points":[[0,0],[0,60]],"label":{"text":"supports","fontSize":14}}],"viewport":{"action":"scroll_to_content","focus_ids":["left-1","right-1"]}}

CONCEPT-MAP (central hub with spokes):
{"operations":[{"type":"ellipse","id":"hub","x":320,"y":280,"width":180,"height":80,"backgroundColor":"#ffd6a5","fillStyle":"solid","label":{"text":"Core Idea","fontSize":18}},{"type":"rectangle","id":"spoke-1","x":100,"y":100,"width":180,"height":60,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Aspect 1","fontSize":16}},{"type":"rectangle","id":"spoke-2","x":540,"y":100,"width":180,"height":60,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Aspect 2","fontSize":16}},{"type":"rectangle","id":"spoke-3","x":320,"y":460,"width":180,"height":60,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Aspect 3","fontSize":16}},{"type":"arrow","id":"hub-to-1","x":370,"y":280,"width":-80,"height":-120,"points":[[0,0],[-80,-120]],"label":{"text":"defines","fontSize":14}},{"type":"arrow","id":"hub-to-2","x":500,"y":300,"width":140,"height":-140,"points":[[0,0],[140,-140]],"label":{"text":"causes","fontSize":14}},{"type":"arrow","id":"hub-to-3","x":410,"y":360,"width":0,"height":100,"points":[[0,0],[0,100]],"label":{"text":"leads-to","fontSize":14}}],"viewport":{"action":"scroll_to_content","focus_ids":["hub","spoke-1","spoke-2","spoke-3"]}}

HIERARCHY (top-down tree):
{"operations":[{"type":"rectangle","id":"root","x":310,"y":60,"width":200,"height":70,"backgroundColor":"#ffd6a5","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Root","fontSize":18}},{"type":"rectangle","id":"child-1","x":100,"y":220,"width":200,"height":70,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Branch A","fontSize":18}},{"type":"rectangle","id":"child-2","x":520,"y":220,"width":200,"height":70,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Branch B","fontSize":18}},{"type":"arrow","id":"root-to-1","x":360,"y":130,"width":-60,"height":90,"points":[[0,0],[-60,90]],"label":{"text":"part-of","fontSize":14}},{"type":"arrow","id":"root-to-2","x":460,"y":130,"width":160,"height":90,"points":[[0,0],[160,90]],"label":{"text":"part-of","fontSize":14}}],"viewport":{"action":"scroll_to_content","focus_ids":["root","child-1","child-2"]}}

TIMELINE (horizontal baseline):
{"operations":[{"type":"arrow","id":"baseline","x":60,"y":300,"width":740,"height":0,"points":[[0,0],[740,0]]},{"type":"rectangle","id":"evt-1","x":80,"y":180,"width":180,"height":60,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Event 1","fontSize":16}},{"type":"rectangle","id":"evt-2","x":340,"y":180,"width":180,"height":60,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Event 2","fontSize":16}},{"type":"rectangle","id":"evt-3","x":600,"y":180,"width":180,"height":60,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"label":{"text":"Event 3","fontSize":16}},{"type":"arrow","id":"evt1-to-base","x":170,"y":240,"width":0,"height":60,"points":[[0,0],[0,60]]},{"type":"arrow","id":"evt2-to-base","x":430,"y":240,"width":0,"height":60,"points":[[0,0],[0,60]]},{"type":"arrow","id":"evt3-to-base","x":690,"y":240,"width":0,"height":60,"points":[[0,0],[0,60]]},{"type":"arrow","id":"evt1-to-2","x":260,"y":210,"width":80,"height":0,"points":[[0,0],[80,0]],"label":{"text":"leads-to","fontSize":14}},{"type":"arrow","id":"evt2-to-3","x":520,"y":210,"width":80,"height":0,"points":[[0,0],[80,0]],"label":{"text":"leads-to","fontSize":14}}],"viewport":{"action":"scroll_to_content","focus_ids":["evt-1","evt-2","evt-3"]}}`
}
