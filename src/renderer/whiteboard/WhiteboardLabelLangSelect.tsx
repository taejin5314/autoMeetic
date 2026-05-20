import { useEffect, useState } from 'react'

const STORAGE_KEY = 'automeetic.diagramLabelLanguage'

const OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'ko', label: 'KO' },
  { value: 'en', label: 'EN' },
  { value: 'ja', label: 'JA' },
  { value: 'zh', label: 'ZH' },
  { value: 'es', label: 'ES' },
  { value: 'fr', label: 'FR' },
  { value: 'de', label: 'DE' },
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
  const [value, setValue] = useState<string>(readInitial)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, value)
    pushToMain(value)
  }, [value])

  // Push the initial value once on mount, in case the user's previous
  // session left a non-default in localStorage but main started fresh.
  useEffect(() => {
    pushToMain(readInitial())
  }, [])

  return (
    <label className="v4p-wb-labellang" title="Diagram label language">
      <span className="amw-mono v4p-wb-labellang-prefix">LABELS</span>
      <select
        className="v4p-wb-labellang-select amw-mono"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          onChange?.(e.target.value)
        }}
        aria-label="Diagram label language"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

