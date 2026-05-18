import type { Segment } from '../types'

export const SUMMARY_PROMPT_VERSION = 'v1'

export const SYSTEM_PROMPT = [
  'You are a meeting analyst. Read the transcript and respond only with JSON in Korean.',
  '',
  '{',
  '  "shortSummary": "1-2 sentences",',
  '  "detailedSummary": "markdown bullets, 3-7 items",',
  '  "keyPoints": ["3-5 key decisions or facts"],',
  '  "actionItems": [{"text": "...", "owner": "Speaker A | unspecified", "due": "optional"}]',
  '}',
  '',
  'Rules:',
  '- Use only facts present in the transcript.',
  '- If the owner is unclear, use "unspecified".',
  '- Output JSON only. No code fences, labels, or explanation.',
].join('\n')

function formatTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function buildTranscriptUserPrompt(meetingStartedAt: number, segments: Segment[]): string {
  if (segments.length === 0) return '(transcript empty)'
  const anchor = segments[0].createdAt
  const lines = segments.map((s) => {
    const offset = formatTimestamp(s.createdAt - anchor)
    const speaker = s.speakerLabel ?? 'Unknown'
    return `[${offset}] ${speaker}: ${s.sourceText}`
  })
  void meetingStartedAt
  return lines.join('\n')
}

export function buildReduceUserPrompt(chunkSummariesJson: string[]): string {
  const joined = chunkSummariesJson.map((s, i) => `Chunk ${i + 1}:\n${s}`).join('\n\n')
  return [
    'The following JSON objects summarize time chunks from one meeting.',
    'Merge them into one final JSON object using the same schema. Korean language, JSON only.',
    '',
    joined,
  ].join('\n')
}
