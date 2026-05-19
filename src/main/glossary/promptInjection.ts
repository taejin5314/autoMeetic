import type { GlossaryEntry } from '../memory/types'

export const LANGUAGE_NAME_BY_CODE: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function formatGlossaryPromptSection(
  entries: GlossaryEntry[],
  targetLang: string | null
): string {
  if (entries.length === 0) return ''
  const verbatim: string[] = []
  const mapped: Array<[string, string]> = []

  for (const e of entries) {
    if (targetLang && e.translations[targetLang]) {
      mapped.push([e.sourceTerm, e.translations[targetLang]])
      continue
    }
    if (e.preserve) verbatim.push(e.sourceTerm)
  }

  if (verbatim.length === 0 && mapped.length === 0) return ''

  const lines: string[] = ['GLOSSARY (apply strictly, do not paraphrase):']
  if (verbatim.length) {
    lines.push(`- Keep verbatim in all output: ${verbatim.map(quote).join(', ')}`)
  }
  if (mapped.length) {
    const langName = LANGUAGE_NAME_BY_CODE[targetLang!] ?? targetLang
    lines.push(`- When producing ${langName}, render:`)
    for (const [src, dst] of mapped) lines.push(`  · ${quote(src)} → ${quote(dst)}`)
  }
  return lines.join('\n')
}

export function normalizePreserveTerms(
  output: string,
  entries: GlossaryEntry[]
): string {
  if (entries.length === 0) return output
  let result = output
  for (const e of entries) {
    if (!e.preserve) continue
    const re = new RegExp(`\\b${escapeRegex(e.sourceTerm)}\\b`, 'gi')
    result = result.replace(re, e.sourceTerm)
  }
  return result
}

export function buildLabelLanguageBlock(langCode: string): string {
  const name = LANGUAGE_NAME_BY_CODE[langCode] ?? langCode
  return `LABEL LANGUAGE:
- Output ALL shape labels, text titles, and arrow labels in ${name}.
- Translate concepts from the transcript into ${name} for the diagram, even if the speaker used a different language.
- Glossary terms marked verbatim must NEVER be translated — copy them as-is.`
}
