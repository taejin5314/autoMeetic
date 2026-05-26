import type { NumberedCitation } from '../citationMerger'
import type { Plan, SubagentResult } from '../types'

const SYNTHESIZER_SYSTEM = `You are the synthesizer for autoMeetic Deep Ask. You receive:
- The original user question
- The lead agent's reasoning + synthesis guidance
- One or more subagent summaries with their evidence
- A numbered list of evidence items (use these markers, do NOT invent new ones)

Your job: write a cohesive, cited answer in the user's language.

RULES
- 2-5 short paragraphs total.
- Every factual claim must cite [^N] from the provided numbered evidence.
- Do not invent citation numbers beyond what is listed.
- Do not fabricate facts not supported by subagent evidence or summaries.
- If subagents could not find evidence for an angle, say so honestly.
- If any subagent failed, the input will say "(partial coverage)" - acknowledge this in the answer.
- Plain prose. No markdown formatting beyond [^N] citation markers.
- Answer in the language of the original question.`

export function formatNumberedEvidence(numbered: NumberedCitation[]): string {
  if (numbered.length === 0) return '(no evidence collected)'
  return numbered
    .map((c) => `[^${c.marker}] (meeting=${c.meetingId}, segment=${c.segmentId}) "${c.quote}"`)
    .join('\n')
}

interface BuildArgs {
  question: string
  plan: Plan
  results: SubagentResult[]
  numbered: NumberedCitation[]
}

export function buildSynthesizerMessages(
  args: BuildArgs
): Array<{ role: 'system' | 'user'; content: string }> {
  const anyFailed = args.results.some((r) => r.status === 'failed')
  const subagentBlock = args.results
    .map((r) => {
      const objective = args.plan.subagents.find((s) => s.idx === r.idx)?.objective ?? '(unknown)'
      const label = r.status === 'failed' ? '[FAILED]' : r.status === 'capped' ? '[CAPPED]' : '[OK]'
      return `Subagent #${r.idx} ${label}\nObjective: ${objective}\nSummary: ${r.summary}`
    })
    .join('\n\n')

  const partialNote = anyFailed
    ? '\n\nNOTE: This run had partial coverage - at least one subagent failed. Reflect this honestly.'
    : ''

  const userContent = `ORIGINAL QUESTION
${args.question}

LEAD REASONING
${args.plan.reasoning}

SYNTHESIS GUIDANCE
${args.plan.synthesisGuidance}

SUBAGENT RESULTS
${subagentBlock}

NUMBERED EVIDENCE (cite as [^N])
${formatNumberedEvidence(args.numbered)}${partialNote}`

  return [
    { role: 'system', content: SYNTHESIZER_SYSTEM },
    { role: 'user', content: userContent },
  ]
}
