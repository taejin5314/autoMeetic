import { useCallback, useReducer } from 'react'
import type { TranscriptSegment } from '../../main/stt/types'
import type { CaptionItem } from './types'

/**
 * Caption store — manages partial + committed transcript display.
 *
 * Ported from autopreso's caption handling pattern:
 * - Partials update a single live `currentPartial` string (not appended to feed)
 * - Committed transcripts are finalized into the `items` feed
 * - Caption pill shows currentPartial or last committed text
 */

interface CaptionState {
  /** Current in-progress partial text from OpenAI deltas. */
  currentPartial: string
  /** Finalized committed transcripts. */
  items: CaptionItem[]
}

type CaptionAction =
  | { type: 'partial'; text: string }
  | { type: 'committed'; payload: TranscriptSegment }
  | { type: 'clear' }

const MAX_ITEMS = 50

function reducer(state: CaptionState, action: CaptionAction): CaptionState {
  if (action.type === 'partial') {
    return { ...state, currentPartial: action.text }
  }

  if (action.type === 'committed') {
    const item: CaptionItem = {
      id: action.payload.id,
      sourceText: action.payload.text,
      createdAtMs: action.payload.createdAtMs,
      updatedAtMs: Date.now(),
    }
    return {
      currentPartial: '',
      items: [...state.items, item].slice(-MAX_ITEMS),
    }
  }

  if (action.type === 'clear') {
    return { currentPartial: '', items: [] }
  }

  return state
}

export function useCaptionStore() {
  const [state, dispatch] = useReducer(reducer, { currentPartial: '', items: [] })

  const applyTranscript = useCallback((segment: TranscriptSegment) => {
    if (segment.isFinal) {
      dispatch({ type: 'committed', payload: segment })
    } else {
      dispatch({ type: 'partial', text: segment.text })
    }
  }, [])

  const clear = useCallback(() => {
    dispatch({ type: 'clear' })
  }, [])

  return {
    currentPartial: state.currentPartial,
    items: state.items,
    applyTranscript,
    clear,
  }
}
