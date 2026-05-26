import type { SubagentResult } from './types'

export interface NumberedCitation {
  marker: number
  meetingId: string
  segmentId: string
  quote: string
}

export interface MergedCitations {
  numbered: NumberedCitation[]
  subagentToMarkers: Record<number, number[]>
}

export function mergeCitations(results: SubagentResult[]): MergedCitations {
  const numbered: NumberedCitation[] = []
  const bySegmentId = new Map<string, number>()
  const subagentToMarkers: Record<number, number[]> = {}

  for (const r of results) {
    subagentToMarkers[r.idx] = []
    for (const ev of r.evidence) {
      let marker = bySegmentId.get(ev.segmentId)
      if (marker === undefined) {
        marker = numbered.length + 1
        bySegmentId.set(ev.segmentId, marker)
        numbered.push({ marker, ...ev })
      }
      subagentToMarkers[r.idx].push(marker)
    }
  }
  return { numbered, subagentToMarkers }
}
