import type { MemoryRepository } from './repository'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function formatOffset(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`
}

export function exportMeetingMarkdown(repo: MemoryRepository, meetingId: string): string | null {
  const meeting = repo.getMeeting(meetingId)
  if (!meeting) return null
  const summary = repo.getSummary(meetingId)
  const segments = repo.getSegments(meetingId)

  const lines: string[] = []
  lines.push(`# ${meeting.title}`)
  lines.push('')
  const dur = meeting.durationMs ? `${Math.round(meeting.durationMs / 60000)} min` : 'live'
  lines.push(`*${new Date(meeting.startedAt).toISOString()} - ${dur}*`)
  lines.push('')

  if (summary && summary.status === 'ok') {
    lines.push('## Summary')
    lines.push(summary.shortSummary)
    lines.push('')
    if (summary.detailedSummary.trim()) {
      lines.push('## Details')
      lines.push(summary.detailedSummary)
      lines.push('')
    }
    if (summary.keyPoints.length > 0) {
      lines.push('## Key Points')
      for (const k of summary.keyPoints) lines.push(`- ${k}`)
      lines.push('')
    }
    if (summary.actionItems.length > 0) {
      lines.push('## Action Items')
      for (const a of summary.actionItems) {
        const owner = a.owner ? ` - ${a.owner}` : ''
        const due = a.due ? ` (${a.due})` : ''
        lines.push(`- [ ] ${a.text}${owner}${due}`)
      }
      lines.push('')
    }
  }

  lines.push('## Transcript')
  const anchor = segments[0]?.createdAt ?? meeting.startedAt
  for (const s of segments) {
    const offset = formatOffset(s.createdAt - anchor)
    const speaker = s.speakerLabel && s.speakerLabel !== 'Unknown' ? `**${s.speakerLabel}**: ` : ''
    lines.push(`[${offset}] ${speaker}${s.sourceText}`)
    if (s.translatedText) lines.push(`  -> ${s.translatedText}`)
  }
  lines.push('')
  return lines.join('\n')
}
