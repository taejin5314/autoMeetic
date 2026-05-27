import { useTranslation } from 'react-i18next'
import type { CostBreakdown } from './types'

interface Props {
  costBreakdown: CostBreakdown
  subagentCount: number
  toolCalls: number
  durationMs: number
}

export function AnswerFooter({ costBreakdown, subagentCount, toolCalls, durationMs }: Props) {
  const { t } = useTranslation()
  const seconds = (durationMs / 1000).toFixed(1)
  const usd = costBreakdown.total.estimatedUsd.toFixed(2)
  return (
    <div className="deep-ask-footer">
      {t('deepAsk.footer.format', { agents: subagentCount, toolCalls, usd, seconds })}
    </div>
  )
}
