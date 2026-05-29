import { useCallback, useMemo, useState } from 'react'
import { PipelineHealthStore } from '../../main/health/pipelineHealth'

type HealthStage = 'capture' | 'stt' | 'translation'
type HealthStatus = 'connected' | 'degraded' | 'disconnected'

export type UpdateHealth = (stage: HealthStage, status: HealthStatus, message?: string) => void

export interface PipelineHealthState {
  updateHealth: UpdateHealth
  healthSnapshot: ReturnType<PipelineHealthStore['getSnapshot']>
}

/**
 * Owns the PipelineHealthStore instance + a re-render tick. `updateHealth`
 * mutates the store and bumps the tick so `healthSnapshot` recomputes on the
 * next render. The store snapshot is read every render (getSnapshot reads
 * mutable store state); `void healthTick` documents/forces the tick dependency.
 */
export function usePipelineHealth(): PipelineHealthState {
  const [healthTick, setHealthTick] = useState(0)
  const health = useMemo(() => new PipelineHealthStore(), [])

  const updateHealth = useCallback<UpdateHealth>(
    (stage, status, message) => {
      health.update(stage, status, message)
      setHealthTick((v) => v + 1)
    },
    [health]
  )

  void healthTick
  const healthSnapshot = health.getSnapshot()

  return { updateHealth, healthSnapshot }
}
