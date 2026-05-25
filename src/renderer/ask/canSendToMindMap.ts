import type { ChatMessage } from './types'

export function canSendToMindMap(message: ChatMessage, isStreaming: boolean): boolean {
  return (
    message.role === 'assistant' &&
    !isStreaming &&
    !message.error &&
    Boolean(message.content.trim()) &&
    Boolean(message.sources && message.sources.length > 0)
  )
}
