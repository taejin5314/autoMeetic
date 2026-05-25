import { describe, expect, it } from 'vitest'
import { buildAskMindMapState } from '../main/whiteboard/askMindMap'
import type { ChatSource } from '../main/memory/types'
import {
  createMindMapFromAsk,
  getWhiteboardMode,
  getWhiteboardState,
  resetWhiteboard,
  setWhiteboardMode,
} from '../main/whiteboardService'

function source(marker: number, text = `Source detail ${marker}`): ChatSource {
  return {
    marker,
    kind: 'segment',
    meetingId: 'm1',
    meetingTitle: 'Planning',
    segmentId: `s${marker}`,
    segmentText: text,
    timestampMs: marker * 1000,
    meetingStartedAt: 1_700_000_000_000,
    score: 0.9,
  }
}

describe('buildAskMindMapState', () => {
  it('derives the root from the question', () => {
    const state = buildAskMindMapState({
      question: 'Summarize pricing launch decisions',
      answer: 'Pricing launch was delayed to Q3 [^1].',
      sources: [source(1, 'Team agreed to delay pricing launch to Q3.')],
    })

    expect(state.nodes[0]).toMatchObject({
      id: 'root',
      parentId: null,
      label: 'pricing launch decisions',
      depth: 0,
    })
  })

  it('creates first-level branches from cited answer sentences', () => {
    const state = buildAskMindMapState({
      question: 'What did we decide about pricing?',
      answer:
        'Pricing launch was delayed to Q3 [^1]. Marketing needs a migration note [^2].',
      sources: [
        source(1, 'Team agreed to delay pricing launch to Q3.'),
        source(2, 'Marketing asked for a migration note.'),
      ],
    })

    const branches = state.nodes.filter((n) => n.parentId === 'root')
    expect(branches.map((n) => n.label)).toEqual([
      'Pricing launch was delayed to Q3 [^1]',
      'Marketing needs a migration note [^2]',
    ])
  })

  it('attaches cited source snippets as supporting children', () => {
    const state = buildAskMindMapState({
      question: 'What did Sarah oppose?',
      answer: 'Sarah opposed the migration timeline [^2].',
      sources: [
        source(1, 'Unrelated source.'),
        source(2, 'Sarah said the migration timeline was too risky.'),
      ],
    })

    const branch = state.nodes.find((n) => n.label === 'Sarah opposed the migration timeline [^2]')!
    const children = state.nodes.filter((n) => n.parentId === branch.id)
    expect(children).toHaveLength(1)
    expect(children[0].label).toContain('Sarah said the migration timeline')
  })

  it('falls back to ordered sources when citations are absent', () => {
    const state = buildAskMindMapState({
      question: 'Summarize action themes',
      answer: 'The team focused on launch readiness.',
      sources: [source(1, 'Launch owner is Mina.'), source(2, 'QA needs two extra days.')],
    })

    const branch = state.nodes.find((n) => n.parentId === 'root')!
    const children = state.nodes.filter((n) => n.parentId === branch.id)
    expect(children.map((n) => n.label)).toEqual(['Launch owner is Mina.', 'QA needs two extra days.'])
  })

  it('enforces branch caps and label length', () => {
    const answer = Array.from(
      { length: 8 },
      (_, i) => `This is a very long cited conclusion for item ${i} that should be clamped to fit the mind map label limit cleanly [^1].`
    ).join(' ')
    const state = buildAskMindMapState({
      question: 'Summarize the long list',
      answer,
      sources: [source(1, 'Supporting detail.')],
    })

    const branches = state.nodes.filter((n) => n.parentId === 'root')
    expect(branches).toHaveLength(5)
    expect(state.nodes.every((n) => n.label.length <= 80)).toBe(true)
  })

  it('rejects empty answers and missing sources', () => {
    expect(() =>
      buildAskMindMapState({ question: 'Q', answer: ' ', sources: [source(1)] })
    ).toThrow('Ask answer is empty')
    expect(() =>
      buildAskMindMapState({ question: 'Q', answer: 'Answer', sources: [] })
    ).toThrow('Ask answer has no sources')
  })
})

describe('createMindMapFromAsk', () => {
  it('replaces the whiteboard with a fresh ask mind map and switches mode', () => {
    setWhiteboardMode('freeform')
    resetWhiteboard()

    const result = createMindMapFromAsk({
      question: 'Summarize pricing launch decisions',
      answer: 'Pricing launch was delayed to Q3 [^1].',
      sources: [source(1, 'Team agreed to delay pricing launch to Q3.')],
    })

    expect(result.nodeCount).toBeGreaterThan(1)
    expect(getWhiteboardMode()).toBe('mindmap')
    expect(getWhiteboardState().elements.length).toBeGreaterThan(0)
  })
})
