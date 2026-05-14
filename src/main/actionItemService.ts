import type { BrowserWindow } from 'electron'

const ACTION_ITEM_MODEL = process.env.ACTION_ITEM_MODEL ?? 'gpt-4.1-mini'
const ACTION_ITEM_FLUSH_MS = Number(process.env.ACTION_ITEM_FLUSH_MS ?? 30_000)
const ACTION_ITEM_FAST_FLUSH_MS = Number(process.env.ACTION_ITEM_FAST_FLUSH_MS ?? 5_000)
const ACTION_ITEM_MIN_CHARS = Number(process.env.ACTION_ITEM_MIN_CHARS ?? 40)
const ACTION_ITEM_MAX_BATCH_CHARS = Number(process.env.ACTION_ITEM_MAX_BATCH_CHARS ?? 4_000)
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const ACTION_CUE_RE =
  /\b(please|can you|could you|should|need to|needs to|follow up|send|create|file|schedule|assign|review|prepare|update|fix|by friday|tomorrow)\b|해야|해주세요|부탁|내일|금요일|정리|공유|보내|만들|수정|확인|담당/i

type ActionItemStatus = 'suggested' | 'accepted' | 'done' | 'dismissed'

export type ActionItem = {
  id: string
  title: string
  owner?: string
  due?: string
  sourceText: string
  status: ActionItemStatus
  createdAtMs: number
}

type ExtractedActionItem = {
  title?: unknown
  owner?: unknown
  due?: unknown
  sourceText?: unknown
}

let mainWindowRef: BrowserWindow | null = null
let buffer = ''
let retryBuffer: string | null = null
let retryCount = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushTimerIsFast = false
let warnedMissingApiKey = false
const seenKeys = new Set<string>()

export function init(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
}

export function enqueueTranscript(text: string): void {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return
  buffer = trimBatch([buffer, trimmed].filter(Boolean).join(' '))
  if (flushTimer && !flushTimerIsFast && shouldFastFlush(buffer)) {
    clearTimeout(flushTimer)
    flushTimer = null
    flushTimerIsFast = false
  }
  scheduleFlush()
}

export function resetActionItems(): void {
  buffer = ''
  retryBuffer = null
  retryCount = 0
  seenKeys.clear()
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
    flushTimerIsFast = false
  }
  mainWindowRef?.webContents.send('actions:reset')
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimerIsFast = shouldFastFlush(buffer)
  const delay = flushTimerIsFast ? ACTION_ITEM_FAST_FLUSH_MS : ACTION_ITEM_FLUSH_MS
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushTimerIsFast = false
    void flushActionItemBuffer()
  }, delay)
}

async function flushActionItemBuffer(): Promise<void> {
  const batch = retryBuffer ?? buffer.trim()
  if (!batch || batch.length < ACTION_ITEM_MIN_CHARS) {
    if (buffer.trim()) scheduleFlush()
    return
  }

  if (!retryBuffer) buffer = ''

  try {
    const candidates = await extractActionItems(batch)
    retryBuffer = null
    retryCount = 0
    const freshItems = candidates.filter((item) => {
      const key = normalizeActionItemKey(item)
      if (!key || seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })
    if (freshItems.length > 0) {
      mainWindowRef?.webContents.send('actions:suggested', { items: freshItems })
    }
  } catch (err) {
    if (retryCount < 1) {
      retryBuffer = batch
      retryCount += 1
      scheduleFlush()
      return
    }
    retryBuffer = null
    retryCount = 0
    console.warn(
      '[actions] extraction failed; dropping batch:',
      err instanceof Error ? err.message : String(err)
    )
  } finally {
    if (buffer.trim()) scheduleFlush()
  }
}

async function extractActionItems(transcript: string): Promise<ActionItem[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    if (!warnedMissingApiKey) {
      warnedMissingApiKey = true
      console.warn('[actions] OPENAI_API_KEY not configured; action extraction disabled')
    }
    return []
  }

  const requestBody = {
    model: ACTION_ITEM_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You extract meeting action items. Return JSON only: {"items":[{"title":"...","owner":"...","due":"...","sourceText":"..."}]}. Extract only explicit or strongly implied tasks. Ignore general discussion, ideas without commitment, filler, and duplicates. Owner and due are optional strings. Return at most 5 items.',
      },
      {
        role: 'user',
        content: `Meeting transcript batch:\n\n${transcript}`,
      },
    ],
  }

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OpenAI action extraction error ${response.status}: ${text.slice(0, 300)}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content?.trim() ?? ''
  if (!content) return []

  const parsed = JSON.parse(stripJsonFence(content)) as { items?: ExtractedActionItem[] }
  if (!Array.isArray(parsed.items)) return []

  return parsed.items
    .map(toActionItem)
    .filter((item): item is ActionItem => item !== null)
    .slice(0, 5)
}

function toActionItem(candidate: ExtractedActionItem): ActionItem | null {
  const title = stringValue(candidate.title)
  const sourceText = stringValue(candidate.sourceText)
  if (!title || !sourceText) return null

  return {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    owner: stringValue(candidate.owner) || undefined,
    due: stringValue(candidate.due) || undefined,
    sourceText,
    status: 'suggested',
    createdAtMs: Date.now(),
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stripJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

function normalizeActionItemKey(item: ActionItem): string {
  return [item.title, item.owner ?? '', item.due ?? '']
    .join('|')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function trimBatch(text: string): string {
  if (text.length <= ACTION_ITEM_MAX_BATCH_CHARS) return text
  return text.slice(text.length - ACTION_ITEM_MAX_BATCH_CHARS)
}

function shouldFastFlush(text: string): boolean {
  return text.length >= ACTION_ITEM_MIN_CHARS && ACTION_CUE_RE.test(text)
}
