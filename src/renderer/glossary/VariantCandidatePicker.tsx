import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VariantCandidate } from './types'

interface Props {
  candidates: VariantCandidate[]
  onConfirm: (selected: string[]) => void
  onCancel: () => void
}

export function VariantCandidatePicker({ candidates, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  const initial = useMemo(
    () => new Set(candidates.filter((c) => c.frequency >= 3).map((c) => c.candidate)),
    [candidates]
  )
  const [selected, setSelected] = useState<Set<string>>(initial)

  const toggle = (candidate: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(candidate)) next.delete(candidate)
      else next.add(candidate)
      return next
    })
  }

  if (candidates.length === 0) {
    return (
      <div className="variant-picker variant-picker-empty">
        <p>{t('glossary.variantPicker.empty')}</p>
        <button type="button" onClick={onCancel}>
          {t('glossary.variantPicker.close')}
        </button>
      </div>
    )
  }

  return (
    <div className="variant-picker">
      <h3>{t('glossary.variantPicker.title')}</h3>
      <ul className="variant-picker-list">
        {candidates.map((c) => (
          <li key={c.candidate}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(c.candidate)}
                onChange={() => toggle(c.candidate)}
              />
              <span className="variant-picker-candidate">{c.candidate}</span>
              <span className="variant-picker-frequency">{t('glossary.variantPicker.frequency', { count: c.frequency })}</span>
            </label>
            <p className="variant-picker-example" title={c.exampleText}>
              {c.exampleText.length > 90 ? `${c.exampleText.slice(0, 90)}...` : c.exampleText}
            </p>
          </li>
        ))}
      </ul>
      <div className="variant-picker-actions">
        <button type="button" onClick={onCancel}>
          {t('glossary.variantPicker.cancel')}
        </button>
        <button type="button" onClick={() => onConfirm(Array.from(selected))} disabled={selected.size === 0}>
          {t('glossary.variantPicker.addSelected', { count: selected.size })}
        </button>
      </div>
    </div>
  )
}
