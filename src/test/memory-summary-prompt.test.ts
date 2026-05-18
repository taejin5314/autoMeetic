import { describe, expect, it } from 'vitest'
import {
  SUMMARY_PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildReduceUserPrompt,
  buildTranscriptUserPrompt,
} from '../main/memory/prompts/summary.v1'
import type { Segment } from '../main/memory/types'

function seg(id: string, sec: number, speaker: string, text: string): Segment {
  return {
    id,
    meetingId: 'm',
    seq: 0,
    createdAt: sec * 1000,
    speakerId: 'speaker_a',
    speakerLabel: speaker,
    sourceText: text,
    translatedText: null,
    sourceLanguage: 'en',
  }
}

describe('summary prompt v1', () => {
  it('version is v1', () => {
    expect(SUMMARY_PROMPT_VERSION).toBe('v1')
  })

  it('system prompt mentions JSON-only output and Korean language', () => {
    expect(SYSTEM_PROMPT).toMatch(/JSON/i)
    expect(SYSTEM_PROMPT).toMatch(/Korean/i)
    expect(SYSTEM_PROMPT).toMatch(/shortSummary/)
    expect(SYSTEM_PROMPT).toMatch(/detailedSummary/)
    expect(SYSTEM_PROMPT).toMatch(/keyPoints/)
    expect(SYSTEM_PROMPT).toMatch(/actionItems/)
  })

  it('builds [hh:mm:ss] speaker: text lines starting at first segment', () => {
    const out = buildTranscriptUserPrompt(0, [
      seg('a', 83, 'Speaker A', 'hello'),
      seg('b', 90, 'Speaker B', 'world'),
    ])
    expect(out).toContain('[00:00:00] Speaker A: hello')
    expect(out).toContain('[00:00:07] Speaker B: world')
  })

  it('reduce prompt embeds chunk summaries verbatim', () => {
    const out = buildReduceUserPrompt(['{"shortSummary":"a"}', '{"shortSummary":"b"}'])
    expect(out).toContain('{"shortSummary":"a"}')
    expect(out).toContain('{"shortSummary":"b"}')
    expect(out).toMatch(/merge/i)
  })
})
