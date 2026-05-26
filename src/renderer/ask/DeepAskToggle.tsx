interface Props {
  enabled: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}

export function DeepAskToggle({ enabled, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      className={`deep-ask-toggle ${enabled ? 'deep-ask-toggle-on' : 'deep-ask-toggle-off'}`}
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      title="Deep research - slower but explores multiple angles (~10x tokens)"
    >
      ⚡ Deep
    </button>
  )
}
