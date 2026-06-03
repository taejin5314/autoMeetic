# Live Coach + Memory Tree — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Checkbox (`- [ ]`) tracking. Phase-by-phase. Each phase ends with a clean `npm run verify:phase <N>` + `npm run build` before the table in `HANDOFF.md` is updated. Read `HANDOFF.md` and `AGENTS.md` first. TDD throughout where logic warrants it. Coach is added as a `PipelineBus` subscriber — `transcriptPostProcessor` is NOT edited (proves the orchestration stream's value).

**Goal:** Add Memory Tree (one cluster level of meeting summaries) + Live Coach (PipelineBus subscriber emitting past-context + glossary-mismatch cards to a new right-sidebar feed).

**Architecture:** `src/main/memory/memoryTreeBuilder.ts` rebuilds clusters on meeting-end (cosine similarity ≥ 0.6, LLM-regenerated cluster summary). `src/main/coach/coachService.ts` consumes `turn-finalized` (regex pre-filter → embed → nearest cluster lookup) and `glossary-normalize-applied` (free). `src/main/pipeline/subscribers/coachSubscriber.ts` is the bus adapter, registered in `index.ts` in ONE line. Coach events flow to renderer via `coach:event` IPC; `<CoachFeed>` mounts under a new `'coach'` mode of `RightShelf`. `normalizePreserveTerms` is extended to return `{ text, pairs }` (behavior-preserving for `.text`); `transcriptPostProcessor` emits the new pipeline event after normalize.

**Tech stack:** TypeScript strict (no `any`), better-sqlite3, vitest, existing `telemetry/logger.ts`, OpenAI Chat Completions (`gpt-4o-mini` for cluster summaries), no new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-live-coach-memory-tree-design.md`

**Scope reminder (do NOT exceed):** One cluster level only. Two Coach event types only (past-context + glossary-mismatch). No drift / clarifying-question / response-draft / speaker-balance. Sidebar feed only — no popups/toasts/audio/mascot. No external integrations. No local LLM. No CJK depth. No multi-level tree. No persistence across app restart. No learning loop.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/main/memory/schema.ts` | Modify | Add `meeting_clusters` + `meeting_cluster_members`; bump `SCHEMA_VERSION` 5 → 6 |
| `src/main/memory/types.ts` | Modify | `MeetingCluster`, `MeetingClusterMember` |
| `src/main/memory/repository.ts` | Modify | Cluster CRUD + cosine-similarity lookup + migration |
| `src/main/memory/memoryTreeBuilder.ts` | Create | `rebuildForMeeting(meetingId)` |
| `src/main/pipeline/types.ts` | Modify | Add `glossary-normalize-applied` event |
| `src/main/glossary/promptInjection.ts` | Modify | Extended `normalizePreserveTerms` returning `{ text, pairs }` |
| `src/main/transcriptPostProcessor.ts` | Modify | Emit `glossary-normalize-applied` after normalize (single line) |
| `src/main/coach/types.ts` | Create | `CoachEvent` union |
| `src/main/coach/coachService.ts` | Create | Event detection + rate limit + dedup |
| `src/main/pipeline/subscribers/coachSubscriber.ts` | Create | Bus adapter |
| `src/main/index.ts` | Modify | Register `coachSubscriber`; wire `meeting-ended` → `memoryTreeBuilder` |
| `src/preload/index.ts` + `types.ts` | Modify | `coach.onEvent` bridge |
| `src/renderer/coach/types.ts` | Create | Re-export |
| `src/renderer/coach/useCoachFeed.ts` | Create | Hook |
| `src/renderer/coach/CoachFeed.tsx` | Create | Component |
| `src/renderer/shell/RightShelf.tsx` | Modify | Add `'coach'` shelf mode rendering |
| `src/renderer/shell/usePanels.ts` | Modify | Extend `Shelf` union with `'coach'` |
| `src/renderer/App.tsx` | Modify | Shelf toggle 3-way cycle; pass coach props to RightShelf |
| `src/renderer/App.css` | Modify | Coach card styles |
| `src/renderer/i18n/locales/{en,ko,ja,zh}.json` | Modify | Coach strings |
| `src/test/memory-cluster-repository.test.ts` | Create | ~6 tests |
| `src/test/memory-tree-builder.test.ts` | Create | ~5 tests |
| `src/test/coach-service.test.ts` | Create | ~8 tests |
| `src/test/coach-glossary-extension.test.ts` | Create | ~3 tests |
| `HANDOFF.md` | Modify | New active stream block + status table |

---

## Phase 1 — Memory Tree: schema + repository + builder (TDD)

### Task 1.1 — Schema v5 → v6

- [ ] Bump `SCHEMA_VERSION = 6` in `schema.ts`. Append:

```sql
CREATE TABLE IF NOT EXISTS meeting_clusters (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL,
  centroid     BLOB NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meeting_cluster_members (
  cluster_id TEXT NOT NULL REFERENCES meeting_clusters(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  PRIMARY KEY (cluster_id, meeting_id)
);
CREATE INDEX IF NOT EXISTS idx_meeting_cluster_members_meeting
  ON meeting_cluster_members(meeting_id);
```

- [ ] In `repository.ts` `initialize()`, add `migrateToV6IfNeeded()` (idempotent: probes `sqlite_master` for `meeting_clusters` existence; runs above DDL if missing — though `CREATE IF NOT EXISTS` covers fresh installs).
- [ ] Commit: `feat(coach): add meeting_clusters tables (schema v6)`

### Task 1.2 — Types

- [ ] Append in `types.ts`:
```ts
export interface MeetingCluster {
  id: string
  title: string
  summary: string
  centroid: Float32Array
  memberCount: number
  createdAt: number
  updatedAt: number
}
```
- [ ] Commit: `feat(coach): add MeetingCluster type`

### Task 1.3 — Cluster repository methods (TDD)

- [ ] Write `src/test/memory-cluster-repository.test.ts` covering:
  - insertCluster + listClusters round-trip
  - addClusterMember + getClusterByMeeting
  - findNearestClusterToCentroid: returns nearest above threshold, null below
  - centroid BLOB round-trips Float32Array correctly
  - cascade delete on meeting / cluster removal
  - recalcClusterCentroid averages over current members' meeting centroids (where meeting centroid = avg of segment_embeddings — use a small helper for that)
- [ ] Implement methods in `repository.ts`:
  - `insertCluster(cluster: Omit<MeetingCluster,'updatedAt'>)`
  - `updateClusterSummary(id, title, summary, updatedAt)`
  - `addClusterMember(clusterId, meetingId)`
  - `getClusterByMeeting(meetingId): MeetingCluster | null`
  - `listClusters(limit = 100): MeetingCluster[]`
  - `findNearestClusterToCentroid(centroid, threshold): { cluster, similarity } | null` (cosine similarity)
  - `recalcClusterCentroid(clusterId): Float32Array | null` (avg member meeting centroids)
- [ ] Verify + commit: `feat(coach): cluster CRUD + cosine-similarity lookup`

### Task 1.4 — Memory Tree Builder (TDD)

- [ ] `src/test/memory-tree-builder.test.ts`:
  - `rebuildForMeeting`: with no clusters → creates new cluster + 1 member + LLM summary called once
  - with existing cluster above threshold → adds member, recomputes centroid, LLM regenerates that cluster's summary
  - with existing clusters all below threshold → creates new singleton cluster
  - skips meeting if it has no segment_embeddings yet (gracefully no-op + log)
  - LLM call is mocked; assertion is the call shape (model gpt-4o-mini, prompt mentions the cluster's member titles/summaries)
- [ ] Implement `memoryTreeBuilder.ts`:
  - `rebuildForMeeting(meetingId, deps?)` where deps allow injecting `fetch` + repo (testability)
  - Computes meeting centroid by averaging segment embeddings via `repo.getMeetingEmbeddings(meetingId)` (add a small repo helper if absent: SELECT vectors for meeting's segments and average)
  - Threshold from `Number(process.env.MEMORY_TREE_CLUSTER_THRESHOLD ?? 0.6)`
  - LLM prompt: "Given these meetings (titles + short summaries), produce: line 1 = short topic title (≤60 chars), then blank line, then 2–3 sentence cross-meeting summary (≤500 chars total). Plain text, no JSON."
  - Save updated title+summary + bump `updated_at`
- [ ] Verify + commit: `feat(coach): memory tree builder (cluster assign + LLM summary)`

### Task 1.5 — Verify Phase 1

```bash
npm run verify:phase 1
npm run build
```

Update `HANDOFF.md` Phase 1 row.

---

## Phase 2 — Glossary normalize extension + pipeline event (TDD)

### Task 2.1 — Extend `normalizePreserveTerms` (behavior-preserving for `.text`)

- [ ] `src/test/coach-glossary-extension.test.ts`:
  - existing behavior preserved: `result.text` identical to current return for various inputs
  - `result.pairs` contains each `(variant → canonical)` replacement made
  - empty pairs when nothing was normalized
  - dedups identical pairs within one call
- [ ] Modify `promptInjection.ts`:
  - Change return type to `{ text: string; pairs: { variant: string; canonical: string }[] }`
  - Inner regex-replace loop tracks which variants matched
- [ ] Update ALL existing call sites mechanically to use `.text` only (Memory Chat synthesizer, Deep Ask synthesizer, Answer Assist (proxy + Electron), Whiteboard glossary post-pass, transcriptPostProcessor translation path). No behavioral change.
- [ ] Existing tests must stay green.
- [ ] Commit: `feat(coach): normalizePreserveTerms returns variant→canonical pairs`

### Task 2.2 — New pipeline event + emit from transcript post-processor

- [ ] Extend `PipelineEvent` union in `pipeline/types.ts`:
```ts
| { type: 'glossary-normalize-applied'; id: string; pairs: { variant: string; canonical: string }[] }
```
- [ ] In `transcriptPostProcessor.ts` translation path: after the normalize call, if `result.pairs.length > 0`, emit:
```ts
pipelineBusRef?.emit({ type: 'glossary-normalize-applied', id: turnId, pairs: result.pairs })
```
- [ ] Existing memory subscriber etc. ignore this new event (`switch` falls through). Verified by current tests staying green.
- [ ] Commit: `feat(coach): emit glossary-normalize-applied pipeline event`

### Task 2.3 — Verify Phase 2

```bash
npm run verify:phase 2
npm run build
```

Update `HANDOFF.md`.

---

## Phase 3 — CoachSubscriber + service (TDD)

### Task 3.1 — Coach types

- [ ] `src/main/coach/types.ts`:
```ts
export type CoachEvent =
  | { type: 'past-context'; clusterId: string; clusterTitle: string; snippet: string; turnId: string; emittedAtMs: number }
  | { type: 'glossary-mismatch'; canonical: string; variant: string; turnId: string; emittedAtMs: number }
```
- [ ] Commit: `feat(coach): add CoachEvent types`

### Task 3.2 — coachService (TDD)

- [ ] `src/test/coach-service.test.ts`:
  - past-context regex screen filters out turns without keyword
  - rate limit: only 1 past-context per minute even with many keyword hits
  - same cluster id deduped within 5 minutes
  - past-context emits only when nearest cluster's similarity ≥ threshold AND cluster ≠ current meeting's
  - glossary-mismatch emits one event per unique `(canonical)` within 1 min
  - total cards capped at 5/min across types
  - `meeting-ended` clears rate-limit state
- [ ] Implement `coach/coachService.ts`:
  - `createCoachService({ repo, embedder, currentMeetingClusterId(): string | null, emit(event: CoachEvent) })`
  - Methods: `onTurnFinalized(turn)` (regex check → embed → repo lookup → emit), `onGlossaryNormalize(payload)` (dedup → emit), `onMeetingEnded()` (clear state)
  - Internal: timestamp maps + Sets for dedup; constants (MAX_PER_MIN, CLUSTER_DEDUP_MS, etc.)
- [ ] Verify + commit: `feat(coach): coach service (past-context + glossary-mismatch detection)`

### Task 3.3 — CoachSubscriber adapter

- [ ] `src/main/pipeline/subscribers/coachSubscriber.ts`:
```ts
export function makeCoachSubscriber(service: CoachService): PipelineSubscriber {
  return {
    name: 'coach',
    onEvent(event) {
      if (event.type === 'turn-finalized') service.onTurnFinalized(event.turn)
      else if (event.type === 'glossary-normalize-applied') service.onGlossaryNormalize(event)
      else if (event.type === 'meeting-ended') service.onMeetingEnded()
    },
  }
}
```
- [ ] Commit: `feat(coach): pipeline subscriber adapter`

### Task 3.4 — Wire in `index.ts`

- [ ] In main `index.ts` (where other subscribers register):
  - Construct `coachService` with the memory repo, embedding service, current meeting cluster getter (via `repo.getClusterByMeeting(currentMeetingId)`), and an `emit` that calls `mainWindow.webContents.send('coach:event', event)`.
  - `pipelineBus.register(makeCoachSubscriber(coachService))` — one line.
  - Also wire `meeting-ended` to the memory tree builder: `pipelineBus.register({ name: 'memoryTreeBuilder', onEvent: (e) => e.type === 'meeting-ended' && void memoryTreeBuilder.rebuildForMeeting(e.meetingId) })` (or fold into an existing subscriber if convenient).
- [ ] `npm run typecheck && npm run lint && npx vitest run`
- [ ] Commit: `feat(coach): register coach subscriber + tree builder in index`

### Task 3.5 — Verify Phase 3

```bash
npm run verify:phase 3
npm run build
```

Update `HANDOFF.md`.

---

## Phase 4 — Preload + i18n strings

### Task 4.1 — Preload bridge

- [ ] `src/preload/index.ts`:
```ts
coach: {
  onEvent: (cb: (event: CoachEvent) => void): (() => void) => {
    const h = (_: unknown, e: CoachEvent) => cb(e)
    ipcRenderer.on('coach:event', h)
    return () => ipcRenderer.removeListener('coach:event', h)
  },
},
```
- [ ] `src/preload/types.ts`: add to API surface.
- [ ] Commit: `feat(coach): preload bridge for coach events`

### Task 4.2 — i18n locale keys (all 4 files)

- [ ] Add `coach.*` keys: `tabLabel`, `empty`, `pastContext.title`, `pastContext.openAction`, `glossaryMismatch.title`, `glossaryMismatch.body`, `dismiss`, `clearAll`. Translate for en/ko/ja/zh.
- [ ] Run locale parity test → green.
- [ ] Commit: `feat(coach): i18n keys for Coach feed (en/ko/ja/zh)`

### Task 4.3 — Verify Phase 4

```bash
npm run verify:phase 4
```

Update `HANDOFF.md`.

---

## Phase 5 — Renderer UI: CoachFeed + RightShelf integration

### Task 5.1 — `useCoachFeed` hook + types

- [ ] `src/renderer/coach/types.ts`: re-export `CoachEvent` from main types.
- [ ] `src/renderer/coach/useCoachFeed.ts`:
```ts
export function useCoachFeed(): {
  cards: CoachCard[]
  dismiss(id: string): void
  clearAll(): void
}
```
where `CoachCard = CoachEvent & { id: string; dismissed: boolean }`. Subscribes via `window.electronAPI.coach.onEvent`. Rolling cap of 30 cards.
- [ ] Commit: `feat(coach): useCoachFeed renderer hook`

### Task 5.2 — `CoachFeed` component

- [ ] `src/renderer/coach/CoachFeed.tsx`: presentational, takes `cards + dismiss + clearAll + onOpenCluster(clusterId)` as props. Renders each card by type:
  - past-context: icon + title (cluster title) + snippet + [Open] button
  - glossary-mismatch: icon + "Glossary: {canonical} (heard: {variant})" + [Dismiss]
  - Empty state via `t('coach.empty')`.
  - Header with [Clear all] button when cards ≥ 1.
- [ ] Commit: `feat(coach): CoachFeed component`

### Task 5.3 — RightShelf 'coach' mode + Shelf union extension

- [ ] `src/renderer/shell/usePanels.ts`: extend `Shelf` union to `'whiteboard' | 'actions' | 'coach' | 'closed'`.
- [ ] `src/renderer/shell/RightShelf.tsx`: accept the new `'coach'` value; render `<CoachFeed cards=… dismiss=… clearAll=… onOpenCluster=… />` when active. New tab in the shelf header.
- [ ] `src/renderer/App.tsx`: shelf-toggle button cycles `closed → whiteboard → actions → coach → closed` (preserve current default 'whiteboard' on first render). Pass `cards/dismiss/clearAll/onOpenCluster` to RightShelf (or mount `<CoachFeed>` directly inside RightShelf using its own hook — simpler).
- [ ] `onOpenCluster(clusterId)`: opens Memory Library + select the cluster's latest meeting. v1 simple: call `setMemoryLibraryOpen(true)` and pass a new optional `initialMeetingId` prop to `MemoryLibraryPanel` (or via a tiny store/event). If this gets fiddly, defer: just open Memory Library (no auto-select) in v1 and note it as a v1.1 polish.
- [ ] Verify (typecheck+lint+build+vitest) + commit: `feat(coach): mount Coach feed in RightShelf with 3rd shelf mode`

### Task 5.4 — Styles

- [ ] `src/renderer/App.css`: card styles, dismiss animation, type-specific icons/colors, empty-state. Match existing right-shelf aesthetics (calm, subdued).
- [ ] Commit: `feat(coach): styles for Coach cards + feed`

### Task 5.5 — Verify Phase 5

```bash
npm run verify:phase 5
npm run build
```

Update `HANDOFF.md`.

---

## Phase 6 — Regression + handoff + push

### Task 6.1 — Full regression

```bash
npm run verify
npm run build
```

Confirm:
- All existing tests green (memory-postprocessor-regression, glossary-prompt-injection, pipeline-bus, pipeline-subscribers, deep-ask, slack, i18n parity, etc.)
- All new tests green (memory-cluster-repository, memory-tree-builder, coach-service, coach-glossary-extension)
- `transcriptPostProcessor.ts` grep: still no edits beyond the single emit line (proves orchestration value)

### Task 6.2 — Update `HANDOFF.md`

- [ ] Move prior streams to Completed if needed.
- [ ] Insert new "Next active stream" block + status table for the next planned stream (Meeting Action Integrations, or CJK depth, or Local LLM — whichever the user picks). Leave as ⏳ PENDING placeholder if not yet decided.

### Task 6.3 — Manual smoke (deferred to user)

Document the smoke checklist from the spec (keyword phrase → past-context card; glossary variant → mismatch card; rate limits hold; shelf toggle 3-way; locale switches; no console errors; Coach disabled = no observable change).

### Task 6.4 — Push

```bash
git push origin master
```

Mark Phase 6 ✅ COMPLETE in `HANDOFF.md`.

---

## Self-review checklist

- [ ] All 6 phases ✅ COMPLETE in `HANDOFF.md` with verbatim verify output + build confirmation.
- [ ] `transcriptPostProcessor.ts` edits limited to: import of pipeline types + single emit line for `glossary-normalize-applied`. No new direct consumer calls. (Proves PipelineBus value.)
- [ ] `normalizePreserveTerms` extension is behavior-preserving for `.text`; all call sites updated mechanically.
- [ ] Coach state cleared on `meeting-ended` (no cross-meeting leak).
- [ ] Rate limits enforced + tested (past-context 1/min, total 5/min, cluster dedup 5min, canonical dedup 1min).
- [ ] Memory Tree degrades gracefully when a meeting has no embeddings yet.
- [ ] i18n parity test green.
- [ ] No new dependencies; no scope creep into drift detection / action items / external integrations.
- [ ] Coach disabled (shelf mode ≠ coach) → existing UX 100% identical.

## Open questions (deferred to v2)

- Multi-level Memory Tree (super-clusters)
- Cluster re-balance / merge / split
- Coach learning loop (dismiss = signal)
- Inline transcript markers for past-context
- LLM-generated "why this matches" line on past-context cards
- Cluster title localization per UI language
- Coach card persistence across app restart
- Past-context Open action: jump precisely to the matching segment (v1: latest meeting in cluster)
- Periodic re-clustering job
- Additional Coach event types (drift, clarifying, action-item live)
