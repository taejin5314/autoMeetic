import type { VariantCandidate } from '../memory/types'

const STRIP_RE = /[\s\-_/.]/g

export function normalize(text: string): string {
  return text.toLowerCase().replace(STRIP_RE, '')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

export function isVariantMatch(candidate: string, canonical: string, maxDistance = 2): boolean {
  const nc = normalize(candidate)
  const nn = normalize(canonical)
  if (nc.length < 3 || nn.length < 3) return false
  if (Math.abs(nc.length - nn.length) > maxDistance) return false
  if (nc[0] !== nn[0]) return false
  return levenshtein(nc, nn) <= maxDistance
}

interface FindOptions {
  topN?: number
  ngramMax?: number
}

export function findVariantCandidates(
  canonical: string,
  segments: { id: string; sourceText: string }[],
  options: FindOptions = {}
): VariantCandidate[] {
  const topN = options.topN ?? 10
  const ngramMax = options.ngramMax ?? 4
  const canonicalText = canonical.trim().toLowerCase()
  const counts = new Map<
    string,
    { frequency: number; exampleSegmentId: string; exampleText: string }
  >()

  for (const seg of segments) {
    const tokens = seg.sourceText.split(/\s+/).filter((t) => t.length > 0)
    for (let n = 1; n <= ngramMax; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const ngram = tokens.slice(i, i + n).join(' ')
        if (ngram.trim().toLowerCase() === canonicalText) continue
        if (!isVariantMatch(ngram, canonical)) continue
        const key = ngram.toLowerCase()
        const existing = counts.get(key)
        if (existing) {
          existing.frequency++
        } else {
          counts.set(key, {
            frequency: 1,
            exampleSegmentId: seg.id,
            exampleText: seg.sourceText,
          })
        }
      }
    }
  }

  return Array.from(counts.entries())
    .map(([candidate, data]) => ({ candidate, ...data }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, topN)
}
