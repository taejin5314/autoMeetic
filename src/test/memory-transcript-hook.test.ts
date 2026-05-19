import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachTranscriptHook,
  detachTranscriptHook,
  notifyTranslation,
  notifyTurnFinalized,
} from '../main/memory/transcriptHook'

describe('transcriptHook (default state)', () => {
  beforeEach(() => detachTranscriptHook())

  it('notifyTurnFinalized is a silent no-op when not attached', () => {
    expect(() =>
      notifyTurnFinalized({
        id: 'turn_1',
        text: 'hi',
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        createdAtMs: 0,
        speakerId: 'unknown',
        speakerLabel: 'Unknown',
      })
    ).not.toThrow()
  })

  it('notifyTranslation is a silent no-op when not attached', () => {
    expect(() => notifyTranslation('turn_1', 'translated')).not.toThrow()
  })
})

describe('transcriptHook (attached)', () => {
  beforeEach(() => detachTranscriptHook())

  it('on turn finalized: inserts segment, increments count, enqueues for embedding', () => {
    const repo = {
      insertSegment: vi.fn(),
      incrementSegmentCount: vi.fn(),
      nextSeq: vi.fn(() => 7),
      updateTranslation: vi.fn(),
    }
    const queue = { enqueue: vi.fn() }
    attachTranscriptHook(repo as never, queue as never, () => 'mtg_x')
    notifyTurnFinalized({
      id: 'turn_1',
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      createdAtMs: 1234,
      speakerId: 'speaker_a',
      speakerLabel: 'Speaker A',
    })
    expect(repo.insertSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'turn_1',
        meetingId: 'mtg_x',
        seq: 7,
        sourceText: 'hello',
        speakerLabel: 'Speaker A',
      })
    )
    expect(repo.incrementSegmentCount).toHaveBeenCalledWith('mtg_x')
    expect(queue.enqueue).toHaveBeenCalledWith({ segmentId: 'turn_1', text: 'hello' })
  })

  it('on turn finalized without active meeting: no DB writes', () => {
    const repo = {
      insertSegment: vi.fn(),
      incrementSegmentCount: vi.fn(),
      nextSeq: vi.fn(() => 0),
      updateTranslation: vi.fn(),
    }
    const queue = { enqueue: vi.fn() }
    attachTranscriptHook(repo as never, queue as never, () => null)
    notifyTurnFinalized({
      id: 'turn_1',
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      createdAtMs: 0,
      speakerId: 'unknown',
      speakerLabel: 'Unknown',
    })
    expect(repo.insertSegment).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('notifyTranslation routes to repo.updateTranslation', () => {
    const repo = {
      insertSegment: vi.fn(),
      incrementSegmentCount: vi.fn(),
      nextSeq: vi.fn(() => 0),
      updateTranslation: vi.fn(),
    }
    const queue = { enqueue: vi.fn() }
    attachTranscriptHook(repo as never, queue as never, () => 'mtg_x')
    notifyTranslation('turn_1', 'translated')
    expect(repo.updateTranslation).toHaveBeenCalledWith('turn_1', 'translated')
  })

  it('after detach, notifies are no-ops again', () => {
    const repo = {
      insertSegment: vi.fn(),
      incrementSegmentCount: vi.fn(),
      nextSeq: vi.fn(() => 0),
      updateTranslation: vi.fn(),
    }
    const queue = { enqueue: vi.fn() }
    attachTranscriptHook(repo as never, queue as never, () => 'mtg_x')
    detachTranscriptHook()
    notifyTurnFinalized({
      id: 'turn_1',
      text: 'x',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      createdAtMs: 0,
      speakerId: 'unknown',
      speakerLabel: 'Unknown',
    })
    notifyTranslation('turn_1', 'y')
    expect(repo.insertSegment).not.toHaveBeenCalled()
    expect(repo.updateTranslation).not.toHaveBeenCalled()
  })
})
