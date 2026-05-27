import { useTranslation } from 'react-i18next'
import type { Plan } from './types'

interface SubagentRowState {
  brief: { idx: number; objective: string }
  status: 'running' | 'done' | 'failed' | 'capped'
  toolCalls: number
}

interface Props {
  plan?: Plan
  subagents: SubagentRowState[]
  synthesizing: boolean
}

export function DeepAskProgressCard({ plan, subagents, synthesizing }: Props) {
  const { t } = useTranslation()
  return (
    <div className="deep-ask-progress">
      {!plan ? (
        <div className="deep-ask-progress-step">{t('deepAsk.progress.decomposing')}</div>
      ) : (
        <>
          <div className="deep-ask-progress-step">{t('deepAsk.progress.plan')}</div>
          <div className="deep-ask-progress-reasoning">{plan.reasoning}</div>
        </>
      )}
      {subagents.map((s) => {
        const icon = s.status === 'running' ? '●' : s.status === 'done' ? '✓' : s.status === 'capped' ? '!' : '×'
        return (
          <div key={s.brief.idx} className="deep-ask-subagent-row">
            <span>{icon}</span>
            <span className="deep-ask-subagent-objective">
              {t('deepAsk.progress.subagent', { index: s.brief.idx + 1, objective: s.brief.objective })}
            </span>
            <span className="deep-ask-subagent-counter">
              {t('deepAsk.progress.toolCalls', { count: s.toolCalls })}
            </span>
          </div>
        )
      })}
      {synthesizing && <div className="deep-ask-progress-step">{t('deepAsk.progress.synthesizing')}</div>}
    </div>
  )
}
