# Deep Ask — Multi-Agent Research Mode (Hub-and-Spoke) — Design Spec

**Date:** 2026-05-26
**Status:** Draft — pending implementation
**Stream type:** Net-new feature on top of existing Memory Ask
**Related:**
- Memory Library Chat (`2026-05-23-memory-chat-design.md`) — the single-shot Ask that this stream upgrades with an optional Deep mode
- Embedding Pipeline Durability (`2026-05-25-embedding-pipeline-durability-design.md`) — provides the semantic retrieval Deep Ask depends on

This stream adds a multi-agent **Deep** mode to Memory Ask, following the Hub-and-Spoke (orchestrator–worker) pattern that Anthropic measured at +90.2% over single-agent on research tasks. It is the first sub-project of a two-stream effort; the gating/payment layer (`Stream 2`) is intentionally out of scope and replaced by an always-allow placeholder.

## One-line

Add a "Deep" toggle to the Memory Library Ask tab. When on, a lead agent (gpt-4o) decomposes the question, spawns 2–4 subagents (gpt-4o-mini) in parallel that each explore a different angle of the user's past meetings via `SearchService` and a new `getMeetingDetail` tool, then a synthesizer agent combines their summaries into a cited streamed answer.

## Why this stream

The existing Memory Ask (`memory:chat`) is one-shot RAG: one search call, one LLM call, one answer. It works for direct lookups ("what did Sarah say about X?") but degrades on multi-angle questions ("how has our roadmap evolved across the last quarter?") because:

- One retrieval pass with `K=10` segments misses long-tail relevant context across many meetings
- One LLM call has to do retrieval planning, synthesis, and citation in a single shot — none of them well
- No way to explore independent angles in parallel

Multi-agent research has measurable wins for this exact problem class. Anthropic's own published architecture for `claude.ai/research`:

- **+90.2%** over single-agent Opus 4 on internal research evaluation
- **Token usage explains 80% of variance** in performance — i.e. more parallel exploration directly buys more accuracy
- **15× token cost** vs chat — so this is a per-query opt-in, not a default
- The dominant production pattern across all five major vendors by mid-2026

We are not pioneering the architecture. We are adapting a well-validated industry pattern (with OpenAI models instead of Anthropic's, which is unproven but follows the same structure) to autoMeetic's existing memory + retrieval stack. The retrieval substrate (`SearchService`, `EmbeddingService`, semantic + literal + title hits) is ready after the embedding pipeline fix.

## Success criteria

1. **Toggle UX:** Ask tab gains a small `[ ⚡ Deep ]` toggle next to the input. Default OFF. Per-message state. Sticky across turns within a session.
2. **Deep mode happy path:** User types a multi-angle question (e.g. "지난 분기 동안 OKR이 어떻게 바뀌었는지 요약해줘"), toggles Deep, presses send. Within ~3 seconds a progress card appears showing the lead's plan + 2–4 subagent status rows. Subagents stream their completion. Within ~30–90 seconds total a synthesized answer streams to the user with `[^N]` citations.
3. **Simple-question fallback:** If the lead decides the question is trivial, it issues a 1-subagent plan (or returns "direct" → falls through to existing single-shot Ask path). User does not pay the full multi-agent cost.
4. **Plan visibility:** The lead's plan (one short paragraph) is shown to the user inside the progress card. This is the "value visible" moment — they see what got decomposed and why.
5. **Per-subagent visibility:** Each subagent's brief objective + status (running / done) + final tool-call count is shown. Educational and trust-building.
6. **Citations work end-to-end:** Synthesizer's `[^N]` markers map to segment IDs the same way existing Ask does. Clicking a citation chip jumps to the meeting and flashes the segment. Sources list shows all unique evidence (typically 10–25 items from a 4-subagent run).
7. **Hard cost caps enforced:**
   - Max 4 subagents per query
   - Max 10 tool calls per subagent
   - If a subagent hits the cap, it is forced to finalize what it has
   - If the lead returns >4 subagents, only the first 4 run
8. **Cost transparency:** Final answer footer shows actual tokens used per phase and an approximate $ estimate. Telemetry counters fire for downstream usage tracking.
9. **Failure surfaces:**
   - If the lead's JSON parse fails, fall back to single-shot Ask with a UI note ("Deep planning failed — using standard mode")
   - If all subagents fail, surface error clearly, do not synthesize garbage
   - If individual subagent fails (timeout or LLM error), synthesizer continues with the remaining results, footer notes the partial coverage
10. **Gate placeholder:** A `checkDeepAskGate()` function exists with signature `(ctx) => Promise<GateResult>` that v1 always returns `{ allowed: true }`. Stream 2 will replace this function's body with real BYOK / license / subscription logic. The orchestrator MUST call it before invoking the lead — this is the API contract that lets Stream 2 land without rewiring.
11. **Chat history persistence:** Deep-mode messages are saved to the existing chat history with a `deepResearch: true` flag and the full sources array. Reopening the app restores them. The mode toggle state is independent (no auto-replay of Deep mode on follow-ups — user re-toggles per turn).
12. **No regression to single-shot Ask:** With Deep toggle OFF, the existing `runChat()` flow is unchanged. Same model, same speed, same UX.
13. **No regression to existing tests** (`npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` all clean).

## In scope

### Architecture — three roles, one shared event stream

```
User question + Deep=ON
  │
  ▼
┌─ DeepAskOrchestrator (main process) ─────────────────────┐
│                                                            │
│  1. checkDeepAskGate(ctx)              ← Stream 2 hook    │
│     ↳ if !allowed: emit error, return                     │
│                                                            │
│  2. Lead agent (gpt-4o, JSON mode)                        │
│     ↳ input: question + last-6-message history            │
│     ↳ output: Plan { reasoning, subagents[], guidance }   │
│     ↳ emit: plan-created                                   │
│                                                            │
│  3. Parallel subagents (gpt-4o-mini, tool calls)          │
│     ↳ Promise.all([runSubagent(b) for b in plan.subagents])│
│     ↳ each one: ReAct loop with tools                      │
│        [search_meetings, get_meeting_detail, finalize]     │
│     ↳ per-subagent emits: started, tool-call, result      │
│                                                            │
│  4. Synthesizer (gpt-4o, streaming)                       │
│     ↳ input: question + plan + all subagent results +     │
│              numbered citation list                        │
│     ↳ emit: synthesizing, delta (token stream), done       │
└────────────────────────────────────────────────────────────┘
```

### Subagent brief contract (Plan JSON schema)

The lead emits a strict JSON object. Anthropic's central anti-pattern is "free-form delegation"; we use a structured brief instead.

```ts
interface Plan {
  reasoning: string                    // one paragraph, shown in progress card
  subagents: SubagentBrief[]           // 1–4 items
  synthesisGuidance: string            // one sentence, passed to synthesizer
}

interface SubagentBrief {
  idx: number                          // 0-indexed
  objective: string                    // "Find what changed about Q3 OKRs between meetings on date range X"
  outputFormat: string                 // "200-word compressed summary with evidence citations"
  toolsAllowed: ToolName[]             // subset of available tools
  boundaries: {
    maxToolCalls: number               // hard cap, default 10
    focusKeywords?: string[]           // optional bias hints
    meetingDateRange?: [number, number] // optional UTC ms range
  }
}

type ToolName = 'search_meetings' | 'get_meeting_detail'
```

Lead prompt explicitly contains the scaling rule (v1):
- Trivial question → 1 subagent with 1–3 tool calls
- Comparison / multi-angle → 2–4 subagents with 5–10 tool calls each
- v1 hard cap: 4 subagents. If the question seems to need more, lead is instructed to scope down to the 4 most important angles and note the limitation in `synthesisGuidance`.

### Subagent ReAct loop

```
state: { messages: [system, brief], toolCallsUsed: 0, evidence: [] }
loop:
  if state.toolCallsUsed >= brief.boundaries.maxToolCalls:
    inject forcing system message "You have hit the tool call cap. Call finalize_summary now."
  response = openai.chat.completions.create({
    model: SUBAGENT_MODEL,
    messages: state.messages,
    tools: TOOLS_FOR(brief.toolsAllowed),
    tool_choice: 'auto',
  })
  if response.tool_calls includes finalize_summary:
    return { summary, evidence }  // exit loop
  for each other tool_call:
    state.toolCallsUsed++
    result = await invokeTool(tool_call)
    state.messages.push(tool_call response)
end loop
```

If the loop terminates without `finalize_summary` (e.g., the model refuses or errors), wrap up with: "Subagent {idx} produced no summary. Reason: {lastError}."

### Available tools (subagent perspective)

Both delegate to existing `MemoryService` / `SearchService` / `MemoryRepository` — no new retrieval code.

```ts
const TOOLS = [
  {
    name: 'search_meetings',
    description:
      'Search the user\'s past meetings for relevant segments. Use SHORT broad queries (2–5 words) first; narrow only after a broad scan. Returns up to {limit} matched segments with meetingId, segmentId, snippet, and similarity score.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Short keyword query, 2–5 words' },
        limit: { type: 'number', default: 10, maximum: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_meeting_detail',
    description:
      'Fetch a meeting\'s metadata + summary + a focused 40-segment window. Use ONLY after search reveals a meeting worth deep-reading. Each call costs ~3× a search call.',
    parameters: {
      type: 'object',
      properties: {
        meetingId: { type: 'string' },
        focusSegmentId: { type: 'string', description: 'Optional: center the window on this segment' },
      },
      required: ['meetingId'],
    },
  },
  {
    name: 'finalize_summary',
    description:
      'Call this tool when you have enough evidence to answer your objective. Returns a compressed summary + structured evidence. After this call, the subagent ends. Do NOT include raw transcripts — only summaries and 30-word quotes max per evidence item.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', maxLength: 1500 },
        evidence: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              meetingId: { type: 'string' },
              segmentId: { type: 'string' },
              quote: { type: 'string', maxLength: 200 },
            },
            required: ['meetingId', 'segmentId', 'quote'],
          },
        },
      },
      required: ['summary', 'evidence'],
    },
  },
]
```

Tool descriptions follow Anthropic's "tool design as important as human-computer interface" principle — they teach the agent strategy, not just shapes.

### Synthesizer step

After all subagents complete:
1. Concatenate `evidence` arrays across subagents; dedupe by `segmentId`; assign 1-based citation numbers in order of first appearance.
2. Build a structured input for the synthesizer:
   ```
   ORIGINAL QUESTION:
   {question}

   LEAD'S REASONING (for context):
   {plan.reasoning}

   SYNTHESIS GUIDANCE:
   {plan.synthesisGuidance}

   SUBAGENT SUMMARIES:
   [Subagent 1] Objective: ...
                Summary: ...
   [Subagent 2] ...
   ...

   NUMBERED EVIDENCE (cite as [^N]):
   [^1] Meeting "{title}" (date, mm:ss) — "{quote}"
   [^2] ...
   ```
3. Synthesizer (gpt-4o, stream=true) produces a final 2–5 paragraph answer with `[^N]` markers.
4. Apply existing `normalizePreserveTerms` post-pass (glossary respect, already plumbed).
5. Emit `done` event with `{ answer, sources, costBreakdown }`.

### IPC channel + events

New channel `memory:deep-ask` (mirrors `memory:chat` pattern). Event types emitted to renderer over `memory:deep-ask:event`:

| Event | Payload |
|---|---|
| `gate-denied` | `{ reason: string }` (Stream 2 hook; v1 never fires) |
| `plan-created` | `{ plan: Plan }` |
| `subagent-started` | `{ idx, brief }` |
| `subagent-tool-call` | `{ idx, toolName, args }` |
| `subagent-result` | `{ idx, summary, evidence, toolCallsUsed, durationMs }` |
| `subagent-failed` | `{ idx, error }` |
| `synthesizing` | `{ sourceCount }` |
| `delta` | `{ content: string }` (existing stream token semantics) |
| `done` | `{ answer, sources, costBreakdown, durationMs }` |
| `error` | `{ message, phase: 'lead' \| 'subagents' \| 'synth' }` |

### Cost telemetry

`costBreakdown` shape:
```ts
interface CostBreakdown {
  lead:       { inputTokens: number; outputTokens: number; estimatedUsd: number }
  subagents:  { totalInputTokens: number; totalOutputTokens: number; estimatedUsd: number; perAgent: Array<...> }
  synthesizer:{ inputTokens: number; outputTokens: number; estimatedUsd: number }
  toolCalls:  { search: number; getDetail: number }
  total:      { tokens: number; estimatedUsd: number }
}
```

Pricing table for `estimatedUsd` lives in `src/main/memory/agents/pricing.ts` as a constant (e.g., gpt-4o = $5.00/$15.00 per 1M I/O; gpt-4o-mini = $0.15/$0.60). Documented as "approximate, update when OpenAI changes pricing."

Telemetry events via `telemetry/logger.ts`:
- `memory.deep-ask.submit { questionLength, deepEnabled: true }`
- `memory.deep-ask.planned { subagentCount, reasoningLength }`
- `memory.deep-ask.subagent-done { idx, toolCalls, durationMs, summaryLength }`
- `memory.deep-ask.subagent-failed { idx, error }`
- `memory.deep-ask.completed { totalTokens, estimatedUsd, durationMs, sourceCount, citationCount }`
- `memory.deep-ask.error { phase, reason }`

### Renderer UI

#### Toggle component (`DeepAskToggle.tsx`)

Sits inside the existing `AskInput` to the left of the send button. Small pill: `⚡ Deep` (off = outline only; on = filled accent). Hover tooltip: "Deep research mode — slower but explores multiple angles. Uses more tokens (~10×)."

Toggle state lives in `useChatStore` (existing) under `deepEnabled: boolean`. Per-message: on send, capture the current toggle value into the message object and send to backend via the IPC arg.

#### Progress card (`DeepAskProgressCard.tsx`)

Replaces the static "Thinking…" placeholder in `ChatMessageView` when the user's last message is a deep one and the assistant response isn't yet complete. Shows:

- 🔍 **Plan** — `plan.reasoning` (one paragraph) once `plan-created` fires
- For each subagent — row with status icon (`⏳` running / `✅` done / `❌` failed), brief.objective (truncated to 60 chars), tool-call counter
- Once synthesizing begins — "🧠 Synthesizing…" footer
- Once `done` — card fades out, answer takes over

#### Answer footer

After `done`, the rendered message has a small footer (italic, muted):
```
⚡ Deep · 4 agents · 12 tool calls · ~$0.27 · 47s
```

#### Source list

Reuses existing `SourcesList.tsx` unchanged. The synthesizer's evidence array maps to the same `ChatSource` shape the existing flow uses (with `marker`, `kind`, `meetingId`, `meetingTitle`, `segmentId`, `segmentText`, `timestampMs`, `meetingStartedAt`, `score`).

### Chat history extension

`ChatMessage` (existing) gets two optional fields:
```ts
interface ChatMessage {
  // ... existing fields
  deepResearch?: boolean
  costBreakdown?: CostBreakdown
}
```

LocalStorage version stays at 1 (additive field, no migration needed). When loading old messages, missing fields default to undefined (no Deep badge shown).

### Files

| Path | Action | Responsibility |
|---|---|---|
| `src/main/memory/agents/types.ts` | Create | `Plan`, `SubagentBrief`, `SubagentResult`, `Evidence`, `CostBreakdown`, `DeepAskEvent` |
| `src/main/memory/agents/prompts/lead.v1.ts` | Create | Lead system prompt + JSON schema enforcement + parser |
| `src/main/memory/agents/prompts/subagent.v1.ts` | Create | Subagent system prompt builder (templated with brief) |
| `src/main/memory/agents/prompts/synthesizer.v1.ts` | Create | Synthesizer prompt builder + numbered evidence formatter |
| `src/main/memory/agents/tools.ts` | Create | Tool schemas + implementations (search wrapper, getMeetingDetail wrapper) |
| `src/main/memory/agents/leadAgent.ts` | Create | `callLeadAgent(question, history) → Plan` with retry on JSON parse fail |
| `src/main/memory/agents/subagent.ts` | Create | `runSubagent(brief, sendEvent) → SubagentResult` (ReAct loop) |
| `src/main/memory/agents/synthesizer.ts` | Create | `runSynthesizer(question, plan, results, sendEvent) → final string` (streams) |
| `src/main/memory/agents/citationMerger.ts` | Create | Dedupes evidence, assigns 1-based numbers, builds numbered list |
| `src/main/memory/agents/pricing.ts` | Create | Per-model $/1M token table + `estimateCost(model, in, out)` helper |
| `src/main/memory/agents/gate.ts` | Create | `checkDeepAskGate(ctx) → GateResult` placeholder, always allow |
| `src/main/memory/deepAskService.ts` | Create | Orchestrator: gate → lead → parallel subagents → synth → emit events |
| `src/main/ipc-memory-handlers.ts` | Modify | Register `memory:deep-ask` handler |
| `src/preload/index.ts` | Modify | Expose `memory.deepAsk` + `memory.onDeepAskEvent` |
| `src/preload/types.ts` | Modify | Type additions |
| `src/renderer/ask/types.ts` | Modify | Re-export `DeepAskEvent`, `CostBreakdown`, etc. |
| `src/renderer/ask/useChatStore.ts` | Modify | `deepEnabled` toggle state + deep-mode submit branch + event handling |
| `src/renderer/ask/AskInput.tsx` | Modify | Mount `DeepAskToggle` to the left of send button |
| `src/renderer/ask/DeepAskToggle.tsx` | Create | Pill toggle component |
| `src/renderer/ask/DeepAskProgressCard.tsx` | Create | Plan + subagent status rows + synthesizing indicator |
| `src/renderer/ask/ChatMessageView.tsx` | Modify | When message is in-flight deep, render progress card; when done deep, render answer + footer |
| `src/renderer/ask/AnswerFooter.tsx` | Create | Cost/duration footer for deep messages |
| `src/renderer/App.css` | Modify | Toggle styles + progress card styles |
| `src/test/deep-ask-lead.test.ts` | Create | Lead prompt + JSON parsing tests |
| `src/test/deep-ask-subagent.test.ts` | Create | ReAct loop with fake LLM + fake tools |
| `src/test/deep-ask-citation-merger.test.ts` | Create | Dedup + numbering |
| `src/test/deep-ask-orchestrator.test.ts` | Create | Full happy path with all fakes |
| `src/test/deep-ask-ipc.test.ts` | Create | IPC channel tests |
| `HANDOFF.md` | Modify | New active stream block + status table |

## Out of scope (deferred)

- **Stream 2 — actual gate implementation** (BYOK / license / Stripe). v1 ships with always-allow.
- **Auto-router** deciding Deep vs Standard automatically. v1 = explicit user toggle.
- **>4 subagents** (Anthropic's "10+ subagents for complex research" mode). v1 caps at 4.
- **Asynchronous subagent execution** — subagents complete as soon as ready, lead proceeds without waiting for batch. v1 uses `Promise.all` (Anthropic's v1 did too — they call this their biggest open performance limitation).
- **Resumable runs / checkpointing** — if app closes mid-run, the run is lost. No partial-save mechanism.
- **Subagent–subagent communication** — strictly hub-and-spoke; subagents never see each other's output.
- **Streaming token output from subagents** — they emit only start / tool-calls / final result, not tokens. Only synthesizer streams.
- **Pre-flight cost estimate modal** — "this query will use ~$0.30, continue?" gating dialog. Defer to v2 (or to Stream 2 where it pairs with gate).
- **Multi-language plan reasoning** — lead reasoning is shown to user in whatever language the LLM picks (usually matches the question). No explicit translate step.
- **Tool design beyond search + getMeetingDetail** — no `web_search`, no `code_interpreter`, no `extract_entities`. Memory-only.
- **Cross-model orchestration** (Anthropic lead + OpenAI subagents). Pure OpenAI throughout.
- **Anthropic models** as an alternative. Pure OpenAI; abstraction for model swapping is v2.
- **Per-subagent custom retrieval scopes** (e.g., "this subagent only looks at meetings from last month"). v1: all subagents share the full corpus.
- **Cost cap based on $ budget** (e.g., "abort if estimated > $X"). v1: token/subagent caps, not dollar caps.

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Pattern | Hub-and-Spoke (orchestrator–worker) | 2026's default. Anthropic's measured +90.2%. All 5 major vendors converged here. Other surviving patterns (Agent-Flow, Bounded Collaboration) don't fit "parallel exploration of past meetings" as cleanly. |
| Models | Lead = gpt-4o, Subagents = gpt-4o-mini, Synthesizer = gpt-4o | Stack consistency (autoMeetic is already OpenAI throughout). Anthropic's measurement was Opus + Sonnet; the analog is gpt-4o + gpt-4o-mini. Unproven combination but architecturally identical. |
| Plan output format | Strict JSON via `response_format: { type: 'json_schema' }` | OpenAI's structured output guarantees parseable JSON; eliminates the brittle prompt-engineering-for-JSON failure mode that plagued earlier multi-agent systems. |
| Subagent loop | OpenAI function calling with `finalize_summary` as terminator tool | Standard OpenAI ReAct pattern. `finalize_summary` is cleaner than relying on a free-form "I'm done" string. |
| Subagent transcript policy | Compressed summary only, evidence as `{meetingId, segmentId, quote≤200chars}` | Anthropic's #1 documented anti-pattern is full-transcript returns ("burns 15× tokens"). Forced compression both saves cost AND makes synthesizer's job tractable. |
| Citation numbering | Synthesizer-side, post-collection | Subagents don't know about each other's evidence. The synthesizer is the only place where global numbering is possible. |
| Hard caps | 4 subagents, 10 tool calls each | Production data: most pilots fail because of runaway resource consumption. Caps are mechanical safety nets in addition to prompted scaling rules. |
| Gate API | `checkDeepAskGate(ctx) → Promise<GateResult>` placeholder | Locks the interface now so Stream 2 can swap in without touching the orchestrator. v1 always-allow. |
| Progress visibility | Live plan + per-subagent status in a card | "Show your work" is the trust-building moment. Anthropic's research tool does this. Also doubles as the "value visible" treatment we did for glossary. |
| Cost in UI | Token + $ in answer footer | Builds user awareness without gating. Pairs with Stream 2's gate when it lands. |
| History storage | Existing localStorage shape with additive `deepResearch` + `costBreakdown` fields | No migration. Old chats still render. New Deep chats get badge + footer. |
| Sticky toggle | OFF default, persists for current session only (no localStorage) | Avoids accidental ongoing high-cost queries. User opts in fresh each session. |
| Failure handling | Partial synthesis with note when some subagents fail | A 3-of-4 result is still valuable. Refusing to answer because one subagent timed out is worse UX. |
| Glossary integration | `normalizePreserveTerms` post-pass on final synthesizer output | Same as existing Ask. Variants from the glossary-variants stream are respected automatically. |
| Streaming | Only synthesizer streams tokens; subagents emit discrete events | Subagents do tool-call loops, not user-facing prose. Streaming their internal reasoning would be noise. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| OpenAI multi-agent performance is unproven (Anthropic's 90.2% was their own models) | Honest disclaimer in the spec + in the answer footer (no claimed accuracy uplift). User judges by perceived quality. We can re-evaluate post-ship; if quality is no better than single-shot we'll reconsider the model mix. |
| Cost surprises — user runs Deep query, sees unexpectedly large $ | Cost footer on EVERY deep answer. Hard caps prevent unbounded spend. v2 can add pre-flight estimate modal. |
| Lead returns malformed JSON | OpenAI structured outputs (json_schema) make this near-zero. Fallback: one retry with stricter prompt. If still fails, surface error and fall through to single-shot Ask. |
| Subagent never calls `finalize_summary` | Hard cap on tool calls triggers a forcing system message: "You hit the cap. Call finalize_summary now." If even that fails (e.g., LLM returns nothing), wrap the subagent as failed and proceed. |
| `Promise.all` blocks on slow subagent | Per-subagent timeout (e.g., 120s). On timeout, treat as failed subagent. Documented as v1 limitation (Anthropic has same issue). |
| Evidence dedup collisions | Dedup key is `segmentId` (globally unique). No collisions possible. |
| Renderer leaks event listeners across multiple Deep queries | `useDeepAskStore` (or the existing `useChatStore`) wires cleanup via `useEffect` return. Same pattern as `useChatStore`. |
| `npm test` Windows EBUSY (known quirk) | Use `npx vitest run` directly. Document in HANDOFF. |
| Schema changes? | None. No DB changes. All state is in-memory + localStorage. |
| User has no OpenAI key configured | Existing error path in `getApiKey()` already handles this — `Error('OPENAI_API_KEY not configured')` bubbles up as `error` event with `phase: 'lead'`. Renderer shows the message. |
| Synthesizer hallucinates citations | Prompt: "Do not invent citation numbers beyond what is listed." Same constraint as existing Ask. Post-pass validation: if final answer contains `[^N]` for N > sources.length, log warning. |
| Glossary `preserve` term broken by subagent quote | `normalizePreserveTerms` runs on final synthesizer output. Quotes inside subagent evidence are user-visible but short (≤200 chars) so any breakage is localized. |
| Memory chat regression | Single-shot path (`runChat`) is completely unchanged. Code review must ensure DeepAsk lives in parallel files, not as a refactor of `chatService`. |

## Verification approach

Per `CLAUDE.md` phase verification convention:

1. **Each phase:** `npm run verify:phase <N>` shows `VERDICT: ✅ Phase N verified`.
2. **Final:** `npm run verify` clean. `npm run build` clean (touches main + preload + renderer).
3. **Manual smoke (deferred to user):**
   - Open Ask tab, toggle Deep, send a comparison-style question against the user's real DB (~975 segments expected to be embedded by then).
   - Confirm progress card shows plan + 2–4 subagent status rows.
   - Confirm answer streams with citations.
   - Click a citation — confirm meeting jump + segment flash works.
   - Send a trivial question with Deep on — confirm lead either returns a 1-subagent plan or falls through (whatever the implementation chose).
   - Toggle Deep OFF — confirm standard Ask still works identically to before.
   - Check telemetry log for the new events.
   - Check footer shows reasonable $ estimate (~$0.05–$1.00 range for typical query).

## Open questions / explicit non-decisions

- **Should the toggle be sticky across sessions (localStorage) or session-only?** v1: session-only (in-memory). Less risk of accidental spend.
- **Should we cache subagent plans for identical/similar questions?** No. Memory queries have time-sensitive context; caching is v2 if we add it.
- **Should the lead see the conversation history?** Yes — last 6 turns (matches existing chat) but with subagent evidence stripped (only assistant final text). Already in the design.
- **Should subagents see each other's progress?** No. Strict hub-and-spoke per Anthropic.
- **Token-counting accuracy** — `tiktoken` isn't bundled. Use OpenAI's usage object in the API response (`usage.prompt_tokens`, `usage.completion_tokens`) — accurate by definition, no client-side estimation needed.
- **What language is the plan reasoning in?** Whatever the LLM emits given the question's language. Acceptable.
- **Should there be a "Cancel" button mid-flight?** v2. AbortController plumbing is non-trivial in IPC. v1: user waits or restarts the app.
- **Should we cap the synthesizer's output length?** `max_tokens: 1500` (same as existing Ask). Adequate for 2–5 paragraphs.

## Self-review notes

The first draft included an "auto-router" that would inspect the question and decide whether to invoke Deep mode without the user's explicit toggle. On second pass: this conflates two decisions — "is the question hard?" and "is the user willing to pay 10× for an answer?" The second is a value judgement the system can't make. Removed; v1 is explicit toggle only.

The first draft also had subagents streaming their own internal reasoning to the renderer. Cut: subagent tool-call sequences are LLM-internal noise, not user-facing content. Only the synthesizer streams tokens. The progress card shows per-subagent status (running / done / tool-call count) which is the actionable information.

A risk surfaced during review: putting the gate placeholder at the call site (inline `if`) makes Stream 2 a search-and-replace task. Moved gate behind a dedicated `gate.ts` module with a stable signature — Stream 2 replaces a file body, not a scatter of call sites.

The "10+ subagents" complex mode from Anthropic was tempting but inflates v1 scope substantially and the marginal value is small for autoMeetic's corpus size (typical user has dozens of meetings, not thousands of research papers). 4 is a defensible v1 cap.
