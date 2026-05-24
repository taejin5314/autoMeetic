import { useEffect, useRef } from 'react'
import { AskInput } from './AskInput'
import { ChatMessageView } from './ChatMessageView'
import type { ChatSource } from './types'
import { useChatStore } from './useChatStore'

interface Props {
  meetingCount: number
  onCitationClick: (source: ChatSource) => void
}

export function AskTab({ meetingCount, onCitationClick }: Props) {
  const store = useChatStore()
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [store.messages])

  const streamingMsgId = store.isStreaming ? store.messages[store.messages.length - 1]?.id : null

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
            />
          ))
        )}
      </div>

      <AskInput isStreaming={store.isStreaming} onSubmit={store.submit} onStop={store.stop} />
    </div>
  )
}
