import { useTranslation } from 'react-i18next'
import type { ActionItem } from './types'

type ActionItemsPanelProps = {
  items: ActionItem[]
  onAccept: (id: string) => void
  onDismiss: (id: string) => void
  onDone: (id: string) => void
  onUpdate: (id: string, patch: Partial<Pick<ActionItem, 'title' | 'owner' | 'due'>>) => void
}

export function ActionItemsPanel({
  items,
  onAccept,
  onDismiss,
  onDone,
  onUpdate,
}: ActionItemsPanelProps) {
  const { t } = useTranslation()
  const visibleItems = items.filter((item) => item.status !== 'dismissed')
  const suggested = visibleItems.filter((item) => item.status === 'suggested')
  const accepted = visibleItems.filter((item) => item.status === 'accepted')
  const done = visibleItems.filter((item) => item.status === 'done')

  if (visibleItems.length === 0) {
    return (
      <div className="v4p-actions-empty">
        <p>
          <em>{t('actions.empty.title')}</em>
        </p>
        <p className="v4p-actions-hint">
          {t('actions.empty.hint')}
        </p>
      </div>
    )
  }

  return (
    <div className="v4p-actions-panel">
      <ActionSection
        title={t('actions.sections.suggested')}
        emptyText={t('actions.sections.suggestedEmpty')}
        items={suggested}
        onAccept={onAccept}
        onDismiss={onDismiss}
        onDone={onDone}
        onUpdate={onUpdate}
      />
      <ActionSection
        title={t('actions.sections.accepted')}
        emptyText={t('actions.sections.acceptedEmpty')}
        items={accepted}
        onAccept={onAccept}
        onDismiss={onDismiss}
        onDone={onDone}
        onUpdate={onUpdate}
      />
      <ActionSection
        title={t('actions.sections.done')}
        emptyText={t('actions.sections.doneEmpty')}
        items={done}
        onAccept={onAccept}
        onDismiss={onDismiss}
        onDone={onDone}
        onUpdate={onUpdate}
        compact
      />
    </div>
  )
}

type ActionSectionProps = ActionItemsPanelProps & {
  title: string
  emptyText: string
  compact?: boolean
}

function ActionSection({
  title,
  emptyText,
  items,
  compact = false,
  onAccept,
  onDismiss,
  onDone,
  onUpdate,
}: ActionSectionProps) {
  return (
    <section className="v4p-action-section">
      <div className="v4p-action-section-hd">
        <em>{title}</em>
        <span>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="v4p-action-section-empty">{emptyText}</p>
      ) : (
        <div className="v4p-action-list">
          {items.map((item) => (
            <ActionCard
              key={item.id}
              item={item}
              compact={compact}
              onAccept={onAccept}
              onDismiss={onDismiss}
              onDone={onDone}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
    </section>
  )
}

type ActionCardProps = Omit<ActionItemsPanelProps, 'items'> & {
  item: ActionItem
  compact: boolean
}

function ActionCard({
  item,
  compact,
  onAccept,
  onDismiss,
  onDone,
  onUpdate,
}: ActionCardProps) {
  const { t } = useTranslation()
  return (
    <article className={`v4p-action-card ${compact ? 'compact' : ''}`}>
      <input
        className="v4p-action-title"
        value={item.title}
        onChange={(event) => onUpdate(item.id, { title: event.target.value })}
        aria-label={t('actions.card.titleAria')}
      />
      {!compact && (
        <>
          <div className="v4p-action-fields">
            <input
              value={item.owner ?? ''}
              onChange={(event) => onUpdate(item.id, { owner: event.target.value })}
              placeholder={t('actions.card.owner')}
              aria-label={t('actions.card.owner')}
            />
            <input
              value={item.due ?? ''}
              onChange={(event) => onUpdate(item.id, { due: event.target.value })}
              placeholder={t('actions.card.due')}
              aria-label={t('actions.card.dueDate')}
            />
          </div>
          <p className="v4p-action-source">{item.sourceText}</p>
        </>
      )}
      <div className="v4p-action-controls">
        {item.status === 'suggested' && (
          <button type="button" onClick={() => onAccept(item.id)}>
            {t('actions.card.accept')}
          </button>
        )}
        {item.status !== 'done' && item.status !== 'dismissed' && (
          <button type="button" onClick={() => onDone(item.id)}>
            {t('actions.card.done')}
          </button>
        )}
        <button type="button" onClick={() => onDismiss(item.id)}>
          {t('actions.card.dismiss')}
        </button>
      </div>
    </article>
  )
}
