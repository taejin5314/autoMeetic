import { useCallback, useReducer } from 'react'
import type { ProcessedTranscriptTurn } from '../../main/stt/types'
import type { CaptionItem } from './types'

interface CaptionState {
  currentPartial: string
  items: CaptionItem[]
}

type CaptionAction =
  | { type: 'partial'; text: string }
  | { type: 'append-processed'; payload: ProcessedTranscriptTurn[] }
  | { type: 'advance-typing'; id: string; sourceChars: number; translationChars: number }
  | { type: 'complete-typing'; id: string }
  | { type: 'clear-partial' }
  | { type: 'clear' }

const MAX_ITEMS = 50

function turnToItem(turn: ProcessedTranscriptTurn): CaptionItem {
  return {
    id: turn.id,
    fullSource: turn.text,
    fullTranslation: turn.translation,
    displayedSource: '',
    displayedTranslation: '',
    typing: true,
    createdAtMs: turn.createdAtMs,
    updatedAtMs: Date.now(),
    speakerId: turn.speakerId,
    speakerLabel: turn.speakerLabel,
    sourceLanguage: turn.sourceLanguage,
    sourceText: turn.text,
    translatedText: turn.translation ?? undefined,
  }
}

function reducer(state: CaptionState, action: CaptionAction): CaptionState {
  if (action.type === 'partial') {
    return { ...state, currentPartial: action.text.trim() }
  }

  if (action.type === 'append-processed') {
    const newItems = action.payload.map(turnToItem)
    return {
      currentPartial: '',
      items: [...state.items, ...newItems].slice(-MAX_ITEMS),
    }
  }

  if (action.type === 'advance-typing') {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === action.id
          ? {
              ...item,
              displayedSource: item.fullSource.slice(0, action.sourceChars),
              displayedTranslation:
                item.fullTranslation === null
                  ? ''
                  : item.fullTranslation.slice(0, action.translationChars),
              updatedAtMs: Date.now(),
            }
          : item
      ),
    }
  }

  if (action.type === 'complete-typing') {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === action.id
          ? {
              ...item,
              displayedSource: item.fullSource,
              displayedTranslation: item.fullTranslation ?? '',
              typing: false,
              translatedText: item.fullTranslation ?? undefined,
              updatedAtMs: Date.now(),
            }
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

  const applyPartial = useCallback((text: string) => {
    dispatch({ type: 'partial', text })
  }, [])

  const appendProcessed = useCallback((turns: ProcessedTranscriptTurn[]) => {
    dispatch({ type: 'append-processed', payload: turns })
  }, [])

  const advanceTyping = useCallback(
    (id: string, sourceChars: number, translationChars: number) => {
      dispatch({ type: 'advance-typing', id, sourceChars, translationChars })
    },
    []
  )

  const completeTyping = useCallback((id: string) => {
    dispatch({ type: 'complete-typing', id })
  }, [])

  const clear = useCallback(() => {
    dispatch({ type: 'clear' })
  }, [])

  const clearPartial = useCallback(() => {
    dispatch({ type: 'clear-partial' })
  }, [])

  const getRecentTranscript = useCallback(
    (windowMs: number): string => {
      const cutoff = Date.now() - windowMs
      const recent = state.items
        .filter((item) => item.createdAtMs >= cutoff)
        .map((item) => item.fullSource)
        .join(' ')
        .trim()
      return recent.length >= 20 ? recent : ''
    },
    [state.items]
  )

  return {
    currentPartial: state.currentPartial,
    items: state.items,
    applyPartial,
    appendProcessed,
    advanceTyping,
    completeTyping,
    clearPartial,
    clear,
    getRecentTranscript,
  }
}
