import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyOperations,
  clear,
  getState,
  init,
  serializeForPrompt,
} from '../main/whiteboard/mindmapState'
import type { GlossaryEntry } from '../main/memory/types'

beforeEach(() => clear())

describe('mindmapState.init', () => {
  it('creates a state with a single root node and meeting-title source', () => {
    init('My Meeting')
    const s = getState()!
    expect(s.nodes).toHaveLength(1)
    expect(s.nodes[0].id).toBe('root')
    expect(s.nodes[0].label).toBe('My Meeting')
    expect(s.nodes[0].parentId).toBeNull()
    expect(s.topicSource).toBe('meeting-title')
  })
})

describe('mindmapState.applyOperations - add_branch', () => {
  it('adds a first-level branch under root', () => {
    init('Meeting')
    applyOperations([{ type: 'add_branch', parentLabel: 'Meeting', label: 'Goals' }], [])
    const s = getState()!
    expect(s.nodes).toHaveLength(2)
    const branch = s.nodes.find((n) => n.label === 'Goals')!
    expect(branch.parentId).toBe('root')
    expect(branch.depth).toBe(1)
    expect(branch.id).toMatch(/^br_/)
  })

  it('adds a sub-branch under a first-level branch', () => {
    init('Meeting')
    applyOperations(
      [
        { type: 'add_branch', parentLabel: 'Meeting', label: 'Goals' },
        { type: 'add_branch', parentLabel: 'Goals', label: 'Reduce latency' },
      ],
      []
    )
    const s = getState()!
    const sub = s.nodes.find((n) => n.label === 'Reduce latency')!
    expect(sub.depth).toBe(2)
  })

  it('drops add_branch with unknown parentLabel', () => {
    init('Meeting')
    applyOperations(
      [{ type: 'add_branch', parentLabel: 'NonExistent', label: 'Child' }],
      []
    )
    expect(getState()!.nodes).toHaveLength(1)
  })

  it('drops add_branch that would create depth 3', () => {
    init('Meeting')
    applyOperations(
      [
        { type: 'add_branch', parentLabel: 'Meeting', label: 'L1' },
        { type: 'add_branch', parentLabel: 'L1', label: 'L2' },
        { type: 'add_branch', parentLabel: 'L2', label: 'L3 should drop' },
      ],
      []
    )
    expect(getState()!.nodes.find((n) => n.label === 'L3 should drop')).toBeUndefined()
  })

  it('drops duplicate label under same parent (case-insensitive)', () => {
    init('Meeting')
    applyOperations(
      [
        { type: 'add_branch', parentLabel: 'Meeting', label: 'Hiring' },
        { type: 'add_branch', parentLabel: 'Meeting', label: 'hiring' },
      ],
      []
    )
    expect(getState()!.nodes.filter((n) => n.label.toLowerCase() === 'hiring')).toHaveLength(1)
  })

  it('caps first-level children at 24', () => {
    init('Meeting')
    const ops = Array.from({ length: 30 }, (_, i) => ({
      type: 'add_branch' as const,
      parentLabel: 'Meeting',
      label: `B${i}`,
    }))
    applyOperations(ops, [])
    expect(getState()!.nodes.filter((n) => n.parentId === 'root')).toHaveLength(24)
  })

  it('caps sub-branches per first-level at 12', () => {
    init('Meeting')
    applyOperations([{ type: 'add_branch', parentLabel: 'Meeting', label: 'Parent' }], [])
    const ops = Array.from({ length: 16 }, (_, i) => ({
      type: 'add_branch' as const,
      parentLabel: 'Parent',
      label: `Sub${i}`,
    }))
    applyOperations(ops, [])
    const parent = getState()!.nodes.find((n) => n.label === 'Parent')!
    expect(getState()!.nodes.filter((n) => n.parentId === parent.id)).toHaveLength(12)
  })

  it('assigns slotAngle once and never moves existing branches', () => {
    init('Meeting')
    applyOperations(
      [
        { type: 'add_branch', parentLabel: 'Meeting', label: 'A' },
        { type: 'add_branch', parentLabel: 'Meeting', label: 'B' },
        { type: 'add_branch', parentLabel: 'Meeting', label: 'C' },
      ],
      []
    )
    const snapshot = getState()!.nodes
      .filter((n) => n.parentId === 'root')
      .map((n) => ({ label: n.label, slotAngle: n.slotAngle }))
    applyOperations(
      [
        { type: 'add_branch', parentLabel: 'Meeting', label: 'D' },
        { type: 'add_branch', parentLabel: 'Meeting', label: 'E' },
      ],
      []
    )
    const after = getState()!.nodes.filter((n) => n.parentId === 'root')
    for (const original of snapshot) {
      const node = after.find((n) => n.label === original.label)!
      expect(node.slotAngle).toBe(original.slotAngle)
    }
  })

  it('places the first first-level branch at the top (12 o\'clock)', () => {
    init('Meeting')
    applyOperations([{ type: 'add_branch', parentLabel: 'Meeting', label: 'A' }], [])
    const branch = getState()!.nodes.find((n) => n.parentId === 'root')!
    expect(branch.slotAngle).toBeCloseTo(-Math.PI / 2, 5)
  })

  it('places sub-branches inside the parent arc (±60° from parent angle)', () => {
    init('Meeting')
    applyOperations(
      [
        { type: 'add_branch', parentLabel: 'Meeting', label: 'Parent' },
        { type: 'add_branch', parentLabel: 'Parent', label: 's1' },
        { type: 'add_branch', parentLabel: 'Parent', label: 's2' },
        { type: 'add_branch', parentLabel: 'Parent', label: 's3' },
      ],
      []
    )
    const parent = getState()!.nodes.find((n) => n.label === 'Parent')!
    const parentAngle = parent.slotAngle!
    const subs = getState()!.nodes.filter((n) => n.parentId === parent.id)
    for (const sub of subs) {
      const diff = Math.abs(sub.slotAngle! - parentAngle)
      expect(diff).toBeLessThanOrEqual(Math.PI / 3 + 1e-9)
    }
  })

  it('applies normalizePreserveTerms on the new label', () => {
    init('Meeting')
    const glossary: GlossaryEntry[] = [
      {
        id: 'g1',
        scope: 'global',
        meetingId: null,
        sourceTerm: 'GPU',
        translations: {},
        preserve: true,
        note: null,
        createdAt: 0,
        updatedAt: 0,
      },
    ]
    applyOperations(
      [{ type: 'add_branch', parentLabel: 'Meeting', label: 'gpu benchmarks' }],
      glossary
    )
    const branch = getState()!.nodes.find((n) => n.label.includes('GPU'))!
    expect(branch.label).toBe('GPU benchmarks')
  })
})

describe('mindmapState.applyOperations - upgrade_root', () => {
  it('replaces root label when topicSource is meeting-title', () => {
    init('Meeting 2026-05-21 14:30')
    applyOperations([{ type: 'upgrade_root', newLabel: 'Q4 OKR Planning' }], [])
    const s = getState()!
    expect(s.nodes[0].label).toBe('Q4 OKR Planning')
    expect(s.topicSource).toBe('llm-detected')
  })

  it('drops second upgrade_root after first success', () => {
    init('Meeting')
    applyOperations([{ type: 'upgrade_root', newLabel: 'Topic A' }], [])
    applyOperations([{ type: 'upgrade_root', newLabel: 'Topic B' }], [])
    expect(getState()!.nodes[0].label).toBe('Topic A')
  })
})

describe('mindmapState.serializeForPrompt', () => {
  it('renders compact tree text', () => {
    init('Meeting')
    applyOperations(
      [
        { type: 'add_branch', parentLabel: 'Meeting', label: 'A' },
        { type: 'add_branch', parentLabel: 'A', label: 'a1' },
        { type: 'add_branch', parentLabel: 'A', label: 'a2' },
        { type: 'add_branch', parentLabel: 'Meeting', label: 'B' },
      ],
      []
    )
    const out = serializeForPrompt(getState()!)
    expect(out).toContain('ROOT: "Meeting"')
    expect(out).toContain('- "A" [2 children]')
    expect(out).toContain('  - "a1"')
    expect(out).toContain('  - "a2"')
    expect(out).toContain('- "B" [0 children]')
  })
})
