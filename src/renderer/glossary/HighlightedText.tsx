import { Fragment, useMemo } from 'react'
import { GlossaryMark } from './GlossaryMark'
import { applyHighlights, buildMatcher } from './glossaryMatcher'
import type { GlossaryEntry } from './types'

interface Props {
  text: string
  entries: GlossaryEntry[]
  enabled: boolean
}

export function HighlightedText({ text, entries, enabled }: Props) {
  const matcher = useMemo(() => (enabled ? buildMatcher(entries) : null), [entries, enabled])
  const parts = useMemo(() => (matcher ? applyHighlights(text, matcher) : null), [text, matcher])
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])

  if (!matcher || !parts) return <>{text}</>

  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'text') return <Fragment key={i}>{part.value}</Fragment>
        const entry = entryById.get(part.entryId!)
        if (!entry) return <Fragment key={i}>{part.value}</Fragment>
        return (
          <GlossaryMark key={i} entry={entry}>
            {part.value}
          </GlossaryMark>
        )
      })}
    </>
  )
}
