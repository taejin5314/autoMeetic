import { useEffect } from 'react'
import type { GlossaryEntry, VariantCandidate } from './types'

interface Props {
  entry: GlossaryEntry
  candidates: VariantCandidate[]
  onDismiss: () => void
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

export function GlossarySaveSuccessCard({ entry, candidates, onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000)
    return () => clearTimeout(t)
  }, [onDismiss])

  const normalizedLen = normalize(entry.sourceTerm).length
  const isShort = normalizedLen <= 2
  const totalPastMatches =
    candidates.reduce((sum, c) => sum + c.frequency, 0) +
    candidates.filter((c) => c.candidate.toLowerCase() === entry.sourceTerm.toLowerCase()).length
  const variantList = entry.variants.length > 0 ? entry.variants.join(', ') : null

  return (
    <div className="glossary-save-card" role="status" onClick={onDismiss}>
      <div className="glossary-save-card-header">✓ {entry.sourceTerm} 저장됨</div>
      {variantList && <div className="glossary-save-card-variants">등록된 변형: {variantList}</div>}
      {isShort ? (
        <div className="glossary-save-card-warning">
          짧은 단어라 라이브 하이라이트는 적용되지 않습니다 (보존 규칙은 작동).
        </div>
      ) : totalPastMatches > 0 ? (
        <>
          <div className="glossary-save-card-body">
            과거 미팅에서 총 {totalPastMatches}번 등장했습니다.
          </div>
          {candidates[0] && (
            <div className="glossary-save-card-example">
              예시: "{candidates[0].exampleText.slice(0, 120)}
              {candidates[0].exampleText.length > 120 ? '...' : ''}"
              <br />
              -&gt; 앞으로 ✨ <strong>{entry.sourceTerm}</strong>로 보존됩니다.
            </div>
          )}
        </>
      ) : (
        <div className="glossary-save-card-body">
          과거 미팅에서 등장하지 않은 새 단어예요. 다음 미팅부터 자동으로 보존됩니다.
        </div>
      )}
    </div>
  )
}
