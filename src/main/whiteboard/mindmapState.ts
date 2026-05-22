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
