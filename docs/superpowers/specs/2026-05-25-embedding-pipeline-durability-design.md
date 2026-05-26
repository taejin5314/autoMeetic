# Embedding Pipeline Durability + Startup Backfill — Design Spec

**Date:** 2026-05-25
**Status:** Draft — pending implementation
**Stream type:** Bug fix + infrastructure hardening
**Related:** Memory Library Chat (`2026-05-23-memory-chat-design.md`) ships an Ask tab that calls `SearchService.search()`; that search has been silently returning 0 semantic hits for every query because no embeddings exist. This spec fixes the underlying pipeline.

## One-line

Make the embedding pipeline durable: derive backfill work from the schema each boot, persist only **permanent failures**, drop the misleading 3-second `endMeeting()` drain wait, and add telemetry so silent failures stop being silent.

## Why this stream

**User-reported symptom (2026-05-25):** Memory Ask answers Korean questions with "no relevant meetings found" even when the database has matching content. Investigation revealed:

- `segment_embeddings` table: **0 rows** across 892 segments / 8 completed meetings.
- `embedding-cache/` directory in `userData`: **does not exist** — the `Xenova/multilingual-e5-small` model (~117MB) has never been downloaded successfully.
- `endMeeting()` waits exactly 3 seconds on `embeddingQueue.drainPending()` before returning. A first-run model download takes much longer; the drain times out, the meeting ends "successfully," and segments are left unprocessed in an in-memory queue with no persistence.
- The in-memory queue is lost on every app restart. No code path retries past meetings on subsequent startups.
- `console.warn('[memory] embedding batch failed:', err)` in `embeddingQueue.process()` is the only failure surface — easy to miss, no telemetry.

**Net effect:** Semantic search (the path that handles paraphrased queries — the user's `중국의 정세` query is paraphrased relative to data that says `시진핑`, `미중관계`, `외교`) has never worked for any user, in any language. The Memory Chat feature shipped on top of an embedding pipeline that fails silently on first run.

**Why fix now:** Memory Chat is the most recent shipped stream and its primary value prop (cross-meeting semantic retrieval) is broken. Title search will never match (auto-generated titles) and literal LIKE search only matches exact substrings, so semantic is load-bearing.

## Success criteria

1. **Fresh install path:** Boot the app for the first time. Begin a meeting, speak ~10 utterances, end the meeting. Within ~2 minutes after end (or sooner, depending on first-time model download), `SELECT COUNT(*) FROM segment_embeddings` ≥ the number of segments produced.
2. **Existing DB backfill path:** Boot the app against the current DB (892 segments, 0 embeddings). Within ~10 minutes of boot, `SELECT COUNT(*) FROM segment_embeddings` rises monotonically toward 892 in the background, without blocking the UI.
3. **Restart safety:** Kill the app mid-backfill at ~50% progress. Boot again. Backfill resumes by recomputing what is missing — no duplicate work (idempotent `INSERT OR IGNORE` semantics on `segment_embeddings`), no lost segments.
4. **`endMeeting()` is non-blocking on embeddings:** Calling `endMeeting()` returns within hundreds of ms regardless of embedding queue depth. Embedding work continues in the background.
5. **Failure visibility:** If the embedding worker fails to initialize (e.g., model download network error), the failure is logged via `telemetry/logger.ts` as `memory.embedding.worker-init.failure`. If a batch fails, `memory.embedding.batch.failure` fires with the error. After `maxAttempts` retries inside a single boot, the segment is recorded in `embedding_failures` with `last_error` and is not retried again **this session**. On the next boot, the segment becomes eligible again (the failure record acts as a "skip this boot" gate, not a "never try again" gate — see Key design decisions).
6. **No regression to existing tests** (`npm run typecheck`, `npm run lint`, `npx vitest run` all clean).
7. **Memory Ask returns sources for paraphrased queries** once backfill completes: e.g., the user's `중국의 정세` query returns at least one of the existing meeting segments mentioning `시진핑/CCTV/미중관계` via semantic match.

## In scope

- New table `embedding_failures` (schema v3 → v4) — **only stores segments that hit the per-boot retry limit**. Pending work is always derived from `segments LEFT JOIN segment_embeddings`.
- New `MemoryRepository` methods:
  - `getSegmentsNeedingEmbedding()` — `segments LEFT JOIN segment_embeddings LEFT JOIN embedding_failures` filtered to rows with no embedding and no failure record. Returns `[{segmentId, sourceText}]`.
  - `recordEmbeddingFailure(segmentId, attempts, errorMessage)` — `INSERT OR REPLACE` into `embedding_failures` with `failed_at = now`.
  - `clearEmbeddingFailures(segmentIds?)` — optional cleanup; not called from production code in v1 (kept for future "retry failed" admin action and easier tests).
  - `listEmbeddingFailures(limit)` — for diagnostics / telemetry.
  - `countSegmentsNeedingEmbedding()` — for telemetry snapshots.
- `EmbeddingQueue` changes (minimal):
  - Repo `Pick` surface expands to include `recordEmbeddingFailure`.
  - On batch failure where the per-item `attempts` reaches `maxAttempts`, the queue calls `recordEmbeddingFailure(segmentId, attempts, error)`. No DB write for transient retries.
  - On batch success: unchanged (`saveEmbeddings` only).
  - No `hydrateFromDb`, no `enqueueEmbeddingJob` — both are unnecessary because work is recomputed each boot from the schema.
- `MemoryService.initialize()`:
  - After repo + worker construction, before returning the service, calls a new `enqueueAllMissingEmbeddings()` method that runs `repo.getSegmentsNeedingEmbedding()` and `embeddingQueue.enqueue` for each. **Does not await drain.**
  - Adds a test-only `__workerFactory` option so unit tests can inject a fake worker without spawning a real `worker_threads.Worker`.
- `MemoryService.endMeeting()`:
  - Removes the `await embeddingQueue.drainPending(..., 3000)` call. The current 3-second wait is the bug we are fixing.
  - Keeps the `repo.getMissingEmbeddings(meetingId)` + `embeddingQueue.enqueue` loop so live-meeting segments still get queued (idempotent if `enqueueAllMissingEmbeddings` already picked them up at boot).
  - Summary generation path (`.then().catch()` fire-and-forget) is unchanged — it does not depend on embeddings.
- Telemetry counters via existing `log(level, channel, event, data)` helper:
  - `memory.embedding.worker-init.success`
  - `memory.embedding.worker-init.failure` { error }
  - `memory.embedding.batch.success` { batchSize, durationMs }
  - `memory.embedding.batch.failure` { batchSize, attempt, error }
  - `memory.embedding.backfill.started` { pendingCount }
  - `memory.embedding.backfill.completed` { processed, failed, durationMs }
- Worker init error surfacing:
  - `EmbeddingService` currently rejects pending promises on worker `error` event but emits no log. Add `log('error', 'memory-embedding', 'memory.embedding.worker-init.failure', { error })` in the same handler.
  - Emit `memory.embedding.worker-init.success` after the first successful batch completes (proves model finished downloading).
- Unit tests (TDD):
  - `src/test/embedding-failures-repository.test.ts` — repo CRUD, derivation query, cascade delete behaviour.
  - `src/test/embedding-queue-failure-persistence.test.ts` — queue calls `recordEmbeddingFailure` only after `maxAttempts`, never on transient errors.
  - `src/test/memory-service-backfill.test.ts` — `initialize()` enqueues missing, `endMeeting()` returns non-blocking, restart resumes from current schema state.

## Out of scope (deferred)

- UI for embedding progress / backfill status indicator (telemetry only for v1).
- Admin action / IPC to retry `embedding_failures` rows on demand (the table is structured to support this in v2 — `clearEmbeddingFailures` exists as a hook — but no UI wiring this stream).
- Replacing `Xenova/multilingual-e5-small` with a different model.
- Changing the semantic threshold (`0.5` in `SearchService`) or normalization.
- Hybrid search rebalancing (literal vs semantic).
- Pre-downloading the model on first app launch with a progress dialog.
- LLM-based query rewriting / expansion for 0-hit queries (was Option 3 in brainstorming — explicitly deferred).
- Auto-generated meaningful meeting titles (was Option 2 — separate stream).
- Vector DB swap (sqlite-vec, libsql, faiss, etc.).
- Multi-worker pool / parallel embedding generation.
- Backfill rate limiting / scheduling around active meetings (v1 just runs it as fast as the queue allows).

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Persistence model | Only **failures** are persisted; "what to do" is always recomputed from `segments LEFT JOIN segment_embeddings LEFT JOIN embedding_failures` | The schema already encodes the answer. A second "pending queue" table just duplicates state and creates synchronization bugs. Recomputation is simpler, smaller, and inherently crash-safe. |
| Failed-record semantics | A row in `embedding_failures` means "skip this segment **for this session only**"; the next boot makes it eligible again | Persistent failures (e.g., model file corruption) get re-tried whenever the user restarts. Transient failures (network blip during model download) self-heal on restart without user intervention. If a segment is truly poisoned, it will flip back into failures next session and stay there until the user takes action. |
| Per-boot retry budget | `maxAttempts=3` (matches existing in-memory default) | No change to retry policy semantics; only the persistence boundary moves. |
| Backfill trigger | Inside `MemoryService.initialize()`, fire-and-forget | Boot path is the right place because (a) it runs once per app start, (b) it has access to the fully-constructed queue, (c) the user does not need to wait. |
| `endMeeting()` drain | Removed entirely | The 3-second wait is the bug — it gives the false impression of completion while silently losing work. Background processing continues like summary generation already does. |
| `enqueue()` semantics | Pure in-memory push (unchanged) | No DB write on enqueue. DB writes happen only on permanent failure. This keeps the hot path identical to the current code and avoids any sync overhead on the live-transcript hook. |
| Schema migration | `CREATE TABLE IF NOT EXISTS` + bump `SCHEMA_VERSION` to 4 + UPDATE the row to 4 if it was < 4 | Matches existing convention. No `ALTER`s needed. Existing memory.db files pick up the new table on next boot. |
| Worker init failure | Logged but not blocking app start | If the worker can't load the model (network down at first boot), the app should still work — embeddings will just stay unprocessed. They'll get tried again on next boot. |
| Telemetry surface | Existing `log(level, channel, event, data)` in `telemetry/logger.ts` | Same pattern used by glossary + memory-chat streams. No new surface needed. |
| Test injection | `__workerFactory` test-only field on `MemoryServiceOptions`, prefixed with `__` to signal "not part of the public API" | Avoids needing to extract a worker-factory module just for tests. The flag is documented as test-only in both spec and the type. |
| Test strategy | TDD per phase, vitest with sqlite shim (existing setup) | Matches the established stream pattern (memory-chat, glossary). |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Model download still fails (network) on first try after this ship | Failure is now logged + surfaced via telemetry. Segments stay unembedded; next successful worker init (next session, or next batch attempt this session) will drain them. No silent permanent loss. |
| Backfilling 892 segments on first run with this fix takes a long time and competes with live meeting embedding | Queue is FIFO with `batchSize=16`. A live-meeting segment enqueued mid-backfill will wait its turn but will be processed in order. v1 accepts this trade; if it becomes a UX issue, a "live meetings have priority" reordering is v2. |
| Schema bump v3→v4 on existing user DBs | `CREATE TABLE IF NOT EXISTS embedding_failures` is idempotent. `schema_version` row is bumped to 4 inside `initialize()` so future migrations can branch on version cleanly. |
| Removing the 3-second drain wait could break a test that relied on synchronous completion | The current `endMeeting()` takes `timeoutMs = 3000` as a parameter. Audit call sites and tests in Phase 3; the contract is now async — adjust tests to `await queue.drain()` if they need to wait. |
| Sudden backfill could spike OpenAI Realtime / proxy resource usage | Embeddings are local (worker thread, no network after model is cached). No external API impact. |
| Permanent-failure pollution: a single bad row keeps blowing up the batch and getting marked failed every session | Acceptable v1 behaviour — the user can `DELETE FROM embedding_failures` manually as an escape hatch. v2 may add a UI button. Marking the segment in the table means it doesn't take down the rest of the batch in a tight loop. |
| Existing tests use stubbed repos that don't include the new methods | Stub interfaces (`Pick<MemoryRepository, ...>`) will need the new methods added. Phase 2 explicitly audits and updates `src/test/memory-embedding-queue.test.ts`. |

## Verification approach

Per `CLAUDE.md` phase verification convention:

1. **Each phase:** `npm run verify:phase <N>` must show `VERDICT: ✅ Phase N verified`.
2. **Final:** `npm run verify` must show `VERDICT: ✅ Verified clean`.
3. **Manual smoke (deferred to user):**
   - Against current 892-segment DB: start app → wait 5-10 minutes → confirm `SELECT COUNT(*) FROM segment_embeddings` rises monotonically. Open Memory Ask, query `중국의 정세` → confirm at least one related segment surfaces via semantic.
   - Fresh-meeting path: begin a meeting, end after a few utterances, confirm embedding counts catch up within ~2 minutes (subject to first-time model download taking longer).
   - Telemetry log inspection: confirm `memory.embedding.worker-init.success`, `memory.embedding.backfill.started`, `memory.embedding.backfill.completed` events appear in the log.

## File map (preview — full detail in plan)

| Path | Action | Responsibility |
|---|---|---|
| `src/main/memory/schema.ts` | Modify | Add `embedding_failures` table; bump `SCHEMA_VERSION` to 4 |
| `src/main/memory/repository.ts` | Modify | Add 5 new methods (`getSegmentsNeedingEmbedding`, `recordEmbeddingFailure`, `clearEmbeddingFailures`, `listEmbeddingFailures`, `countSegmentsNeedingEmbedding`); update `initialize()` to bump version row |
| `src/main/memory/types.ts` | Modify | Add `EmbeddingFailure` + `PendingEmbedding` types |
| `src/main/memory/embeddingQueue.ts` | Modify | Expand repo Pick; call `recordEmbeddingFailure` after `maxAttempts` |
| `src/main/memory/embeddingService.ts` | Modify | Log worker init success/failure |
| `src/main/memory/memoryService.ts` | Modify | Add `__workerFactory`; `enqueueAllMissingEmbeddings()` in `initialize()`; remove `drainPending` from `endMeeting()`; backfill telemetry |
| `src/test/embedding-failures-repository.test.ts` | Create | Repo CRUD + derivation query tests |
| `src/test/embedding-queue-failure-persistence.test.ts` | Create | Queue persistence on permanent failure only |
| `src/test/memory-service-backfill.test.ts` | Create | `initialize()` backfill + non-blocking `endMeeting()` tests |
| `src/test/memory-embedding-queue.test.ts` | Modify | Update `fakeRepo` to include the new method |
| `HANDOFF.md` | Modify | New active stream block + status table |

## Open questions / explicit non-decisions

- **Should failed segments be retried automatically across sessions?** v1: yes, the next boot tries them again. This avoids permanent silent loss for transient errors. A truly poisoned segment will pollute the failures table on every boot — acceptable noise floor for v1.
- **Should we add an admin UI / IPC to inspect or clear `embedding_failures`?** v1: no. `clearEmbeddingFailures(segmentIds?)` exists as a hook; UI is v2.
- **What about embeddings for `translated_text` instead of just `source_text`?** Out of scope. The existing pipeline embeds `source_text` per the `notifyTurnFinalized` hook; this spec does not change that policy.
- **Should backfill be paused while a meeting is live?** v1: no — embedding is local + worker-thread + not on the main process loop. If it becomes a problem we'll add backpressure in v2.

## Self-review notes

Initial draft used a more complex `embedding_jobs` table tracking both `pending` and `failed` status with `attempts`, `enqueued_at`, and `updated_at` columns, plus a `hydrateFromDb` queue method. On second pass: the "pending" state was redundant — it's already derivable from `segments LEFT JOIN segment_embeddings`. Persisting only failures keeps the failure record (the genuinely durable thing we need) while letting the queue's hot path stay pure-in-memory. This revision drops a method, a column set, and a class of synchronization bugs without losing any of the success criteria.
