import { describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'
import { exportMeetingMarkdown } from '../main/memory/markdownExporter'
import type { Meeting, Segment, Summary } from '../main/memory/types'

function setup(includeSummary: boolean): MemoryRepository {
  const repo = new MemoryRepository(':memory:')
  const m: Meeting = {
    id: 'mtg_1',
    title: 'Meeting 05-17 14:30',
    startedAt: 0,
    endedAt: 60_000,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    status: 'completed',
    segmentCount: 0,
    durationMs: 60_000,
  }
  repo.insertMeeting(m)
  const segs: Segment[] = [
    {
      id: 's1',
      meetingId: 'mtg_1',
      seq: 0,
      createdAt: 0,
      speakerId: null,
      speakerLabel: 'Speaker A',
      sourceText: 'hello',
      translatedText: 'hello translated',
      sourceLanguage: 'en',
    },
    {
      id: 's2',
      meetingId: 'mtg_1',
      seq: 1,
      createdAt: 5_000,
      speakerId: null,
      speakerLabel: 'Speaker B',
      sourceText: 'world',
      translatedText: null,
      sourceLanguage: 'en',
    },
  ]
  for (const s of segs) repo.insertSegment(s)
  if (includeSummary) {
    const sum: Summary = {
      meetingId: 'mtg_1',
      shortSummary: 'short summary',
      detailedSummary: '- a\n- b',
      keyPoints: ['k1', 'k2'],
      actionItems: [{ text: 'do it', owner: 'Speaker A' }],
      generatedAt: 1,
      model: 'gpt-4o-mini',
      promptVersion: 'v1',
      status: 'ok',
    }
    repo.upsertSummary(sum)
  }
  return repo
}

describe('exportMeetingMarkdown', () => {
  it('renders title, summary sections, and transcript with timestamps and translations', () => {
    const repo = setup(true)
    const md = exportMeetingMarkdown(repo, 'mtg_1')!
    expect(md).toMatch(/^# Meeting 05-17 14:30/)
    expect(md).toContain('## Summary')
    expect(md).toContain('short summary')
    expect(md).toContain('## Details')
    expect(md).toContain('## Key Points')
    expect(md).toContain('- k1')
    expect(md).toContain('## Action Items')
    expect(md).toContain('- [ ] do it - Speaker A')
    expect(md).toContain('## Transcript')
    expect(md).toContain('[00:00:00] **Speaker A**: hello')
    expect(md).toContain('  -> hello translated')
    expect(md).toContain('[00:00:05] **Speaker B**: world')
    repo.close()
  })

  it('omits summary sections when no summary exists', () => {
    const repo = setup(false)
    const md = exportMeetingMarkdown(repo, 'mtg_1')!
    expect(md).not.toContain('## Summary')
    expect(md).toContain('## Transcript')
    repo.close()
  })

  it('returns null for an unknown meeting id', () => {
    const repo = new MemoryRepository(':memory:')
    expect(exportMeetingMarkdown(repo, 'missing')).toBeNull()
    repo.close()
  })
})
