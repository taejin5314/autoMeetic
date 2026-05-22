import { describe, expect, it } from 'vitest'
import { computeMindMapLayout } from '../main/whiteboard/mindmapLayout'
import { BRANCH_PALETTE, ROOT_COLOR } from '../main/whiteboard/mindmapColors'
import type { MindMapState } from '../main/whiteboard/types'

function state(nodes: MindMapState['nodes']): MindMapState {
  return { rootId: 'root', nodes, topicSource: 'meeting-title' }
}

describe('computeMindMapLayout', () => {
  it('renders only the root ellipse when no branches', () => {
    const els = computeMindMapLayout(
      state([{ id: 'root', parentId: null, label: 'Topic', depth: 0 }])
    )
    expect(els).toHaveLength(1)
    expect(els[0].type).toBe('ellipse')
    expect(els[0].id).toBe('root')
    expect(els[0].backgroundColor).toBe(ROOT_COLOR)
  })

  it("places one first-level branch at top (12 o'clock)", () => {
    const els = computeMindMapLayout(
      state([
        { id: 'root', parentId: null, label: 'Topic', depth: 0 },
        { id: 'b1', parentId: 'root', label: 'A', depth: 1 },
      ])
    )
    const branch = els.find((e) => e.id === 'b1')!
    expect(branch.y).toBeLessThan(0)
    expect(Math.abs((branch.x ?? 0) + (branch.width ?? 0) / 2)).toBeLessThan(1)
  })

  it('distributes 7 first-level branches evenly around the root', () => {
    const nodes: MindMapState['nodes'] = [
      { id: 'root', parentId: null, label: 'Topic', depth: 0 },
    ]
    for (let i = 0; i < 7; i++) {
      nodes.push({ id: `b${i}`, parentId: 'root', label: `B${i}`, depth: 1 })
    }
    const els = computeMindMapLayout(state(nodes))
    const branches = els.filter((e) => e.id?.startsWith('b'))
    expect(branches).toHaveLength(7)
    for (const b of branches) {
      const cx = (b.x ?? 0) + (b.width ?? 0) / 2
      const cy = (b.y ?? 0) + (b.height ?? 0) / 2
      expect(Math.hypot(cx, cy)).toBeGreaterThan(270)
      expect(Math.hypot(cx, cy)).toBeLessThan(290)
    }
  })

  it('places sub-branches in an outward arc relative to parent', () => {
    const els = computeMindMapLayout(
      state([
        { id: 'root', parentId: null, label: 'Topic', depth: 0 },
        { id: 'b1', parentId: 'root', label: 'A', depth: 1 },
        { id: 's1', parentId: 'b1', label: 's1', depth: 2 },
        { id: 's2', parentId: 'b1', label: 's2', depth: 2 },
        { id: 's3', parentId: 'b1', label: 's3', depth: 2 },
      ])
    )
    const branch = els.find((e) => e.id === 'b1')!
    const branchCx = (branch.x ?? 0) + (branch.width ?? 0) / 2
    const branchCy = (branch.y ?? 0) + (branch.height ?? 0) / 2
    const branchDist = Math.hypot(branchCx, branchCy)
    for (const sid of ['s1', 's2', 's3']) {
      const sub = els.find((e) => e.id === sid)!
      const sx = (sub.x ?? 0) + (sub.width ?? 0) / 2
      const sy = (sub.y ?? 0) + (sub.height ?? 0) / 2
      expect(Math.hypot(sx, sy)).toBeGreaterThan(branchDist)
    }
  })

  it('arrow endpoints sit near shape edges, not centers', () => {
    const els = computeMindMapLayout(
      state([
        { id: 'root', parentId: null, label: 'Topic', depth: 0 },
        { id: 'b1', parentId: 'root', label: 'A', depth: 1 },
      ])
    )
    const arrow = els.find((e) => e.id === 'arrow-b1')!
    const startDist = Math.hypot(arrow.x ?? 0, arrow.y ?? 0)
    expect(startDist).toBeGreaterThan(30)
  })

  it('first-level branch color is palette[index].primary', () => {
    const els = computeMindMapLayout(
      state([
        { id: 'root', parentId: null, label: 'Topic', depth: 0 },
        { id: 'b1', parentId: 'root', label: 'A', depth: 1 },
        { id: 'b2', parentId: 'root', label: 'B', depth: 1 },
      ])
    )
    expect(els.find((e) => e.id === 'b1')!.backgroundColor).toBe(BRANCH_PALETTE[0].primary)
    expect(els.find((e) => e.id === 'b2')!.backgroundColor).toBe(BRANCH_PALETTE[1].primary)
  })

  it('sub-branch color is the parent palette entry.secondary', () => {
    const els = computeMindMapLayout(
      state([
        { id: 'root', parentId: null, label: 'Topic', depth: 0 },
        { id: 'b1', parentId: 'root', label: 'A', depth: 1 },
        { id: 's1', parentId: 'b1', label: 'a1', depth: 2 },
      ])
    )
    expect(els.find((e) => e.id === 's1')!.backgroundColor).toBe(BRANCH_PALETTE[0].secondary)
  })

  it('color palette wraps around after 7 branches', () => {
    const nodes: MindMapState['nodes'] = [
      { id: 'root', parentId: null, label: 'Topic', depth: 0 },
    ]
    for (let i = 0; i < 8; i++) {
      nodes.push({ id: `b${i}`, parentId: 'root', label: `B${i}`, depth: 1 })
    }
    const els = computeMindMapLayout(state(nodes))
    expect(els.find((e) => e.id === 'b7')!.backgroundColor).toBe(BRANCH_PALETTE[0].primary)
  })
})
