import type { CostBreakdown } from './types'

interface Props {
  costBreakdown: CostBreakdown
  subagentCount: number
  toolCalls: number
  durationMs: number
}

export function AnswerFooter({ costBreakdown, subagentCount, toolCalls, durationMs }: Props) {
  const seconds = (durationMs / 1000).toFixed(1)
  const usd = costBreakdown.total.estimatedUsd.toFixed(2)
  return (
    <div className="deep-ask-footer">
      ⚡ Deep · {subagentCount} agents · {toolCalls} tool calls · ~${usd} · {seconds}s
    </div>
  )
}
