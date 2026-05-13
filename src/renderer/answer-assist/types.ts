export type AnswerAssistStatus =
  | 'idle'
  | 'loading'
  | 'searching'
  | 'streaming'
  | 'done'
  | 'error'

export interface AnswerAssistState {
  status: AnswerAssistStatus
  searchQuery: string | null
  answer: string
  answerKo: string
  errorMessage: string | null
}

export type SSEEvent =
  | { type: 'searching'; query: string }
  | { type: 'delta'; content: string }
  | { type: 'section'; name: 'ko' }
  | { type: 'done'; answer: string; answer_ko: string }
  | { type: 'no_question' }
  | { type: 'error'; message: string }
