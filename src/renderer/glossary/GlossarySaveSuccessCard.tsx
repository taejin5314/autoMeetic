import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
      <div className="glossary-save-card-header">
        {t('glossary.success.saved', { term: entry.sourceTerm })}
      </div>
      {variantList && (
        <div className="glossary-save-card-variants">
          {t('glossary.success.variants', { variants: variantList })}
        </div>
      )}
      {isShort ? (
        <div className="glossary-save-card-warning">
          {t('glossary.success.shortWarning')}
        </div>
      ) : totalPastMatches > 0 ? (
        <>
          <div className="glossary-save-card-body">
            {t('glossary.success.pastMatches', { count: totalPastMatches })}
          </div>
          {candidates[0] && (
            <div className="glossary-save-card-example">
              {t('glossary.success.example', {
                example: `${candidates[0].exampleText.slice(0, 120)}${
                  candidates[0].exampleText.length > 120 ? '...' : ''
                }`,
              })}
              <br />
              -&gt; {t('glossary.success.futurePrefix')}{' '}
              <strong>{entry.sourceTerm}</strong>{t('glossary.success.futureSuffix')}
            </div>
          )}
        </>
      ) : (
        <div className="glossary-save-card-body">
          {t('glossary.success.newTerm')}
        </div>
      )}
    </div>
  )
}
