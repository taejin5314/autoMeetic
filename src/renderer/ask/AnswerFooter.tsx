import { useTranslation } from 'react-i18next'
import { formatCurrency, formatNumber } from '../i18n/format'
import type { CostBreakdown } from './types'

interface Props {
  costBreakdown: CostBreakdown
  subagentCount: number
  toolCalls: number
  durationMs: number
}

export function AnswerFooter({ costBreakdown, subagentCount, toolCalls, durationMs }: Props) {
  const { t } = useTranslation()
  const seconds = formatNumber(durationMs / 1000, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const usd = formatCurrency(costBreakdown.total.estimatedUsd)
  return (
    <div className="deep-ask-footer">
      {t('deepAsk.footer.format', { agents: subagentCount, toolCalls, usd, seconds })}
    </div>
  )
}
