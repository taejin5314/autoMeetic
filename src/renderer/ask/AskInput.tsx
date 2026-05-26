import { useState } from 'react'
import { DeepAskToggle } from './DeepAskToggle'

interface Props {
  isStreaming: boolean
  onSubmit: (question: string) => void
  onStop: () => void
  deepEnabled: boolean
  onDeepEnabledChange: (next: boolean) => void
}

export function AskInput({
  isStreaming,
  onSubmit,
  onStop,
  deepEnabled,
  onDeepEnabledChange,
}: Props) {
  const [value, setValue] = useState('')

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setValue('')
  }

  return (
    <form
      className="ask-input"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        className="ask-input-textarea"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
        placeholder={isStreaming ? 'Streaming...' : 'Ask anything about your past meetings...'}
        disabled={isStreaming}
        rows={2}
        maxLength={2000}
      />
      <DeepAskToggle
        enabled={deepEnabled}
        onChange={onDeepEnabledChange}
        disabled={isStreaming}
      />
      {isStreaming ? (
        <button type="button" className="ask-input-stop" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="submit" className="ask-input-send" disabled={value.trim().length === 0}>
          Send
        </button>
      )}
    </form>
  )
}
