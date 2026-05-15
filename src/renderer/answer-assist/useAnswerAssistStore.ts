import { useCallback, useReducer, useRef } from 'react'
import type { AnswerAssistState, SSEEvent } from './types'

type Action =
  | { type: 'start' }
  | { type: 'searching'; query: string }
  | { type: 'delta'; content: string; section: 'source' | 'ko' }
  | { type: 'done'; answer: string; answerKo: string }
  | { type: 'error'; message: string }
  | { type: 'dismiss' }

const INITIAL: AnswerAssistState = {
  status: 'idle',
  searchQuery: null,
  answer: '',
  answerKo: '',
  errorMessage: null,
}

const ANSWER_ASSIST_URL = '/api/answer-assist'

function reducer(state: AnswerAssistState, action: Action): AnswerAssistState {
  switch (action.type) {
    case 'start':
      return { ...INITIAL, status: 'loading' }
    case 'searching':
      return { ...state, status: 'searching', searchQuery: action.query }
    case 'delta':
      if (action.section === 'ko') {
        return { ...state, status: 'streaming', answerKo: state.answerKo + action.content }
      }
      return { ...state, status: 'streaming', answer: state.answer + action.content }
    case 'done':
      return { ...state, status: 'done', answer: action.answer, answerKo: action.answerKo }
    case 'error':
      return { ...state, status: 'error', errorMessage: action.message }
    case 'dismiss':
      return INITIAL
    default:
      return state
  }
}

type HandleEventArgs = {
  dispatch: React.Dispatch<Action>
  sectionRef: React.MutableRefObject<'source' | 'ko'>
  appendSource: (content: string) => void
  appendKo: (content: string) => void
}

function handleAnswerAssistEvent(
  event: SSEEvent,
  { dispatch, sectionRef, appendSource, appendKo }: HandleEventArgs
): 'done' | 'continue' {
  switch (event.type) {
    case 'searching':
      dispatch({ type: 'searching', query: event.query })
      return 'continue'
    case 'delta':
      if (sectionRef.current === 'ko') {
        appendKo(event.content)
      } else {
        appendSource(event.content)
      }
      dispatch({ type: 'delta', content: event.content, section: sectionRef.current })
      return 'continue'
    case 'section':
      if (event.name === 'ko') sectionRef.current = 'ko'
      return 'continue'
    case 'done':
      dispatch({ type: 'done', answer: event.answer, answerKo: event.answer_ko })
      return 'done'
    case 'no_question':
      dispatch({ type: 'error', message: '질문이 감지되지 않았습니다' })
      return 'done'
    case 'error':
      dispatch({ type: 'error', message: event.message })
      return 'done'
  }
}

export function useAnswerAssistStore() {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const abortRef = useRef<AbortController | null>(null)
  const cleanupElectronListenerRef = useRef<(() => void) | null>(null)
  const sectionRef = useRef<'source' | 'ko'>('source')

  const requestAnswer = useCallback(
    async (transcript: string, sourceLang: string, targetLang: string) => {
      if (abortRef.current) abortRef.current.abort()
      if (cleanupElectronListenerRef.current) cleanupElectronListenerRef.current()
      const controller = new AbortController()
      abortRef.current = controller
      sectionRef.current = 'source'

      dispatch({ type: 'start' })

      try {
        if (window.electronAPI) {
          let fullAnswer = ''
          let fullAnswerKo = ''
          cleanupElectronListenerRef.current = window.electronAPI.onAnswerAssistEvent(
            (rawEvent: unknown) => {
              const handled = handleAnswerAssistEvent(rawEvent as SSEEvent, {
                dispatch,
                sectionRef,
                appendSource: (content) => {
                  fullAnswer += content
                },
                appendKo: (content) => {
                  fullAnswerKo += content
                },
              })
              if (handled === 'done') {
                cleanupElectronListenerRef.current?.()
                cleanupElectronListenerRef.current = null
              }
            }
          )
          await window.electronAPI.startAnswerAssist(transcript, sourceLang, targetLang)
          if (fullAnswer || fullAnswerKo) {
            dispatch({ type: 'done', answer: fullAnswer, answerKo: fullAnswerKo })
          }
          return
        }

        const res = await fetch(ANSWER_ASSIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ transcript, sourceLang, targetLang }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
          error?: string
        }
        dispatch({ type: 'error', message: body.error ?? `HTTP ${res.status}` })
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        dispatch({ type: 'error', message: 'No response body' })
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let fullAnswer = ''
      let fullAnswerKo = ''

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

          let event: SSEEvent
          try {
            event = JSON.parse(json) as SSEEvent
          } catch {
            continue
          }

          const handled = handleAnswerAssistEvent(event, {
            dispatch,
            sectionRef,
            appendSource: (content) => {
              fullAnswer += content
            },
            appendKo: (content) => {
              fullAnswerKo += content
            },
          })
          if (handled === 'done') return
        }
      }

      if (fullAnswer || fullAnswerKo) {
        dispatch({ type: 'done', answer: fullAnswer, answerKo: fullAnswerKo })
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    },
    []
  )

  const dismiss = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    if (cleanupElectronListenerRef.current) cleanupElectronListenerRef.current()
    abortRef.current = null
    cleanupElectronListenerRef.current = null
    sectionRef.current = 'source'
    dispatch({ type: 'dismiss' })
  }, [])

  const copyAnswer = useCallback(
    async (section: 'source' | 'ko') => {
      const text = section === 'ko' ? state.answerKo : state.answer
      if (text) await navigator.clipboard.writeText(text)
    },
    [state.answer, state.answerKo]
  )

  return { ...state, requestAnswer, dismiss, copyAnswer }
}
