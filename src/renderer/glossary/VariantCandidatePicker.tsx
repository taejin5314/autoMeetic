import { useMemo, useState } from 'react'
import type { VariantCandidate } from './types'

interface Props {
  candidates: VariantCandidate[]
  onConfirm: (selected: string[]) => void
  onCancel: () => void
}

export function VariantCandidatePicker({ candidates, onConfirm, onCancel }: Props) {
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
        <p>비슷한 표현을 찾지 못했어요.</p>
        <button type="button" onClick={onCancel}>
          닫기
        </button>
      </div>
    )
  }

  return (
    <div className="variant-picker">
      <h3>비슷한 표현 발견 (STT 오인일 수 있음)</h3>
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
              <span className="variant-picker-frequency">({c.frequency}번)</span>
            </label>
            <p className="variant-picker-example" title={c.exampleText}>
              {c.exampleText.length > 90 ? `${c.exampleText.slice(0, 90)}...` : c.exampleText}
            </p>
          </li>
        ))}
      </ul>
      <div className="variant-picker-actions">
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button type="button" onClick={() => onConfirm(Array.from(selected))} disabled={selected.size === 0}>
          선택한 {selected.size}개 추가
        </button>
      </div>
    </div>
  )
}
