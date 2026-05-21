import type { MemoryService } from '../memory/memoryService'
import { buildTranscriptUserPrompt } from '../memory/prompts/summary.v1'
import { log } from '../telemetry/logger'
import { buildExtractionSystemPrompt, parseExtractionResponse } from './extractionPrompt'

const EXTRACTION_MODEL = process.env.GLOSSARY_EXTRACTION_MODEL ?? 'gpt-4o-mini'
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const MAX_TRANSCRIPT_CHARS = 100_000

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

function info(message: string, details?: Record<string, unknown>): void {
  log('info', 'glossary-suggestions', message, details)
}

function warn(message: string, details?: Record<string, unknown>): void {
  log('warn', 'glossary-suggestions', message, details)
}

export async function extractCandidates(
  memory: MemoryService,
  meetingId: string,
  notify: () => void
): Promise<void> {
  try {
    const m = memory.repository.getMeeting(meetingId)
    if (!m) {
      warn('glossary.extraction.no-meeting', { meetingId })
      return
    }

    const segments = memory.repository.listSegmentsByMeeting(meetingId)
    if (segments.length === 0) {
      info('glossary.extraction.empty-transcript', { meetingId })
      return
    }

    const userPrompt = buildTranscriptUserPrompt(m.startedAt, segments)
    if (userPrompt.length > MAX_TRANSCRIPT_CHARS) {
      warn('glossary.extraction.failure', {
        meetingId,
        reason: 'transcript-too-large',
        length: userPrompt.length,
      })
      return
    }

    const existingEntries = memory.repository.activeGlossary(meetingId)
    const dismissedTerms = memory.repository.listDismissedTerms(200)
    const targetLang = m.targetLanguage ?? 'off'

    const systemPrompt = buildExtractionSystemPrompt({
      targetLang,
      existingTerms: existingEntries.map((e) => e.sourceTerm),
      dismissedTerms,
    })

    const res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    })

    if (!res.ok) {
      warn('glossary.extraction.failure', {
        meetingId,
        reason: 'llm-error',
        status: res.status,
      })
      return
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    const candidates = parseExtractionResponse(content)

    if (candidates.length === 0) {
      info('glossary.extraction.success', { meetingId, emitted: 0 })
      return
    }

    const existingLower = new Set(existingEntries.map((e) => e.sourceTerm.toLowerCase()))
    const dismissedLower = new Set(dismissedTerms.map((d) => d.toLowerCase()))
    const seenInBatch = new Map<string, (typeof candidates)[number]>()
    for (const c of candidates) {
      const key = c.sourceTerm.toLowerCase()
      if (existingLower.has(key) || dismissedLower.has(key)) continue
      const prev = seenInBatch.get(key)
      if (!prev || prev.confidence < c.confidence) seenInBatch.set(key, c)
    }

    let written = 0
    for (const c of seenInBatch.values()) {
      try {
        memory.repository.upsertSuggestion({
          meetingId,
          ...c,
        })
        written += 1
      } catch (err) {
        warn('glossary.extraction.upsert-failed', {
          meetingId,
          sourceTerm: c.sourceTerm,
          error: String(err),
        })
      }
    }

    info('glossary.extraction.success', {
      meetingId,
      emitted: written,
      candidatesProposed: candidates.length,
    })

    if (written > 0) notify()
  } catch (err) {
    warn('glossary.extraction.failure', {
      meetingId,
      reason: 'unexpected',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
