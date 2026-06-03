import { log as defaultLog, type LogLevel } from '../telemetry/logger'
import type { MemoryRepository } from './repository'
import type { Meeting } from './types'

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_THRESHOLD = 0.6

export type ClusterSummaryCall = (args: {
  model: string
  userPrompt: string
}) => Promise<string>

type Logger = (
  level: LogLevel,
  scope: string,
  message: string,
  details?: Record<string, unknown>
) => void

interface MemoryTreeBuilderDeps {
  repo: MemoryRepository
  summarizeCluster?: ClusterSummaryCall
  threshold?: number
  now?: () => number
  log?: Logger
  model?: string
}

interface ClusterMemberSummary {
  meeting: Meeting
  shortSummary: string
}

function averageVectors(vectors: Float32Array[]): Float32Array | null {
  const [first] = vectors
  if (!first) return null
  const sums = new Float32Array(first.length)
  let count = 0
  for (const vector of vectors) {
    if (vector.length !== first.length) continue
    for (let i = 0; i < vector.length; i += 1) sums[i] += vector[i]
    count += 1
  }
  if (count === 0) return null
  for (let i = 0; i < sums.length; i += 1) sums[i] /= count
  return sums
}

function parseClusterSummary(text: string): { title: string; summary: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const title = (lines[0] ?? 'Meeting cluster').slice(0, 60)
  const summary = (lines.slice(1).join(' ') || title).slice(0, 500)
  return { title, summary }
}

function buildClusterPrompt(members: ClusterMemberSummary[]): string {
  const meetings = members
    .map((member, index) => {
      return `${index + 1}. ${member.meeting.title}\nSummary: ${member.shortSummary}`
    })
    .join('\n\n')
  return [
    'Given these meetings (titles + short summaries), produce: line 1 = short topic title (<=60 chars), then blank line, then 2-3 sentence cross-meeting summary (<=500 chars total). Plain text, no JSON.',
    '',
    meetings,
  ].join('\n')
}

async function defaultSummarizeCluster(args: { model: string; userPrompt: string }): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You summarize related meeting memories into one concise cluster title and summary.',
        },
        { role: 'user', content: args.userPrompt },
      ],
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OpenAI memory tree summary error ${response.status}: ${text.slice(0, 300)}`)
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return payload.choices?.[0]?.message?.content?.trim() ?? ''
}

export class MemoryTreeBuilder {
  private repo: MemoryRepository
  private summarizeCluster: ClusterSummaryCall
  private threshold: number
  private now: () => number
  private log: Logger
  private model: string

  constructor(deps: MemoryTreeBuilderDeps) {
    this.repo = deps.repo
    this.summarizeCluster = deps.summarizeCluster ?? defaultSummarizeCluster
    this.threshold =
      deps.threshold ?? Number(process.env.MEMORY_TREE_CLUSTER_THRESHOLD ?? DEFAULT_THRESHOLD)
    this.now = deps.now ?? (() => Date.now())
    this.log = deps.log ?? defaultLog
    this.model = deps.model ?? DEFAULT_MODEL
  }

  async rebuildForMeeting(meetingId: string): Promise<void> {
    const meeting = this.repo.getMeeting(meetingId)
    if (!meeting) return
    const meetingCentroid = averageVectors(this.repo.getMeetingEmbeddings(meetingId).map((e) => e.vector))
    if (!meetingCentroid) {
      this.log('warn', 'memory-tree', 'Skipping cluster rebuild; meeting has no embeddings', {
        meetingId,
      })
      return
    }

    const nearest = this.repo.findNearestClusterToCentroid(meetingCentroid, this.threshold)
    const now = this.now()
    const clusterId = nearest?.cluster.id ?? `cluster_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    if (!nearest) {
      const parsed = await this.summarizeMembers([meetingId])
      this.repo.insertCluster({
        id: clusterId,
        title: parsed.title,
        summary: parsed.summary,
        centroid: meetingCentroid,
        memberCount: 0,
        createdAt: now,
      })
      this.repo.addClusterMember(clusterId, meetingId)
      return
    }

    this.repo.addClusterMember(clusterId, meetingId)
    this.repo.recalcClusterCentroid(clusterId)
    const parsed = await this.summarizeMembers(this.listClusterMeetingIds(clusterId))
    this.repo.updateClusterSummary(clusterId, parsed.title, parsed.summary, now)
  }

  private async summarizeMembers(meetingIds: string[]): Promise<{ title: string; summary: string }> {
    const members = meetingIds
      .map((meetingId): ClusterMemberSummary | null => {
        const meeting = this.repo.getMeeting(meetingId)
        if (!meeting) return null
        const summary = this.repo.getSummary(meetingId)
        return {
          meeting,
          shortSummary: summary?.shortSummary ?? '(No summary yet)',
        }
      })
      .filter((member): member is ClusterMemberSummary => member !== null)
    const raw = await this.summarizeCluster({
      model: this.model,
      userPrompt: buildClusterPrompt(members),
    })
    return parseClusterSummary(raw)
  }

  private listClusterMeetingIds(clusterId: string): string[] {
    const rows = this.repo.raw
      .prepare(
        `SELECT meeting_id AS meetingId
         FROM meeting_cluster_members
         WHERE cluster_id = ?
         ORDER BY rowid ASC`
      )
      .all(clusterId) as Array<{ meetingId: string }>
    return rows.map((row) => row.meetingId)
  }
}
