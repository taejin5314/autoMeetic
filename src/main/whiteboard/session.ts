import type { WhiteboardSession } from './types'

const FILLER_WORDS = new Set([
  'uh',
  'um',
  'yeah',
  'ok',
  'right',
  'hmm',
  'well',
  'you know',
  'like',
  'so',
])

/**
 * Check if transcript is trivial (just fillers/punctuation).
 * From autopreso: whiteboard-session.js
 */
export function isTrivialTranscript(text: unknown): boolean {
  if (typeof text !== 'string') return true
  const trimmed = text.trim()
  if (trimmed.length === 0) return true

  // Strip common punctuation and lowercase
  const cleaned = trimmed.replace(/[.,!?;:'"()-]/g, ' ').toLowerCase()
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0)

  if (words.length === 0) return true

  // Single word: skip if filler or very short
  if (words.length === 1) {
    return FILLER_WORDS.has(words[0]) || words[0].length <= 2
  }

  // 2-3 words and ALL are filler
  if (words.length <= 3 && words.every((w) => FILLER_WORDS.has(w))) return true

  return false
}

/**
 * Create initial whiteboard session state.
 * From autopreso: whiteboard-session.js
 */
export function createWhiteboardSession(): WhiteboardSession {
  return {
    mode: 'staging',
    elements: [],
    agentHistory: [],
    agentStatus: 'idle',
    agentBusy: false,
    warmupBusy: false,
    latestScreenshot: undefined,
    agentInstructions: '',
    warmupState: {
      state: 'idle',
      attempt: 0,
      maxAttempts: 8,
    },
    canvasDirtyForAgent: false,
  }
}

/**
 * Transition session to live mode.
 */
export function startLiveSession(session: WhiteboardSession): void {
  session.mode = 'live'
  session.elements = []
  session.agentHistory = []
  session.agentStatus = 'idle'
}

/**
 * End the session.
 */
export function endSession(session: WhiteboardSession): void {
  session.mode = 'staging'
  session.agentBusy = false
  session.warmupBusy = false
  session.agentStatus = 'idle'
}

/**
 * Mark canvas as needing screenshot for agent.
 */
export function markCanvasDirty(session: WhiteboardSession): void {
  session.canvasDirtyForAgent = true
}

/**
 * Update latest screenshot (from frontend).
 */
export function updateLatestScreenshot(session: WhiteboardSession, image: string): void {
  session.latestScreenshot = image
}
