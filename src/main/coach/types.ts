export type CoachEvent =
  | {
      type: 'past-context'
      clusterId: string
      clusterTitle: string
      snippet: string
      turnId: string
      emittedAtMs: number
    }
  | {
      type: 'glossary-mismatch'
      canonical: string
      variant: string
      turnId: string
      emittedAtMs: number
    }
