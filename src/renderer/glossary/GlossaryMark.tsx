import type { GlossaryEntry } from './types'

interface Props {
  entry: GlossaryEntry
  children: string
}

export function GlossaryMark({ entry, children }: Props) {
  const translationLine = Object.entries(entry.translations)
    .map(([lang, value]) => `${lang}: ${value}`)
    .join(' · ')
  const tooltip = [
    '내 glossary',
    entry.sourceTerm,
    translationLine || null,
    entry.preserve ? '보존 (preserve)' : null,
  ]
    .filter((line) => line)
    .join('\n')
  return (
    <span className="glossary-mark" title={tooltip}>
      {children}
    </span>
  )
}
