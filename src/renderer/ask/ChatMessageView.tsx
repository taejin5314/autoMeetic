import { parseAnswerWithCitations } from './parseAnswerWithCitations'
import { SourcesList } from './SourcesList'
import type { ChatMessage, ChatSource } from './types'
import { canSendToMindMap } from './canSendToMindMap'

function formatTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

interface Props {
  message: ChatMessage
  isStreaming: boolean
  onCitationClick: (source: ChatSource) => void
  onSendToMindMap?: (message: ChatMessage) => void
  mindMapPending?: boolean
  mindMapError?: string | null
}

export function ChatMessageView({
  message,
  isStreaming,
  onCitationClick,
  onSendToMindMap,
  mindMapPending = false,
  mindMapError = null,
}: Props) {
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
          {canSendToMindMap(message, isStreaming) && onSendToMindMap && (
            <div className="ask-msg-actions">
              <button
                type="button"
                className="ask-mindmap-btn"
                onClick={() => onSendToMindMap(message)}
                disabled={mindMapPending}
              >
                {mindMapPending ? 'Creating mind map...' : 'Send to Mind Map'}
              </button>
              {mindMapError && <span className="ask-mindmap-error">{mindMapError}</span>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
