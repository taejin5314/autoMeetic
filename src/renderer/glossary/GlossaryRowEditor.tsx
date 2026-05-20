import { useState } from 'react'
import { LANGUAGE_OPTIONS, type GlossaryEntry, type GlossaryEntryInput } from './types'

interface Props {
  initial?: GlossaryEntry
  scope: 'global' | 'meeting'
  meetingId: string | null
  onSave: (input: GlossaryEntryInput) => Promise<void>
  onCancel: () => void
}

export function GlossaryRowEditor({
  initial,
  scope,
  meetingId,
  onSave,
  onCancel,
}: Props) {
  const [sourceTerm, setSourceTerm] = useState(initial?.sourceTerm ?? '')
  const [preserve, setPreserve] = useState(initial?.preserve ?? false)
  const [note, setNote] = useState(initial?.note ?? '')
  const [translations, setTranslations] = useState<Record<string, string>>(
    initial?.translations ?? {}
  )
  const [newLang, setNewLang] = useState<string>('ko')
  const [newValue, setNewValue] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const addTranslation = () => {
    const v = newValue.trim()
    if (!v) return
    setTranslations((t) => ({ ...t, [newLang]: v }))
    setNewValue('')
  }

  const removeTranslation = (lang: string) => {
    setTranslations((t) => {
      const next = { ...t }
      delete next[lang]
      return next
    })
  }

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      await onSave({
        id: initial?.id,
        scope,
        meetingId: scope === 'meeting' ? meetingId : null,
        sourceTerm: sourceTerm.trim(),
        translations,
        preserve,
        note: note.trim() || null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="glossary-row-editor">
      <label className="glossary-field">
        <span>Source term</span>
        <input
          type="text"
          value={sourceTerm}
          onChange={(e) => setSourceTerm(e.target.value)}
          placeholder="e.g. autoMeetic"
          maxLength={100}
          autoFocus
        />
      </label>

      <label className="glossary-field glossary-field-row">
        <input
          type="checkbox"
          checked={preserve}
          onChange={(e) => setPreserve(e.target.checked)}
        />
        <span>Preserve verbatim in all output</span>
      </label>

      <div className="glossary-field">
        <span>Translations</span>
        {Object.entries(translations).map(([lang, val]) => (
          <div key={lang} className="glossary-translation-row">
            <span className="glossary-lang-chip amw-mono">{lang.toUpperCase()}</span>
            <span className="glossary-translation-val">{val}</span>
            <button
              type="button"
              className="glossary-translation-remove"
              onClick={() => removeTranslation(lang)}
              aria-label={`Remove ${lang} translation`}
            >
              ×
            </button>
          </div>
        ))}
        <div className="glossary-translation-add">
          <select
            value={newLang}
            onChange={(e) => setNewLang(e.target.value)}
            className="glossary-lang-select"
            aria-label="Translation language"
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code.toUpperCase()}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="rendered form"
            maxLength={100}
          />
          <button type="button" onClick={addTranslation}>
            + Add
          </button>
        </div>
      </div>

      <label className="glossary-field">
        <span>Note (optional)</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
      </label>

      {error && <div className="glossary-error">{error}</div>}

      <div className="glossary-editor-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="glossary-save"
          onClick={() => void save()}
          disabled={saving || !sourceTerm.trim()}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
