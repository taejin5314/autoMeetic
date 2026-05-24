import type { ChatSource } from '../types'

const RULES = `Rules:
- Use ONLY information from the SOURCES above. Do not speculate or use
  outside knowledge.
- Every factual claim must be backed by a citation [^N] pointing to a
  source in the list above.
- If the SOURCES don't contain enough information to answer, say so
  explicitly. Do not fabricate facts, meeting titles, dates, or speakers.
- Be concise. 1-4 short paragraphs max.
- Answer in the language of the user's question.
- A direct quotation is encouraged when it sharpens the answer - keep
  quotations short (1-2 sentences) and always cite.
- Do not invent citation numbers beyond what is listed.
- Output plain prose. Do not use markdown formatting.`

function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatSourcesBlock(sources: ChatSource[]): string {
  return sources
    .map((s) => {
      const ts = formatMmSs(s.timestampMs)
      const kind = s.kind === 'meeting-summary' ? ' [summary]' : ''
      const date = formatDate(s.meetingStartedAt)
      return `[${s.marker}] Meeting "${s.meetingTitle}" (${date}, ${ts})${kind}:\n    "${s.segmentText}"`
    })
    .join('\n')
}

interface BuildArgs {
  sources: ChatSource[]
  glossaryBlock: string
}

export function buildChatSystemPrompt(args: BuildArgs): string {
  const sources = formatSourcesBlock(args.sources)
  const glossaryTail = args.glossaryBlock ? `\n\n${args.glossaryBlock}` : ''
  return `You are a meeting knowledge assistant for autoMeetic. The user is asking
about their past meetings. Answer using ONLY the SOURCES below.

SOURCES (cite by [^N] when referencing):
${sources}

${RULES}${glossaryTail}`
}

export function enforceContextBudget(sources: ChatSource[], maxChars: number): ChatSource[] {
  let total = 0
  const out: ChatSource[] = []
  for (const s of sources) {
    const cost = s.segmentText.length + 80
    if (total + cost > maxChars) break
    out.push(s)
    total += cost
  }
  return out
}

export function stripCitations(text: string): string {
  return text.replace(/\[\^\d+\]/g, '').replace(/[ \t]{2,}/g, ' ').trim()
}
