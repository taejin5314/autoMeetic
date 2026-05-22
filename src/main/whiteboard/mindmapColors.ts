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
