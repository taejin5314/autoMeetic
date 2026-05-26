import type { GlossaryEntry } from './types'

export interface MatchSegment {
  kind: 'text' | 'match'
  value: string
  entryId?: string
}

export interface GlossaryMatcher {
  patterns: { regex: RegExp; entryId: string; canonical: string }[]
}

const HANGUL_RE = /[가-힣]/

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizedLen(s: string): number {
  return s.toLowerCase().replace(/[\s\-_/.]/g, '').length
}

export function buildMatcher(entries: GlossaryEntry[]): GlossaryMatcher {
  const patterns: GlossaryMatcher['patterns'] = []
  for (const entry of entries) {
    if (normalizedLen(entry.sourceTerm) <= 2) continue
    const forms = [entry.sourceTerm, ...entry.variants].filter((f) => f.length > 0)
    if (forms.length === 0) continue
    const alternation = forms.map(escapeRegex).join('|')
    const usesHangul = forms.some((f) => HANGUL_RE.test(f))
    const regex = usesHangul
      ? new RegExp(`(?<![\\uAC00-\\uD7AF\\w])(${alternation})`, 'g')
      : new RegExp(`\\b(${alternation})\\b`, 'gi')
    patterns.push({ regex, entryId: entry.id, canonical: entry.sourceTerm })
  }
  return { patterns }
}

export function applyHighlights(text: string, matcher: GlossaryMatcher): MatchSegment[] {
  if (matcher.patterns.length === 0 || text.length === 0) {
    return [{ kind: 'text', value: text }]
  }

  type Interval = { start: number; end: number; entryId: string; value: string }
  const intervals: Interval[] = []
  for (const p of matcher.patterns) {
    p.regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = p.regex.exec(text)) !== null) {
      intervals.push({
        start: m.index,
        end: m.index + m[0].length,
        entryId: p.entryId,
        value: m[0],
      })
      if (m[0].length === 0) p.regex.lastIndex++
    }
  }

  intervals.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))

  const accepted: Interval[] = []
  for (const iv of intervals) {
    const last = accepted[accepted.length - 1]
    if (!last || iv.start >= last.end) accepted.push(iv)
  }

  const out: MatchSegment[] = []
  let cursor = 0
  for (const iv of accepted) {
    if (iv.start > cursor) out.push({ kind: 'text', value: text.slice(cursor, iv.start) })
    out.push({ kind: 'match', value: iv.value, entryId: iv.entryId })
    cursor = iv.end
  }
  if (cursor < text.length) out.push({ kind: 'text', value: text.slice(cursor) })
  return out
}
