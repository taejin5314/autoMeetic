import { normalizePreserveTerms } from '../glossary/promptInjection'
import type { GlossaryEntry } from '../memory/types'
import type { MindMapNode, MindMapOperation, MindMapState } from './types'

const MAX_FIRST_LEVEL = 24
const MAX_SUB_PER_PARENT = 12
const MAX_LABEL_CHARS = 80

// Golden angle (≈ 137.5°) distributes new first-level branches without
// clustering — each new arrival lands roughly opposite the recent ones,
// and the position is determined purely by insertion order so existing
// branches never shift when new siblings join.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const FIRST_LEVEL_START = -Math.PI / 2 // 12 o'clock
const SUB_ARC = (2 * Math.PI) / 3 // 120° spread for sub-branches

let state: MindMapState | null = null

export function init(meetingTitle: string): void {
  const title = meetingTitle.trim().slice(0, MAX_LABEL_CHARS) || 'Meeting'
  state = {
    rootId: 'root',
    nodes: [{ id: 'root', parentId: null, label: title, depth: 0, slotAngle: null }],
    topicSource: 'meeting-title',
  }
}

export function clear(): void {
  state = null
}

export function getState(): MindMapState | null {
  return state
}

export function replace(nextState: MindMapState): void {
  state = {
    ...nextState,
    nodes: nextState.nodes.map((node) => ({ ...node })),
  }
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
      const label = normalizePreserveTerms(op.newLabel.trim(), glossary).text.slice(0, MAX_LABEL_CHARS)
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
      const normalized = normalizePreserveTerms(op.label.trim(), glossary).text.slice(0, MAX_LABEL_CHARS)
      if (!normalized) continue
      const siblings = state.nodes.filter((n) => n.parentId === parent.id)
      if (siblings.some((s) => s.label.toLowerCase() === normalized.toLowerCase())) continue
      if (parent.id === 'root' && siblings.length >= MAX_FIRST_LEVEL) continue
      if (parent.depth === 1 && siblings.length >= MAX_SUB_PER_PARENT) continue

      const slotAngle = computeSlotAngle(parent, siblings)
      const now = Date.now()
      const id = `br_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      state.nodes.push({
        id,
        parentId: parent.id,
        label: normalized,
        depth: parent.depth + 1,
        slotAngle,
      })
      result.addedNodeIds.push(id)
    }
  }

  return result
}

function computeSlotAngle(parent: MindMapNode, siblings: MindMapNode[]): number {
  if (parent.id === 'root') {
    // Golden-angle sequence keyed by insertion order: new first-level branch
    // i lands at FIRST_LEVEL_START + i * GOLDEN_ANGLE. Stable forever.
    return normalizeAngle(FIRST_LEVEL_START + siblings.length * GOLDEN_ANGLE)
  }
  // Sub-branch: largest-gap fill within the bounded arc centered on parent.
  const parentAngle = parent.slotAngle ?? 0
  const occupied = siblings
    .map((s) => s.slotAngle)
    .filter((a): a is number => a !== null)
  return pickSubBranchAngle(parentAngle, occupied)
}

function pickSubBranchAngle(parentAngle: number, occupied: number[]): number {
  const arcStart = parentAngle - SUB_ARC / 2
  const arcEnd = parentAngle + SUB_ARC / 2
  if (occupied.length === 0) return parentAngle
  const sorted = [...occupied].sort((a, b) => a - b)
  let bestGap = sorted[0] - arcStart
  let bestMid = arcStart + bestGap / 2
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1] - sorted[i]
    if (gap > bestGap) {
      bestGap = gap
      bestMid = sorted[i] + gap / 2
    }
  }
  const tailGap = arcEnd - sorted[sorted.length - 1]
  if (tailGap > bestGap) {
    bestMid = sorted[sorted.length - 1] + tailGap / 2
  }
  return bestMid
}

function normalizeAngle(a: number): number {
  let v = a
  while (v > Math.PI) v -= 2 * Math.PI
  while (v < -Math.PI) v += 2 * Math.PI
  return v
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
