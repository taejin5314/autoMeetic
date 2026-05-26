import { log } from '../telemetry/logger'
import { checkDeepAskGate } from './agents/gate'
import { callLeadAgent } from './agents/leadAgent'
import { mergeCitations } from './agents/citationMerger'
import { estimateCostUsd } from './agents/pricing'
import { runSubagent } from './agents/subagent'
import { runSynthesizer } from './agents/synthesizer'
import type { MemoryService } from './memoryService'
import type { ChatMessage, ChatSource } from './types'
import type { CostBreakdown, DeepAskEvent, Plan, SubagentResult } from './agents/types'

const LEAD_MODEL = process.env.MEMORY_DEEP_ASK_LEAD_MODEL ?? 'gpt-4o'
const SUBAGENT_MODEL = process.env.MEMORY_DEEP_ASK_SUBAGENT_MODEL ?? 'gpt-4o-mini'
const SYNTH_MODEL = process.env.MEMORY_DEEP_ASK_SYNTH_MODEL ?? 'gpt-4o'

export interface DeepAskDeps {
  memory: Pick<MemoryService, 'search' | 'getMeeting' | 'activeGlossary'>
}

export async function runDeepAsk(
  args: { question: string; history: ChatMessage[] },
  sendEvent: (e: DeepAskEvent) => void,
  deps: DeepAskDeps
): Promise<void> {
  const startedAt = Date.now()
  log('info', 'memory-deep-ask', 'memory.deep-ask.submit', {
    questionLength: args.question.length,
  })

  const gate = await checkDeepAskGate({ question: args.question })
  if (!gate.allowed) {
    sendEvent({ type: 'gate-denied', reason: gate.reason ?? 'Not permitted' })
    return
  }

  let plan: Plan
  let leadIn: number
  let leadOut: number
  try {
    const leadResult = await callLeadAgent({ question: args.question, history: args.history })
    plan = leadResult.plan
    leadIn = leadResult.inputTokens
    leadOut = leadResult.outputTokens
    sendEvent({ type: 'plan-created', plan })
    log('info', 'memory-deep-ask', 'memory.deep-ask.planned', {
      subagentCount: plan.subagents.length,
      reasoningLength: plan.reasoning.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('warn', 'memory-deep-ask', 'memory.deep-ask.error', { phase: 'lead', message })
    sendEvent({ type: 'error', message, phase: 'lead' })
    return
  }

  let results: SubagentResult[]
  try {
    results = await Promise.all(
      plan.subagents.map((brief) => runSubagent(brief, { memory: deps.memory }, sendEvent))
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('warn', 'memory-deep-ask', 'memory.deep-ask.error', { phase: 'subagents', message })
    sendEvent({ type: 'error', message, phase: 'subagents' })
    return
  }

  const merged = mergeCitations(results)

  let synth
  try {
    synth = await runSynthesizer({
      question: args.question,
      plan,
      results,
      numbered: merged.numbered,
      memory: deps.memory,
      sendEvent,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('warn', 'memory-deep-ask', 'memory.deep-ask.error', { phase: 'synth', message })
    sendEvent({ type: 'error', message, phase: 'synth' })
    return
  }

  const costBreakdown = buildCostBreakdown({
    leadIn,
    leadOut,
    results,
    synthIn: synth.inputTokens,
    synthOut: synth.outputTokens,
  })

  const sources: ChatSource[] = merged.numbered.map((c) => {
    const detail = deps.memory.getMeeting(c.meetingId)
    const meeting = detail?.meeting
    const segment = detail?.segments.find((s) => s.id === c.segmentId)
    return {
      marker: c.marker,
      kind: 'segment',
      meetingId: c.meetingId,
      meetingTitle: meeting?.title ?? '(unknown)',
      segmentId: c.segmentId,
      segmentText: c.quote,
      timestampMs: segment ? Math.max(0, segment.createdAt - (meeting?.startedAt ?? segment.createdAt)) : 0,
      meetingStartedAt: meeting?.startedAt ?? 0,
      score: 1,
    }
  })

  const durationMs = Date.now() - startedAt
  log('info', 'memory-deep-ask', 'memory.deep-ask.completed', {
    totalTokens: costBreakdown.total.tokens,
    estimatedUsd: costBreakdown.total.estimatedUsd,
    durationMs,
    sourceCount: sources.length,
    subagentCount: results.length,
  })

  sendEvent({
    type: 'done',
    answer: synth.answer,
    sources,
    costBreakdown,
    durationMs,
  })
}

interface BuildCostArgs {
  leadIn: number
  leadOut: number
  results: SubagentResult[]
  synthIn: number
  synthOut: number
}

function buildCostBreakdown(args: BuildCostArgs): CostBreakdown {
  const leadUsd = estimateCostUsd(LEAD_MODEL, args.leadIn, args.leadOut)
  const subTotalIn = args.results.reduce((s, r) => s + r.tokensIn, 0)
  const subTotalOut = args.results.reduce((s, r) => s + r.tokensOut, 0)
  const subUsd = estimateCostUsd(SUBAGENT_MODEL, subTotalIn, subTotalOut)
  const synthUsd = estimateCostUsd(SYNTH_MODEL, args.synthIn, args.synthOut)
  return {
    lead: { inputTokens: args.leadIn, outputTokens: args.leadOut, estimatedUsd: leadUsd },
    subagents: {
      totalInputTokens: subTotalIn,
      totalOutputTokens: subTotalOut,
      estimatedUsd: subUsd,
      perAgent: args.results.map((r) => ({
        idx: r.idx,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        toolCalls: r.toolCallsUsed,
      })),
    },
    synthesizer: { inputTokens: args.synthIn, outputTokens: args.synthOut, estimatedUsd: synthUsd },
    toolCalls: {
      search: 0,
      getDetail: 0,
    },
    total: {
      tokens: args.leadIn + args.leadOut + subTotalIn + subTotalOut + args.synthIn + args.synthOut,
      estimatedUsd: leadUsd + subUsd + synthUsd,
    },
  }
}
