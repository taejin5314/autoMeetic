import type { ChatSource } from '../memory/types'
import type { MindMapNode, MindMapState } from './types'

export interface AskMindMapPayload {
  question: string
  answer: string
  sources: ChatSource[]
}

export interface AskMindMapResult {
  nodeCount: number
}

const MAX_LABEL_CHARS = 80
const MAX_BRANCHES = 5
const MAX_CHILDREN_PER_BRANCH = 3
const FIRST_LEVEL_START = -Math.PI / 2
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export function buildAskMindMapState(payload: AskMindMapPayload): MindMapState {
  const answer = String(payload.answer ?? '').trim()
  if (!answer) throw new Error('Ask answer is empty')
  if (!Array.isArray(payload.sources) || payload.sources.length === 0) {
    throw new Error('Ask answer has no sources')
  }

  const rootLabel = deriveRootLabel(payload.question, answer)
  const nodes: MindMapNode[] = [
    { id: 'root', parentId: null, label: rootLabel, depth: 0, slotAngle: null },
  ]

  const branchLabels = deriveBranchLabels(answer)
  const labels = branchLabels.length > 0 ? branchLabels : ['Summary']

  labels.slice(0, MAX_BRANCHES).forEach((label, index) => {
    const branch: MindMapNode = {
      id: `ask_b${index + 1}`,
      parentId: 'root',
      label: clampLabel(label),
      depth: 1,
      slotAngle: normalizeAngle(FIRST_LEVEL_START + index * GOLDEN_ANGLE),
    }
    nodes.push(branch)

    const citedSources = sourcesForLabel(branch.label, payload.sources)
    const children = citedSources.length > 0 ? citedSources : fallbackSources(payload.sources, index)
    children.slice(0, MAX_CHILDREN_PER_BRANCH).forEach((source, childIndex) => {
      nodes.push({
        id: `ask_b${index + 1}_s${childIndex + 1}`,
        parentId: branch.id,
        label: clampSourceLabel(source.segmentText),
        depth: 2,
        slotAngle: branch.slotAngle,
      })
    })
  })

  return { rootId: 'root', nodes, topicSource: 'llm-detected' }
}

function deriveRootLabel(question: string, answer: string): string {
  const cleanedQuestion = stripQuestionPrefix(stripCitations(question).trim())
  if (cleanedQuestion) return clampLabel(cleanedQuestion)
  const firstAnswerSentence = splitAnswer(answer)[0] ?? 'Ask summary'
  return clampLabel(stripCitations(firstAnswerSentence))
}

function stripQuestionPrefix(text: string): string {
  return text
    .replace(/^\s*(summarize|summary of|what did we decide about|what were|what was|what is|how did|who|why)\s+/i, '')
    .replace(/^\s*(요약해줘|요약|무엇을|뭘|어떤|누가|왜|어떻게)\s*/i, '')
    .replace(/[?.!。？！]+$/g, '')
    .trim()
}

function deriveBranchLabels(answer: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const sentence of splitAnswer(answer)) {
    const label = cleanupLabel(sentence)
    if (!label) continue
    const key = stripCitations(label).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label)
    if (out.length >= MAX_BRANCHES) break
  }
  return out
}

function splitAnswer(answer: string): string[] {
  return answer
    .split(/(?<=[.!?。？！])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function cleanupLabel(text: string): string {
  return text
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/[.!?。？！]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sourcesForLabel(label: string, sources: ChatSource[]): ChatSource[] {
  const markers = Array.from(label.matchAll(/\[\^(\d+)\]/g))
    .map((match) => Number(match[1]))
    .filter((marker) => Number.isInteger(marker))
  if (markers.length === 0) return []
  return markers
    .map((marker) => sources.find((source) => source.marker === marker))
    .filter((source): source is ChatSource => Boolean(source))
}

function fallbackSources(sources: ChatSource[], branchIndex: number): ChatSource[] {
  if (branchIndex === 0) return sources
  return []
}

function stripCitations(text: string): string {
  return String(text ?? '').replace(/\[\^\d+\]/g, '').replace(/\s+/g, ' ')
}

function clampLabel(text: string): string {
  const trimmed = cleanupLabel(text)
  if (trimmed.length <= MAX_LABEL_CHARS) return trimmed
  return `${trimmed.slice(0, MAX_LABEL_CHARS - 3).trimEnd()}...`
}

function clampSourceLabel(text: string): string {
  const trimmed = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (trimmed.length <= MAX_LABEL_CHARS) return trimmed
  return `${trimmed.slice(0, MAX_LABEL_CHARS - 3).trimEnd()}...`
}

function normalizeAngle(a: number): number {
  let v = a
  while (v > Math.PI) v -= 2 * Math.PI
  while (v < -Math.PI) v += 2 * Math.PI
  return v
}
