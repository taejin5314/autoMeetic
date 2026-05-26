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
  return (
    <div className="deep-ask-progress">
      {!plan ? (
        <div className="deep-ask-progress-step">분해 중...</div>
      ) : (
        <>
          <div className="deep-ask-progress-step">계획</div>
          <div className="deep-ask-progress-reasoning">{plan.reasoning}</div>
        </>
      )}
      {subagents.map((s) => {
        const icon = s.status === 'running' ? '●' : s.status === 'done' ? '✓' : s.status === 'capped' ? '!' : '×'
        return (
          <div key={s.brief.idx} className="deep-ask-subagent-row">
            <span>{icon}</span>
            <span className="deep-ask-subagent-objective">
              서브에이전트 {s.brief.idx + 1}: {s.brief.objective}
            </span>
            <span className="deep-ask-subagent-counter">({s.toolCalls}회 도구 호출)</span>
          </div>
        )
      })}
      {synthesizing && <div className="deep-ask-progress-step">종합 중...</div>}
    </div>
  )
}
