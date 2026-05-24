import type { ChatSource } from './types'

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'cite'; source: ChatSource; marker: number }

export function parseAnswerWithCitations(content: string, sources: ChatSource[]): ChatPart[] {
  const markerRe = /\[\^(\d+)\]/g
  const parts: ChatPart[] = []
  let lastIdx = 0
  let match: RegExpExecArray | null

  while ((match = markerRe.exec(content)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: 'text', text: content.slice(lastIdx, match.index) })
    }
    const marker = Number.parseInt(match[1], 10)
    const source = sources.find((s) => s.marker === marker)
    if (source) {
      parts.push({ type: 'cite', source, marker })
    } else {
      parts.push({ type: 'text', text: match[0] })
    }
    lastIdx = match.index + match[0].length
  }

  if (lastIdx < content.length) {
    parts.push({ type: 'text', text: content.slice(lastIdx) })
  }
  return parts
}
