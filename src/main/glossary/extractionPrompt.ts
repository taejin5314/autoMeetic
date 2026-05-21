import type { GlossarySuggestionInput } from '../memory/types'

interface BuildPromptArgs {
  targetLang: string
  existingTerms: string[]
  dismissedTerms: string[]
}

const MAX_TERMS = 200

export function buildExtractionSystemPrompt(args: BuildPromptArgs): string {
  const existing = args.existingTerms.slice(0, MAX_TERMS)
  const dismissed = args.dismissedTerms.slice(0, MAX_TERMS)
  const existingBlock = existing.length === 0 ? '(empty)' : existing.join(', ')
  const dismissedBlock = dismissed.length === 0 ? '(empty)' : dismissed.join(', ')
  return `You are a glossary extractor for meeting transcripts. Find recurring proper
nouns, brand names, code symbols, and technical terms that appear
inconsistently rendered - these are candidates for the user's glossary.

DO suggest:
- Person/company/product names mentioned multiple times
- Code identifiers, API/framework names, technical acronyms (when domain-specific)
- Foreign-origin terms used as proper nouns (e.g., romanized names like "kunchen")

DO NOT suggest:
- Common nouns (meeting, project, data, report)
- Numbers, dates, times, file paths
- Words mentioned only once unless declared explicitly as a project codename
- Terms already in the user's existing glossary (provided below)
- Terms the user previously dismissed (provided below)

Strongest signal: a term rendered DIFFERENTLY across occurrences in the
transcript (e.g., "kunchen", "Kun Chen", "쿤천" - same person).

Active target language: ${args.targetLang}
Existing glossary terms (case-insensitive - do NOT re-suggest):
${existingBlock}
Previously dismissed terms (do NOT re-suggest):
${dismissedBlock}

Output JSON only. Schema:
{
  "candidates": [
    {
      "sourceTerm": string,
      "variants": string[],
      "translations": object,
      "preserve": boolean,
      "confidence": number,
      "reason": string,
      "frequency": integer
    }
  ]
}

Rules:
- Pick ONE canonical sourceTerm form. List other forms in "variants".
- If targetLang is "off" or empty, leave translations as {}.
- Only propose preserve=true when the term is a code symbol, acronym, or brand name.
- confidence < 0.5 -> exclude from output.
- Return at most 10 candidates, ordered by confidence DESC.
- Output JSON only. No code fences, labels, or explanation.`
}

type RawCandidate = {
  sourceTerm?: unknown
  variants?: unknown
  translations?: unknown
  preserve?: unknown
  confidence?: unknown
  reason?: unknown
  frequency?: unknown
}

export function parseExtractionResponse(
  raw: string
): Array<Omit<GlossarySuggestionInput, 'meetingId' | 'id'>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const candidates = (parsed as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates)) return []

  const out: Array<Omit<GlossarySuggestionInput, 'meetingId' | 'id'>> = []
  for (const rawCandidate of candidates as RawCandidate[]) {
    if (!rawCandidate || typeof rawCandidate !== 'object') continue
    const sourceTerm =
      typeof rawCandidate.sourceTerm === 'string' ? rawCandidate.sourceTerm.trim() : ''
    if (!sourceTerm || sourceTerm.length > 100) continue
    const preserve = rawCandidate.preserve === true
    const confidence =
      typeof rawCandidate.confidence === 'number' ? rawCandidate.confidence : Number.NaN
    if (!Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) continue
    const frequency =
      typeof rawCandidate.frequency === 'number' &&
      Number.isFinite(rawCandidate.frequency) &&
      rawCandidate.frequency > 0
        ? Math.floor(rawCandidate.frequency)
        : null
    const reasonRaw = typeof rawCandidate.reason === 'string' ? rawCandidate.reason : ''
    const reason = reasonRaw.length === 0 ? null : reasonRaw.slice(0, 200)
    const variants = Array.isArray(rawCandidate.variants)
      ? Array.from(
          new Set(
            (rawCandidate.variants as unknown[])
              .map((v) => (typeof v === 'string' ? v.trim() : ''))
              .filter(
                (v) =>
                  v.length > 0 &&
                  v.length <= 100 &&
                  v.toLowerCase() !== sourceTerm.toLowerCase()
              )
          )
        )
      : []
    const translationsRaw =
      rawCandidate.translations && typeof rawCandidate.translations === 'object'
        ? rawCandidate.translations
        : {}
    const translations: Record<string, string> = {}
    for (const [k, v] of Object.entries(translationsRaw as Record<string, unknown>)) {
      if (typeof k !== 'string' || k.length === 0 || k.length > 20) continue
      if (typeof v !== 'string' || v.length === 0 || v.length > 100) continue
      translations[k] = v
    }
    out.push({
      sourceTerm,
      variants,
      translations,
      preserve,
      confidence,
      reason,
      frequency,
    })
  }
  return out
}
