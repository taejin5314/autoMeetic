# autoMeetic — Implementation Handoff

Live handoff document. Any agent (Claude, Codex, human) can resume from this file.

## 🚀 Next active stream

> **Deep Ask — Multi-Agent Research Mode.** Net-new feature on top of existing Memory Ask. 6 phases. Adds a `[⚡ Deep]` toggle to the Ask tab; when on, a lead agent (gpt-4o) decomposes the question into 2–4 subagent briefs, subagents (gpt-4o-mini) explore in parallel via `SearchService` + `getMeetingDetail`, a synthesizer (gpt-4o) combines results into a cited streamed answer. Implements the Hub-and-Spoke pattern Anthropic measured at +90.2% on research tasks. Pure OpenAI throughout. Gate is a placeholder (always-allow) — real BYOK/license/subscription is a separate Stream 2. See:
>
> - **Spec:** `docs/superpowers/specs/2026-05-26-deep-ask-multi-agent-design.md`
> - **Plan:** `docs/superpowers/plans/2026-05-26-deep-ask-multi-agent.md`
>
> Start at Phase 1 (Task 1.1). TDD pattern through Phases 1–4; Phase 5 is renderer UI; Phase 6 is wrap-up.

## Active stream state — Deep Ask Multi-Agent

| Phase | Status | Commits | Tests passing |
|---|---|---|---|
| 1 — Types + lead agent (TDD) | ✅ COMPLETE | `2c9f518` → `e2772ba` (3 commits) | 284/284 (`npm run verify:phase 1`); typecheck/lint clean |
| 2 — Subagent runtime + tools (TDD) | ✅ COMPLETE | `9ff4cd6` → `d6a631c` (3 commits) | 288/288 (`npm run verify:phase 2`); typecheck/lint clean |
| 3 — Citation merger + synthesizer + pricing (TDD) | ✅ COMPLETE | `c4fd9e7` → `b6d7acf` (3 commits) | 297/297 (`npm run verify:phase 3`); typecheck/lint clean |
| 4 — Gate + Orchestrator + IPC + preload (TDD) | ✅ COMPLETE | `19149ec` → `731b56f` (3 commits) | 307/307 (`npm run verify:phase 4`); typecheck/lint clean |
| 5 — Renderer UI (toggle + progress card + footer) | ✅ COMPLETE | `3595a10` → `8f4145f` (5 commits) | 307/307 (`npm run verify:phase 5`); typecheck/lint clean |
| 6 — Regression + handoff + push | ✅ COMPLETE | `HEAD` (docs/final) | 307/307 (`npm run verify:phase 6`, `npm run verify`, `npm test`); build clean |

**Phase 1 verification (`npm run verify:phase 1`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 1


🔍 autoMeetic verification — 2026-05-26 16:08

  Plan: docs/superpowers/plans/2026-05-26-deep-ask-multi-agent.md
  Verifying Phase 1

  Expected files (referenced in Phase 1 body):
    ✅ src/main/memory/agents/types.ts
    ✅ src/main/memory/agents/prompts/lead.v1.ts
    ✅ src/test/deep-ask-lead.test.ts
    ✅ src/main/memory/agents/leadAgent.ts

Checks:
  ✅ typecheck (0 errors, 1.0s)
  ✅ lint (0 errors, 10.5s)
  ✅ vitest (284 / 284 passed, 6.6s)

Git context (last 5 commits):
  e2772ba feat(deep-ask): lead agent OpenAI wrapper
  b298073 feat(deep-ask): lead prompt + JSON schema + parser
  2c9f518 feat(deep-ask): add agents types module
  361fd4c docs(glossary): complete variants highlights handoff
  796b716 fix(glossary): pass undefined for active glossary default scope

VERDICT: ✅ Phase 1 verified
```

**Phase 2 verification (`npm run verify:phase 2`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 2


🔍 autoMeetic verification — 2026-05-26 16:12

  Plan: docs/superpowers/plans/2026-05-26-deep-ask-multi-agent.md
  Verifying Phase 2

  Expected files (referenced in Phase 2 body):
    ✅ src/main/memory/agents/tools.ts
    ✅ src/main/memory/agents/prompts/subagent.v1.ts
    ✅ src/main/memory/agents/subagent.ts
    ✅ src/test/deep-ask-subagent.test.ts

Checks:
  ✅ typecheck (0 errors, 1.0s)
  ✅ lint (0 errors, 10.3s)
  ✅ vitest (288 / 288 passed, 6.2s)

Git context (last 5 commits):
  d6a631c feat(deep-ask): subagent ReAct loop with tool-call cap + finalize
  72988f6 feat(deep-ask): subagent prompt builder
  9ff4cd6 feat(deep-ask): tool schemas + dispatch (search, get_detail, finalize)
  e2772ba feat(deep-ask): lead agent OpenAI wrapper
  b298073 feat(deep-ask): lead prompt + JSON schema + parser

VERDICT: ✅ Phase 2 verified
```

**Phase 3 verification (`npm run verify:phase 3`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 3


🔍 autoMeetic verification — 2026-05-26 16:16

  Plan: docs/superpowers/plans/2026-05-26-deep-ask-multi-agent.md
  Verifying Phase 3

  Expected files (referenced in Phase 3 body):
    ✅ src/main/memory/agents/citationMerger.ts
    ✅ src/test/deep-ask-citation-merger.test.ts
    ✅ src/main/memory/agents/prompts/synthesizer.v1.ts
    ✅ src/main/memory/agents/synthesizer.ts
    ✅ src/test/deep-ask-synthesizer.test.ts
    ✅ src/main/memory/agents/pricing.ts

Checks:
  ✅ typecheck (0 errors, 1.0s)
  ✅ lint (0 errors, 10.6s)
  ✅ vitest (297 / 297 passed, 6.1s)

Git context (last 5 commits):
  b6d7acf feat(deep-ask): pricing helper for cost estimates
  3b8366b feat(deep-ask): synthesizer prompt + streaming with glossary post-pass
  c4fd9e7 feat(deep-ask): citation merger (dedup + 1-based numbering)
  d6a631c feat(deep-ask): subagent ReAct loop with tool-call cap + finalize
  72988f6 feat(deep-ask): subagent prompt builder

VERDICT: ✅ Phase 3 verified
```

**Phase 4 verification (`npm run verify:phase 4`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 4


🔍 autoMeetic verification — 2026-05-26 16:22

  Plan: docs/superpowers/plans/2026-05-26-deep-ask-multi-agent.md
  Verifying Phase 4

  Expected files (referenced in Phase 4 body):
    ✅ src/main/memory/agents/gate.ts
    ✅ src/main/memory/deepAskService.ts
    ✅ src/test/deep-ask-orchestrator.test.ts
    ✅ src/main/ipc-memory-handlers.ts
    ✅ src/preload/index.ts
    ✅ src/preload/types.ts
    ✅ src/test/deep-ask-ipc.test.ts

Checks:
  ✅ typecheck (0 errors, 0.9s)
  ✅ lint (0 errors, 10.4s)
  ✅ vitest (307 / 307 passed, 6.3s)

Git context (last 5 commits):
  731b56f feat(deep-ask): IPC channel memory:deep-ask + preload bridge
  9b62d70 feat(deep-ask): orchestrator (gate → lead → parallel subagents → synth)
  19149ec feat(deep-ask): gate placeholder (Stream 1: always allow)
  b6d7acf feat(deep-ask): pricing helper for cost estimates
  3b8366b feat(deep-ask): synthesizer prompt + streaming with glossary post-pass

VERDICT: ✅ Phase 4 verified
```

**Phase 5 verification (`npm run verify:phase 5`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 5


🔍 autoMeetic verification — 2026-05-26 16:32

  Plan: docs/superpowers/plans/2026-05-26-deep-ask-multi-agent.md
  Verifying Phase 5

  Expected files (referenced in Phase 5 body):
    ✅ src/renderer/ask/DeepAskToggle.tsx
    ✅ src/renderer/ask/useChatStore.ts
    ✅ src/renderer/ask/types.ts
    ✅ src/renderer/ask/AskInput.tsx
    ✅ src/renderer/ask/DeepAskProgressCard.tsx
    ✅ src/renderer/ask/AnswerFooter.tsx
    ✅ src/renderer/ask/ChatMessageView.tsx
    ✅ src/renderer/App.css

Checks:
  ✅ typecheck (0 errors, 0.9s)
  ✅ lint (0 errors, 10.3s)
  ✅ vitest (307 / 307 passed, 6.4s)

Git context (last 5 commits):
  8f4145f fix(deep-ask): satisfy build type references
  b0c9150 feat(deep-ask): styles for toggle + progress + footer
  25a2553 feat(deep-ask): UI — toggle in AskInput + progress card + answer footer
  7606255 feat(deep-ask): chat store deep mode branch + event handling
  3595a10 feat(deep-ask): DeepAskToggle pill component

VERDICT: ✅ Phase 5 verified
```

**Phase 6 verification (`npm run verify:phase 6`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 6


🔍 autoMeetic verification — 2026-05-26 16:33

  Plan: docs/superpowers/plans/2026-05-26-deep-ask-multi-agent.md
  Verifying Phase 6

  ⚠️  Could not extract expected files for Phase 6 from plan. Continuing with general checks only.

Checks:
  ✅ typecheck (0 errors, 0.9s)
  ✅ lint (0 errors, 10.6s)
  ✅ vitest (307 / 307 passed, 6.0s)

Git context (last 5 commits):
  8f4145f fix(deep-ask): satisfy build type references
  b0c9150 feat(deep-ask): styles for toggle + progress + footer
  25a2553 feat(deep-ask): UI — toggle in AskInput + progress card + answer footer
  7606255 feat(deep-ask): chat store deep mode branch + event handling
  3595a10 feat(deep-ask): DeepAskToggle pill component

VERDICT: ✅ Phase 6 verified
```

**Phase 6 additional checks:**

```text
npm run verify
VERDICT: ✅ Verified clean
typecheck: 0 errors
lint: 0 errors
vitest: 307 / 307 passed

npm run build
✓ built in 13.01s

npm test
Test Files 49 passed (49)
Tests 307 passed (307)
Windows better_sqlite3.node EBUSY did not reproduce in this run.
```

**Phase 6 manual smoke (deferred to user):**

- Deep toggle visible in AskInput.
- Sending with Deep ON shows progress card.
- Streamed answer with citations.
- Citation click jumps to meeting through the existing flow.
- Footer shows estimated USD and elapsed seconds.
- Toggle OFF uses standard Ask unchanged.
- Trivial question with Deep ON behaves reasonably.

## ✅ Completed stream — Glossary Variants & Inline Highlights

> Implemented and pushed to `origin/master`. See:
>
> - **Spec:** `docs/superpowers/specs/2026-05-25-glossary-variants-and-highlights-design.md`
> - **Plan:** `docs/superpowers/plans/2026-05-25-glossary-variants-and-highlights.md`
>
> Automated regression passed. Manual smoke deferred to user. Existing user DB at v1 — will auto-migrate to v5 (and add `embedding_failures` table from the prior stream) on next app launch.

## Completed stream state — Glossary Variants & Inline Highlights

| Phase | Status | Commits | Tests passing |
|---|---|---|---|
| 1 — Schema + types + repo (TDD) | ✅ COMPLETE | `dc4996c` → `549dea0` (3 commits) | 250/250 (`npm run verify:phase 1`); typecheck/lint clean |
| 2 — Variant finder + IPC + broadcast (TDD) | ✅ COMPLETE | `5f9a4c2` → `6d4475c` (3 commits) | 263/263 (`npm run verify:phase 2`); typecheck/lint clean |
| 3 — Prompt + normalize update (TDD) | ✅ COMPLETE | `8541c46` | 269/269 (`npm run verify:phase 3`); typecheck/lint clean |
| 4 — Registration UI (picker + success card) | ✅ COMPLETE | `5b77e59` → `4705be5` (5 commits) | 269/269 (`npm run verify:phase 4`); typecheck/lint clean |
| 5 — Live highlight + toggle + styles | ✅ COMPLETE | `bac7c51` → `9d00ce3` (5 commits) | 275/275 (`npm run verify:phase 5`); typecheck/lint clean |
| 6 — Regression + handoff + push | ✅ COMPLETE | `796b716` → `HEAD` (docs/final) | 275/275 (`npm run verify:phase 6`, `npm run verify`); build clean; `npm test` blocked pre-Vitest by Windows `EBUSY` |

**Phase 1 verification (`npm run verify:phase 1`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 1


🔍 autoMeetic verification — 2026-05-25 23:55

  Plan: docs/superpowers/plans/2026-05-25-glossary-variants-and-highlights.md
  Verifying Phase 1

  Expected files (referenced in Phase 1 body):
    ✅ src/main/memory/schema.ts
    ✅ src/main/memory/types.ts
    ✅ src/main/memory/repository.ts
    ✅ src/test/glossary-repository-variants.test.ts

Checks:
  ✅ typecheck (0 errors, 1.0s)
  ✅ lint (0 errors, 10.3s)
  ✅ vitest (250 / 250 passed, 5.8s)

Git context (last 5 commits):
  549dea0 feat(glossary): persist variants + v5 migration + recent-segment scan
  23106ce feat(glossary): add variants to GlossaryEntry + VariantCandidate type
  dc4996c feat(glossary): add variants column to glossary_entries (schema v5)
  6236ce7 docs(embeddings): complete embedding durability handoff
  59a3b39 feat(embeddings): telemetry for backfill start + completion

VERDICT: ✅ Phase 1 verified
```

**Phase 2 verification (`npm run verify:phase 2`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 2


🔍 autoMeetic verification — 2026-05-26 00:00

  Plan: docs/superpowers/plans/2026-05-25-glossary-variants-and-highlights.md
  Verifying Phase 2

  Expected files (referenced in Phase 2 body):
    ✅ src/main/glossary/variantFinder.ts
    ✅ src/test/glossary-variant-finder.test.ts
    ✅ src/main/ipc-glossary-handlers.ts
    ✅ src/preload/index.ts
    ✅ src/preload/types.ts
    ✅ src/test/glossary-ipc-handlers.test.ts
    ✅ src/main/index.ts

Checks:
  ✅ typecheck (0 errors, 1.0s)
  ✅ lint (0 errors, 10.3s)
  ✅ vitest (263 / 263 passed, 5.8s)

Git context (last 5 commits):
  6d4475c feat(glossary): broadcast entries-updated event for renderer subscribers
  62494e1 feat(glossary): glossary:find-variants IPC + preload bridge
  5f9a4c2 feat(glossary): variant finder (normalize + Levenshtein + n-gram scan)
  549dea0 feat(glossary): persist variants + v5 migration + recent-segment scan
  23106ce feat(glossary): add variants to GlossaryEntry + VariantCandidate type

VERDICT: ✅ Phase 2 verified
```

**Phase 3 verification (`npm run verify:phase 3`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 3


🔍 autoMeetic verification — 2026-05-26 00:05

  Plan: docs/superpowers/plans/2026-05-25-glossary-variants-and-highlights.md
  Verifying Phase 3

  Expected files (referenced in Phase 3 body):
    ✅ src/main/glossary/promptInjection.ts
    ✅ src/test/glossary-prompt-injection.test.ts

Checks:
  ✅ typecheck (0 errors, 1.0s)
  ✅ lint (0 errors, 11.3s)
  ✅ vitest (269 / 269 passed, 5.7s)

Git context (last 5 commits):
  8541c46 feat(glossary): prompt + normalize handle variants alongside canonical
  6d4475c feat(glossary): broadcast entries-updated event for renderer subscribers
  62494e1 feat(glossary): glossary:find-variants IPC + preload bridge
  5f9a4c2 feat(glossary): variant finder (normalize + Levenshtein + n-gram scan)
  549dea0 feat(glossary): persist variants + v5 migration + recent-segment scan

VERDICT: ✅ Phase 3 verified
```

**Phase 4 verification (`npm run verify:phase 4`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 4


🔍 autoMeetic verification — 2026-05-26 00:12

  Plan: docs/superpowers/plans/2026-05-25-glossary-variants-and-highlights.md
  Verifying Phase 4

  Expected files (referenced in Phase 4 body):
    ✅ src/renderer/glossary/useGlossaryStore.ts
    ✅ src/renderer/glossary/types.ts
    ✅ src/renderer/glossary/VariantCandidatePicker.tsx
    ✅ src/renderer/glossary/GlossaryRowEditor.tsx
    ✅ src/renderer/glossary/GlossarySaveSuccessCard.tsx
    ✅ src/renderer/glossary/GlossaryPanel.tsx

Checks:
  ✅ typecheck (0 errors, 1.0s)
  ✅ lint (0 errors, 10.2s)
  ✅ vitest (269 / 269 passed, 7.1s)

Git context (last 5 commits):
  4705be5 feat(glossary): show variant chips on panel rows
  039b7bd feat(glossary): post-save success card with past-match preview
  7a631ba feat(glossary): row editor variants UI + scan button
  d114541 feat(glossary): VariantCandidatePicker modal component
  5b77e59 feat(glossary): store action findVariants + variants in upsert payload

VERDICT: ✅ Phase 4 verified
```

**Phase 5 verification (`npm run verify:phase 5`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 5


🔍 autoMeetic verification — 2026-05-26 00:19

  Plan: docs/superpowers/plans/2026-05-25-glossary-variants-and-highlights.md
  Verifying Phase 5

  Expected files (referenced in Phase 5 body):
    ✅ src/renderer/glossary/useActiveGlossary.ts
    ✅ src/renderer/glossary/glossaryMatcher.ts
    ✅ src/test/glossary-matcher.test.ts
    ✅ src/renderer/glossary/GlossaryMark.tsx
    ✅ src/renderer/glossary/HighlightedText.tsx
    ✅ src/renderer/shell/TranscriptColumns.tsx
    ✅ src/renderer/library/MeetingsTab.tsx
    ✅ src/renderer/glossary/useHighlightToggle.ts
    ✅ src/renderer/glossary/GlossaryPanel.tsx
    ✅ src/renderer/App.css

Checks:
  ✅ typecheck (0 errors, 1.1s)
  ✅ lint (0 errors, 11.2s)
  ✅ vitest (275 / 275 passed, 6.4s)

Git context (last 5 commits):
  9d00ce3 feat(glossary): highlight toggle in panel header + all-component styles
  248c39b feat(glossary): wire HighlightedText into live feed + meeting transcripts
  9c00ae1 feat(glossary): HighlightedText + GlossaryMark renderer components
  06e3f33 feat(glossary): renderer matcher (regex builder + interval merging)
  bac7c51 feat(glossary): useActiveGlossary hook with entries-updated subscription

VERDICT: ✅ Phase 5 verified
```

**Phase 6 verification (`npm run verify:phase 6`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 6


🔍 autoMeetic verification — 2026-05-26 00:24

  Plan: docs/superpowers/plans/2026-05-25-glossary-variants-and-highlights.md
  Verifying Phase 6

  ⚠️  Could not extract expected files for Phase 6 from plan. Continuing with general checks only.

Checks:
  ✅ typecheck (0 errors, 1.0s)
  ✅ lint (0 errors, 10.9s)
  ✅ vitest (275 / 275 passed, 6.1s)

Git context (last 5 commits):
  796b716 fix(glossary): pass undefined for active glossary default scope
  cc986bd fix(glossary): expose recent segment scan through MemoryService
  9d00ce3 feat(glossary): highlight toggle in panel header + all-component styles
  248c39b feat(glossary): wire HighlightedText into live feed + meeting transcripts
  9c00ae1 feat(glossary): HighlightedText + GlossaryMark renderer components

VERDICT: ✅ Phase 6 verified
```

**General verification (`npm run verify`):**

```text
> automeetic@0.0.0 verify
> node scripts/verify.mjs


🔍 autoMeetic verification — 2026-05-26 00:22

Checks:
  ✅ typecheck (0 errors, 0.9s)
  ✅ lint (0 errors, 10.4s)
  ✅ vitest (275 / 275 passed, 5.8s)

Git context (last 5 commits):
  796b716 fix(glossary): pass undefined for active glossary default scope
  cc986bd fix(glossary): expose recent segment scan through MemoryService
  9d00ce3 feat(glossary): highlight toggle in panel header + all-component styles
  248c39b feat(glossary): wire HighlightedText into live feed + meeting transcripts
  9c00ae1 feat(glossary): HighlightedText + GlossaryMark renderer components

VERDICT: ✅ Verified clean
```

**Final build (`npm run build`):**

```text
> automeetic@0.0.0 build
> tsc -b && vite build

vite v8.0.12 building client environment for production...
✓ 1870 modules transformed.
✓ built in 13.48s
```

Build completed cleanly. Vite emitted existing chunk-size/plugin-timing warnings only.

**`npm test` note:**

```text
> automeetic@0.0.0 test
> node scripts/prepare-native-deps.mjs node && vitest run

prebuild-install warn install EBUSY: resource busy or locked, open 'C:\Users\taeji\OneDrive\바탕 화면\ai-projects\autoMeetic\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
```

`npm test` did not reach Vitest because Windows held `better_sqlite3.node` locked. Verification used `npm run verify` / `npx vitest run`, which passed 275/275.

**Manual smoke deferred to user:**

- Register `RealtimeOrchestrator`, click "변형 찾기" → candidates appear with frequencies.
- Save → success card shows past-match count and example.
- Start a meeting → live feed shows dotted underline on glossary matches.
- Open a saved meeting → same highlights appear in historical transcript.
- Toggle highlights off → underlines disappear.
- Register `AI` → save card warns about short-word exclusion.
- Register a brand-new term → success card shows the forward-looking message.

## ✅ Completed stream — Embedding Pipeline Durability + Startup Backfill

> Implemented and pushed to `origin/master`. See:
>
> - **Spec:** `docs/superpowers/specs/2026-05-25-embedding-pipeline-durability-design.md`
> - **Plan:** `docs/superpowers/plans/2026-05-25-embedding-pipeline-durability.md`
>
> Automated regression passed. Manual Electron smoke deferred to user (confirm `segment_embeddings` populates from ~0 to ~975 after next app start; telemetry events should fire for worker-init success + backfill start/complete).

## Completed stream state — Embedding Pipeline Durability

| Phase | Status | Commits | Tests passing |
|---|---|---|---|
| 1 — Schema + repo CRUD (TDD) | ✅ COMPLETE | `75359ce` → `b21e5d3` (3 commits) | 234/234 (`npm run verify:phase 1`); typecheck/lint clean |
| 2 — EmbeddingQueue failure persistence (TDD) | ✅ COMPLETE | `747cb46` → `0ff363c` (2 commits) | 238/238 (`npm run verify:phase 2`); typecheck/lint clean |
| 3 — Startup backfill + endMeeting fix (TDD) | ✅ COMPLETE | `090e2d6` → `d9944be` (2 commits) | 242/242 (`npm run verify:phase 3`); typecheck/lint clean |
| 4 — Telemetry | ✅ COMPLETE | `a9078fb` → `59a3b39` (3 commits) | 242/242 (`npm run verify:phase 4`); typecheck/lint clean |
| 5 — Regression + handoff + push | ✅ COMPLETE | `59a3b39` → `HEAD` (docs/final) | 242/242 (`npm run verify`); `npm test` blocked pre-Vitest by Windows `EBUSY`; build clean |

**Phase 1 verification (`npm run verify:phase 1`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 1


🔍 autoMeetic verification — 2026-05-25 21:42

  Plan: docs/superpowers/plans/2026-05-25-embedding-pipeline-durability.md
  Verifying Phase 1

  Expected files (referenced in Phase 1 body):
    ✅ src/main/memory/schema.ts
    ✅ src/main/memory/types.ts
    ✅ src/main/memory/repository.ts
    ✅ src/test/embedding-failures-repository.test.ts

Checks:
  ✅ typecheck (0 errors, 0.9s)
  ✅ lint (0 errors, 9.5s)
  ✅ vitest (234 / 234 passed, 6.8s)

Git context (last 5 commits):
  b21e5d3 feat(embeddings): repo CRUD for embedding_failures + backfill derivation
  c3638bf feat(embeddings): add EmbeddingFailure + PendingEmbedding types
  75359ce feat(embeddings): add embedding_failures table (schema v4)
  a005e2e Merge branch 'master' of https://github.com/taejin5314/autoMeetic
  3c1b674 [codex] Send Memory Ask answers to mind maps (#4)

VERDICT: ✅ Phase 1 verified
```

**Phase 2 verification (`npm run verify:phase 2`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 2


🔍 autoMeetic verification — 2026-05-25 21:45

  Plan: docs/superpowers/plans/2026-05-25-embedding-pipeline-durability.md
  Verifying Phase 2

  Expected files (referenced in Phase 2 body):
    ✅ src/test/memory-embedding-queue.test.ts
    ✅ src/main/memory/embeddingQueue.ts
    ✅ src/test/embedding-queue-failure-persistence.test.ts

Checks:
  ✅ typecheck (0 errors, 1.0s)
  ✅ lint (0 errors, 10.2s)
  ✅ vitest (238 / 238 passed, 5.6s)

Git context (last 5 commits):
  0ff363c feat(embeddings): persist permanent embedding failures
  747cb46 test(embeddings): expand fakeRepo with recordEmbeddingFailure
  b21e5d3 feat(embeddings): repo CRUD for embedding_failures + backfill derivation
  c3638bf feat(embeddings): add EmbeddingFailure + PendingEmbedding types
  75359ce feat(embeddings): add embedding_failures table (schema v4)

VERDICT: ✅ Phase 2 verified
```

**Phase 3 verification (`npm run verify:phase 3`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 3


🔍 autoMeetic verification — 2026-05-25 21:49

  Plan: docs/superpowers/plans/2026-05-25-embedding-pipeline-durability.md
  Verifying Phase 3

  Expected files (referenced in Phase 3 body):
    ✅ src/main/memory/memoryService.ts
    ✅ src/test/memory-service-backfill.test.ts

Checks:
  ✅ typecheck (0 errors, 1.1s)
  ✅ lint (0 errors, 11.9s)
  ✅ vitest (242 / 242 passed, 8.1s)

Git context (last 5 commits):
  d9944be feat(embeddings): startup backfill + non-blocking endMeeting
  090e2d6 chore(embeddings): add __workerFactory test hook to MemoryServiceOptions
  0ff363c feat(embeddings): persist permanent embedding failures
  747cb46 test(embeddings): expand fakeRepo with recordEmbeddingFailure
  b21e5d3 feat(embeddings): repo CRUD for embedding_failures + backfill derivation

VERDICT: ✅ Phase 3 verified
```

**Phase 4 verification (`npm run verify:phase 4`):**

```text
> automeetic@0.0.0 verify:phase
> node scripts/verify.mjs --phase 4


🔍 autoMeetic verification — 2026-05-25 21:52

  Plan: docs/superpowers/plans/2026-05-25-embedding-pipeline-durability.md
  Verifying Phase 4

  Expected files (referenced in Phase 4 body):
    ✅ src/main/memory/embeddingService.ts
    ✅ src/main/memory/embeddingQueue.ts
    ✅ src/main/memory/memoryService.ts

Checks:
  ✅ typecheck (0 errors, 0.9s)
  ✅ lint (0 errors, 9.5s)
  ✅ vitest (242 / 242 passed, 5.3s)

Git context (last 5 commits):
  59a3b39 feat(embeddings): telemetry for backfill start + completion
  f584dd1 feat(embeddings): telemetry for batch success + failure
  a9078fb feat(embeddings): telemetry for worker init success + failure
  d9944be feat(embeddings): startup backfill + non-blocking endMeeting
  090e2d6 chore(embeddings): add __workerFactory test hook to MemoryServiceOptions

VERDICT: ✅ Phase 4 verified
```

**Phase 5 verification (`npm run verify`):**

```text
> automeetic@0.0.0 verify
> node scripts/verify.mjs


🔍 autoMeetic verification — 2026-05-25 21:53

Checks:
  ✅ typecheck (0 errors, 0.9s)
  ✅ lint (0 errors, 9.5s)
  ✅ vitest (242 / 242 passed, 5.6s)

Git context (last 5 commits):
  59a3b39 feat(embeddings): telemetry for backfill start + completion
  f584dd1 feat(embeddings): telemetry for batch success + failure
  a9078fb feat(embeddings): telemetry for worker init success + failure
  d9944be feat(embeddings): startup backfill + non-blocking endMeeting
  090e2d6 chore(embeddings): add __workerFactory test hook to MemoryServiceOptions

VERDICT: ✅ Verified clean
```

**Phase 5 additional checks:**

- `npm test` was attempted and blocked before Vitest by Windows native-module lock:

```text
prebuild-install warn install EBUSY: resource busy or locked, open 'C:\Users\taeji\OneDrive\바탕 화면\ai-projects\autoMeetic\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
```

- `npm run build` completed successfully (`tsc -b && vite build`, Vite built in 12.30s).
- Manual Electron smoke is deferred to the user. Check telemetry for `memory.embedding.worker-init.success`, `memory.embedding.backfill.started`, and `memory.embedding.backfill.completed`; first model download can take a few minutes, so backfill speed is gated on that.

**Stream completion notes:** Embedding durability now persists per-boot permanent failures in `embedding_failures`, recomputes startup backfill from `segments` missing `segment_embeddings`, removes the misleading 3-second `endMeeting()` drain wait, and logs worker init, batch, and backfill telemetry. No UI, retry trigger, model swap, threshold change, query rewriting, or title generation was added.

## ✅ Completed stream — Memory Library Chat (Cross-meeting RAG)

> Implemented and pushed to `origin/master`. See:
>
> - **Spec:** `docs/superpowers/specs/2026-05-23-memory-chat-design.md`
> - **Plan:** `docs/superpowers/plans/2026-05-23-memory-chat.md`
>
> Automated regression passed. Manual Electron smoke deferred to user.

## Completed stream state — Memory Library Chat

| Phase | Status | Commits | Tests passing |
|---|---|---|---|
| 1 — Types + prompt helpers (TDD) | ✅ COMPLETE | `1e1569e` → `9183b79` (2 commits) | 199/199 (`npx vitest run` + `npm test`); typecheck/lint clean |
| 2 — Chat service orchestration (TDD) | ✅ COMPLETE | `f9e0b07` | 206/206 (`npx vitest run` + `npm test`); typecheck/lint clean |
| 3 — IPC handler + preload + IPC tests | ✅ COMPLETE | `582944c` | 211/211 (`npx vitest run` + `npm test`); typecheck/lint clean |
| 4 — Renderer types + parser + store | ✅ COMPLETE | `259b0b3` | 216/216 (`npx vitest run` + `npm test`); typecheck/lint clean |
| 5 — UI (AskInput, SourcesList, ChatMessageView, AskTab, panel refactor, styles) | ✅ COMPLETE | `847d912` → `45aae2e` (5 commits) | 216/216 (`npx vitest run` + `npm test`); typecheck/lint/build clean |
| 6 — Telemetry counters | ✅ COMPLETE | `f69c7ed` | 217/217 (`npx vitest run`); typecheck/lint clean; `npm test` blocked pre-Vitest by Windows `EBUSY` on `better_sqlite3.node` |
| 7 — Regression + manual smoke + push | ✅ COMPLETE | verification/docs only | 217/217 (`npx vitest run`); typecheck/lint/build clean; manual smoke deferred to user; `npm test` blocked pre-Vitest by Windows `EBUSY` on `better_sqlite3.node` |

**Stream completion notes:** Memory Library Chat now adds an Ask tab backed by cross-meeting search, streamed OpenAI answers, citation chips/sources, clickable citation navigation into Meetings with segment flash, persistent rolling chat history, glossary preserve post-pass, and telemetry counters (`memory.chat.submit`, `memory.chat.retrieved`, `memory.chat.no-context`, `memory.chat.completed`, `memory.chat.error`). Known gaps by v1 scope: plain text only, no markdown rendering, no export, no filter UI, no web-mode parity. Phase 7 manual Electron smoke is deferred to the user.

**Post-ship discovery (2026-05-25):** Field testing revealed that the underlying semantic search has been silently broken since before this stream shipped — `segment_embeddings` is empty because the embedding pipeline never completes its first model download. Memory Chat's RAG layer was built correctly on top of a non-functional retrieval layer. The new active stream above (Embedding Pipeline Durability) addresses the root cause.

## How to resume (Codex or any agent)

1. Read this file end-to-end. Also read `CLAUDE.md` "Phase verification convention" — it is MANDATORY.
2. Find the **Active stream state** table at the top. Next phase = first row marked `⏳ PENDING`.
3. For that phase, read the corresponding section in the active plan (linked in "Next active stream" above).
4. Implement per the plan (TDD where indicated). Each task has exact code blocks and exact commit messages.
5. **Before marking a phase ✅ COMPLETE in the table below, you MUST run `npm run verify:phase <N>` and paste the verbatim output.** A phase is only complete when the `VERDICT` line shows `✅ Phase N verified`. Do not edit the output or fabricate a passing run.
6. After all phases: also run `npm run verify` (general) one more time. Manual smoke per the spec's success criteria is deferred to the user unless explicitly assigned.

## ✅ Completed stream — Whiteboard Mind-Map Mode

> Implemented and pushed to `origin/master`. See:
>
> - **Spec:** `docs/superpowers/specs/2026-05-21-mindmap-mode-design.md`
> - **Plan:** `docs/superpowers/plans/2026-05-21-mindmap-mode.md`
>
> Automated regression passed. Manual Electron smoke is not run in this pass.

## Completed stream state — Whiteboard Mind-Map Mode

| Phase | Status | Commits | Tests passing |
|---|---|---|---|
| 1 — Types + colors + state | ✅ COMPLETE | `4f3990b` → `1f36499` (3 commits) | 170/170 (`npx vitest run`); typecheck/lint clean |
| 2 — Radial layout engine | ✅ COMPLETE | `db208c6` | 178/178 (`npx vitest run`); typecheck/lint clean |
| 3 — Prompt + parser | ✅ COMPLETE | `956baea` | 186/186 (`npx vitest run`); typecheck/lint clean |
| 4 — Service routing + IPC + preload | ✅ COMPLETE | `e9866a5` → `fcf8160` (3 commits) | 186/186 (`npx vitest run`); typecheck/lint clean |
| 5 — Shelf header mode toggle UI | ✅ COMPLETE | `a9818b4` | 186/186 (`npx vitest run`); typecheck/lint clean |
| 6 — Lifecycle wire + telemetry + regression + push | ✅ COMPLETE | `78f9f11` → `HEAD` | 186/186 (`npx vitest run`); typecheck/lint/build clean; manual smoke not run; `npm test` blocked pre-Vitest by Windows `EBUSY` |

**Stream completion notes:** Whiteboard now supports a dedicated Mind map mode with in-memory tree state, deterministic radial layout, a strict JSON operation parser, OpenAI-backed tree updates, glossary-aware label preservation, a shelf-header `[Freeform | Mind map]` toggle, meeting-title root initialization on lifecycle begin, and telemetry for mode toggles plus mind-map turns. Known gap: manual Electron smoke is still needed.

## ✅ Completed stream — Glossary Auto-Suggestions

> Implemented and pushed to `origin/master`. See:
>
> - **Spec:** `docs/superpowers/specs/2026-05-20-glossary-auto-suggestions-design.md`
> - **Plan:** `docs/superpowers/plans/2026-05-20-glossary-auto-suggestions.md`
>
> Automated regression passed. Manual Electron smoke is intentionally deferred for the user to run separately.

## Completed stream state — Glossary Auto-Suggestions

| Phase | Status | Commits | Tests passing |
|---|---|---|---|
| 1 — Storage + types + repository CRUD + backfill + cleanup hook | ✅ COMPLETE | `4acc27f` → `d317a38` (6 commits) | 143/143 (`npx vitest run`); `npm test` blocked pre-Vitest by Windows `EBUSY` |
| 2 — Extraction prompt + parser + suggestionService | ✅ COMPLETE | `b6aedcb` → `9b80542` (2 commits) | 152/152 (`npx vitest run`); `npm test` blocked pre-Vitest by Windows `EBUSY` |
| 3 — IPC handlers + preload bridge + lifecycle wiring + IPC tests | ✅ COMPLETE | `e34a5c5` → `b5afab8` (4 commits) | 158/158 (`npx vitest run`); `npm test` blocked pre-Vitest by Windows `EBUSY` |
| 4 — Renderer types + useGlossaryStore extension | ✅ COMPLETE | `312ccb0` → `5ad6cbf` (2 commits) | 158/158 (`npx vitest run`); `npm test` blocked pre-Vitest by Windows `EBUSY` |
| 5 — SuggestionRow + Panel tab + header badge + styles | ✅ COMPLETE | `21455ab` → `af622d0` (3 commits) | 158/158 (`npx vitest run`); `npm test` blocked pre-Vitest by Windows `EBUSY` |
| 6 — Telemetry counters | ✅ COMPLETE | `2a6c14d` | 10/10 IPC telemetry-adjacent tests; typecheck clean |
| 7 — Final regression + manual smoke + push | ✅ COMPLETE | `b47eb53` → `HEAD` | 158/158 (`npx vitest run`); typecheck/lint/build clean; manual smoke deferred to user; `npm test` blocked pre-Vitest by Windows `EBUSY` |

**Stream completion notes:** Auto-suggestions now persist extracted candidates, dedupe against existing/dismissed terms, surface a Suggestions tab with accept/dismiss/bulk-accept flows, backfill accepted terms into meeting transcript segments, show a header badge, and emit telemetry counters. The telemetry event names in use are `glossary.extraction.success`, `glossary.extraction.failure`, `glossary.extraction.empty-transcript`, `glossary.extraction.no-meeting`, `glossary.extraction.upsert-failed`, `glossary.suggestion.accepted`, `glossary.suggestion.dismissed`, and `glossary.suggestion.bulk-accepted`. Known gap: Phase 7 manual Electron smoke is not run in this pass and is assigned to the user.

## Previously shipped — Mind-map mode

- **Spec:** `docs/superpowers/specs/2026-05-21-mindmap-mode-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-21-mindmap-mode.md`

Notes: Electron-only mind-map mode is implemented with no persistence by design. Web-mode whiteboard parity remains out of scope for this stream.

## Previously shipped — Glossary v1 (Diagram Label Language)

- **Spec:** `docs/superpowers/specs/2026-05-19-glossary-and-diagram-label-language-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-19-glossary-and-diagram-label-language.md`

## Working branch

`master` (user explicitly approved working on master). Commits go directly; push to `origin/master` after each phase completes.

## Environment quirks

- **better-sqlite3 ABI mismatch:** The project's `better-sqlite3` is compiled for Electron (ABI 145), but vitest runs under Node (ABI 115). Workaround: a shim at `src/test/__sqlite-shim__.ts` plus an alias in `vitest.config.ts`. If tests fail locally with `NODE_MODULE_VERSION` errors, run `node scripts/prepare-native-deps.mjs node` (requires Electron not running) to install the Node-compatible binary at `node_modules/better-sqlite3/build/Release/better_sqlite3_node115.node`.
- **Lint baseline = 0 errors.** As of v1 ship, `npm run lint` is clean. Any new errors introduced by the auto-suggestions work must be fixed before that phase ships.
- **Preexisting tsc -b build error:** `npm run build` fails on a preexisting issue in `src/main/memory/repository.ts` (the `lookupSearchHits` return type). `npm run typecheck` (which uses `tsc --noEmit` instead of `tsc -b`) does pass cleanly. Don't try to "fix" this in glossary phases — it's out of scope.
- **Windows + PowerShell shell:** Use `npx vitest run` directly when possible to avoid the `npm test` script's native-deps prep step. PowerShell glob expansion is limited; pass test files by full path explicitly.

## Glossary v1 — completed phases (reference)

| Phase | Status | Commits | Tests passing |
|---|---|---|---|
| 1 — Storage foundation | ✅ COMPLETE | `1e2f819` → `85a7c2a` (9 commits) | 16/16 |
| 2 — Shared prompt helpers | ✅ COMPLETE | `1b79734` | 12/12 |
| 3 — Pull-based cache | ✅ COMPLETE | `0d2bc81` | 4/4 |
| 4 — IPC handlers + preload bridge | ✅ COMPLETE | `f47896b` → `476190c` (2 commits) | 4/4 |
| 5 — Translation queue integration | ✅ COMPLETE | `de672e1` | 2/2 |
| 6 — Glossary panel UI | ✅ COMPLETE | `f7945aa` → `bc98721` (7 commits) | 117/117 |
| 7 — Whiteboard integration | ✅ COMPLETE | `648f6dc` → `b3a016f` (3 commits) | 38/38 |
| 8 — STT vocabulary bias | ✅ COMPLETE | `d7bdf70` | 38/38 |
| 9 — Answer Assist integration | ✅ COMPLETE | `2eaf951` → `36b0359` (4 commits) | 38/38 |
| 10 — Regression sweep + push | ✅ COMPLETE | `911ae11` (head) | 117/117 |

## Notes per phase

**Phase 1** — Schema bump to v2 + `glossary_entries` table + `GlossaryEntry`/`GlossaryEntryInput` types + `MemoryRepository` methods (`upsertGlossary`, `getGlossaryEntry`, `listGlossary`, `deleteGlossary`, `activeGlossary`). 16 tests. One code-review fix cycle resolved: drop `any` from sqlite shim, validate translation language keys (≤20 chars), drop redundant `?? {}`, update stale schema-version-1 test description.

Notable unplanned additions (both accepted by review):
- `src/test/__sqlite-shim__.ts` + `vitest.config.ts` alias for the ABI workaround above
- `rowid DESC` tiebreaker on `ORDER BY updated_at DESC` for stable ordering in fast tests

**Phase 2** — `src/main/glossary/promptInjection.ts` with three pure helpers (`formatGlossaryPromptSection`, `normalizePreserveTerms`, `buildLabelLanguageBlock`) and `LANGUAGE_NAME_BY_CODE` lookup. 12 unit tests. Review pending.

**Phase 3** — `src/main/glossary/cache.ts` with pull-based `ensureFreshGlossary`, `getCachedGlossary`, `bumpGlossaryEpoch`, and test-only reset helper. 4 unit tests. Verification run: `npm run typecheck` and `npx vitest run src/test/glossary-repository.test.ts src/test/glossary-prompt-injection.test.ts src/test/glossary-cache.test.ts` passed (32/32 glossary tests).

**Phase 4** — `src/main/ipc-glossary-handlers.ts` handler factory + wiring in the actual IPC entrypoint (`src/main/ipc.ts`), plus `MemoryService` glossary pass-through methods and preload `window.electronAPI.glossary` bridge. 4 unit tests in `src/test/glossary-ipc-handlers.test.ts`. Verification run: `npm run typecheck`, glossary test bundle (36/36), `npm run lint`, `npx vitest run` (116/116), and `npm run build` passed. `npm test` was attempted but blocked before Vitest by Windows `EBUSY` on `node_modules/better-sqlite3/build/Release/better_sqlite3.node` while Electron/native deps were in use; use `npx vitest run` until the Electron process releases the file.

**Phase 5** — `src/main/transcriptPostProcessor.ts` now receives the `MemoryService` promise, pulls active glossary entries through the Phase 3 cache, injects `formatGlossaryPromptSection()` into live translation prompts, and applies `normalizePreserveTerms()` before emitting translation patches / memory updates. `src/main/index.ts` now shares the initialized memory service promise with the postprocessor. Regression coverage added to `src/test/memory-postprocessor-regression.test.ts` (2 tests). Verification run: `npm run typecheck`, `npx vitest run src/test/memory-postprocessor-regression.test.ts src/test/glossary-prompt-injection.test.ts src/test/glossary-cache.test.ts` (18/18), `npm run lint`, `npx vitest run` (117/117), and `npm run build` passed. Manual SQL smoke test deferred until the Phase 6 glossary panel exists.

**Phase 6** — Renderer glossary surface added: type re-export, `useGlossaryStore`, inline row editor, panel UI, styles, and header button mount in `App.tsx`. Meeting-scoped tab remains disabled with `meetingId={null}` per v1 plan. Lint fix included to defer initial store load from the effect body. Verification run: `npm run typecheck`, `npm run lint`, `npx vitest run` (117/117), and `npm run build` passed. `npm test` was re-attempted and still blocked before Vitest by Windows `EBUSY` on `node_modules/better-sqlite3/build/Release/better_sqlite3.node`, likely because Electron/native deps are currently holding the file. Manual Electron smoke test not run in this pass.

**Phase 7** — Whiteboard integration implemented across 3 tasks:
- Task 7.1: `whiteboardSystemPrompt` refactored to accept a `WhiteboardPromptOptions` object (`viewport`, `labelLanguage`, `glossary`), with `buildLabelLanguageBlock` and `formatGlossaryPromptSection` appended when non-empty.
- Task 7.2: `whiteboardService.ts` gains module-level `cachedLabelLanguage` + `setDiagramLabelLanguage`/`getDiagramLabelLanguage` exports; `init()` now optionally accepts the memory service promise (mirroring Phase 5 pattern) and resolves it async. Glossary is fetched via Phase 3 cache (`ensureFreshGlossary`/`getCachedGlossary`) before each agent prompt build. A `applyGlossaryPostPass()` helper normalizes `element.label.text` and standalone `text` fields after the LLM returns. IPC handler `whiteboard:set-label-language` registered in `src/main/ipc.ts`. Preload bridge `whiteboard.setLabelLanguage` added to `src/preload/index.ts` and `src/preload/types.ts`. Architectural note: in Electron mode the whiteboard WS is null — label language reaches main exclusively via the IPC channel, not the WS payload; the WS `labelLanguage` field is web-mode-only insurance.
- Task 7.3: `WhiteboardLabelLangSelect` component created at `src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx`. Mounts in the shelf header conditional on `shelf === 'whiteboard'`. Persists selection to `localStorage` and fires the IPC on mount + change. WS payload in `App.tsx` includes `labelLanguage` for web-mode parity. `readDiagramLabelLanguage` was inlined in `App.tsx` as a direct `localStorage.getItem` call to avoid the `react-refresh/only-export-components` lint error. Verification: `npm run typecheck`, `npm run lint` (clean — 0 errors), `npx vitest run` (38/38 Phase 7 tests, 117/117 full suite).
- Review fix: removed the duplicate mount-time IPC push useEffect (the `[value]` effect already pushes on mount, so the dedicated mount effect was sending the same value twice).
- Known deferred gap: `server/proxy.mjs` and `server/whiteboard-runtime.mjs` ignore the `labelLanguage` field in the WS `whiteboard:agent-run` payload, so web-mode diagram label language is non-functional. The spec defers all web-mode whiteboard parity to v2; Electron mode (the primary target) is fully functional.

## Subagent-driven workflow conventions

- **Phase-level batching:** Tasks tightly coupled within a phase get bundled into one implementer dispatch (e.g., Phase 1 was 6 tasks → 1 dispatch). Loosely coupled work uses one dispatch per task.
- **Per phase / dispatch:** implementer → spec reviewer → fix loop if needed → code quality reviewer → fix loop if needed → mark complete.
- **Commit hygiene:** Each task in the plan specifies its own commit message. Don't squash; let the history reflect the TDD cycle.
- **Commit message format:** `<type>(glossary): <description>`. Types in use: `feat`, `fix`, `chore`, `docs`, `test`. All commits include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer.

**Phase 9** — Answer Assist integration across two tasks plus a follow-up commit closing the Electron-mode gap:
- Task 9.1 (web mode): `useAnswerAssistStore.ts` now fetches the active glossary via `window.electronAPI.glossary.active()` just before the POST body is constructed and attaches it as `glossary` in the request body.
- Task 9.2 (proxy): `server/proxy.mjs` gains five JS helpers (`GLOSS_LANGUAGE_NAME_BY_CODE`, `glossQuote`, `glossEscapeRegex`, `formatGlossarySection`, `normalizePreserve`). `translateText` extended with optional 4th arg `glossary = []`; injects a GLOSSARY block into the system prompt and wraps the translated result in `normalizePreserve`. `buildAnswerAssistPrompt` extended with optional 3rd arg `glossary = []`; appends the glossary block as a tail. `/api/answer-assist` handler destructures `glossary = []` from the body; passes it to `buildAnswerAssistPrompt` and both `translateText` calls in `ensureBothHalves`; and applies `normalizePreserve` to the final `answer` and `answerKo` in both the `response.completed` path and the "stream ended without completed" tail path. Streaming deltas are NOT normalized per-chunk (word boundaries split across chunks); normalization applies only to the canonical final strings in the `done` SSE payload — this is the correct approach and the streaming display snaps to normalized on the `done` event.
- Follow-up (`36b0359`): closed the Electron-mode gap surfaced in review. `useAnswerAssistStore.ts` Electron branch now fetches active glossary too. `electronAPI.startAnswerAssist` and the `start-answer-assist` IPC carry the glossary through to `proxyService.startAnswerAssist`. `buildAnswerAssistSystemPrompt` accepts an optional 3rd `glossary` arg and appends `formatGlossaryPromptSection`; the two `done`-event sites in the streamed response post-pass `answer` and `answer_ko` with `normalizePreserveTerms`. Both Electron and web modes are now functionally equivalent for Answer Assist glossary handling. Verification: `npm run typecheck` clean, `npm run lint` clean (0 new errors), 38/38 tests passing.

**Phase 8** — STT vocabulary bias implemented in `src/main/sttService.ts`. Added module-level `memoryServiceRef` typed as `Pick<MemoryService, 'activeGlossary' | 'getCurrentMeetingId'>` (matching the Phase 5/7 pattern). Added `init()` export that accepts the memory service promise and resolves it async. `src/main/index.ts` passes `memoryServicePromise` to `initSttService`. In `startTranscription`, after fetching whiteboard keywords via `getVocabulary()`, the function calls `ensureFreshGlossary(memoryServiceRef, currentMeetingId)` and appends `getCachedGlossary().map(e => e.sourceTerm)` to the keyword list with lowercase dedup before passing to `buildVocabularyPrompt`. Bias is applied at session start only — mid-meeting glossary edits do not take effect until the next session (accepted limitation, documented in spec). No deviations from the plan. Verification: `npm run typecheck` clean, `npm run lint` clean (0 new errors), 38/38 tests passing.

**Phase 10** — Full regression sweep: `npm run typecheck` clean, `npm run lint` clean (0 errors — note: the 4 preexisting errors documented in Environment quirks were resolved in earlier phases as a side effect of the renderer/effect surgery), `npx vitest run` 117/117 passing across 24 files. Pushed master to `origin/master`. No PR created — the user explicitly chose direct-to-master workflow at the start of the implementation cycle (consistent with the established branch convention for this project).

## Open questions (deferred to v2, do NOT implement in this stream)

- Pre-meeting document upload / RAG
- Sharing links / export
- Team-shared glossary
- CSV / Anki imports
- Inline transcript/diagram highlighting of glossary matches
- Web-mode parity for `/api/translate` glossary (Answer Assist parity IS in scope for Phase 9)
- Renderer-side meeting-id propagation (the GlossaryPanel currently passes `meetingId={null}`; the "This meeting" tab is disabled until this is wired in a follow-up)

## Stack / commands

```bash
# Typecheck (must pass after every phase)
npm run typecheck

# Run a single test file (preferred during dev)
npx vitest run src/test/glossary-repository.test.ts

# Run all glossary tests (after Phase 3)
npx vitest run "src/test/glossary-*.test.ts"

# Lint (4 preexisting errors expected — flag any new ones)
npm run lint

# Build is preexisting-broken (see Environment quirks); don't gate on it.

# Manual dev run (Electron)
npm run dev:electron

# Manual dev run (web mode against proxy)
npm run dev:web
```

## Files created so far

```
src/main/memory/schema.ts              (modified)
src/main/memory/types.ts               (modified)
src/main/memory/repository.ts          (modified — glossary CRUD methods)
src/main/glossary/promptInjection.ts   (new)
src/main/glossary/cache.ts             (new — Phase 3)
src/main/ipc-glossary-handlers.ts      (new — Phase 4)
src/main/index.ts                      (modified — memory service promise shared with transcript postprocessor)
src/main/ipc.ts                        (modified — glossary handlers registered)
src/main/memory/memoryService.ts       (modified — glossary pass-through methods)
src/main/transcriptPostProcessor.ts    (modified — glossary injection into live translation)
src/renderer/glossary/types.ts         (new — renderer type re-export)
src/renderer/glossary/useGlossaryStore.ts (new — renderer store hook)
src/renderer/glossary/GlossaryPanel.tsx (new — glossary panel UI)
src/renderer/glossary/GlossaryRowEditor.tsx (new — inline row editor)
src/renderer/App.tsx                   (modified — glossary header button + panel mount)
src/renderer/App.css                   (modified — glossary panel styles)
src/preload/index.ts                   (modified — glossary bridge)
src/preload/types.ts                   (modified — glossary API types)
src/test/glossary-repository.test.ts   (new — 16 tests)
src/test/glossary-prompt-injection.test.ts (new — 12 tests)
src/test/glossary-cache.test.ts        (new — 4 tests)
src/test/glossary-ipc-handlers.test.ts (new — 4 tests)
src/test/memory-postprocessor-regression.test.ts (modified — glossary translation regression)
src/test/memory-repository-init.test.ts (modified — schema version assertion)
src/test/__sqlite-shim__.ts            (new — ABI workaround)
vitest.config.ts                       (modified — shim alias)
src/main/whiteboard/prompt.ts          (modified — Phase 7: options-object signature, labelLanguage + glossary blocks)
src/main/whiteboardService.ts          (modified — Phase 7: label-lang cache, glossary post-pass, memory service wiring)
src/main/ipc.ts                        (modified — Phase 7: whiteboard:set-label-language handler)
src/main/index.ts                      (modified — Phase 7: pass memory service promise to initWhiteboard)
src/preload/index.ts                   (modified — Phase 7: whiteboard.setLabelLanguage bridge)
src/preload/types.ts                   (modified — Phase 7: whiteboard API type)
src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx (new — Phase 7)
src/renderer/App.tsx                   (modified — Phase 7: label-lang select mount + WS payload)
src/renderer/App.css                   (modified — Phase 7: label-lang select styles)
src/main/sttService.ts                 (modified — Phase 8: init(), memoryServiceRef, glossary vocabulary merge)
src/main/index.ts                      (modified — Phase 8: initSttService wired with memoryServicePromise)
src/renderer/answer-assist/useAnswerAssistStore.ts (modified — Phase 9: fetch active glossary + attach to POST body)
server/proxy.mjs                       (modified — Phase 9: glossary helpers, translateText extended, buildAnswerAssistPrompt extended, /api/answer-assist handler extended)
```

## Files yet to create / modify (preview from plan)

```
(Phase 9 complete — no remaining files for Phase 10 beyond regression sweep + PR)
```
