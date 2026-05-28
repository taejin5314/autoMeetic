import { describe, expect, it, vi } from 'vitest'
import { makeWhiteboardSubscriber } from '../main/pipeline/subscribers/whiteboardSubscriber'
import { makeActionItemsSubscriber } from '../main/pipeline/subscribers/actionItemsSubscriber'
import { makeMemorySubscriber } from '../main/pipeline/subscribers/memorySubscriber'
import type { FinalizedTurn } from '../main/pipeline/types'

const turn: FinalizedTurn = {
  id: 't1', text: 'hello world', sourceLanguage: 'en', targetLanguage: 'ko',
  createdAtMs: 1, speakerId: 'unknown', speakerLabel: 'Unknown',
}

describe('whiteboardSubscriber', () => {
  it('enqueues "speakerLabel: text" on turn-finalized', () => {
    const enqueue = vi.fn()
    const s = makeWhiteboardSubscriber(enqueue)
    s.onEvent({ type: 'turn-finalized', turn })
    expect(enqueue).toHaveBeenCalledWith('Unknown: hello world')
  })
  it('ignores other events', () => {
    const enqueue = vi.fn()
    const s = makeWhiteboardSubscriber(enqueue)
    s.onEvent({ type: 'translation-updated', id: 't1', translation: 'x' })
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('actionItemsSubscriber', () => {
  it('enqueues "speakerLabel: text" on turn-finalized', () => {
    const enqueue = vi.fn()
    const s = makeActionItemsSubscriber(enqueue)
    s.onEvent({ type: 'turn-finalized', turn })
    expect(enqueue).toHaveBeenCalledWith('Unknown: hello world')
  })
})

describe('memorySubscriber', () => {
  it('persists on turn-finalized, updates translation, updates source text', () => {
    const deps = {
      notifyTurnFinalized: vi.fn(),
      notifyTranslation: vi.fn(),
      notifySourceTextUpdate: vi.fn(),
    }
    const s = makeMemorySubscriber(deps)
    s.onEvent({ type: 'turn-finalized', turn })
    expect(deps.notifyTurnFinalized).toHaveBeenCalledWith({
      id: 't1', text: 'hello world', sourceLanguage: 'en', targetLanguage: 'ko',
      createdAtMs: 1, speakerId: 'unknown', speakerLabel: 'Unknown',
    })
    s.onEvent({ type: 'translation-updated', id: 't1', translation: '안녕' })
    expect(deps.notifyTranslation).toHaveBeenCalledWith('t1', '안녕')
    s.onEvent({ type: 'turn-source-updated', id: 't1', text: 'hello world?' })
    expect(deps.notifySourceTextUpdate).toHaveBeenCalledWith('t1', 'hello world?')
  })
})
