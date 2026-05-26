# Deep Ask — Multi-Agent Research Mode — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Checkbox (`- [ ]`) tracking. Phase-by-phase. Each phase ends with a clean `npm run verify:phase <N>` before the table in `HANDOFF.md` is updated. Read `HANDOFF.md` and `AGENTS.md` first for environment quirks (Windows better-sqlite3 ABI shim + `EBUSY` `npm test` quirk).

**Goal:** Add a `[⚡ Deep]` toggle to the Memory Library Ask tab that invokes a Hub-and-Spoke multi-agent flow: lead agent (gpt-4o) decomposes the question into 2–4 subagent briefs, subagents (gpt-4o-mini) explore in parallel via `SearchService` + `getMeetingDetail`, synthesizer (gpt-4o) combines results into a cited streamed answer.

**Architecture:** New `deepAskService` orchestrator in main + dedicated `agents/` module (lead, subagent, synthesizer, tools, pricing, gate). New IPC channel `memory:deep-ask` with rich event stream. Renderer gains a toggle, progress card, and answer footer. Existing single-shot `runChat` flow untouched — Deep is purely additive.

**Tech stack:** TypeScript strict (no `any` unless documented), OpenAI Chat Completions (`gpt-4o`, `gpt-4o-mini`, structured outputs `response_format: { type: 'json_schema' }`, function calling), vitest, existing `telemetry/logger.ts`.

**Spec:** `docs/superpowers/specs/2026-05-26-deep-ask-multi-agent-design.md`

**Scope reminder (do NOT exceed):** No real billing gate (Stream 2). No auto-router. No >4 subagents. No async-as-ready execution. No checkpoints. No cancel button. No pre-flight cost modal. Pure OpenAI throughout (no model swapping abstraction yet). Single-shot Ask path is unchanged.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/main/memory/agents/types.ts` | Create | `Plan`, `SubagentBrief`, `SubagentResult`, `Evidence`, `CostBreakdown`, `DeepAskEvent`, `GateResult`, `ToolName` |
| `src/main/memory/agents/prompts/lead.v1.ts` | Create | Lead system prompt + JSON schema for `Plan` + `buildLeadMessages` + `parsePlan` |
| `src/main/memory/agents/prompts/subagent.v1.ts` | Create | Subagent system prompt builder (templated with brief) |
| `src/main/memory/agents/prompts/synthesizer.v1.ts` | Create | Synthesizer prompt builder + numbered evidence formatter |
| `src/main/memory/agents/tools.ts` | Create | Tool schemas (`search_meetings`, `get_meeting_detail`, `finalize_summary`) + `invokeTool` dispatch |
| `src/main/memory/agents/pricing.ts` | Create | Per-model $/1M token table + `estimateCost(model, in, out)` helper |
| `src/main/memory/agents/gate.ts` | Create | `checkDeepAskGate(ctx)` placeholder, always allow |
| `src/main/memory/agents/leadAgent.ts` | Create | `callLeadAgent(question, history, sendEvent)` with retry on JSON parse fail |
| `src/main/memory/agents/subagent.ts` | Create | `runSubagent(brief, deps, sendEvent)` ReAct loop with `finalize_summary` terminator |
| `src/main/memory/agents/citationMerger.ts` | Create | `mergeCitations(subagentResults)` dedupes by `segmentId`, assigns 1-based numbers |
| `src/main/memory/agents/synthesizer.ts` | Create | `runSynthesizer(question, plan, results, mergedCitations, sendEvent)` streams final answer |
| `src/main/memory/deepAskService.ts` | Create | Top-level `runDeepAsk(args, sendEvent, deps)` — gate → lead → parallel subagents → synth |
| `src/main/ipc-memory-handlers.ts` | Modify | Register `memory:deep-ask` handler |
| `src/preload/index.ts` | Modify | Expose `memory.deepAsk` + `memory.onDeepAskEvent` |
| `src/preload/types.ts` | Modify | Type additions for the new API + events |
| `src/renderer/ask/types.ts` | Modify | Re-export `DeepAskEvent`, `CostBreakdown`, `Plan`, `SubagentBrief` |
| `src/renderer/ask/useChatStore.ts` | Modify | Add `deepEnabled: boolean` state + `submitDeep()` branch + event handlers |
| `src/renderer/ask/DeepAskToggle.tsx` | Create | Pill toggle component (`⚡ Deep`) |
| `src/renderer/ask/AskInput.tsx` | Modify | Mount `<DeepAskToggle>` to the left of the send button |
| `src/renderer/ask/DeepAskProgressCard.tsx` | Create | Plan + per-subagent status rows + synthesizing indicator |
| `src/renderer/ask/AnswerFooter.tsx` | Create | `⚡ Deep · N agents · K tool calls · ~$X · Ys` |
| `src/renderer/ask/ChatMessageView.tsx` | Modify | Render progress card when in-flight deep; render footer when done deep |
| `src/renderer/App.css` | Modify | Toggle + progress card + footer styles |
| `src/test/deep-ask-lead.test.ts` | Create | Lead prompt + JSON parsing tests (~6) |
| `src/test/deep-ask-subagent.test.ts` | Create | ReAct loop + tool-call cap + finalize_summary (~6) |
| `src/test/deep-ask-citation-merger.test.ts` | Create | Dedup + numbering (~5) |
| `src/test/deep-ask-synthesizer.test.ts` | Create | Prompt structure + evidence list formatting (~4) |
| `src/test/deep-ask-orchestrator.test.ts` | Create | Full happy path + partial-failure path (~5) |
| `src/test/deep-ask-ipc.test.ts` | Create | IPC handler emits the expected events (~3) |
| `HANDOFF.md` | Modify | New active stream block + status table |

---

## Phase 1 — Types + lead agent (TDD)

### Task 1.1 — Add types

**Files:** `src/main/memory/agents/types.ts`

- [ ] **Step 1: Create file**

```ts
import type { ChatSource } from '../types'

export type ToolName = 'search_meetings' | 'get_meeting_detail'

export interface SubagentBrief {
  idx: number
  objective: string
  outputFormat: string
  toolsAllowed: ToolName[]
  boundaries: {
    maxToolCalls: number
    focusKeywords?: string[]
    meetingDateRange?: [number, number]
  }
}

export interface Plan {
  reasoning: string
  subagents: SubagentBrief[]
  synthesisGuidance: string
}

export interface Evidence {
  meetingId: string
  segmentId: string
  quote: string
}

export interface SubagentResult {
  idx: number
  status: 'ok' | 'failed' | 'capped'
  summary: string
  evidence: Evidence[]
  toolCallsUsed: number
  durationMs: number
  error?: string
  tokensIn: number
  tokensOut: number
}

export interface CostBreakdown {
  lead: { inputTokens: number; outputTokens: number; estimatedUsd: number }
  subagents: {
    totalInputTokens: number
    totalOutputTokens: number
    estimatedUsd: number
    perAgent: Array<{ idx: number; tokensIn: number; tokensOut: number; toolCalls: number }>
  }
  synthesizer: { inputTokens: number; outputTokens: number; estimatedUsd: number }
  toolCalls: { search: number; getDetail: number }
  total: { tokens: number; estimatedUsd: number }
}

export interface GateContext {
  question: string
  userId?: string
}

export interface GateResult {
  allowed: boolean
  reason?: string
}

export type DeepAskEvent =
  | { type: 'gate-denied'; reason: string }
  | { type: 'plan-created'; plan: Plan }
  | { type: 'subagent-started'; idx: number; brief: SubagentBrief }
  | { type: 'subagent-tool-call'; idx: number; toolName: ToolName | 'finalize_summary' }
  | {
      type: 'subagent-result'
      idx: number
      summary: string
      evidence: Evidence[]
      toolCallsUsed: number
      durationMs: number
    }
  | { type: 'subagent-failed'; idx: number; error: string }
  | { type: 'synthesizing'; sourceCount: number }
  | { type: 'delta'; content: string }
  | { type: 'done'; answer: string; sources: ChatSource[]; costBreakdown: CostBreakdown; durationMs: number }
  | { type: 'error'; message: string; phase: 'lead' | 'subagents' | 'synth' }
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/main/memory/agents/types.ts
git commit -m "feat(deep-ask): add agents types module"
```

---

### Task 1.2 — Lead prompt + parser (TDD)

**Files:** `src/main/memory/agents/prompts/lead.v1.ts`, `src/test/deep-ask-lead.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/deep-ask-lead.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  PLAN_JSON_SCHEMA,
  buildLeadMessages,
  parsePlan,
} from '../main/memory/agents/prompts/lead.v1'

describe('buildLeadMessages', () => {
  it('includes question and last-N history with citations stripped', () => {
    const msgs = buildLeadMessages({
      question: 'How did OKRs change between Q3 and Q4?',
      history: [
        { role: 'user', content: 'previous' },
        { role: 'assistant', content: 'a [^1] then b [^2]' },
      ],
    })
    expect(msgs[0].role).toBe('system')
    expect(msgs.at(-1)!.content).toContain('How did OKRs change')
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.content).toBe('a then b')
  })

  it('clamps history to last 6 messages', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `msg ${i}`,
    }))
    const msgs = buildLeadMessages({ question: 'q', history })
    // 1 system + 6 history + 1 new user = 8
    expect(msgs).toHaveLength(8)
  })
})

describe('PLAN_JSON_SCHEMA', () => {
  it('has required top-level fields', () => {
    expect(PLAN_JSON_SCHEMA.schema.required).toContain('reasoning')
    expect(PLAN_JSON_SCHEMA.schema.required).toContain('subagents')
    expect(PLAN_JSON_SCHEMA.schema.required).toContain('synthesisGuidance')
  })

  it('caps subagents array at 4 items', () => {
    expect(PLAN_JSON_SCHEMA.schema.properties.subagents.maxItems).toBe(4)
  })
})

describe('parsePlan', () => {
  it('parses a valid plan and indexes subagents 0..N-1', () => {
    const raw = JSON.stringify({
      reasoning: 'multi-angle',
      subagents: [
        {
          objective: 'A',
          outputFormat: 'summary',
          toolsAllowed: ['search_meetings'],
          boundaries: { maxToolCalls: 10 },
        },
        {
          objective: 'B',
          outputFormat: 'summary',
          toolsAllowed: ['search_meetings', 'get_meeting_detail'],
          boundaries: { maxToolCalls: 8 },
        },
      ],
      synthesisGuidance: 'compare',
    })
    const plan = parsePlan(raw)
    expect(plan.subagents).toHaveLength(2)
    expect(plan.subagents[0].idx).toBe(0)
    expect(plan.subagents[1].idx).toBe(1)
  })

  it('truncates >4 subagents to first 4', () => {
    const raw = JSON.stringify({
      reasoning: 'r',
      synthesisGuidance: 'g',
      subagents: Array.from({ length: 7 }, () => ({
        objective: 'o',
        outputFormat: 'f',
        toolsAllowed: ['search_meetings'],
        boundaries: { maxToolCalls: 10 },
      })),
    })
    const plan = parsePlan(raw)
    expect(plan.subagents).toHaveLength(4)
  })

  it('clamps maxToolCalls to 10', () => {
    const raw = JSON.stringify({
      reasoning: 'r',
      synthesisGuidance: 'g',
      subagents: [
        {
          objective: 'o',
          outputFormat: 'f',
          toolsAllowed: ['search_meetings'],
          boundaries: { maxToolCalls: 50 },
        },
      ],
    })
    const plan = parsePlan(raw)
    expect(plan.subagents[0].boundaries.maxToolCalls).toBe(10)
  })

  it('throws on malformed JSON', () => {
    expect(() => parsePlan('not json')).toThrow()
  })

  it('throws on missing required fields', () => {
    expect(() => parsePlan('{"reasoning":"x"}')).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/deep-ask-lead.test.ts
```

Expect FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `src/main/memory/agents/prompts/lead.v1.ts`**

```ts
import type { ChatMessage } from '../../types'
import type { Plan, SubagentBrief, ToolName } from '../types'

const LEAD_SYSTEM_PROMPT = `You are the lead research agent for autoMeetic, a meeting-memory app.

A user has asked a question about their past meetings. Your job is to decide:
1. Is this trivial (one search will answer it)? Then emit a 1-subagent plan with a tight objective.
2. Is this multi-angle (comparison, trend, "what changed", multi-meeting synthesis)? Then decompose into 2–4 INDEPENDENT subagent briefs.

Scaling rules (hard):
- Simple fact-finding: 1 subagent, maxToolCalls 3–5
- Comparison or multi-angle: 2–4 subagents, maxToolCalls 5–10 each
- NEVER more than 4 subagents. If you need more, scope the question down to the 4 highest-leverage angles and note the trade-off in synthesisGuidance.

Each subagent brief MUST be self-contained: objective, outputFormat, toolsAllowed, boundaries. Subagents do NOT see each other — overlapping objectives waste tokens.

Tools available to subagents:
- search_meetings(query, limit): semantic + literal search across all past meetings
- get_meeting_detail(meetingId, focusSegmentId?): fetch full meeting metadata + 40-segment window (use sparingly, ~3× the cost of a search)

Output STRICT JSON matching the provided schema. No commentary, no markdown.`

export const PLAN_JSON_SCHEMA = {
  name: 'deep_ask_plan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reasoning', 'subagents', 'synthesisGuidance'],
    properties: {
      reasoning: { type: 'string' },
      synthesisGuidance: { type: 'string' },
      subagents: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['objective', 'outputFormat', 'toolsAllowed', 'boundaries'],
          properties: {
            objective: { type: 'string' },
            outputFormat: { type: 'string' },
            toolsAllowed: {
              type: 'array',
              items: { type: 'string', enum: ['search_meetings', 'get_meeting_detail'] },
            },
            boundaries: {
              type: 'object',
              additionalProperties: false,
              required: ['maxToolCalls'],
              properties: {
                maxToolCalls: { type: 'integer', minimum: 1, maximum: 10 },
                focusKeywords: { type: 'array', items: { type: 'string' } },
                meetingDateRange: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
              },
            },
          },
        },
      },
    },
  },
} as const

const HISTORY_LIMIT = 6

function stripCitations(text: string): string {
  return text.replace(/\[\^\d+\]/g, '').replace(/\s+/g, ' ').trim()
}

export function buildLeadMessages(args: {
  question: string
  history: ChatMessage[]
}): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    { role: 'system', content: LEAD_SYSTEM_PROMPT },
    ...args.history.slice(-HISTORY_LIMIT).map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? stripCitations(m.content) : m.content,
    })),
    { role: 'user', content: args.question },
  ]
}

interface RawSubagent {
  objective: string
  outputFormat: string
  toolsAllowed: ToolName[]
  boundaries: {
    maxToolCalls: number
    focusKeywords?: string[]
    meetingDateRange?: [number, number]
  }
}

interface RawPlan {
  reasoning: string
  subagents: RawSubagent[]
  synthesisGuidance: string
}

export function parsePlan(raw: string): Plan {
  const parsed = JSON.parse(raw) as RawPlan
  if (typeof parsed.reasoning !== 'string') throw new Error('Plan: missing reasoning')
  if (typeof parsed.synthesisGuidance !== 'string') throw new Error('Plan: missing synthesisGuidance')
  if (!Array.isArray(parsed.subagents) || parsed.subagents.length === 0)
    throw new Error('Plan: subagents must be a non-empty array')
  const subagents: SubagentBrief[] = parsed.subagents.slice(0, 4).map((s, idx) => ({
    idx,
    objective: s.objective,
    outputFormat: s.outputFormat,
    toolsAllowed: s.toolsAllowed,
    boundaries: {
      ...s.boundaries,
      maxToolCalls: Math.min(Math.max(1, s.boundaries.maxToolCalls), 10),
    },
  }))
  return {
    reasoning: parsed.reasoning,
    subagents,
    synthesisGuidance: parsed.synthesisGuidance,
  }
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/deep-ask-lead.test.ts
npm run typecheck
npm run lint
git add src/main/memory/agents/prompts/lead.v1.ts src/test/deep-ask-lead.test.ts
git commit -m "feat(deep-ask): lead prompt + JSON schema + parser"
```

---

### Task 1.3 — `leadAgent.ts` wrapper

**Files:** `src/main/memory/agents/leadAgent.ts`

- [ ] **Step 1: Create**

```ts
import { log } from '../../telemetry/logger'
import type { ChatMessage } from '../types'
import { PLAN_JSON_SCHEMA, buildLeadMessages, parsePlan } from './prompts/lead.v1'
import type { Plan } from './types'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const LEAD_MODEL = process.env.MEMORY_DEEP_ASK_LEAD_MODEL ?? 'gpt-4o'

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

export interface LeadResult {
  plan: Plan
  inputTokens: number
  outputTokens: number
}

export async function callLeadAgent(args: {
  question: string
  history: ChatMessage[]
}): Promise<LeadResult> {
  const messages = buildLeadMessages(args)
  const res = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: LEAD_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: 'json_schema', json_schema: PLAN_JSON_SCHEMA },
    }),
  })
  if (!res.ok) {
    throw new Error(`Lead OpenAI ${res.status}: ${await res.text().catch(() => 'no body')}`)
  }
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>
    usage: { prompt_tokens: number; completion_tokens: number }
  }
  const raw = data.choices[0]?.message?.content
  if (!raw) throw new Error('Lead returned empty content')
  let plan: Plan
  try {
    plan = parsePlan(raw)
  } catch (err) {
    log('warn', 'memory-deep-ask', 'memory.deep-ask.lead.parse-failure', {
      error: err instanceof Error ? err.message : String(err),
      rawSnippet: raw.slice(0, 200),
    })
    throw err
  }
  return {
    plan,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  }
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/main/memory/agents/leadAgent.ts
git commit -m "feat(deep-ask): lead agent OpenAI wrapper"
```

---

### Task 1.4 — Verify Phase 1

- [ ] **Run phase verification**

```bash
npm run verify:phase 1
```

Expected: `VERDICT: ✅ Phase 1 verified`.

- [ ] **Update `HANDOFF.md` Phase 1 row.**

---

## Phase 2 — Subagent runtime + tools (TDD)

### Task 2.1 — Tool schemas + dispatch

**Files:** `src/main/memory/agents/tools.ts`

- [ ] **Step 1: Create**

```ts
import type { MemoryService } from '../memoryService'
import type { Evidence } from './types'

export const TOOL_DEFS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_meetings',
      description:
        "Search the user's past meetings for relevant segments. Use SHORT broad queries (2–5 words) first; narrow only after a broad scan. Returns matched segments with meetingId, segmentId, snippet, and score.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_meeting_detail',
      description:
        'Fetch a meeting metadata + summary + a focused 40-segment window. Use ONLY after search reveals a meeting worth deep-reading. Each call costs ~3× a search call.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['meetingId'],
        properties: {
          meetingId: { type: 'string' },
          focusSegmentId: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finalize_summary',
      description:
        'Call when you have enough evidence. Returns your compressed summary + structured evidence. After this call the subagent ends. Do NOT include raw transcripts — only summaries with short quotes (≤200 chars each).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'evidence'],
        properties: {
          summary: { type: 'string', maxLength: 2000 },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['meetingId', 'segmentId', 'quote'],
              properties: {
                meetingId: { type: 'string' },
                segmentId: { type: 'string' },
                quote: { type: 'string', maxLength: 200 },
              },
            },
          },
        },
      },
    },
  },
] as const

export interface ToolDeps {
  memory: Pick<MemoryService, 'search' | 'getMeeting'>
}

export interface ToolResult {
  result: unknown
  countAs: 'search' | 'getDetail' | 'finalize'
}

export async function invokeTool(
  name: string,
  args: Record<string, unknown>,
  deps: ToolDeps
): Promise<ToolResult> {
  switch (name) {
    case 'search_meetings': {
      const query = String(args.query ?? '')
      const limit = Math.min(Math.max(1, Number(args.limit ?? 10)), 20)
      const hits = await deps.memory.search(query, limit)
      return {
        countAs: 'search',
        result: hits.map((h) => ({
          meetingId: h.meetingId,
          segmentId: h.segmentId,
          meetingTitle: h.meetingTitle,
          snippet: h.sourceText.slice(0, 200),
          score: h.score,
          kind: h.kind,
        })),
      }
    }
    case 'get_meeting_detail': {
      const meetingId = String(args.meetingId ?? '')
      const detail = deps.memory.getMeeting(meetingId)
      if (!detail) return { countAs: 'getDetail', result: { error: 'meeting not found' } }
      const segments = detail.segments.slice(0, 40)
      return {
        countAs: 'getDetail',
        result: {
          title: detail.meeting.title,
          startedAt: detail.meeting.startedAt,
          shortSummary: detail.summary?.shortSummary ?? null,
          segments: segments.map((s) => ({
            id: s.id,
            seq: s.seq,
            speakerLabel: s.speakerLabel,
            sourceText: s.sourceText,
          })),
        },
      }
    }
    case 'finalize_summary': {
      return { countAs: 'finalize', result: args }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

export function isFinalizeCall(name: string): boolean {
  return name === 'finalize_summary'
}

export function parseFinalize(args: Record<string, unknown>): {
  summary: string
  evidence: Evidence[]
} {
  const summary = String(args.summary ?? '')
  const evidenceRaw = Array.isArray(args.evidence) ? args.evidence : []
  const evidence: Evidence[] = evidenceRaw
    .filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object')
    .map((e) => ({
      meetingId: String(e.meetingId ?? ''),
      segmentId: String(e.segmentId ?? ''),
      quote: String(e.quote ?? '').slice(0, 200),
    }))
    .filter((e) => e.meetingId && e.segmentId)
  return { summary, evidence }
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/main/memory/agents/tools.ts
git commit -m "feat(deep-ask): tool schemas + dispatch (search, get_detail, finalize)"
```

---

### Task 2.2 — Subagent prompt builder

**Files:** `src/main/memory/agents/prompts/subagent.v1.ts`

- [ ] **Step 1: Create**

```ts
import type { SubagentBrief } from '../types'

export function buildSubagentSystemPrompt(brief: SubagentBrief): string {
  const focus = brief.boundaries.focusKeywords?.length
    ? `\n- Focus on these keywords if present: ${brief.boundaries.focusKeywords.join(', ')}`
    : ''
  const dateRange = brief.boundaries.meetingDateRange
    ? `\n- Meeting date range: ${new Date(brief.boundaries.meetingDateRange[0]).toISOString()} to ${new Date(brief.boundaries.meetingDateRange[1]).toISOString()}`
    : ''
  const toolsList = brief.toolsAllowed.join(', ')
  return `You are research subagent #${brief.idx} for autoMeetic.

YOUR BRIEF
- Objective: ${brief.objective}
- Output format: ${brief.outputFormat}
- Tools you may use: ${toolsList}, finalize_summary (always available)
- Tool-call budget: max ${brief.boundaries.maxToolCalls} (NOT counting finalize_summary)${focus}${dateRange}

STRATEGY
- Start with SHORT broad search queries (2–5 words) to map the landscape.
- Narrow only after a broad scan.
- Stop early if you have sufficient evidence — do not exhaust your budget.
- Do NOT pursue tangents outside your objective.

OUTPUT RULES
- Call finalize_summary when ready. After that call your subagent ends.
- The summary must be compressed (≤500 words). NO raw transcripts.
- For each factual claim, include an evidence item with {meetingId, segmentId, quote ≤200 chars}.
- Use quotes verbatim from search/get_detail results. Do NOT paraphrase quotes.
- If you cannot find sufficient evidence, finalize_summary with what you have and note the gap in the summary.`
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/main/memory/agents/prompts/subagent.v1.ts
git commit -m "feat(deep-ask): subagent prompt builder"
```

---

### Task 2.3 — Subagent ReAct loop (TDD)

**Files:** `src/main/memory/agents/subagent.ts`, `src/test/deep-ask-subagent.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/deep-ask-subagent.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { runSubagent } from '../main/memory/agents/subagent'
import type { SubagentBrief } from '../main/memory/agents/types'

const baseBrief = (over: Partial<SubagentBrief> = {}): SubagentBrief => ({
  idx: 0,
  objective: 'find foo',
  outputFormat: 'summary',
  toolsAllowed: ['search_meetings'],
  boundaries: { maxToolCalls: 3 },
  ...over,
})

function fakeOpenAI(steps: Array<{ tool_calls?: Array<{ name: string; arguments: string }>; content?: string }>) {
  let idx = 0
  return vi.fn(async () => {
    const step = steps[idx++]
    if (!step) throw new Error('No more steps in fake OpenAI')
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: step.content ?? null,
              tool_calls: step.tool_calls?.map((t, i) => ({
                id: `c${idx}_${i}`,
                type: 'function',
                function: { name: t.name, arguments: t.arguments },
              })),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as never
  })
}

const fakeMemory = {
  search: async (query: string) => [
    { meetingId: 'm1', segmentId: 's1', meetingTitle: 'M', sourceText: 'foo bar', score: 1, kind: 'segment' as const, createdAt: 0, startedAt: 0, seq: 0, speakerLabel: null, translatedText: null },
  ],
  getMeeting: () => null,
}

describe('runSubagent', () => {
  it('completes after one search + finalize', async () => {
    const fetchFn = fakeOpenAI([
      { tool_calls: [{ name: 'search_meetings', arguments: '{"query":"foo"}' }] },
      {
        tool_calls: [
          {
            name: 'finalize_summary',
            arguments: JSON.stringify({
              summary: 'all done',
              evidence: [{ meetingId: 'm1', segmentId: 's1', quote: 'foo bar' }],
            }),
          },
        ],
      },
    ])
    const events: unknown[] = []
    const result = await runSubagent(
      baseBrief(),
      { memory: fakeMemory as never, fetchFn },
      (e) => events.push(e)
    )
    expect(result.status).toBe('ok')
    expect(result.summary).toBe('all done')
    expect(result.evidence).toHaveLength(1)
    expect(result.toolCallsUsed).toBe(1)
  })

  it('forces finalize when tool-call cap reached', async () => {
    const fetchFn = fakeOpenAI([
      { tool_calls: [{ name: 'search_meetings', arguments: '{"query":"a"}' }] },
      { tool_calls: [{ name: 'search_meetings', arguments: '{"query":"b"}' }] },
      {
        tool_calls: [
          {
            name: 'finalize_summary',
            arguments: JSON.stringify({ summary: 'capped', evidence: [] }),
          },
        ],
      },
    ])
    const result = await runSubagent(
      baseBrief({ boundaries: { maxToolCalls: 2 } }),
      { memory: fakeMemory as never, fetchFn },
      () => {}
    )
    expect(result.status).toBe('capped')
    expect(result.toolCallsUsed).toBe(2)
    expect(result.summary).toBe('capped')
  })

  it('returns failed when LLM never calls finalize and never makes a tool call', async () => {
    const fetchFn = fakeOpenAI([{ content: 'wandering off' }])
    const result = await runSubagent(
      baseBrief(),
      { memory: fakeMemory as never, fetchFn },
      () => {}
    )
    expect(result.status).toBe('failed')
  })

  it('emits subagent-started + subagent-tool-call + subagent-result events', async () => {
    const fetchFn = fakeOpenAI([
      { tool_calls: [{ name: 'search_meetings', arguments: '{"query":"x"}' }] },
      {
        tool_calls: [
          {
            name: 'finalize_summary',
            arguments: JSON.stringify({ summary: 'done', evidence: [] }),
          },
        ],
      },
    ])
    const types: string[] = []
    await runSubagent(
      baseBrief(),
      { memory: fakeMemory as never, fetchFn },
      (e) => types.push((e as { type: string }).type)
    )
    expect(types[0]).toBe('subagent-started')
    expect(types).toContain('subagent-tool-call')
    expect(types.at(-1)).toBe('subagent-result')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/deep-ask-subagent.test.ts
```

Expect FAIL.

- [ ] **Step 3: Implement `src/main/memory/agents/subagent.ts`**

```ts
import { log } from '../../telemetry/logger'
import { buildSubagentSystemPrompt } from './prompts/subagent.v1'
import { TOOL_DEFS, ToolDeps, invokeTool, isFinalizeCall, parseFinalize } from './tools'
import type { DeepAskEvent, SubagentBrief, SubagentResult } from './types'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const SUBAGENT_MODEL = process.env.MEMORY_DEEP_ASK_SUBAGENT_MODEL ?? 'gpt-4o-mini'
const SUBAGENT_TIMEOUT_MS = 120_000

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

export interface SubagentDeps extends ToolDeps {
  fetchFn?: typeof fetch
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export async function runSubagent(
  brief: SubagentBrief,
  deps: SubagentDeps,
  sendEvent: (e: DeepAskEvent) => void
): Promise<SubagentResult> {
  const startedAt = Date.now()
  sendEvent({ type: 'subagent-started', idx: brief.idx, brief })

  const fetchFn = deps.fetchFn ?? fetch
  const messages: OpenAIMessage[] = [
    { role: 'system', content: buildSubagentSystemPrompt(brief) },
    { role: 'user', content: brief.objective },
  ]
  let toolCallsUsed = 0
  let tokensIn = 0
  let tokensOut = 0
  const maxIterations = brief.boundaries.maxToolCalls + 3 // safety: budget + finalize + a couple of natural-language responses

  for (let iter = 0; iter < maxIterations; iter++) {
    if (toolCallsUsed >= brief.boundaries.maxToolCalls) {
      messages.push({
        role: 'system',
        content:
          'You have hit your tool-call cap. Call finalize_summary now with whatever evidence you have.',
      })
    }
    let res: Response
    try {
      res = await fetchWithTimeout(fetchFn, {
        url: OPENAI_CHAT_URL,
        body: {
          model: SUBAGENT_MODEL,
          messages,
          tools: TOOL_DEFS,
          tool_choice: 'auto',
          temperature: 0.2,
          max_tokens: 1500,
        },
        timeoutMs: SUBAGENT_TIMEOUT_MS,
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      sendEvent({ type: 'subagent-failed', idx: brief.idx, error })
      return failed(brief, error, startedAt, toolCallsUsed, tokensIn, tokensOut)
    }
    if (!res.ok) {
      const error = `OpenAI ${res.status}`
      sendEvent({ type: 'subagent-failed', idx: brief.idx, error })
      return failed(brief, error, startedAt, toolCallsUsed, tokensIn, tokensOut)
    }
    const data = (await res.json()) as {
      choices: Array<{ message: OpenAIMessage }>
      usage: { prompt_tokens: number; completion_tokens: number }
    }
    tokensIn += data.usage?.prompt_tokens ?? 0
    tokensOut += data.usage?.completion_tokens ?? 0
    const msg = data.choices[0]?.message
    if (!msg) {
      sendEvent({ type: 'subagent-failed', idx: brief.idx, error: 'empty response' })
      return failed(brief, 'empty response', startedAt, toolCallsUsed, tokensIn, tokensOut)
    }
    messages.push(msg)

    const calls = msg.tool_calls ?? []
    if (calls.length === 0) {
      // Model produced prose with no tool call — treat as failure to make progress
      sendEvent({ type: 'subagent-failed', idx: brief.idx, error: 'no tool call' })
      return failed(brief, 'no tool call', startedAt, toolCallsUsed, tokensIn, tokensOut)
    }

    for (const call of calls) {
      sendEvent({
        type: 'subagent-tool-call',
        idx: brief.idx,
        toolName: call.function.name as never,
      })
      if (isFinalizeCall(call.function.name)) {
        const args = safeJson(call.function.arguments)
        const { summary, evidence } = parseFinalize(args)
        const status = toolCallsUsed >= brief.boundaries.maxToolCalls ? 'capped' : 'ok'
        const result: SubagentResult = {
          idx: brief.idx,
          status,
          summary,
          evidence,
          toolCallsUsed,
          durationMs: Date.now() - startedAt,
          tokensIn,
          tokensOut,
        }
        sendEvent({
          type: 'subagent-result',
          idx: brief.idx,
          summary,
          evidence,
          toolCallsUsed,
          durationMs: result.durationMs,
        })
        return result
      }
      if (!brief.toolsAllowed.includes(call.function.name as never)) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Tool "${call.function.name}" is not allowed for this subagent.`,
        })
        continue
      }
      const args = safeJson(call.function.arguments)
      try {
        const out = await invokeTool(call.function.name, args, deps)
        toolCallsUsed++
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(out.result).slice(0, 8000),
        })
      } catch (err) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }
  }

  const error = 'iteration cap exceeded without finalize'
  log('warn', 'memory-deep-ask', 'memory.deep-ask.subagent.iter-cap', { idx: brief.idx })
  sendEvent({ type: 'subagent-failed', idx: brief.idx, error })
  return failed(brief, error, startedAt, toolCallsUsed, tokensIn, tokensOut)
}

function failed(
  brief: SubagentBrief,
  error: string,
  startedAt: number,
  toolCallsUsed: number,
  tokensIn: number,
  tokensOut: number
): SubagentResult {
  return {
    idx: brief.idx,
    status: 'failed',
    summary: `Subagent ${brief.idx} failed: ${error}`,
    evidence: [],
    toolCallsUsed,
    durationMs: Date.now() - startedAt,
    error,
    tokensIn,
    tokensOut,
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  args: { url: string; body: unknown; timeoutMs: number }
): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), args.timeoutMs)
  try {
    return await fetchFn(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(t)
  }
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/deep-ask-subagent.test.ts
npm run typecheck
npm run lint
git add src/main/memory/agents/subagent.ts src/test/deep-ask-subagent.test.ts
git commit -m "feat(deep-ask): subagent ReAct loop with tool-call cap + finalize"
```

---

### Task 2.4 — Verify Phase 2

```bash
npm run verify:phase 2
```

Expected: `VERDICT: ✅ Phase 2 verified`. Update `HANDOFF.md`.

---

## Phase 3 — Citation merger + synthesizer + pricing (TDD)

### Task 3.1 — Citation merger (TDD)

**Files:** `src/main/memory/agents/citationMerger.ts`, `src/test/deep-ask-citation-merger.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/deep-ask-citation-merger.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mergeCitations } from '../main/memory/agents/citationMerger'
import type { SubagentResult } from '../main/memory/agents/types'

const r = (idx: number, evidence: { meetingId: string; segmentId: string; quote: string }[]): SubagentResult => ({
  idx,
  status: 'ok',
  summary: 's',
  evidence,
  toolCallsUsed: 1,
  durationMs: 100,
  tokensIn: 0,
  tokensOut: 0,
})

describe('mergeCitations', () => {
  it('assigns 1-based numbers in order of first appearance', () => {
    const out = mergeCitations([
      r(0, [
        { meetingId: 'm1', segmentId: 's1', quote: 'q1' },
        { meetingId: 'm1', segmentId: 's2', quote: 'q2' },
      ]),
      r(1, [{ meetingId: 'm2', segmentId: 's3', quote: 'q3' }]),
    ])
    expect(out.numbered.map((c) => c.marker)).toEqual([1, 2, 3])
    expect(out.numbered[0].segmentId).toBe('s1')
    expect(out.numbered[2].segmentId).toBe('s3')
  })

  it('dedupes by segmentId (later occurrences merged into first marker)', () => {
    const out = mergeCitations([
      r(0, [{ meetingId: 'm1', segmentId: 's1', quote: 'q1' }]),
      r(1, [{ meetingId: 'm1', segmentId: 's1', quote: 'q1 again' }]),
    ])
    expect(out.numbered).toHaveLength(1)
    expect(out.numbered[0].marker).toBe(1)
  })

  it('returns empty when no evidence', () => {
    const out = mergeCitations([r(0, []), r(1, [])])
    expect(out.numbered).toEqual([])
  })

  it('handles a mix of failed and ok subagents', () => {
    const failed: SubagentResult = {
      idx: 0,
      status: 'failed',
      summary: 'failed',
      evidence: [],
      toolCallsUsed: 0,
      durationMs: 10,
      tokensIn: 0,
      tokensOut: 0,
      error: 'x',
    }
    const out = mergeCitations([failed, r(1, [{ meetingId: 'm', segmentId: 's', quote: 'q' }])])
    expect(out.numbered).toHaveLength(1)
  })

  it('returns an indexable subagentToMarkers map for synthesizer formatting', () => {
    const out = mergeCitations([
      r(0, [
        { meetingId: 'm', segmentId: 'a', quote: 'qa' },
        { meetingId: 'm', segmentId: 'b', quote: 'qb' },
      ]),
      r(1, [{ meetingId: 'm', segmentId: 'c', quote: 'qc' }]),
    ])
    expect(out.subagentToMarkers[0]).toEqual([1, 2])
    expect(out.subagentToMarkers[1]).toEqual([3])
  })
})
```

- [ ] **Step 2: Run to verify failure, then implement**

Create `src/main/memory/agents/citationMerger.ts`:

```ts
import type { Evidence, SubagentResult } from './types'

export interface NumberedCitation {
  marker: number
  meetingId: string
  segmentId: string
  quote: string
}

export interface MergedCitations {
  numbered: NumberedCitation[]
  subagentToMarkers: Record<number, number[]>
}

export function mergeCitations(results: SubagentResult[]): MergedCitations {
  const numbered: NumberedCitation[] = []
  const bySegmentId = new Map<string, number>()
  const subagentToMarkers: Record<number, number[]> = {}

  for (const r of results) {
    subagentToMarkers[r.idx] = []
    for (const ev of r.evidence) {
      let marker = bySegmentId.get(ev.segmentId)
      if (marker === undefined) {
        marker = numbered.length + 1
        bySegmentId.set(ev.segmentId, marker)
        numbered.push({ marker, ...ev })
      }
      subagentToMarkers[r.idx].push(marker)
    }
  }
  return { numbered, subagentToMarkers }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/test/deep-ask-citation-merger.test.ts
npm run typecheck
npm run lint
git add src/main/memory/agents/citationMerger.ts src/test/deep-ask-citation-merger.test.ts
git commit -m "feat(deep-ask): citation merger (dedup + 1-based numbering)"
```

---

### Task 3.2 — Synthesizer (TDD)

**Files:** `src/main/memory/agents/prompts/synthesizer.v1.ts`, `src/main/memory/agents/synthesizer.ts`, `src/test/deep-ask-synthesizer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/deep-ask-synthesizer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildSynthesizerMessages,
  formatNumberedEvidence,
} from '../main/memory/agents/prompts/synthesizer.v1'
import type { Plan, SubagentResult } from '../main/memory/agents/types'

const r = (idx: number, summary: string, evidence: { meetingId: string; segmentId: string; quote: string }[]): SubagentResult => ({
  idx,
  status: 'ok',
  summary,
  evidence,
  toolCallsUsed: 1,
  durationMs: 1,
  tokensIn: 0,
  tokensOut: 0,
})

const plan: Plan = {
  reasoning: 'multi-angle',
  synthesisGuidance: 'compare across quarters',
  subagents: [
    { idx: 0, objective: 'A', outputFormat: 'f', toolsAllowed: ['search_meetings'], boundaries: { maxToolCalls: 5 } },
    { idx: 1, objective: 'B', outputFormat: 'f', toolsAllowed: ['search_meetings'], boundaries: { maxToolCalls: 5 } },
  ],
}

describe('formatNumberedEvidence', () => {
  it('formats numbered evidence list', () => {
    const out = formatNumberedEvidence([
      { marker: 1, meetingId: 'm1', segmentId: 's1', quote: 'q1' },
      { marker: 2, meetingId: 'm2', segmentId: 's2', quote: 'q2' },
    ])
    expect(out).toContain('[^1]')
    expect(out).toContain('[^2]')
    expect(out).toContain('q1')
  })
})

describe('buildSynthesizerMessages', () => {
  it('includes question, reasoning, synthesis guidance, subagent summaries, and numbered evidence', () => {
    const msgs = buildSynthesizerMessages({
      question: 'How did OKRs change?',
      plan,
      results: [r(0, 'sum A', [{ meetingId: 'm1', segmentId: 's1', quote: 'q1' }])],
      numbered: [{ marker: 1, meetingId: 'm1', segmentId: 's1', quote: 'q1' }],
    })
    const text = msgs.map((m) => m.content).join('\n')
    expect(text).toContain('How did OKRs change?')
    expect(text).toContain('multi-angle')
    expect(text).toContain('compare across quarters')
    expect(text).toContain('sum A')
    expect(text).toContain('[^1]')
  })

  it('explicitly forbids inventing citation numbers', () => {
    const msgs = buildSynthesizerMessages({
      question: 'q',
      plan,
      results: [],
      numbered: [],
    })
    const sys = msgs.find((m) => m.role === 'system')?.content ?? ''
    expect(sys.toLowerCase()).toContain('do not invent')
  })

  it('notes partial coverage when some subagents failed', () => {
    const failed: SubagentResult = {
      idx: 0,
      status: 'failed',
      summary: 'agent failed',
      evidence: [],
      toolCallsUsed: 0,
      durationMs: 1,
      tokensIn: 0,
      tokensOut: 0,
      error: 'timeout',
    }
    const ok = r(1, 'sum', [{ meetingId: 'm', segmentId: 's', quote: 'q' }])
    const msgs = buildSynthesizerMessages({
      question: 'q',
      plan,
      results: [failed, ok],
      numbered: [{ marker: 1, meetingId: 'm', segmentId: 's', quote: 'q' }],
    })
    const text = msgs.map((m) => m.content).join('\n')
    expect(text.toLowerCase()).toContain('partial')
  })
})
```

- [ ] **Step 2: Implement prompts and synthesizer module**

Create `src/main/memory/agents/prompts/synthesizer.v1.ts`:

```ts
import type { NumberedCitation } from '../citationMerger'
import type { Plan, SubagentResult } from '../types'

const SYNTHESIZER_SYSTEM = `You are the synthesizer for autoMeetic Deep Ask. You receive:
- The original user question
- The lead agent's reasoning + synthesis guidance
- One or more subagent summaries with their evidence
- A numbered list of evidence items (use these markers, do NOT invent new ones)

Your job: write a cohesive, cited answer in the user's language.

RULES
- 2–5 short paragraphs total.
- Every factual claim must cite [^N] from the provided numbered evidence.
- Do not invent citation numbers beyond what is listed.
- Do not fabricate facts not supported by subagent evidence or summaries.
- If subagents could not find evidence for an angle, say so honestly.
- If any subagent failed, the input will say "(partial coverage)" — acknowledge this in the answer.
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

  const partialNote = anyFailed ? '\n\nNOTE: This run had partial coverage — at least one subagent failed. Reflect this honestly.' : ''

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
```

Create `src/main/memory/agents/synthesizer.ts`:

```ts
import { normalizePreserveTerms } from '../../glossary/promptInjection'
import type { MemoryService } from '../memoryService'
import { buildSynthesizerMessages } from './prompts/synthesizer.v1'
import type { NumberedCitation } from './citationMerger'
import type { DeepAskEvent, Plan, SubagentResult } from './types'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const SYNTHESIZER_MODEL = process.env.MEMORY_DEEP_ASK_SYNTH_MODEL ?? 'gpt-4o'

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

interface OpenAIStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>
  usage?: { prompt_tokens: number; completion_tokens: number }
}

export interface SynthesizerResult {
  answer: string
  inputTokens: number
  outputTokens: number
}

export async function runSynthesizer(args: {
  question: string
  plan: Plan
  results: SubagentResult[]
  numbered: NumberedCitation[]
  memory: Pick<MemoryService, 'activeGlossary'>
  sendEvent: (e: DeepAskEvent) => void
  fetchFn?: typeof fetch
}): Promise<SynthesizerResult> {
  args.sendEvent({ type: 'synthesizing', sourceCount: args.numbered.length })
  const messages = buildSynthesizerMessages({
    question: args.question,
    plan: args.plan,
    results: args.results,
    numbered: args.numbered,
  })
  const fetchFn = args.fetchFn ?? fetch
  const res = await fetchFn(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: SYNTHESIZER_MODEL,
      messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 1500,
      stream_options: { include_usage: true },
    }),
  })
  if (!res.ok || !res.body) throw new Error(`Synthesizer OpenAI ${res.status}`)

  let fullText = ''
  let usage: { prompt_tokens: number; completion_tokens: number } | undefined
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const consumeLine = (line: string) => {
    if (!line.startsWith('data: ')) return
    const json = line.slice(6).trim()
    if (!json || json === '[DONE]') return
    try {
      const evt = JSON.parse(json) as OpenAIStreamChunk
      const delta = evt.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        fullText += delta
        args.sendEvent({ type: 'delta', content: delta })
      }
      if (evt.usage) usage = evt.usage
    } catch {
      // ignore malformed chunk
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) consumeLine(line)
  }
  for (const line of buffer.split('\n')) consumeLine(line)

  const glossary = args.memory.activeGlossary(null)
  const normalized = normalizePreserveTerms(fullText, glossary)
  return {
    answer: normalized,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/test/deep-ask-synthesizer.test.ts
npm run typecheck
npm run lint
git add src/main/memory/agents/prompts/synthesizer.v1.ts src/main/memory/agents/synthesizer.ts src/test/deep-ask-synthesizer.test.ts
git commit -m "feat(deep-ask): synthesizer prompt + streaming with glossary post-pass"
```

---

### Task 3.3 — Pricing helper

**Files:** `src/main/memory/agents/pricing.ts`

- [ ] **Step 1: Create**

```ts
interface Price {
  inputPer1M: number
  outputPer1M: number
}

const PRICING: Record<string, Price> = {
  'gpt-4o': { inputPer1M: 5.0, outputPer1M: 15.0 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o-2024-08-06': { inputPer1M: 5.0, outputPer1M: 15.0 },
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? PRICING['gpt-4o']
  return (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M
}
```

- [ ] **Step 2: Commit**

```bash
npm run typecheck
npm run lint
git add src/main/memory/agents/pricing.ts
git commit -m "feat(deep-ask): pricing helper for cost estimates"
```

---

### Task 3.4 — Verify Phase 3

```bash
npm run verify:phase 3
```

Update `HANDOFF.md`.

---

## Phase 4 — Gate + Orchestrator + IPC + preload (TDD)

### Task 4.1 — Gate placeholder

**Files:** `src/main/memory/agents/gate.ts`

```ts
import type { GateContext, GateResult } from './types'

export async function checkDeepAskGate(_ctx: GateContext): Promise<GateResult> {
  // Stream 1 placeholder: always allow.
  // Stream 2 will replace the body with real BYOK / license / subscription logic.
  return { allowed: true }
}
```

```bash
npm run typecheck
git add src/main/memory/agents/gate.ts
git commit -m "feat(deep-ask): gate placeholder (Stream 1: always allow)"
```

---

### Task 4.2 — Orchestrator (TDD)

**Files:** `src/main/memory/deepAskService.ts`, `src/test/deep-ask-orchestrator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/deep-ask-orchestrator.test.ts`. Use full fakes for `callLeadAgent`, `runSubagent`, `runSynthesizer` (mock the entire module via `vi.mock` if needed, or pass injection points). Test:
1. happy path: lead returns 2-subagent plan → both subagents return evidence → synthesizer streams → `done` event has correct sources + costBreakdown
2. partial failure: 1 subagent fails, 1 succeeds → synthesizer still runs → final answer notes partial coverage
3. all subagents fail: synthesizer still runs (with empty evidence) → final answer reflects failure honestly
4. gate denied: lead never invoked, `gate-denied` event emitted, return
5. lead JSON parse fails: `error` event with `phase: 'lead'`, return without proceeding

(Use `vi.mock('../main/memory/agents/leadAgent', () => ({ callLeadAgent: vi.fn() }))` style.)

- [ ] **Step 2: Implement `src/main/memory/deepAskService.ts`**

```ts
import { log } from '../telemetry/logger'
import { checkDeepAskGate } from './agents/gate'
import { callLeadAgent } from './agents/leadAgent'
import { mergeCitations } from './agents/citationMerger'
import { estimateCostUsd } from './agents/pricing'
import { runSubagent } from './agents/subagent'
import { runSynthesizer } from './agents/synthesizer'
import type { MemoryService } from './memoryService'
import type { ChatMessage, ChatSource } from './types'
import type {
  CostBreakdown,
  DeepAskEvent,
  Plan,
  SubagentResult,
} from './agents/types'

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

  // 1. Gate
  const gate = await checkDeepAskGate({ question: args.question })
  if (!gate.allowed) {
    sendEvent({ type: 'gate-denied', reason: gate.reason ?? 'Not permitted' })
    return
  }

  // 2. Lead
  let plan: Plan
  let leadIn = 0
  let leadOut = 0
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

  // 3. Parallel subagents
  let results: SubagentResult[]
  try {
    results = await Promise.all(
      plan.subagents.map((brief) =>
        runSubagent(brief, { memory: deps.memory }, sendEvent)
      )
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('warn', 'memory-deep-ask', 'memory.deep-ask.error', { phase: 'subagents', message })
    sendEvent({ type: 'error', message, phase: 'subagents' })
    return
  }

  // 4. Citation merge
  const merged = mergeCitations(results)

  // 5. Synthesize
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

  // 6. Cost breakdown
  const costBreakdown = buildCostBreakdown({
    leadIn,
    leadOut,
    results,
    synthIn: synth.inputTokens,
    synthOut: synth.outputTokens,
  })

  // 7. Sources
  const sources: ChatSource[] = merged.numbered.map((c, i) => {
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
      search: 0, // populated in v2 if useful
      getDetail: 0,
    },
    total: {
      tokens: args.leadIn + args.leadOut + subTotalIn + subTotalOut + args.synthIn + args.synthOut,
      estimatedUsd: leadUsd + subUsd + synthUsd,
    },
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/test/deep-ask-orchestrator.test.ts
npm run typecheck
npm run lint
git add src/main/memory/deepAskService.ts src/test/deep-ask-orchestrator.test.ts
git commit -m "feat(deep-ask): orchestrator (gate → lead → parallel subagents → synth)"
```

---

### Task 4.3 — IPC handler + preload bridge (TDD)

**Files:** `src/main/ipc-memory-handlers.ts`, `src/preload/index.ts`, `src/preload/types.ts`, `src/test/deep-ask-ipc.test.ts`

- [ ] **Step 1: Add IPC channel `memory:deep-ask`**

Mirror the existing `memory:chat` pattern. Handler signature:

```ts
ipcMain.handle('memory:deep-ask', async (event, args: { question: string; history: ChatMessage[] }) => {
  const memory = await getMemoryService()
  await runDeepAsk(args, (evt) => event.sender.send('memory:deep-ask:event', evt), { memory })
})
```

- [ ] **Step 2: Preload bridge**

In `src/preload/index.ts`:

```ts
deepAsk: (args: { question: string; history: ChatMessage[] }) =>
  ipcRenderer.invoke('memory:deep-ask', args),
onDeepAskEvent: (cb: (e: DeepAskEvent) => void) => {
  const handler = (_: unknown, e: DeepAskEvent) => cb(e)
  ipcRenderer.on('memory:deep-ask:event', handler)
  return () => ipcRenderer.removeListener('memory:deep-ask:event', handler)
},
```

Add corresponding types in `src/preload/types.ts`.

- [ ] **Step 3: Write IPC tests** for happy path, gate-denied event, error event.

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/deep-ask-ipc.test.ts
npm run typecheck
npm run lint
git add src/main/ipc-memory-handlers.ts src/preload/index.ts src/preload/types.ts src/test/deep-ask-ipc.test.ts
git commit -m "feat(deep-ask): IPC channel memory:deep-ask + preload bridge"
```

---

### Task 4.4 — Verify Phase 4

```bash
npm run verify:phase 4
```

Update `HANDOFF.md`.

---

## Phase 5 — Renderer UI

### Task 5.1 — Toggle component

**Files:** `src/renderer/ask/DeepAskToggle.tsx`

```tsx
interface Props {
  enabled: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}

export function DeepAskToggle({ enabled, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      className={`deep-ask-toggle ${enabled ? 'deep-ask-toggle-on' : 'deep-ask-toggle-off'}`}
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      title="Deep research — slower but explores multiple angles (~10× tokens)"
    >
      ⚡ Deep
    </button>
  )
}
```

```bash
npm run typecheck
git add src/renderer/ask/DeepAskToggle.tsx
git commit -m "feat(deep-ask): DeepAskToggle pill component"
```

---

### Task 5.2 — Store extension

**Files:** `src/renderer/ask/useChatStore.ts`, `src/renderer/ask/types.ts`

- [ ] **Step 1: Re-export the new types** in `src/renderer/ask/types.ts`.

- [ ] **Step 2: Extend the store:**

Add to state: `deepEnabled: boolean` (default false, session-only — no localStorage).
Add to state: per in-flight message, a `deepProgress: { plan?: Plan; subagents: Map<number, { brief, status, toolCalls }>; synthesizing: boolean }` field.
Add action `setDeepEnabled(v)`.
Add action `submit(question)`: if `deepEnabled`, route through `electronAPI.memory.deepAsk` and subscribe to events. Otherwise current single-shot path.
Event handlers map event types → store mutations.
On `done`: persist message with `deepResearch: true` + `costBreakdown` to localStorage chat history.

(Full code is moderately long; follow the existing single-shot pattern in this file.)

```bash
npm run typecheck
git add src/renderer/ask/useChatStore.ts src/renderer/ask/types.ts
git commit -m "feat(deep-ask): chat store deep mode branch + event handling"
```

---

### Task 5.3 — AskInput integration + progress card + footer

**Files:** `src/renderer/ask/AskInput.tsx`, `src/renderer/ask/DeepAskProgressCard.tsx`, `src/renderer/ask/AnswerFooter.tsx`, `src/renderer/ask/ChatMessageView.tsx`

- [ ] **Step 1: Mount toggle in AskInput**

In the existing button row, render `<DeepAskToggle enabled={store.deepEnabled} onChange={store.setDeepEnabled} disabled={inflight} />` to the LEFT of the send button.

- [ ] **Step 2: `DeepAskProgressCard.tsx`**

```tsx
import type { Plan } from './types'

interface SubagentRowState {
  brief: { idx: number; objective: string }
  status: 'running' | 'done' | 'failed' | 'capped'
  toolCalls: number
}

interface Props {
  plan?: Plan
  subagents: SubagentRowState[]
  synthesizing: boolean
}

export function DeepAskProgressCard({ plan, subagents, synthesizing }: Props) {
  return (
    <div className="deep-ask-progress">
      {!plan ? (
        <div className="deep-ask-progress-step">🔍 분해 중...</div>
      ) : (
        <>
          <div className="deep-ask-progress-step">✓ 계획</div>
          <div className="deep-ask-progress-reasoning">{plan.reasoning}</div>
        </>
      )}
      {subagents.map((s) => {
        const icon = s.status === 'running' ? '🟢' : s.status === 'done' ? '✅' : s.status === 'capped' ? '⚠️' : '❌'
        return (
          <div key={s.brief.idx} className="deep-ask-subagent-row">
            <span>{icon}</span>
            <span className="deep-ask-subagent-objective">서브에이전트 {s.brief.idx + 1}: {s.brief.objective}</span>
            <span className="deep-ask-subagent-counter">({s.toolCalls}회 도구 호출)</span>
          </div>
        )
      })}
      {synthesizing && <div className="deep-ask-progress-step">⏳ 종합 중...</div>}
    </div>
  )
}
```

- [ ] **Step 3: `AnswerFooter.tsx`**

```tsx
import type { CostBreakdown } from './types'

interface Props {
  costBreakdown: CostBreakdown
  subagentCount: number
  toolCalls: number
  durationMs: number
}

export function AnswerFooter({ costBreakdown, subagentCount, toolCalls, durationMs }: Props) {
  const seconds = (durationMs / 1000).toFixed(1)
  const usd = costBreakdown.total.estimatedUsd.toFixed(2)
  return (
    <div className="deep-ask-footer">
      ⚡ Deep · {subagentCount} agents · {toolCalls} tool calls · ~${usd} · {seconds}s
    </div>
  )
}
```

- [ ] **Step 4: Wire into `ChatMessageView.tsx`**

When rendering an assistant message:
- If `message.deepResearch === true` and assistant content empty (i.e. still streaming): render `<DeepAskProgressCard>` from store state
- If `message.deepResearch === true` and content present: render existing content + `<AnswerFooter>` with stored `costBreakdown`

- [ ] **Step 5: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/ask/AskInput.tsx src/renderer/ask/DeepAskProgressCard.tsx src/renderer/ask/AnswerFooter.tsx src/renderer/ask/ChatMessageView.tsx
git commit -m "feat(deep-ask): UI — toggle in AskInput + progress card + answer footer"
```

---

### Task 5.4 — Styles

**Files:** `src/renderer/App.css`

```css
.deep-ask-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 14px;
  font-size: 12px;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--border, rgba(0,0,0,0.15));
  color: var(--text, inherit);
  transition: all 0.15s;
}
.deep-ask-toggle-on {
  background: var(--accent, #6366f1);
  color: white;
  border-color: var(--accent, #6366f1);
}
.deep-ask-toggle:hover { filter: brightness(1.1); }
.deep-ask-toggle:disabled { opacity: 0.5; cursor: not-allowed; }

.deep-ask-progress {
  margin: 8px 0;
  padding: 12px;
  background: var(--surface-elevated, rgba(99, 102, 241, 0.06));
  border-left: 3px solid var(--accent, #6366f1);
  border-radius: 4px;
  font-size: 13px;
}
.deep-ask-progress-step { font-weight: 600; margin-bottom: 4px; }
.deep-ask-progress-reasoning {
  font-size: 12px;
  color: var(--text-muted, #777);
  margin: 4px 0 10px 0;
  font-style: italic;
}
.deep-ask-subagent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.deep-ask-subagent-objective { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.deep-ask-subagent-counter { font-size: 11px; color: var(--text-muted, #999); }

.deep-ask-footer {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted, #999);
  font-style: italic;
}
```

```bash
git add src/renderer/App.css
git commit -m "feat(deep-ask): styles for toggle + progress + footer"
```

---

### Task 5.5 — Verify Phase 5

```bash
npm run verify:phase 5
```

Update `HANDOFF.md`.

---

## Phase 6 — Regression + handoff + push

### Task 6.1 — Full regression

```bash
npm run verify
npm run build
```

Document Windows `EBUSY` if `npm test` blocked. Document any preexisting build failures (do not fix in this stream).

### Task 6.2 — Update `HANDOFF.md`

- [ ] Move "Glossary Variants & Inline Highlights" to a Completed stream section (if not already).
- [ ] Insert new "Next active stream" block + status table with all 6 rows ⏳ PENDING (replaced phase by phase as work progresses).

### Task 6.3 — Manual smoke (deferred to user)

Document:
- Deep toggle visible in AskInput
- Sending with Deep ON shows progress card
- Streamed answer with citations
- Citation click jumps to meeting (existing flow)
- Footer shows ~$X · Ys
- Toggle OFF → standard Ask works unchanged
- Trivial question with Deep ON behaves reasonably (1 subagent or fall-through)

### Task 6.4 — Push

```bash
git push origin master
```

Mark Phase 6 ✅ COMPLETE in `HANDOFF.md`.

---

## Self-review checklist

- [ ] All 6 phases ✅ COMPLETE in `HANDOFF.md` with verbatim verify output.
- [ ] Single-shot Ask path unchanged (no regression).
- [ ] Gate placeholder ready for Stream 2 to swap.
- [ ] No new dependencies added.
- [ ] No deviation from spec's "In scope" / "Out of scope".
- [ ] Telemetry events fire for every documented case.
- [ ] Pricing table comment notes it must be updated when OpenAI changes prices.

## Open questions (deferred to v2)

- Real billing gate (Stream 2)
- Auto-router (Deep on/off automatic)
- 10+ subagent complex mode
- Async-as-ready subagent execution
- Checkpointing / resumable runs
- Pre-flight cost estimate modal
- Cancel mid-flight (AbortController)
- Anthropic / mixed model support
- Cross-meeting filter scopes per subagent
- $ budget caps
