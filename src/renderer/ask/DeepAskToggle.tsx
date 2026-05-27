import { useTranslation } from 'react-i18next'

interface Props {
  enabled: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}

export function DeepAskToggle({ enabled, onChange, disabled }: Props) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={`deep-ask-toggle ${enabled ? 'deep-ask-toggle-on' : 'deep-ask-toggle-off'}`}
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      title={t('deepAsk.toggle.title')}
    >
      {t('deepAsk.toggle.label')}
    </button>
  )
}
