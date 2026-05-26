export type { ChatMessage, ChatSource } from '../../main/memory/types'
export type {
  CostBreakdown,
  DeepAskEvent,
  Plan,
  SubagentBrief,
} from '../../main/memory/agents/types'

export interface DeepAskSubagentProgress {
  brief: SubagentBrief
  status: 'running' | 'done' | 'failed' | 'capped'
  toolCalls: number
}

export interface DeepAskProgressState {
  plan?: Plan
  subagents: DeepAskSubagentProgress[]
  synthesizing: boolean
}
