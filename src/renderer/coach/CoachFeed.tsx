import { useTranslation } from 'react-i18next'
import type { CoachCard } from './useCoachFeed'

type CoachFeedProps = {
  cards: CoachCard[]
  dismiss: (id: string) => void
  clearAll: () => void
  onOpenCluster: (clusterId: string) => void
}

export function CoachFeed({ cards, dismiss, clearAll, onOpenCluster }: CoachFeedProps) {
  const { t } = useTranslation()
  const visibleCards = cards.filter((card) => !card.dismissed)

  if (visibleCards.length === 0) {
    return (
      <div className="v4p-coach-empty">
        <p>
          <em>{t('coach.empty')}</em>
        </p>
      </div>
    )
  }

  return (
    <div className="v4p-coach-panel">
      <div className="v4p-coach-head">
        <span className="amw-mono">{visibleCards.length}</span>
        <button type="button" onClick={clearAll}>
          {t('coach.clearAll')}
        </button>
      </div>
      <div className="v4p-coach-list">
        {visibleCards.map((card) =>
          card.type === 'past-context' ? (
            <PastContextCard
              key={card.id}
              card={card}
              dismiss={dismiss}
              onOpenCluster={onOpenCluster}
            />
          ) : (
            <GlossaryMismatchCard key={card.id} card={card} dismiss={dismiss} />
          )
        )}
      </div>
    </div>
  )
}

type PastContextCardProps = {
  card: Extract<CoachCard, { type: 'past-context' }>
  dismiss: (id: string) => void
  onOpenCluster: (clusterId: string) => void
}

function PastContextCard({ card, dismiss, onOpenCluster }: PastContextCardProps) {
  const { t } = useTranslation()
  return (
    <article className="v4p-coach-card past-context">
      <div className="v4p-coach-card-hd">
        <em>{t('coach.pastContext.title')}</em>
        <button type="button" onClick={() => dismiss(card.id)}>
          {t('coach.dismiss')}
        </button>
      </div>
      <h3>{card.clusterTitle}</h3>
      <p>{card.snippet}</p>
      <div className="v4p-coach-card-actions">
        <button type="button" onClick={() => onOpenCluster(card.clusterId)}>
          {t('coach.pastContext.openAction')}
        </button>
      </div>
    </article>
  )
}

type GlossaryMismatchCardProps = {
  card: Extract<CoachCard, { type: 'glossary-mismatch' }>
  dismiss: (id: string) => void
}

function GlossaryMismatchCard({ card, dismiss }: GlossaryMismatchCardProps) {
  const { t } = useTranslation()
  return (
    <article className="v4p-coach-card glossary-mismatch">
      <div className="v4p-coach-card-hd">
        <em>{t('coach.glossaryMismatch.title')}</em>
        <button type="button" onClick={() => dismiss(card.id)}>
          {t('coach.dismiss')}
        </button>
      </div>
      <p>
        {t('coach.glossaryMismatch.body', {
          variant: card.variant,
          canonical: card.canonical,
        })}
      </p>
    </article>
  )
}

