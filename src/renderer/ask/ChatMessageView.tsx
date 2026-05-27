import { parseAnswerWithCitations } from './parseAnswerWithCitations'
import { useTranslation } from 'react-i18next'
import { SourcesList } from './SourcesList'
import type { ChatMessage, ChatSource, DeepAskProgressState } from './types'
import { canSendToMindMap } from './canSendToMindMap'
import { DeepAskProgressCard } from './DeepAskProgressCard'
import { AnswerFooter } from './AnswerFooter'
import { formatTime } from '../i18n/format'

interface Props {
  message: ChatMessage
  isStreaming: boolean
  onCitationClick: (source: ChatSource) => void
  onSendToMindMap?: (message: ChatMessage) => void
  mindMapPending?: boolean
  mindMapError?: string | null
  deepProgress?: DeepAskProgressState | null
}

export function ChatMessageView({
  message,
  isStreaming,
  onCitationClick,
  onSendToMindMap,
  mindMapPending = false,
  mindMapError = null,
  deepProgress = null,
}: Props) {
  const { t } = useTranslation()
  if (message.role === 'user') {
    return (
      <div className="ask-msg ask-msg-user">
        <div className="ask-msg-role amw-mono">
          {t('ask.message.you')} | {formatTime(message.createdAt)}
        </div>
        <div className="ask-msg-content">{message.content}</div>
      </div>
    )
  }

  const parts = parseAnswerWithCitations(message.content, message.sources ?? [])

  return (
    <div className="ask-msg ask-msg-assistant">
      <div className="ask-msg-role amw-mono">
        {t('ask.message.assistant')} | {formatTime(message.createdAt)}
      </div>
      {message.error ? (
        <div className="ask-msg-error">{message.error}</div>
      ) : (
        <>
          <div className="ask-msg-content">
            {message.deepResearch && isStreaming && message.content.length === 0 && deepProgress && (
              <DeepAskProgressCard
                plan={deepProgress.plan}
                subagents={deepProgress.subagents}
                synthesizing={deepProgress.synthesizing}
              />
            )}
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
          {message.deepResearch && message.costBreakdown && (
            <AnswerFooter
              costBreakdown={message.costBreakdown}
              subagentCount={message.costBreakdown.subagents.perAgent.length}
              toolCalls={message.costBreakdown.subagents.perAgent.reduce(
                (sum, item) => sum + item.toolCalls,
                0
              )}
              durationMs={message.deepDurationMs ?? 0}
            />
          )}
          {canSendToMindMap(message, isStreaming) && onSendToMindMap && (
            <div className="ask-msg-actions">
              <button
                type="button"
                className="ask-mindmap-btn"
                onClick={() => onSendToMindMap(message)}
                disabled={mindMapPending}
              >
                {mindMapPending ? t('ask.message.creatingMindMap') : t('ask.message.sendToMindMap')}
              </button>
              {mindMapError && <span className="ask-mindmap-error">{mindMapError}</span>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
