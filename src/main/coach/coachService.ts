import type { MeetingCluster } from '../memory/types'
import type { FinalizedTurn, PipelineEvent } from '../pipeline/types'
import type { CoachEvent } from './types'

const PAST_CONTEXT_RE =
  /(지난번|저번|이전에|먼저번|last time|previously|before that|remember when|earlier we|the other day)/i
const PAST_CONTEXT_MIN_INTERVAL_MS = 60_000
const TOTAL_MAX_PER_MINUTE = 5
const CLUSTER_DEDUP_MS = 5 * 60_000
const CANONICAL_DEDUP_MS = 60_000
const DEFAULT_THRESHOLD = 0.6

interface CoachRepo {
  findNearestClusterToCentroid(
    centroid: Float32Array,
    threshold: number
  ): { cluster: MeetingCluster; similarity: number } | null
}

interface CoachEmbedder {
  embedQuery(text: string): Promise<Float32Array>
}

interface CoachServiceDeps {
  repo: CoachRepo
  embedder: CoachEmbedder
  currentMeetingClusterId: () => string | null
  emit: (event: CoachEvent) => void
  now?: () => number
  threshold?: number
}

export interface CoachService {
  onTurnFinalized(turn: FinalizedTurn): Promise<void>
  onGlossaryNormalize(event: Extract<PipelineEvent, { type: 'glossary-normalize-applied' }>): void
  onMeetingEnded(): void
}

export function createCoachService(deps: CoachServiceDeps): CoachService {
  const now = deps.now ?? (() => Date.now())
  const threshold = deps.threshold ?? DEFAULT_THRESHOLD
  let lastPastContextAt = -Infinity
  let emittedThisMinute: number[] = []
  const clusterEmittedAt = new Map<string, number>()
  const canonicalEmittedAt = new Map<string, number>()

  function canEmit(at: number): boolean {
    emittedThisMinute = emittedThisMinute.filter((ts) => at - ts < 60_000)
    return emittedThisMinute.length < TOTAL_MAX_PER_MINUTE
  }

  function recordEmit(at: number): void {
    emittedThisMinute.push(at)
  }

  function emit(event: CoachEvent): void {
    deps.emit(event)
    recordEmit(event.emittedAtMs)
  }

  return {
    async onTurnFinalized(turn): Promise<void> {
      if (!PAST_CONTEXT_RE.test(turn.text)) return
      const at = now()
      if (at - lastPastContextAt < PAST_CONTEXT_MIN_INTERVAL_MS) return
      if (!canEmit(at)) return
      const vector = await deps.embedder.embedQuery(turn.text)
      const nearest = deps.repo.findNearestClusterToCentroid(vector, threshold)
      if (!nearest) return
      if (nearest.cluster.id === deps.currentMeetingClusterId()) return
      const lastClusterAt = clusterEmittedAt.get(nearest.cluster.id)
      if (typeof lastClusterAt === 'number' && at - lastClusterAt < CLUSTER_DEDUP_MS) return
      lastPastContextAt = at
      clusterEmittedAt.set(nearest.cluster.id, at)
      emit({
        type: 'past-context',
        clusterId: nearest.cluster.id,
        clusterTitle: nearest.cluster.title,
        snippet: nearest.cluster.summary.slice(0, 200),
        turnId: turn.id,
        emittedAtMs: at,
      })
    },

    onGlossaryNormalize(event): void {
      const at = now()
      for (const pair of event.pairs) {
        if (!canEmit(at)) return
        const key = pair.canonical.toLowerCase()
        const lastCanonicalAt = canonicalEmittedAt.get(key)
        if (typeof lastCanonicalAt === 'number' && at - lastCanonicalAt < CANONICAL_DEDUP_MS) {
          continue
        }
        canonicalEmittedAt.set(key, at)
        emit({
          type: 'glossary-mismatch',
          canonical: pair.canonical,
          variant: pair.variant,
          turnId: event.id,
          emittedAtMs: at,
        })
      }
    },

    onMeetingEnded(): void {
      lastPastContextAt = -Infinity
      emittedThisMinute = []
      clusterEmittedAt.clear()
      canonicalEmittedAt.clear()
    },
  }
}
