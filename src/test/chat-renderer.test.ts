import { describe, expect, it } from 'vitest'
import { parseAnswerWithCitations } from '../renderer/ask/parseAnswerWithCitations'
import { applyChatEventToMessages } from '../renderer/ask/useChatStore'
import type { ChatMessage, ChatSource } from '../renderer/ask/types'

function source(marker: number): ChatSource {
  return {
    marker,
    kind: 'segment',
    meetingId: 'm1',
    meetingTitle: 'Planning',
    segmentId: `s${marker}`,
    segmentText: `source ${marker}`,
    timestampMs: 1000,
    meetingStartedAt: 1_700_000_000_000,
    score: 0.9,
  }
}

describe('parseAnswerWithCitations', () => {
  it('splits known citation markers into cite parts', () => {
    const parts = parseAnswerWithCitations('Decision came from here [^2].', [
      source(1),
      source(2),
    ])

    expect(parts).toEqual([
      { type: 'text', text: 'Decision came from here ' },
      { type: 'cite', marker: 2, source: source(2) },
      { type: 'text', text: '.' },
    ])
  })

  it('leaves unknown citation markers as text', () => {
    const parts = parseAnswerWithCitations('Unknown [^9] stays.', [source(1)])
    expect(parts).toEqual([{ type: 'text', text: 'Unknown ' }, { type: 'text', text: '[^9]' }, { type: 'text', text: ' stays.' }])
  })
})

describe('applyChatEventToMessages', () => {
  const assistant: ChatMessage = {
    id: 'assistant_1',
    role: 'assistant',
    content: '',
    createdAt: 1,
  }

  it('appends delta content to the streaming assistant message', () => {
    const out = applyChatEventToMessages([assistant], 'assistant_1', {
      type: 'delta',
      content: 'hello',
    })

    expect(out[0].content).toBe('hello')
  })

  it('attaches retrieved sources and replaces content on done', () => {
    const sources = [source(1)]
    const withSources = applyChatEventToMessages([assistant], 'assistant_1', {
      type: 'retrieved',
      sources,
    })
    const done = applyChatEventToMessages(withSources, 'assistant_1', {
      type: 'done',
      content: 'final',
      sources,
    })

    expect(done[0].sources).toEqual(sources)
    expect(done[0].content).toBe('final')
  })

  it('records no-context and error terminal states', () => {
    const noContext = applyChatEventToMessages([assistant], 'assistant_1', {
      type: 'no_context',
    })
    const errored = applyChatEventToMessages([assistant], 'assistant_1', {
      type: 'error',
      message: 'network down',
    })

    expect(noContext[0].content).toBe('No relevant meetings found.')
    expect(errored[0].error).toBe('network down')
  })
})
