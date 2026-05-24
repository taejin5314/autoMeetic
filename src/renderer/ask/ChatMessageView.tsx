import { parseAnswerWithCitations } from './parseAnswerWithCitations'
import { SourcesList } from './SourcesList'
import type { ChatMessage, ChatSource } from './types'

function formatTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

interface Props {
  message: ChatMessage
  isStreaming: boolean
  onCitationClick: (source: ChatSource) => void
}

export function ChatMessageView({ message, isStreaming, onCitationClick }: Props) {
  if (message.role === 'user') {
    return (
      <div className="ask-msg ask-msg-user">
        <div className="ask-msg-role amw-mono">You | {formatTime(message.createdAt)}</div>
        <div className="ask-msg-content">{message.content}</div>
      </div>
    )
  }

  const parts = parseAnswerWithCitations(message.content, message.sources ?? [])

  return (
    <div className="ask-msg ask-msg-assistant">
      <div className="ask-msg-role amw-mono">Assistant | {formatTime(message.createdAt)}</div>
      {message.error ? (
        <div className="ask-msg-error">{message.error}</div>
      ) : (
        <>
          <div className="ask-msg-content">
            {parts.map((part, index) =>
              part.type === 'text' ? (
                <span key={index}>{part.text}</span>
              ) : (
                <button
                  key={index}
                  type="button"
                  className="ask-citation amw-mono"
                  title={part.source.meetingTitle}
                  onClick={() => onCitationClick(part.source)}
                >
                  {part.marker}
                </button>
              )
            )}
            {isStreaming && <span className="ask-cursor">|</span>}
          </div>
          {message.sources && message.sources.length > 0 && (
            <SourcesList sources={message.sources} onClickSource={onCitationClick} />
          )}
        </>
      )}
    </div>
  )
}
