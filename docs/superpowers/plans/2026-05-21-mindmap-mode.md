# Whiteboard Mind-Map Mode — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Steps use checkbox (`- [ ]`) syntax for tracking. Execute phase-by-phase. Each phase ends in a clean state with passing tests, typecheck, and lint before moving on. Read `HANDOFF.md` first for environment quirks and conventions.

**Goal:** Add a dedicated "Mind map" mode to the whiteboard shelf. The LLM curates a single tree of branches, a deterministic radial layout engine renders it, and the existing freeform mode stays untouched.

**Architecture:** New main-process modules (`mindmapState`, `mindmapPrompt`, `mindmapLayout`, `mindmapColors`) under `src/main/whiteboard/`. `whiteboardService.ts` gains a mode router that delegates to the new path when `cachedMode === 'mindmap'`. A new IPC channel (`whiteboard:set-mode`) plus a segmented-pill toggle in the renderer shelf header complete the surface area.

**Tech Stack:** Electron, React 19, TypeScript strict (NO `any`), better-sqlite3 (unused — no schema change), vitest, OpenAI Chat Completions (gpt-4o-mini for mind-map turns).

**Spec:** `docs/superpowers/specs/2026-05-21-mindmap-mode-design.md`

**Scope reminder (do NOT exceed):** Mind-map mode only. No other diagram types. No auto-detect mode. No click-to-expand interaction. Tree depth ≤ 2. Persistence in-memory only.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/main/whiteboard/types.ts` | Modify | Add `WhiteboardMode`, `MindMapNode`, `MindMapState`, `MindMapOperation` |
| `src/main/whiteboard/mindmapColors.ts` | Create | Palette + `branchColor` helper |
| `src/main/whiteboard/mindmapState.ts` | Create | In-memory tree + `init / applyOperations / getState / clear / serializeForPrompt` |
| `src/main/whiteboard/mindmapLayout.ts` | Create | `computeMindMapLayout(state) → WhiteboardElement[]` |
| `src/main/whiteboard/mindmapPrompt.ts` | Create | `buildMindMapSystemPrompt + parseOperations` |
| `src/main/whiteboardService.ts` | Modify | `cachedMode` + `setWhiteboardMode` + `onMeetingBegin` + mode router in dispatch |
| `src/main/ipc.ts` | Modify | `whiteboard:set-mode` handler |
| `src/main/index.ts` | Modify | Wire `onMeetingBegin(meetingTitle)` at the lifecycle begin site |
| `src/preload/index.ts` | Modify | Expose `whiteboard.setMode` |
| `src/preload/types.ts` | Modify | Extend `ElectronAPI['whiteboard']` |
| `src/renderer/whiteboard/WhiteboardModeToggle.tsx` | Create | Segmented pill toggle |
| `src/renderer/App.tsx` | Modify | Mount the toggle in the shelf header next to LABELS |
| `src/renderer/App.css` | Modify | `.v4p-wb-mode*` styles |
| `src/test/mindmap-state.test.ts` | Create | ~10 tests |
| `src/test/mindmap-layout.test.ts` | Create | ~8 tests |
| `src/test/mindmap-prompt-parser.test.ts` | Create | ~6 tests |

---

## Phase 1 — Types + colors + state

### Task 1.1 — Extend whiteboard types

**Files:** `src/main/whiteboard/types.ts`

- [ ] **Step 1: Add the new types**

Append to `src/main/whiteboard/types.ts`:

```ts
export type WhiteboardMode = 'freeform' | 'mindmap'

export interface MindMapNode {
  id: string
  parentId: string | null
  label: string
  depth: number
}

export interface MindMapState {
  rootId: string
  nodes: MindMapNode[]
  topicSource: 'meeting-title' | 'llm-detected'
}

export type MindMapOperation =
  | { type: 'add_branch'; parentLabel: string; label: string }
  | { type: 'upgrade_root'; newLabel: string }
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/main/whiteboard/types.ts
git commit -m "feat(mindmap): add WhiteboardMode + MindMap types"
```

---

### Task 1.2 — `mindmapColors.ts`

**Files:** `src/main/whiteboard/mindmapColors.ts`

- [ ] **Step 1: Create the module**

```ts
export const ROOT_COLOR = '#fff8e1'

export interface BranchPaletteEntry {
  primary: string
  secondary: string
}

export const BRANCH_PALETTE: readonly BranchPaletteEntry[] = [
  { primary: '#a5d8ff', secondary: '#dbeafe' },
  { primary: '#ffd6a5', secondary: '#fed7aa' },
  { primary: '#caffbf', secondary: '#d9f99d' },
  { primary: '#ffadad', secondary: '#fecaca' },
  { primary: '#bdb2ff', secondary: '#ddd6fe' },
  { primary: '#fdffb6', secondary: '#fef08a' },
  { primary: '#9bf6ff', secondary: '#bae6fd' },
]

export function branchColor(firstLevelIndex: number, depth: 1 | 2): string {
  const entry = BRANCH_PALETTE[firstLevelIndex % BRANCH_PALETTE.length]
  return depth === 1 ? entry.primary : entry.secondary
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/main/whiteboard/mindmapColors.ts
git commit -m "feat(mindmap): branch color palette"
```

---

### Task 1.3 — `mindmapState.ts` with TDD

**Files:** `src/main/whiteboard/mindmapState.ts`, `src/test/mindmap-state.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/mindmap-state.test.ts`:

```ts
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

describe('mindmapState.applyOperations — add_branch', () => {
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

  it('caps first-level children at 7', () => {
    init('Meeting')
    const ops = Array.from({ length: 9 }, (_, i) => ({
      type: 'add_branch' as const,
      parentLabel: 'Meeting',
      label: `B${i}`,
    }))
    applyOperations(ops, [])
    expect(getState()!.nodes.filter((n) => n.parentId === 'root')).toHaveLength(7)
  })

  it('caps sub-branches per first-level at 5', () => {
    init('Meeting')
    applyOperations([{ type: 'add_branch', parentLabel: 'Meeting', label: 'Parent' }], [])
    const ops = Array.from({ length: 7 }, (_, i) => ({
      type: 'add_branch' as const,
      parentLabel: 'Parent',
      label: `Sub${i}`,
    }))
    applyOperations(ops, [])
    const parent = getState()!.nodes.find((n) => n.label === 'Parent')!
    expect(getState()!.nodes.filter((n) => n.parentId === parent.id)).toHaveLength(5)
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

describe('mindmapState.applyOperations — upgrade_root', () => {
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
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/mindmap-state.test.ts
```

Expect FAIL — module not found.

- [ ] **Step 3: Implement `mindmapState.ts`**

Create `src/main/whiteboard/mindmapState.ts`:

```ts
import { normalizePreserveTerms } from '../glossary/promptInjection'
import type { GlossaryEntry } from '../memory/types'
import type { MindMapNode, MindMapOperation, MindMapState } from './types'

const MAX_FIRST_LEVEL = 7
const MAX_SUB_PER_PARENT = 5
const MAX_LABEL_CHARS = 80

let state: MindMapState | null = null

export function init(meetingTitle: string): void {
  const title = meetingTitle.trim().slice(0, MAX_LABEL_CHARS) || 'Meeting'
  state = {
    rootId: 'root',
    nodes: [{ id: 'root', parentId: null, label: title, depth: 0 }],
    topicSource: 'meeting-title',
  }
}

export function clear(): void {
  state = null
}

export function getState(): MindMapState | null {
  return state
}

interface ApplyResult {
  rootUpgraded: boolean
  addedNodeIds: string[]
}

export function applyOperations(
  operations: MindMapOperation[],
  glossary: GlossaryEntry[]
): ApplyResult {
  const result: ApplyResult = { rootUpgraded: false, addedNodeIds: [] }
  if (!state) return result

  for (const op of operations) {
    if (op.type === 'upgrade_root') {
      if (state.topicSource !== 'meeting-title') continue
      const label = normalizePreserveTerms(op.newLabel.trim(), glossary).slice(0, MAX_LABEL_CHARS)
      if (!label) continue
      state.nodes[0].label = label
      state.topicSource = 'llm-detected'
      result.rootUpgraded = true
      continue
    }

    if (op.type === 'add_branch') {
      const parent = findNodeByLabel(op.parentLabel)
      if (!parent) continue
      if (parent.depth >= 2) continue
      const normalized = normalizePreserveTerms(op.label.trim(), glossary).slice(0, MAX_LABEL_CHARS)
      if (!normalized) continue
      const siblings = state.nodes.filter((n) => n.parentId === parent.id)
      if (siblings.some((s) => s.label.toLowerCase() === normalized.toLowerCase())) continue
      if (parent.id === 'root' && siblings.length >= MAX_FIRST_LEVEL) continue
      if (parent.depth === 1 && siblings.length >= MAX_SUB_PER_PARENT) continue

      const now = Date.now()
      const id = `br_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      state.nodes.push({
        id,
        parentId: parent.id,
        label: normalized,
        depth: parent.depth + 1,
      })
      result.addedNodeIds.push(id)
    }
  }

  return result
}

function findNodeByLabel(label: string): MindMapNode | null {
  if (!state) return null
  const target = label.trim().toLowerCase()
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    if (state.nodes[i].label.toLowerCase() === target) return state.nodes[i]
  }
  return null
}

export function serializeForPrompt(s: MindMapState): string {
  const root = s.nodes.find((n) => n.id === s.rootId)
  if (!root) return ''
  const lines: string[] = [`ROOT: ${quote(root.label)}`]
  const firstLevel = s.nodes.filter((n) => n.parentId === 'root')
  for (const branch of firstLevel) {
    const subs = s.nodes.filter((n) => n.parentId === branch.id)
    lines.push(`- ${quote(branch.label)} [${subs.length} children]`)
    for (const sub of subs) {
      lines.push(`  - ${quote(sub.label)}`)
    }
  }
  return lines.join('\n')
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`
}

export function findFirstLevelIndex(branchId: string): number {
  if (!state) return -1
  const firstLevel = state.nodes.filter((n) => n.parentId === 'root')
  return firstLevel.findIndex((n) => n.id === branchId)
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/test/mindmap-state.test.ts
```

Expect ~11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/whiteboard/mindmapState.ts src/test/mindmap-state.test.ts
git commit -m "feat(mindmap): in-memory tree state with applyOperations"
```

---

## Phase 2 — Layout engine

### Task 2.1 — `mindmapLayout.ts` with TDD

**Files:** `src/main/whiteboard/mindmapLayout.ts`, `src/test/mindmap-layout.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/mindmap-layout.test.ts`:

```ts
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

  it('places one first-level branch at top (12 o\'clock)', () => {
    const els = computeMindMapLayout(
      state([
        { id: 'root', parentId: null, label: 'Topic', depth: 0 },
        { id: 'b1', parentId: 'root', label: 'A', depth: 1 },
      ])
    )
    const branch = els.find((e) => e.id === 'b1')!
    // 12 o'clock = -π/2, so cos(-π/2) ≈ 0, sin(-π/2) = -1 → y is negative
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
    // verify all 7 are roughly RADIUS_L1 (~280) away from origin
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
      // sub is further from origin than parent
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
    // arrow start should be offset from origin by at least ROOT half-min-dim
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
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/mindmap-layout.test.ts
```

Expect FAIL — module not found.

- [ ] **Step 3: Implement `mindmapLayout.ts`**

Create `src/main/whiteboard/mindmapLayout.ts`:

```ts
import { branchColor, ROOT_COLOR } from './mindmapColors'
import type { MindMapState } from './types'
import type { WhiteboardElement } from './types'

const ROOT_SIZE = { w: 220, h: 80 }
const L1_SIZE = { w: 200, h: 60 }
const L2_SIZE = { w: 160, h: 50 }
const RADIUS_L1 = 280
const RADIUS_L2 = 180
const SUB_ARC = (2 * Math.PI) / 3
const ARROW_GAP = 6

export function computeMindMapLayout(state: MindMapState): WhiteboardElement[] {
  const out: WhiteboardElement[] = []
  const root = state.nodes.find((n) => n.id === state.rootId)
  if (!root) return out

  out.push(
    makeShape({
      type: 'ellipse',
      id: 'root',
      centerX: 0,
      centerY: 0,
      width: ROOT_SIZE.w,
      height: ROOT_SIZE.h,
      backgroundColor: ROOT_COLOR,
      label: root.label,
      fontSize: 20,
    })
  )

  const firstLevel = state.nodes.filter((n) => n.parentId === 'root')
  if (firstLevel.length === 0) return out

  const angleStep = (2 * Math.PI) / firstLevel.length
  firstLevel.forEach((branch, i) => {
    const angle = -Math.PI / 2 + i * angleStep
    const cx = Math.cos(angle) * RADIUS_L1
    const cy = Math.sin(angle) * RADIUS_L1
    out.push(
      makeShape({
        type: 'rectangle',
        id: branch.id,
        centerX: cx,
        centerY: cy,
        width: L1_SIZE.w,
        height: L1_SIZE.h,
        backgroundColor: branchColor(i, 1),
        label: branch.label,
        fontSize: 16,
      })
    )
    out.push(
      makeArrow({
        id: `arrow-${branch.id}`,
        from: { cx: 0, cy: 0, w: ROOT_SIZE.w, h: ROOT_SIZE.h },
        to: { cx, cy, w: L1_SIZE.w, h: L1_SIZE.h },
      })
    )

    const subs = state.nodes.filter((n) => n.parentId === branch.id)
    if (subs.length === 0) return
    const subAngleStep = subs.length === 1 ? 0 : SUB_ARC / (subs.length - 1)
    const startAngle = angle - SUB_ARC / 2
    subs.forEach((sub, j) => {
      const subAngle = subs.length === 1 ? angle : startAngle + j * subAngleStep
      const sx = cx + Math.cos(subAngle) * RADIUS_L2
      const sy = cy + Math.sin(subAngle) * RADIUS_L2
      out.push(
        makeShape({
          type: 'rectangle',
          id: sub.id,
          centerX: sx,
          centerY: sy,
          width: L2_SIZE.w,
          height: L2_SIZE.h,
          backgroundColor: branchColor(i, 2),
          label: sub.label,
          fontSize: 14,
        })
      )
      out.push(
        makeArrow({
          id: `arrow-${sub.id}`,
          from: { cx, cy, w: L1_SIZE.w, h: L1_SIZE.h },
          to: { cx: sx, cy: sy, w: L2_SIZE.w, h: L2_SIZE.h },
        })
      )
    })
  })

  return out
}

interface ShapeInput {
  type: 'ellipse' | 'rectangle'
  id: string
  centerX: number
  centerY: number
  width: number
  height: number
  backgroundColor: string
  label: string
  fontSize: number
}

function makeShape(s: ShapeInput): WhiteboardElement {
  return {
    type: s.type,
    id: s.id,
    x: s.centerX - s.width / 2,
    y: s.centerY - s.height / 2,
    width: s.width,
    height: s.height,
    backgroundColor: s.backgroundColor,
    fillStyle: 'solid',
    roundness: s.type === 'rectangle' ? { type: 3 } : undefined,
    label: { text: s.label, fontSize: s.fontSize },
  }
}

interface ArrowInput {
  id: string
  from: { cx: number; cy: number; w: number; h: number }
  to: { cx: number; cy: number; w: number; h: number }
}

function makeArrow(a: ArrowInput): WhiteboardElement {
  const dx = a.to.cx - a.from.cx
  const dy = a.to.cy - a.from.cy
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  const fromRadius = Math.min(a.from.w, a.from.h) / 2 + ARROW_GAP
  const toRadius = Math.min(a.to.w, a.to.h) / 2 + ARROW_GAP
  const startX = a.from.cx + ux * fromRadius
  const startY = a.from.cy + uy * fromRadius
  const endX = a.to.cx - ux * toRadius
  const endY = a.to.cy - uy * toRadius
  return {
    type: 'arrow',
    id: a.id,
    x: startX,
    y: startY,
    width: endX - startX,
    height: endY - startY,
    points: [
      [0, 0],
      [endX - startX, endY - startY],
    ],
  }
}
```

**Note on `WhiteboardElement` shape:** If the existing type in `src/main/whiteboard/types.ts` does not accept `label: { text, fontSize }` or `points: [[number, number], ...]` exactly as written, adapt to the actual interface. Grep for `interface WhiteboardElement` and match. The whiteboard agent already emits elements with these fields, so the type should accept them.

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/test/mindmap-layout.test.ts
```

Expect ~8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/whiteboard/mindmapLayout.ts src/main/whiteboard/mindmapColors.ts src/test/mindmap-layout.test.ts
git commit -m "feat(mindmap): radial layout engine"
```

---

## Phase 3 — Prompt + parser

### Task 3.1 — `mindmapPrompt.ts` with TDD

**Files:** `src/main/whiteboard/mindmapPrompt.ts`, `src/test/mindmap-prompt-parser.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/mindmap-prompt-parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildMindMapSystemPrompt,
  parseOperations,
} from '../main/whiteboard/mindmapPrompt'

describe('parseOperations', () => {
  it('returns [] for non-JSON content', () => {
    expect(parseOperations('not json')).toEqual([])
  })

  it('returns [] when operations field is missing', () => {
    expect(parseOperations('{"foo":"bar"}')).toEqual([])
  })

  it('parses valid add_branch and upgrade_root', () => {
    const raw = JSON.stringify({
      operations: [
        { type: 'add_branch', parentLabel: 'Meeting', label: 'Goals' },
        { type: 'upgrade_root', newLabel: 'Q4 Planning' },
      ],
    })
    const out = parseOperations(raw)
    expect(out).toHaveLength(2)
    expect(out[0].type).toBe('add_branch')
    expect(out[1].type).toBe('upgrade_root')
  })

  it('drops operations with unknown type', () => {
    const raw = JSON.stringify({
      operations: [
        { type: 'add_branch', parentLabel: 'A', label: 'B' },
        { type: 'remove_branch', label: 'Q' },
      ],
    })
    expect(parseOperations(raw)).toHaveLength(1)
  })

  it('drops add_branch with missing fields', () => {
    const raw = JSON.stringify({
      operations: [
        { type: 'add_branch', parentLabel: '', label: 'B' },
        { type: 'add_branch', parentLabel: 'A' },
        { type: 'add_branch', label: 'C' },
      ],
    })
    expect(parseOperations(raw)).toEqual([])
  })

  it('truncates to 5 operations', () => {
    const ops = Array.from({ length: 8 }, (_, i) => ({
      type: 'add_branch',
      parentLabel: 'Meeting',
      label: `B${i}`,
    }))
    const raw = JSON.stringify({ operations: ops })
    expect(parseOperations(raw)).toHaveLength(5)
  })
})

describe('buildMindMapSystemPrompt', () => {
  it('embeds the compact tree text and label language', () => {
    const out = buildMindMapSystemPrompt({
      treeText: 'ROOT: "Meeting"',
      labelLanguage: 'ko',
      glossaryBlock: '',
    })
    expect(out).toContain('Active label language: ko')
    expect(out).toContain('ROOT: "Meeting"')
  })

  it('includes glossary block when present', () => {
    const out = buildMindMapSystemPrompt({
      treeText: 'ROOT: "x"',
      labelLanguage: 'off',
      glossaryBlock: 'GLOSSARY: keep GPU verbatim',
    })
    expect(out).toContain('GLOSSARY: keep GPU verbatim')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/mindmap-prompt-parser.test.ts
```

Expect FAIL.

- [ ] **Step 3: Implement `mindmapPrompt.ts`**

Create `src/main/whiteboard/mindmapPrompt.ts`:

```ts
import type { MindMapOperation } from './types'

const MAX_OPS_PER_TURN = 5
const MAX_LABEL = 80

interface BuildArgs {
  treeText: string
  labelLanguage: string
  glossaryBlock: string
}

export function buildMindMapSystemPrompt(args: BuildArgs): string {
  const labelLang = args.labelLanguage && args.labelLanguage.length > 0 ? args.labelLanguage : 'Auto'
  const glossarySection = args.glossaryBlock ? `\n\n${args.glossaryBlock}` : ''
  return `You are a mind-map curator for a live meeting. The user has switched to
mind-map mode. Maintain ONE tree that grows as the meeting unfolds.

Current mind map:
${args.treeText}

Rules:
- One central topic at the root. Branches radiate outward.
- Tree depth: root (depth 0) + first-level branches (depth 1, max 7)
  + sub-branches (depth 2, max 5 per parent).
- Labels: 1-80 chars. 1-5 words ideal. Use sentence case.
- Do NOT propose duplicate labels under the same parent.
- Only ADD operations and ONE-TIME root upgrade. No remove/move/merge.

Per turn, output JSON only:
{
  "operations": [
    { "type": "add_branch", "parentLabel": "<exact existing>", "label": "<new>" },
    { "type": "upgrade_root", "newLabel": "<better central topic>" }
  ]
}

upgrade_root:
- Propose AT MOST ONCE per meeting, and only when the current root is a
  generic title like "Meeting 2026-05-21 14:30". Skip if already meaningful.
- New label captures the meeting's actual theme — short, 2-5 words.

add_branch:
- parentLabel must match an existing node EXACTLY (case-insensitive).
- If the new transcript fits an existing first-level branch, add as a
  child of that branch (depth 2). Otherwise add a new first-level branch.
- Prefer extending existing structure over multiplying top-level branches.
- Output at most 5 operations per turn.

If nothing in this transcript is worth adding, return: { "operations": [] }

Active label language: ${labelLang}${glossarySection}

Output JSON only. No code fences, no labels, no explanation.`
}

type RawOp = {
  type?: unknown
  parentLabel?: unknown
  label?: unknown
  newLabel?: unknown
}

export function parseOperations(raw: string): MindMapOperation[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const operations = (parsed as { operations?: unknown }).operations
  if (!Array.isArray(operations)) return []

  const out: MindMapOperation[] = []
  for (const rawOp of operations as RawOp[]) {
    if (out.length >= MAX_OPS_PER_TURN) break
    if (!rawOp || typeof rawOp !== 'object') continue
    if (rawOp.type === 'add_branch') {
      const parentLabel =
        typeof rawOp.parentLabel === 'string' ? rawOp.parentLabel.trim() : ''
      const label = typeof rawOp.label === 'string' ? rawOp.label.trim() : ''
      if (!parentLabel || !label) continue
      if (parentLabel.length > MAX_LABEL || label.length > MAX_LABEL) continue
      out.push({ type: 'add_branch', parentLabel, label })
    } else if (rawOp.type === 'upgrade_root') {
      const newLabel = typeof rawOp.newLabel === 'string' ? rawOp.newLabel.trim() : ''
      if (!newLabel || newLabel.length > MAX_LABEL) continue
      out.push({ type: 'upgrade_root', newLabel })
    }
  }
  return out
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/test/mindmap-prompt-parser.test.ts
```

Expect ~7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/whiteboard/mindmapPrompt.ts src/test/mindmap-prompt-parser.test.ts
git commit -m "feat(mindmap): prompt builder + operation parser"
```

---

## Phase 4 — whiteboardService routing + IPC + preload

### Task 4.1 — Service routing + mode cache + LLM dispatch

**Files:** `src/main/whiteboardService.ts`

- [ ] **Step 1: Read the existing structure**

Read `src/main/whiteboardService.ts` and identify:

- Where `cachedLabelLanguage` and `setDiagramLabelLanguage` live (the pattern we'll mirror)
- Where `whiteboardSystemPrompt(...)` is called and the LLM dispatch happens
- Where `enqueueTranscript` writes to the agent queue

- [ ] **Step 2: Add cached mode state + mode setter**

Near `cachedLabelLanguage`:

```ts
import type { WhiteboardMode } from './whiteboard/types'
import * as mindmapState from './whiteboard/mindmapState'
import { computeMindMapLayout } from './whiteboard/mindmapLayout'
import { buildMindMapSystemPrompt, parseOperations } from './whiteboard/mindmapPrompt'
import { serializeForPrompt } from './whiteboard/mindmapState'

let cachedMode: WhiteboardMode = 'freeform'

export function setWhiteboardMode(mode: WhiteboardMode): void {
  if (cachedMode === mode) return
  cachedMode = mode
  // Reset both modes' visible state: clear existing freeform elements
  // and any in-flight mind map state.
  clearFreeformElements()
  mindmapState.clear()
  if (mode === 'mindmap' && lifecycleRef?.getCurrentMeetingId()) {
    const meetingId = lifecycleRef.getCurrentMeetingId()
    const m = repoRef?.getMeeting(meetingId!)
    if (m) {
      mindmapState.init(m.title)
      broadcastWhiteboardUpdate(computeMindMapLayout(mindmapState.getState()!))
      return
    }
  }
  // Otherwise broadcast empty canvas
  broadcastWhiteboardUpdate([])
}

export function getWhiteboardMode(): WhiteboardMode {
  return cachedMode
}
```

The exact names `clearFreeformElements`, `broadcastWhiteboardUpdate`, `lifecycleRef`, `repoRef` may already exist or need wrapping. Grep the file for the local equivalents and adapt the names. The goal is:

- A function that empties whatever local array holds freeform elements (or sets it to `[]`).
- A function that sends elements over the existing `whiteboard:update` IPC channel.
- Access to the live meeting id and to the memory repo (already wired in earlier phases via `init()`).

- [ ] **Step 3: Add `onMeetingBegin`**

```ts
export function onMeetingBegin(meetingTitle: string): void {
  if (cachedMode !== 'mindmap') return
  mindmapState.init(meetingTitle)
  broadcastWhiteboardUpdate(computeMindMapLayout(mindmapState.getState()!))
}
```

- [ ] **Step 4: Route the agent dispatch**

Find the function that consumes the next coalesced transcript (likely called from `enqueueTranscript`'s flush, or a `runAgent` function). At the top of that function, branch on `cachedMode`:

```ts
async function runAgent(transcriptText: string): Promise<void> {
  const dispatchedMode = cachedMode
  if (dispatchedMode === 'mindmap') {
    return runMindMapAgent(transcriptText, dispatchedMode)
  }
  // ... existing freeform agent code unchanged ...
}

async function runMindMapAgent(
  transcriptText: string,
  dispatchedMode: WhiteboardMode
): Promise<void> {
  const s = mindmapState.getState()
  if (!s) return
  const glossary = repoRef ? repoRef.activeGlossary(lifecycleRef?.getCurrentMeetingId() ?? null) : []
  const treeText = serializeForPrompt(s)
  const labelLanguage = cachedLabelLanguage ?? 'Auto'
  // re-use the existing helper that formats a GLOSSARY block (from Phase 5 of glossary v1)
  const glossaryBlock = glossary.length > 0
    ? formatGlossaryPromptSection(glossary, labelLanguage === 'Auto' ? null : labelLanguage)
    : ''
  const systemPrompt = buildMindMapSystemPrompt({ treeText, labelLanguage, glossaryBlock })

  let raw: string
  try {
    raw = await callOpenAIChat({
      model: 'gpt-4o-mini',
      systemPrompt,
      userPrompt: transcriptText,
      jsonMode: true,
      temperature: 0.2,
    })
  } catch (err) {
    logger.warn('mindmap.turn.failure', { reason: 'llm-error', error: String(err) })
    return
  }
  // Mode may have changed while LLM was in flight.
  if (cachedMode !== dispatchedMode) return

  const ops = parseOperations(raw)
  if (ops.length === 0) {
    logger.info('mindmap.turn.success', { opsApplied: 0, totalNodes: s.nodes.length })
    return
  }
  const result = mindmapState.applyOperations(ops, glossary)
  if (result.rootUpgraded) {
    logger.info('mindmap.root.upgraded', { newLabel: mindmapState.getState()!.nodes[0].label })
  }
  for (const id of result.addedNodeIds) {
    const node = mindmapState.getState()!.nodes.find((n) => n.id === id)
    if (node) logger.info('mindmap.node.added', { depth: node.depth })
  }
  logger.info('mindmap.turn.success', {
    opsApplied: result.addedNodeIds.length + (result.rootUpgraded ? 1 : 0),
    totalNodes: mindmapState.getState()!.nodes.length,
  })
  broadcastWhiteboardUpdate(computeMindMapLayout(mindmapState.getState()!))
}
```

**`callOpenAIChat`** is a placeholder — the file likely has its own LLM-call helper; reuse whatever the freeform agent uses. If there is no shared helper, copy the same `fetch` pattern from `src/main/glossary/suggestionService.ts` (the auto-suggestions phase added one).

`formatGlossaryPromptSection` is imported from `src/main/glossary/promptInjection.ts` (glossary v1).

`logger` — the project's existing telemetry logger. Match how `glossary.suggestion.accepted` is logged in `ipc-glossary-handlers.ts`.

- [ ] **Step 5: Verify typecheck**

```bash
npm run typecheck
```

Clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/whiteboardService.ts
git commit -m "feat(mindmap): whiteboardService mode routing + dispatcher"
```

---

### Task 4.2 — IPC handler

**Files:** `src/main/ipc.ts`

- [ ] **Step 1: Add handler near the existing `whiteboard:set-label-language`**

```ts
import type { WhiteboardMode } from './whiteboard/types'

// ...inside the handler registration block...
ipcMain.handle('whiteboard:set-mode', (_event, args: { mode: WhiteboardMode }) => {
  setWhiteboardMode(args.mode)
})
```

Make sure `setWhiteboardMode` is imported from `./whiteboardService`.

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/main/ipc.ts
git commit -m "feat(mindmap): IPC handler for whiteboard:set-mode"
```

---

### Task 4.3 — Preload bridge

**Files:** `src/preload/index.ts`, `src/preload/types.ts`

- [ ] **Step 1: Extend preload `whiteboard` object**

Inside the existing `whiteboard: { ... }`:

```ts
whiteboard: {
  setLabelLanguage: (code: string | null) =>
    ipcRenderer.invoke('whiteboard:set-label-language', { code }),
  setMode: (mode: 'freeform' | 'mindmap') =>
    ipcRenderer.invoke('whiteboard:set-mode', { mode }),
},
```

- [ ] **Step 2: Extend `ElectronAPI['whiteboard']` type**

```ts
whiteboard: {
  setLabelLanguage(code: string | null): Promise<void>
  setMode(mode: 'freeform' | 'mindmap'): Promise<void>
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
git add src/preload/index.ts src/preload/types.ts
git commit -m "feat(mindmap): preload bridge for setMode"
```

---

## Phase 5 — UI toggle

### Task 5.1 — `WhiteboardModeToggle.tsx`

**Files:** `src/renderer/whiteboard/WhiteboardModeToggle.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useState } from 'react'

type Mode = 'freeform' | 'mindmap'
const STORAGE_KEY = 'automeetic.whiteboardMode'

function readInitial(): Mode {
  if (typeof window === 'undefined') return 'freeform'
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === 'mindmap' ? 'mindmap' : 'freeform'
}

function pushToMain(mode: Mode): void {
  const api = window.electronAPI?.whiteboard?.setMode
  if (api) void api(mode)
}

export function WhiteboardModeToggle() {
  const [mode, setMode] = useState<Mode>(readInitial)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode)
    pushToMain(mode)
  }, [mode])

  return (
    <div className="v4p-wb-mode" role="group" aria-label="Diagram mode">
      <button
        type="button"
        className={`v4p-wb-mode-btn ${mode === 'freeform' ? 'on' : ''}`}
        onClick={() => setMode('freeform')}
        aria-pressed={mode === 'freeform'}
      >
        Freeform
      </button>
      <button
        type="button"
        className={`v4p-wb-mode-btn ${mode === 'mindmap' ? 'on' : ''}`}
        onClick={() => setMode('mindmap')}
        aria-pressed={mode === 'mindmap'}
      >
        Mind map
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add styles to `src/renderer/App.css`**

Append:

```css
.v4p-wb-mode {
  display: inline-flex;
  align-items: center;
  margin-right: 10px;
  border: 1px solid var(--p-border);
  border-radius: 6px;
  overflow: hidden;
}
.v4p-wb-mode-btn {
  height: 22px;
  padding: 0 10px;
  background: var(--p-bg-card);
  border: none;
  color: var(--p-mute);
  font-family: var(--p-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
}
.v4p-wb-mode-btn + .v4p-wb-mode-btn {
  border-left: 1px solid var(--p-border);
}
.v4p-wb-mode-btn.on {
  background: var(--p-primary);
  color: var(--p-primary-on);
}
.v4p-wb-mode-btn:hover:not(.on) {
  background: var(--p-bg-sub);
  color: var(--p-text);
}
```

- [ ] **Step 3: Mount in `src/renderer/App.tsx`**

Add import:

```ts
import { WhiteboardModeToggle } from './whiteboard/WhiteboardModeToggle'
```

Find the shelf header markup (where `v4p-shelf-tab` buttons + `WhiteboardLabelLangSelect` + `v4p-shelf-x` close button live). Insert `<WhiteboardModeToggle />` immediately BEFORE the `<WhiteboardLabelLangSelect />`, both conditional on `shelf === 'whiteboard'`:

```tsx
{shelf === 'whiteboard' && <WhiteboardModeToggle />}
{shelf === 'whiteboard' && <WhiteboardLabelLangSelect />}
<button className="v4p-shelf-x" ...>
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run lint
```

Both clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/whiteboard/WhiteboardModeToggle.tsx src/renderer/App.tsx src/renderer/App.css
git commit -m "feat(mindmap): shelf-header mode toggle"
```

---

## Phase 6 — Meeting lifecycle wire + telemetry + ship

### Task 6.1 — Wire `onMeetingBegin` in `src/main/index.ts`

**Files:** `src/main/index.ts`

- [ ] **Step 1: Find the lifecycle.beginMeeting() call site**

Grep `src/main/index.ts` for `beginMeeting`. There should be one site where a new meeting starts (likely in the STT-start handler or right after the language config).

- [ ] **Step 2: After `beginMeeting` returns, fetch the meeting title and notify the whiteboard service**

```ts
const meetingId = lifecycle.beginMeeting({ sourceLanguage, targetLanguage })
const m = (await memoryServicePromise).repository.getMeeting(meetingId)
if (m) {
  // existing summary/extraction wiring stays...
  // append:
  const { onMeetingBegin: onWhiteboardMeetingBegin } = await import('./whiteboardService')
  onWhiteboardMeetingBegin(m.title)
}
```

The exact existing pattern at that site uses an inline dynamic import or a direct call; match it.

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
git add src/main/index.ts
git commit -m "feat(mindmap): wire onMeetingBegin to whiteboard service"
```

---

### Task 6.2 — Telemetry log calls verification

**Files:** `src/main/whiteboardService.ts` (already done in Task 4.1) + main `ipc.ts`

- [ ] **Step 1: Add a mode-toggle telemetry call**

In `src/main/ipc.ts`'s `whiteboard:set-mode` handler:

```ts
ipcMain.handle('whiteboard:set-mode', (_event, args: { mode: WhiteboardMode }) => {
  setWhiteboardMode(args.mode)
  logger.info('mindmap.mode-toggled', { target: args.mode })
})
```

- [ ] **Step 2: Verify the existing dispatcher telemetry from Task 4.1 fires**

Already covered: `mindmap.turn.success`, `mindmap.turn.failure`, `mindmap.node.added`, `mindmap.root.upgraded`. No extra changes needed if Task 4.1 was implemented per the plan.

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
git add src/main/ipc.ts
git commit -m "feat(mindmap): mode-toggle telemetry"
```

---

### Task 6.3 — Final regression + manual smoke + push

- [ ] **Step 1: Full regression**

```bash
npm run typecheck                     # clean
npm run lint                          # 0 errors expected
npx vitest run                        # all suites pass; new tests add ~24 (state 11 + layout 8 + prompt 7)
```

If anything fails, fix in-place before committing.

- [ ] **Step 2: Manual smoke (Electron)**

`npm run dev:electron`:

1. Open whiteboard shelf. Confirm the new `[Freeform | Mind map]` pill is visible next to LABELS.
2. Click "Mind map" — canvas resets, shows nothing (no meeting yet).
3. Start a meeting (`Start` button). Confirm a root ellipse appears with the auto-generated meeting title.
4. Share a tab with English audio. Speak about a few clearly-grouped topics ("Q4 OKR planning... Engineering goals: reduce latency, migrate to Postgres... Marketing goals: brand refresh, launch campaign... Hiring: backfill platform team").
5. After ~30 seconds of conversation, observe:
   - Root label upgraded from generic title to "Q4 OKR Planning" (or similar)
   - Engineering / Marketing / Hiring branches appear with distinct colors
   - Sub-branches appear under Engineering and Marketing
6. Toggle to "Freeform" — canvas clears.
7. Toggle back to "Mind map" — fresh tree starts (root is the meeting title again, branches gone).
8. Stop the meeting. Glossary auto-suggestions should still work (run the same workflow you used to verify v2).

- [ ] **Step 3: Update HANDOFF.md**

Open `HANDOFF.md`. Update the "Next active stream" + "Active stream state" to mark this stream as complete. Add a "Mind-map mode" entry to the "Previously shipped" section with the spec/plan links and a brief notes paragraph.

- [ ] **Step 4: Commit + push**

```bash
git add HANDOFF.md
git commit -m "docs(mindmap): mark stream complete"
git push origin master
```

---

## Self-review notes (resolved inline)

**Spec coverage:** every section of the spec maps to one or more tasks:

- Types → Task 1.1
- Colors → Task 1.2
- State + applyOperations → Task 1.3
- Layout engine → Task 2.1
- Prompt + parser → Task 3.1
- Service routing + dispatcher → Task 4.1
- IPC handler → Task 4.2
- Preload bridge → Task 4.3
- UI toggle → Task 5.1
- Meeting lifecycle wire → Task 6.1
- Telemetry → Tasks 4.1 + 6.2
- Regression + ship → Task 6.3

**Type consistency:** `WhiteboardMode`, `MindMapNode`, `MindMapState`, `MindMapOperation`, function names (`init`, `applyOperations`, `getState`, `clear`, `serializeForPrompt`, `computeMindMapLayout`, `buildMindMapSystemPrompt`, `parseOperations`, `setWhiteboardMode`, `getWhiteboardMode`, `onMeetingBegin`, `branchColor`) — all consistent across tasks.

**Known assumptions to verify during execution:**

- `WhiteboardElement` shape in `src/main/whiteboard/types.ts` accepts `label: { text, fontSize }` and `points: number[][]`. If not, adapt the layout output to match the actual interface.
- `whiteboardService.ts` has access to `repoRef` (for `activeGlossary`) and `lifecycleRef` (for `getCurrentMeetingId`) — same pattern as Phases 5 and 7 of the glossary v1 work.
- The freeform LLM dispatcher uses a helper for the OpenAI Chat call. If no shared helper exists, copy the fetch pattern from `src/main/glossary/suggestionService.ts`.
- The renderer mounts `WhiteboardLabelLangSelect` inside an `{shelf === 'whiteboard' && ...}` guard. The mode toggle mirrors that guard exactly.

**No web-mode parity:** This feature is Electron-only by design. `server/proxy.mjs` and `server/whiteboard-runtime.mjs` are not touched. Web users continue to see freeform mode only.

**No persistence:** Mind map state is lost on app restart. Documented limitation. v2 can add sqlite storage if user demand emerges.
