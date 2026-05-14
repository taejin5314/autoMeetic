export type ActionItemStatus = 'suggested' | 'accepted' | 'done' | 'dismissed'

export type ActionItem = {
  id: string
  title: string
  owner?: string
  due?: string
  sourceText: string
  status: ActionItemStatus
  createdAtMs: number
}

export function isActionItem(value: unknown): value is ActionItem {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ActionItem>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.sourceText === 'string' &&
    isActionItemStatus(candidate.status) &&
    typeof candidate.createdAtMs === 'number'
  )
}

function isActionItemStatus(value: unknown): value is ActionItemStatus {
  return value === 'suggested' || value === 'accepted' || value === 'done' || value === 'dismissed'
}
