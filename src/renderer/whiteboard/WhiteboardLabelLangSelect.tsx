import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY = 'automeetic.diagramLabelLanguage'

const OPTIONS = [
  { value: '', labelKey: 'whiteboard.labelLang.auto' },
  { value: 'ko', labelKey: 'whiteboard.labelLang.ko' },
  { value: 'en', labelKey: 'whiteboard.labelLang.en' },
  { value: 'ja', labelKey: 'whiteboard.labelLang.ja' },
  { value: 'zh', labelKey: 'whiteboard.labelLang.zh' },
  { value: 'es', labelKey: 'whiteboard.labelLang.es' },
  { value: 'fr', labelKey: 'whiteboard.labelLang.fr' },
  { value: 'de', labelKey: 'whiteboard.labelLang.de' },
]

function readInitial(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(STORAGE_KEY) ?? ''
}

function pushToMain(value: string): void {
  const api = window.electronAPI?.whiteboard?.setLabelLanguage
  if (api) void api(value || null)
}

interface Props {
  onChange?: (next: string) => void
}

export function WhiteboardLabelLangSelect({ onChange }: Props) {
  const { t } = useTranslation()
  const [value, setValue] = useState<string>(readInitial)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, value)
    pushToMain(value)
  }, [value])

  return (
    <label className="v4p-wb-labellang" title={t('whiteboard.labelLang.title')}>
      <span className="amw-mono v4p-wb-labellang-prefix">
        {t('whiteboard.labelLang.prefix')}
      </span>
      <select
        className="v4p-wb-labellang-select amw-mono"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          onChange?.(e.target.value)
        }}
        aria-label={t('whiteboard.labelLang.aria')}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
    </label>
  )
}
