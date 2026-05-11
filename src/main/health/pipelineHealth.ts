export type PipelineStage = 'capture' | 'stt' | 'translation'
export type HealthStatus = 'connected' | 'degraded' | 'disconnected'

export interface StageHealth {
  stage: PipelineStage
  status: HealthStatus
  updatedAtMs: number
  message?: string
}

export class PipelineHealthStore {
  private state: Record<PipelineStage, StageHealth> = {
    capture: { stage: 'capture', status: 'disconnected', updatedAtMs: Date.now() },
    stt: { stage: 'stt', status: 'disconnected', updatedAtMs: Date.now() },
    translation: { stage: 'translation', status: 'disconnected', updatedAtMs: Date.now() },
  }

  getSnapshot(): Record<PipelineStage, StageHealth> {
    return this.state
  }

  update(stage: PipelineStage, status: HealthStatus, message?: string): void {
    this.state[stage] = {
      stage,
      status,
      updatedAtMs: Date.now(),
      message,
    }
  }
}
