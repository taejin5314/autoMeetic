import { useCallback, useReducer } from 'react'
import type { TranscriptSegment, TranslationSegment } from '../../main/stt/types'
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
  | { type: 'translation'; payload: TranslationSegment }
  | { type: 'clear-partial' }
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

  if (action.type === 'translation') {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === action.payload.segmentId
          ? { ...item, translatedText: action.payload.text, updatedAtMs: Date.now() }
          : item
      ),
    }
  }

  if (action.type === 'clear-partial') {
    return { ...state, currentPartial: '' }
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

  const applyTranslation = useCallback((segment: TranslationSegment) => {
    dispatch({ type: 'translation', payload: segment })
  }, [])

  const clear = useCallback(() => {
    dispatch({ type: 'clear' })
  }, [])

  const clearPartial = useCallback(() => {
    dispatch({ type: 'clear-partial' })
  }, [])

  return {
    currentPartial: state.currentPartial,
    items: state.items,
    applyTranscript,
    applyTranslation,
    clearPartial,
    clear,
  }
}
