import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGE_OPTIONS, type GlossaryEntry, type GlossaryEntryInput, type VariantCandidate } from './types'
import { VariantCandidatePicker } from './VariantCandidatePicker'

interface Props {
  initial?: GlossaryEntry
  scope: 'global' | 'meeting'
  meetingId: string | null
  onSave: (input: GlossaryEntryInput) => Promise<void>
  onCancel: () => void
  onVariantCandidatesChange?: (candidates: VariantCandidate[]) => void
}

export function GlossaryRowEditor({
  initial,
  scope,
  meetingId,
  onSave,
  onCancel,
  onVariantCandidatesChange,
}: Props) {
  const { t } = useTranslation()
  const [sourceTerm, setSourceTerm] = useState(initial?.sourceTerm ?? '')
  const [preserve, setPreserve] = useState(initial?.preserve ?? false)
  const [note, setNote] = useState(initial?.note ?? '')
  const [translations, setTranslations] = useState<Record<string, string>>(
    initial?.translations ?? {}
  )
  const [newLang, setNewLang] = useState<string>('ko')
  const [newValue, setNewValue] = useState<string>('')
  const [variants, setVariants] = useState<string[]>(initial?.variants ?? [])
  const [newVariant, setNewVariant] = useState('')
  const [candidates, setCandidates] = useState<VariantCandidate[] | null>(null)
  const [scanning, setScanning] = useState(false)
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

  const handleFind = async () => {
    if (!sourceTerm.trim()) return
    setScanning(true)
    try {
      const found = (await window.electronAPI?.glossary?.findVariants(sourceTerm.trim())) ?? []
      setCandidates(found)
      onVariantCandidatesChange?.(found)
    } finally {
      setScanning(false)
    }
  }

  const handlePickerConfirm = (picked: string[]) => {
    setVariants((prev) => Array.from(new Set([...prev, ...picked])))
    setCandidates(null)
  }

  const handleAddManual = () => {
    const v = newVariant.trim()
    if (!v) return
    setVariants((prev) => (prev.includes(v) ? prev : [...prev, v]))
    setNewVariant('')
  }

  const handleRemoveVariant = (v: string) => {
    setVariants((prev) => prev.filter((x) => x !== v))
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
        variants,
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
        <span>{t('glossary.editor.sourceTerm')}</span>
        <input
          type="text"
          value={sourceTerm}
          onChange={(e) => setSourceTerm(e.target.value)}
          placeholder={t('glossary.editor.sourcePlaceholder')}
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
        <span>{t('glossary.editor.preserveVerbatim')}</span>
      </label>

      <div className="glossary-field">
        <span>{t('glossary.editor.translations')}</span>
        {Object.entries(translations).map(([lang, val]) => (
          <div key={lang} className="glossary-translation-row">
            <span className="glossary-lang-chip amw-mono">{lang.toUpperCase()}</span>
            <span className="glossary-translation-val">{val}</span>
            <button
              type="button"
              className="glossary-translation-remove"
              onClick={() => removeTranslation(lang)}
              aria-label={t('glossary.editor.removeTranslation', { lang })}
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
            aria-label={t('glossary.editor.translationLanguage')}
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
            placeholder={t('glossary.editor.renderedForm')}
            maxLength={100}
          />
          <button type="button" onClick={addTranslation}>
            {t('glossary.editor.add')}
          </button>
        </div>
      </div>

      <label className="glossary-field">
        <span>{t('glossary.editor.noteOptional')}</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
      </label>

      <div className="glossary-editor-variants">
        <label>{t('glossary.editor.variantsLabel')}</label>
        <div className="glossary-editor-variants-chips">
          {variants.map((v) => (
            <span key={v} className="glossary-editor-chip">
              {v}
              <button type="button" onClick={() => handleRemoveVariant(v)} aria-label={t('glossary.editor.removeVariant')}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="glossary-editor-variants-add">
          <input
            type="text"
            value={newVariant}
            onChange={(e) => setNewVariant(e.target.value)}
            placeholder={t('glossary.editor.variantPlaceholder')}
          />
          <button type="button" onClick={handleAddManual}>
            {t('glossary.editor.addVariant')}
          </button>
          <button type="button" onClick={handleFind} disabled={scanning || !sourceTerm.trim()}>
            {scanning ? t('glossary.editor.scanning') : t('glossary.editor.findVariants')}
          </button>
        </div>
      </div>

      {candidates !== null && (
        <VariantCandidatePicker
          candidates={candidates}
          onConfirm={handlePickerConfirm}
          onCancel={() => setCandidates(null)}
        />
      )}

      {error && <div className="glossary-error">{error}</div>}

      <div className="glossary-editor-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          {t('glossary.editor.cancel')}
        </button>
        <button
          type="button"
          className="glossary-save"
          onClick={() => void save()}
          disabled={saving || !sourceTerm.trim()}
        >
          {saving ? t('glossary.editor.saving') : t('glossary.editor.save')}
        </button>
      </div>
    </div>
  )
}
