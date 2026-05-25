import { useEffect, useRef, useState } from 'react'
import { AskInput } from './AskInput'
import { ChatMessageView } from './ChatMessageView'
import type { ChatMessage, ChatSource } from './types'
import { useChatStore } from './useChatStore'

interface Props {
  meetingCount: number
  onCitationClick: (source: ChatSource) => void
  onSendToMindMap?: (payload: {
    question: string
    answer: string
    sources: ChatSource[]
  }) => Promise<void>
}

export function AskTab({ meetingCount, onCitationClick, onSendToMindMap }: Props) {
  const store = useChatStore()
  const listRef = useRef<HTMLDivElement>(null)
  const [mindMapPendingId, setMindMapPendingId] = useState<string | null>(null)
  const [mindMapErrorById, setMindMapErrorById] = useState<Record<string, string>>({})

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [store.messages])

  const streamingMsgId = store.isStreaming ? store.messages[store.messages.length - 1]?.id : null

  const findPreviousQuestion = (message: ChatMessage): string => {
    const index = store.messages.findIndex((candidate) => candidate.id === message.id)
    for (let i = index - 1; i >= 0; i--) {
      const candidate = store.messages[i]
      if (candidate.role === 'user') return candidate.content
    }
    return ''
  }

  const handleSendToMindMap = async (message: ChatMessage): Promise<void> => {
    if (!onSendToMindMap || !message.sources || mindMapPendingId) return
    setMindMapPendingId(message.id)
    setMindMapErrorById((prev) => ({ ...prev, [message.id]: '' }))
    try {
      await onSendToMindMap({
        question: findPreviousQuestion(message),
        answer: message.content,
        sources: message.sources,
      })
    } catch (err) {
      setMindMapErrorById((prev) => ({
        ...prev,
        [message.id]: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setMindMapPendingId(null)
    }
  }

  return (
    <div className="ask-tab">
      <header className="ask-tab-header">
        <div className="ask-tab-title">
          Ask your meetings
          {meetingCount > 0 && (
            <span className="ask-tab-count amw-mono"> | {meetingCount} meetings</span>
          )}
        </div>
        <button
          type="button"
          className="ask-tab-new"
          onClick={store.newChat}
          disabled={store.messages.length === 0 && !store.isStreaming}
        >
          New chat
        </button>
      </header>

      <div className="ask-tab-list amw-scroll" ref={listRef}>
        {store.messages.length === 0 ? (
          <div className="ask-empty">
            <h3>Ask anything about your past meetings</h3>
            {meetingCount === 0 ? (
              <p>No meetings yet. Start a meeting to build your searchable memory.</p>
            ) : (
              <ul className="ask-examples">
                <li>"What were our Q4 OKR conclusions?"</li>
                <li>"Who pushed back on the migration timeline?"</li>
                <li>"Summarize all decisions about pricing"</li>
              </ul>
            )}
          </div>
        ) : (
          store.messages.map((message) => (
            <ChatMessageView
              key={message.id}
              message={message}
              isStreaming={store.isStreaming && message.id === streamingMsgId}
              onCitationClick={onCitationClick}
              onSendToMindMap={onSendToMindMap ? handleSendToMindMap : undefined}
              mindMapPending={mindMapPendingId === message.id}
              mindMapError={mindMapErrorById[message.id] || null}
            />
          ))
        )}
      </div>

      <AskInput isStreaming={store.isStreaming} onSubmit={store.submit} onStop={store.stop} />
    </div>
  )
}
