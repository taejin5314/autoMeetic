import { describe, expect, it } from 'vitest'
import {
  findVariantCandidates,
  isVariantMatch,
  levenshtein,
  normalize,
} from '../main/glossary/variantFinder'

describe('normalize', () => {
  it('lowercases and strips whitespace + hyphens + underscores + dots + slashes', () => {
    expect(normalize('Real-Time Orchestrator')).toBe('realtimeorchestrator')
    expect(normalize('  REALTIME_ORCHESTRATOR  ')).toBe('realtimeorchestrator')
    expect(normalize('A.B/C')).toBe('abc')
  })
})

describe('levenshtein', () => {
  it('returns edit distance', () => {
    expect(levenshtein('abc', 'abc')).toBe(0)
    expect(levenshtein('abc', 'abcd')).toBe(1)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })
})

describe('isVariantMatch', () => {
  it('returns true for normalized exact match', () => {
    expect(isVariantMatch('Real Time Orchestrator', 'RealtimeOrchestrator')).toBe(true)
  })
  it('returns true within edit distance 2', () => {
    expect(isVariantMatch('Realtim Orchestratr', 'RealtimeOrchestrator')).toBe(true)
  })
  it('returns false beyond edit distance 2', () => {
    expect(isVariantMatch('Real Time Architect', 'RealtimeOrchestrator')).toBe(false)
  })
  it('returns false when first character differs', () => {
    expect(isVariantMatch('XealtimeOrchestrator', 'RealtimeOrchestrator')).toBe(false)
  })
  it('returns false when length difference exceeds 2', () => {
    expect(isVariantMatch('Realtime', 'RealtimeOrchestrator')).toBe(false)
  })
  it('returns false for terms shorter than 3 normalized chars', () => {
    expect(isVariantMatch('AI', 'AI')).toBe(false)
    expect(isVariantMatch('ab', 'ac')).toBe(false)
  })
})

describe('findVariantCandidates', () => {
  it('finds and counts variants in segments, excluding exact canonical matches', () => {
    const segments = [
      { id: 's1', sourceText: 'the realtime orchestrator handles things' },
      { id: 's2', sourceText: 'and the real time orchestrator pivots' },
      { id: 's3', sourceText: 'RealtimeOrchestrator throws when overloaded' },
      { id: 's4', sourceText: 'totally unrelated content here' },
    ]
    const results = findVariantCandidates('RealtimeOrchestrator', segments)
    const candidates = results.map((r) => r.candidate.toLowerCase())
    expect(candidates).toContain('realtime orchestrator')
    expect(candidates).toContain('real time orchestrator')
    // Exact canonical match (s3) should NOT appear as a variant
    expect(candidates).not.toContain('realtimeorchestrator')
  })

  it('returns candidates sorted by frequency desc', () => {
    const segments = [
      { id: 's1', sourceText: 'real time orchestrator one' },
      { id: 's2', sourceText: 'real time orchestrator two' },
      { id: 's3', sourceText: 'realtime orchestrator three' },
    ]
    const results = findVariantCandidates('RealtimeOrchestrator', segments)
    expect(results[0].candidate.toLowerCase()).toBe('real time orchestrator')
    expect(results[0].frequency).toBe(2)
  })

  it('caps results at topN (default 10)', () => {
    const segments = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`,
      sourceText: `unique${i.toString().padStart(2, '0')} variation`,
    }))
    const results = findVariantCandidates('unique00', segments, { topN: 5 })
    expect(results.length).toBeLessThanOrEqual(5)
  })
})
