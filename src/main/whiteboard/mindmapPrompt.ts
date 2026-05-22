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
- New label captures the meeting's actual theme - short, 2-5 words.

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
