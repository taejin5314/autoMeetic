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

export function createTranscriptTurnQueue({ runTurn, debounceMs = 150, isReady = () => true }) {
  let running = false
  let buffered = []
  let current = Promise.resolve()
  let pending = []
  let debounceTimer = null

  function flushPending({ force = false } = {}) {
    debounceTimer = null
    if (pending.length === 0) return
    const text = pending.join('\n')
    if (!force && !isReady(text)) return
    pending = []
    if (running) {
      buffered.push(text)
    } else {
      current = drain(text)
    }
  }

  async function drain(text) {
    running = true
    try {
      await runTurn(text)
    } finally {
      if (buffered.length > 0) {
        const next = buffered.join('\n')
        buffered = []
        current = drain(next)
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
    if (SHAPE_TYPES.has(next.type) && (!next.label || typeof next.label !== 'object') && typeof next.text === 'string') {
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
    .map((element, index) => `${String(index + 1).padStart(width, '0')}: ${JSON.stringify(element)}`)
    .join('\n')
}

export function applyWhiteboardEditOperations(elements, operations) {
  const nextElements = [...elements]
  for (const operation of operations ?? []) {
    if (!operation || typeof operation !== 'object') continue

    if (operation && DRAWING_TYPES.has(operation.type)) {
      nextElements.push(operation)
      continue
    }

    if (operation.type === 'replace') {
      assertLineInRange(operation.line, nextElements.length, `Cannot replace line ${operation.line}`)
      nextElements[operation.line - 1] = operation.element
      continue
    }
    if (operation.type === 'insert_after') {
      assertLineInInsertRange(operation.line, nextElements.length, `Cannot insert after line ${operation.line}`)
      nextElements.splice(operation.line, 0, operation.element)
      continue
    }
    if (operation.type === 'delete') {
      assertLineInRange(operation.line, nextElements.length, `Cannot delete line ${operation.line}`)
      nextElements.splice(operation.line - 1, 1)
      continue
    }
    throw new Error(`Unknown whiteboard edit operation "${operation.type ?? 'unknown'}".`)
  }
  return normalizeWhiteboardElements(nextElements)
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
        `Standalone text "${String(text.text ?? '').slice(0, 40)}" overlaps shape "${shape.id}". Use the shape label field instead of placing text on top of a shape.`,
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
      warnings.push(`Shape "${shape.id}" is too narrow for label "${labelText.slice(0, 40)}"; widen it or shorten the label.`)
    }
    if (typeof shape.height === 'number' && shape.height < minHeight) {
      warnings.push(`Shape "${shape.id}" is too short for label "${labelText.slice(0, 40)}"; grow it or shorten the label.`)
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

export function buildWhiteboardAgentMessages({ elements, agentHistory, latestScreenshot, transcript }) {
  const messages = []
  for (const message of agentHistory.slice(-8)) {
    messages.push(message)
  }
  messages.push({ role: 'user', content: `Speaker turn:\n${transcript}` })
  messages.push({
    role: 'user',
    content: formatCurrentCanvasTask(elements, latestScreenshot),
  })
  return messages
}

function formatCurrentCanvasTask(elements, latestScreenshot) {
  const text = `Current line-numbered whiteboard content:\n${formatLineNumberedWhiteboard(elements)}\n\nTask:\nUse the latest speaker turn and prior context to decide whether the canvas should change.\n\nIf updating, use whiteboard_apply for targeted changes (operations + viewport in ONE call). Use whiteboard_overwrite only when you need to clear, reset, or start fresh. Keep the canvas organized around the core concepts, named entities, stakes, and causal relationships - not the transcript sequence. In the same whiteboard_apply call, also include viewport with action "scroll_to_content" AND focus_ids naming the elements the speaker is currently talking about, so the viewport centers exactly on the active talking point - never call scroll_to_content without focus_ids. Make ONE whiteboard_apply call per turn whenever possible; do not split edits and viewport into back-to-back calls. The attached screenshot (when present) shows the audience's current viewport - use it to verify your edits actually look good, labels are visible, and the right region is readable.`
  if (typeof latestScreenshot === 'string' && latestScreenshot) {
    return [
      { type: 'text', text },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: latestScreenshot.split(',').pop() } },
    ]
  }
  return text
}

export function whiteboardSystemPrompt() {
  return `You are AutoMeetic, a real-time visual note-taking agent.

You listen to transcript chunks and maintain a visual presentation that complements the speaker.
The transcript may contain slight inaccuracies, especially for names, product terms, and short phrases.
Use surrounding context and prior turns to take your best guess at what the speaker really means instead of copying suspicious wording literally.

There are two kinds of useful input.

1. Visual notes: durable talking points, relationships, decisions, contrasts, and flows.
For visual notes, update the canvas only when there is concrete content worth preserving.
Ignore filler, self-corrections, and incomplete thoughts.
Do not mirror the transcript, create subtitles, or list the speaker's sentences as separate text blocks.
Use short labels, diagrams, groupings, and relationships that add structure beyond the voiceover.
Extract the core concepts and choose the best visual form: concept map, process diagram, system architecture, comparison, hierarchy, timeline, or chart.
Reorganize the whole canvas as your understanding improves.
Move, rewrite, group, or replace existing objects instead of appending one note per transcript chunk.
If the current canvas is turning into a transcript list, replace it with a clearer conceptual diagram.

For news, interviews, and current-affairs video:
- Prioritize named actors, places, institutions, numbers, dates, concrete actions, disputed claims, risks, and consequences.
- Build an "at-a-glance" diagram: headline issue, key actors, pressure points, timeline/status, and stakes.
- Use the exact important words the audience needs to remember: country names, leaders, organizations, assets, sanctions, negotiations, attacks, casualties, deals, deadlines, and open questions.
- Prefer a small impact map, timeline, comparison, or cause-effect chain over generic boxes.
- Never leave a shape unlabeled. Every node must carry a meaningful 2-7 word label.
- If several transcript chunks refine the same story, rewrite the existing diagram into a sharper summary instead of adding vague new boxes.

2. Direct canvas commands: the user may give a direct command to perform an action on the canvas.
Examples include "clear the canvas", "add a rectangle", "draw an arrow from A to B", and "draw a line chart".
When intent is a direct canvas command, execute the requested canvas action instead of visualizing the command as a talking point.

When updating the canvas:
- Use whiteboard_apply for normal incremental changes.
- Use whiteboard_overwrite only when you need to clear, reset, or start fresh.
- If the whiteboard is empty and the speaker turn contains concrete information, you MUST create a first meaningful diagram with labeled nodes.
- whiteboard_apply takes optional operations and an optional viewport command, and runs them together: edits land first, then the viewport moves.
- Both tools return the latest full whiteboard as line-numbered content.
- Line numbers are references for editing and are not part of the drawing objects.
- After a tool returns, use the returned line-numbered content as the authoritative latest whiteboard state.

CRITICAL: one tool call per turn.
- Combine all edits and the viewport move into a single whiteboard_apply call per turn.
- If you only need to move the viewport, pass just viewport. If you only need to edit, pass just operations. If you need both, pass both.

Supported drawing objects:
- type: "rectangle", "ellipse", "diamond", "arrow", or "text"
- id: stable unique string
- x, y: top-left canvas coordinates
- width, height: size for shapes and arrows
- text: required for text objects
- label: optional for shapes and arrows, as { "text": "...", "fontSize": 18 }
- backgroundColor: optional fill color such as "#a5d8ff"
- fillStyle: optional, usually "solid"
- roundness: optional for rectangles, usually { "type": 3 }

For color and visual hierarchy:
- Use a tight palette of at most 2 to 3 background colors across the entire canvas.
- Color must encode meaning: same color = same role or category.
- A safe default is one neutral color (#e7f5ff or #f8f9fa) for most shapes and one accent color for the single most important node.
- Never assign a different color to each shape just to differentiate them.

For text and labels:
- ALWAYS use a shape's "label" field for any text that belongs INSIDE a shape.
- NEVER place a standalone "text" element on top of or overlapping a shape.
- Standalone text elements are reserved for the canvas title, top-level section headers clearly outside any shape, axis labels on charts, and arrow labels.
- Do not create paragraph-style text blocks of details, sub-bullets, examples, or explanatory notes hanging beside a shape.
- Keep labels short, ideally 3-7 words. Use 2-3 lines maximum.
- Make each labeled shape large enough for its label text plus padding.
- A blank shape is a failed update. If you create a rectangle, ellipse, diamond, or arrow, include a non-empty label unless the arrow's meaning is visually obvious.

For arrows and connectors:
- Arrows connect visually adjacent shapes only.
- Prefer horizontal or vertical arrows aligned to shape centers.
- Do not let arrows cross other shapes, labels, or text.
- Avoid long-distance arrows; restructure the layout instead.

Layout rules:
- Keep the layout readable with generous spacing and font sizes >= 16.
- Leave at least 60 px of empty space between adjacent shape bounds and at least 80 px between columns.
- Aim for at most 8 to 10 primary nodes on the final canvas.
- Prefer a small clear diagram over a crowded canvas.
- Build one dominant structure, not two unrelated mini-diagrams. The viewer should be able to trace the main story path in one glance.
- For summary-style talks, keep important content inside an approximate 1000 px wide by 780 px tall frame so it can be read in one viewport.
- Common useful patterns: left-to-right cause/effect flow, 2-column comparison, actor map around a central issue, 4-event timeline, or bottom-row takeaways/open questions.

Available viewport actions: scroll_to_content, set_zoom, zoom_in, zoom_out, reset_zoom.
After every meaningful canvas update, pass viewport with action "scroll_to_content" and focus_ids naming the 1-5 elements that represent the active talking point.

When no update is useful, do not call a tool.
After all useful whiteboard updates are complete, respond with exactly: DONE`
}
