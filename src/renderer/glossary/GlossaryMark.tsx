import i18n from '../i18n'
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
    i18n.t('glossary.mark.myGlossary'),
    entry.sourceTerm,
    translationLine || null,
    entry.preserve ? i18n.t('glossary.mark.preserve') : null,
  ]
    .filter((line) => line)
    .join('\n')
  return (
    <span className="glossary-mark" title={tooltip}>
      {children}
    </span>
  )
}
