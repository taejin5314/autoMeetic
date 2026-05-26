# Embedding Pipeline Durability + Startup Backfill — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Checkbox (`- [ ]`) tracking. Phase-by-phase. Each phase ends with a clean `npm run verify:phase <N>` before the table in `HANDOFF.md` is updated. Read `HANDOFF.md` and `AGENTS.md` first for environment quirks (notably: the better-sqlite3 ABI shim under Windows + the `EBUSY` `npm test` quirk).

**Goal:** Persist permanent embedding failures, backfill all missing embeddings on every app startup by recomputing from the schema, drop the 3-second `endMeeting()` drain wait, and add telemetry so the embedding pipeline stops failing silently.

**Architecture:** New `embedding_failures` table records segments that hit the per-boot retry limit. Pending work is **always** derived from `segments LEFT JOIN segment_embeddings LEFT JOIN embedding_failures` — no separate pending-jobs table, no `hydrateFromDb` step. `MemoryService.initialize()` enqueues every needs-embedding segment and lets the queue work in background. `endMeeting()` no longer waits.

**Tech stack:** TypeScript strict (no `any` unless documented), better-sqlite3, vitest, existing `telemetry/logger.ts`.

**Spec:** `docs/superpowers/specs/2026-05-25-embedding-pipeline-durability-design.md`

**Scope reminder (do NOT exceed):** No new UI. No retry-failed-jobs trigger. No model swap. No threshold changes. No query rewriting. No title generation. Just: failure persistence + startup backfill + fix the lying drain + telemetry.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/main/memory/schema.ts` | Modify | Add `embedding_failures` table; bump `SCHEMA_VERSION` 3 → 4 |
| `src/main/memory/types.ts` | Modify | Add `EmbeddingFailure` + `PendingEmbedding` types |
| `src/main/memory/repository.ts` | Modify | 5 new methods; update `initialize()` to bump version row |
| `src/main/memory/embeddingService.ts` | Modify | Log worker init failure + first-success event |
| `src/main/memory/embeddingQueue.ts` | Modify | Expand repo Pick; call `recordEmbeddingFailure` after `maxAttempts` |
| `src/main/memory/memoryService.ts` | Modify | `enqueueAllMissingEmbeddings()`; `__workerFactory` test hook; drop `drainPending` from `endMeeting()`; telemetry |
| `src/test/embedding-failures-repository.test.ts` | Create | 7+ tests |
| `src/test/embedding-queue-failure-persistence.test.ts` | Create | 4+ tests |
| `src/test/memory-service-backfill.test.ts` | Create | 4+ tests |
| `src/test/memory-embedding-queue.test.ts` | Modify | Update fake repo with new method |
| `HANDOFF.md` | Modify | New active stream block + status table |

---

## Phase 1 — Schema + types + repository CRUD (TDD)

### Task 1.1 — Add `embedding_failures` table and bump schema version

**Files:** `src/main/memory/schema.ts`

- [ ] **Step 1: Edit `src/main/memory/schema.ts`**

Change `SCHEMA_VERSION` from `3` to `4`. Append after the `glossary_dismissed_terms` table:

```sql
CREATE TABLE IF NOT EXISTS embedding_failures (
  segment_id TEXT PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
  attempts   INTEGER NOT NULL,
  last_error TEXT NOT NULL,
  failed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embedding_failures_failed_at
  ON embedding_failures(failed_at DESC);
```

- [ ] **Step 2: Verify schema parses + commit**

```bash
npm run typecheck
git add src/main/memory/schema.ts
git commit -m "feat(embeddings): add embedding_failures table (schema v4)"
```

---

### Task 1.2 — Add types

**Files:** `src/main/memory/types.ts`

- [ ] **Step 1: Append to `src/main/memory/types.ts`**

```ts
export interface EmbeddingFailure {
  segmentId: string
  attempts: number
  lastError: string
  failedAt: number
}

export interface PendingEmbedding {
  segmentId: string
  sourceText: string
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/main/memory/types.ts
git commit -m "feat(embeddings): add EmbeddingFailure + PendingEmbedding types"
```

---

### Task 1.3 — Repository methods (TDD)

**Files:** `src/main/memory/repository.ts`, `src/test/embedding-failures-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/embedding-failures-repository.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRepository } from '../main/memory/repository'

function freshRepo(): MemoryRepository {
  const dir = mkdtempSync(join(tmpdir(), 'autometic-emb-'))
  return new MemoryRepository(join(dir, 'memory.db'))
}

function seedMeeting(repo: MemoryRepository): void {
  repo.insertMeeting({
    id: 'mtg1',
    title: 'm',
    startedAt: 1,
    endedAt: null,
    sourceLanguage: 'ko',
    targetLanguage: 'en',
    status: 'live',
    segmentCount: 0,
    durationMs: null,
  })
}

function seedSegment(repo: MemoryRepository, id: string, text = 'hello', seq = 1): void {
  repo.insertSegment({
    id,
    meetingId: 'mtg1',
    seq,
    createdAt: seq,
    speakerId: null,
    speakerLabel: null,
    sourceText: text,
    translatedText: null,
    sourceLanguage: 'ko',
  })
}

describe('MemoryRepository — embedding_failures + backfill derivation', () => {
  let repo: MemoryRepository

  beforeEach(() => {
    repo = freshRepo()
    seedMeeting(repo)
  })

  it('schema version is 4 after fresh init', () => {
    expect(repo.getSchemaVersion()).toBe(4)
  })

  it('getSegmentsNeedingEmbedding returns segments without embedding or failure', () => {
    seedSegment(repo, 's1', 'a', 1)
    seedSegment(repo, 's2', 'b', 2)
    const pending = repo.getSegmentsNeedingEmbedding()
    expect(pending.map((p) => p.segmentId).sort()).toEqual(['s1', 's2'])
    expect(pending[0].sourceText.length).toBeGreaterThan(0)
  })

  it('getSegmentsNeedingEmbedding excludes segments that already have an embedding', () => {
    seedSegment(repo, 's1', 'a', 1)
    seedSegment(repo, 's2', 'b', 2)
    repo.saveEmbeddings([{ segmentId: 's1', vector: new Float32Array([1, 2]), model: 'm' }])
    const pending = repo.getSegmentsNeedingEmbedding()
    expect(pending.map((p) => p.segmentId)).toEqual(['s2'])
  })

  it('getSegmentsNeedingEmbedding excludes segments recorded in embedding_failures', () => {
    seedSegment(repo, 's1', 'a', 1)
    seedSegment(repo, 's2', 'b', 2)
    repo.recordEmbeddingFailure('s1', 3, 'boom')
    const pending = repo.getSegmentsNeedingEmbedding()
    expect(pending.map((p) => p.segmentId)).toEqual(['s2'])
  })

  it('recordEmbeddingFailure inserts a row and is idempotent (REPLACE)', () => {
    seedSegment(repo, 's1')
    repo.recordEmbeddingFailure('s1', 3, 'first')
    repo.recordEmbeddingFailure('s1', 3, 'second')
    const failures = repo.listEmbeddingFailures(10)
    expect(failures).toHaveLength(1)
    expect(failures[0].lastError).toBe('second')
    expect(failures[0].attempts).toBe(3)
  })

  it('clearEmbeddingFailures([ids]) removes specified rows', () => {
    seedSegment(repo, 's1', 'a', 1)
    seedSegment(repo, 's2', 'b', 2)
    repo.recordEmbeddingFailure('s1', 3, 'x')
    repo.recordEmbeddingFailure('s2', 3, 'y')
    repo.clearEmbeddingFailures(['s1'])
    const remaining = repo.listEmbeddingFailures(10).map((f) => f.segmentId)
    expect(remaining).toEqual(['s2'])
  })

  it('clearEmbeddingFailures() with no args removes all rows', () => {
    seedSegment(repo, 's1')
    repo.recordEmbeddingFailure('s1', 1, 'x')
    repo.clearEmbeddingFailures()
    expect(repo.listEmbeddingFailures(10)).toHaveLength(0)
  })

  it('cascade delete via segments removes orphan failures', () => {
    seedSegment(repo, 's1')
    repo.recordEmbeddingFailure('s1', 1, 'x')
    repo.deleteMeeting('mtg1')
    expect(repo.listEmbeddingFailures(10)).toHaveLength(0)
  })

  it('countSegmentsNeedingEmbedding matches getSegmentsNeedingEmbedding length', () => {
    seedSegment(repo, 's1', 'a', 1)
    seedSegment(repo, 's2', 'b', 2)
    seedSegment(repo, 's3', 'c', 3)
    repo.saveEmbeddings([{ segmentId: 's1', vector: new Float32Array([1]), model: 'm' }])
    repo.recordEmbeddingFailure('s2', 3, 'x')
    expect(repo.countSegmentsNeedingEmbedding()).toBe(1)
    expect(repo.getSegmentsNeedingEmbedding().map((p) => p.segmentId)).toEqual(['s3'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/embedding-failures-repository.test.ts
```

Expect FAIL — methods do not exist yet.

- [ ] **Step 3: Implement methods in `src/main/memory/repository.ts`**

Update the imports from `./types` to include `EmbeddingFailure` and `PendingEmbedding`. Add these methods inside `MemoryRepository` (suggested location: after `getMissingEmbeddings`, before `searchByText`):

```ts
getSegmentsNeedingEmbedding(): PendingEmbedding[] {
  return this.db
    .prepare(
      `SELECT s.id AS segmentId, s.source_text AS sourceText
       FROM segments s
       LEFT JOIN segment_embeddings e ON e.segment_id = s.id
       LEFT JOIN embedding_failures f ON f.segment_id = s.id
       WHERE e.segment_id IS NULL AND f.segment_id IS NULL
       ORDER BY s.created_at ASC, s.seq ASC`
    )
    .all() as PendingEmbedding[]
}

countSegmentsNeedingEmbedding(): number {
  const row = this.db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM segments s
       LEFT JOIN segment_embeddings e ON e.segment_id = s.id
       LEFT JOIN embedding_failures f ON f.segment_id = s.id
       WHERE e.segment_id IS NULL AND f.segment_id IS NULL`
    )
    .get() as { n: number }
  return row.n
}

recordEmbeddingFailure(segmentId: string, attempts: number, errorMessage: string): void {
  this.db
    .prepare(
      `INSERT INTO embedding_failures(segment_id, attempts, last_error, failed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(segment_id) DO UPDATE SET
         attempts   = excluded.attempts,
         last_error = excluded.last_error,
         failed_at  = excluded.failed_at`
    )
    .run(segmentId, attempts, errorMessage, Date.now())
}

listEmbeddingFailures(limit: number): EmbeddingFailure[] {
  return this.db
    .prepare(
      `SELECT segment_id AS segmentId, attempts, last_error AS lastError, failed_at AS failedAt
       FROM embedding_failures
       ORDER BY failed_at DESC
       LIMIT ?`
    )
    .all(limit) as EmbeddingFailure[]
}

clearEmbeddingFailures(segmentIds?: string[]): void {
  if (!segmentIds) {
    this.db.prepare(`DELETE FROM embedding_failures`).run()
    return
  }
  if (segmentIds.length === 0) return
  const placeholders = segmentIds.map(() => '?').join(',')
  this.db
    .prepare(`DELETE FROM embedding_failures WHERE segment_id IN (${placeholders})`)
    .run(...segmentIds)
}
```

- [ ] **Step 4: Update `initialize()` to bump schema version row**

In `MemoryRepository.initialize()`, replace the version-row block with:

```ts
private initialize(): void {
  this.db.exec(SCHEMA_SQL)
  const row = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined
  if (!row) {
    this.db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(SCHEMA_VERSION)
  } else if (row.version < SCHEMA_VERSION) {
    this.db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION)
  }
}
```

- [ ] **Step 5: Verify + commit**

```bash
npx vitest run src/test/embedding-failures-repository.test.ts
npm run typecheck
npm run lint
git add src/main/memory/repository.ts src/test/embedding-failures-repository.test.ts
git commit -m "feat(embeddings): repo CRUD for embedding_failures + backfill derivation"
```

---

### Task 1.4 — Verify Phase 1

- [ ] **Run phase verification**

```bash
npm run verify:phase 1
```

Expected: `VERDICT: ✅ Phase 1 verified`. If not, fix before proceeding.

- [ ] **Update `HANDOFF.md` Phase 1 row to ✅ COMPLETE with the commit hash and a paste of the verify output. Do not mark complete without verify ✅.**

---

## Phase 2 — EmbeddingQueue permanent-failure persistence (TDD)

### Task 2.1 — Update existing queue tests to match new repo shape

**Files:** `src/test/memory-embedding-queue.test.ts`

- [ ] **Step 1: Expand `fakeRepo` to include `recordEmbeddingFailure`**

The existing fake exposes only `saveEmbeddings`. Update it to:

```ts
function fakeRepo() {
  const saved: { segmentId: string; vector: Float32Array; model: string }[] = []
  const failures: { segmentId: string; attempts: number; error: string }[] = []
  return {
    saved,
    failures,
    saveEmbeddings: (rows: typeof saved) => {
      saved.push(...rows)
    },
    recordEmbeddingFailure: (segmentId: string, attempts: number, error: string) => {
      failures.push({ segmentId, attempts, error })
    },
  }
}
```

All 5 existing tests should still pass because they don't probe failure persistence. Run:

```bash
npx vitest run src/test/memory-embedding-queue.test.ts
```

- [ ] **Step 2: Commit the test helper update**

```bash
git add src/test/memory-embedding-queue.test.ts
git commit -m "test(embeddings): expand fakeRepo with recordEmbeddingFailure"
```

---

### Task 2.2 — Add permanent-failure persistence to `EmbeddingQueue` (TDD)

**Files:** `src/main/memory/embeddingQueue.ts`, `src/test/embedding-queue-failure-persistence.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/embedding-queue-failure-persistence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EmbeddingQueue } from '../main/memory/embeddingQueue'

interface FakeRepo {
  saved: { segmentId: string; vector: Float32Array; model: string }[]
  failures: { segmentId: string; attempts: number; error: string }[]
  saveEmbeddings: (rows: FakeRepo['saved']) => void
  recordEmbeddingFailure: (segmentId: string, attempts: number, error: string) => void
}

function fakeRepo(): FakeRepo {
  const saved: FakeRepo['saved'] = []
  const failures: FakeRepo['failures'] = []
  return {
    saved,
    failures,
    saveEmbeddings: (rows) => saved.push(...rows),
    recordEmbeddingFailure: (segmentId, attempts, error) =>
      failures.push({ segmentId, attempts, error }),
  }
}

describe('EmbeddingQueue — permanent-failure persistence', () => {
  it('does NOT record a failure on transient (retryable) batch failure', async () => {
    let n = 0
    const embedder = {
      embedPassages: async (texts: string[]) => {
        n++
        if (n === 1) throw new Error('transient')
        return texts.map(() => new Float32Array([1]))
      },
    }
    const r = fakeRepo()
    const q = new EmbeddingQueue(embedder as never, r as never, {
      modelId: 'm',
      batchSize: 2,
      maxAttempts: 3,
    })
    q.enqueue({ segmentId: 's1', text: 't' })
    q.enqueue({ segmentId: 's2', text: 't' })
    await q.drain()
    expect(r.saved.map((s) => s.segmentId).sort()).toEqual(['s1', 's2'])
    expect(r.failures).toHaveLength(0)
  })

  it('records a failure ONCE per segment when attempts reach maxAttempts', async () => {
    const embedder = {
      embedPassages: async () => {
        throw new Error('always')
      },
    }
    const r = fakeRepo()
    const q = new EmbeddingQueue(embedder as never, r as never, {
      modelId: 'm',
      batchSize: 1,
      maxAttempts: 3,
    })
    q.enqueue({ segmentId: 's1', text: 't' })
    await q.drain()
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].segmentId).toBe('s1')
    expect(r.failures[0].attempts).toBe(3)
    expect(r.failures[0].error).toBe('always')
    expect(r.saved).toHaveLength(0)
  })

  it('records distinct failures for each segment in a failing batch', async () => {
    const embedder = {
      embedPassages: async () => {
        throw new Error('batch boom')
      },
    }
    const r = fakeRepo()
    const q = new EmbeddingQueue(embedder as never, r as never, {
      modelId: 'm',
      batchSize: 4,
      maxAttempts: 2,
    })
    q.enqueue({ segmentId: 'a', text: 'x' })
    q.enqueue({ segmentId: 'b', text: 'x' })
    await q.drain()
    const ids = r.failures.map((f) => f.segmentId).sort()
    expect(ids).toEqual(['a', 'b'])
    for (const f of r.failures) {
      expect(f.attempts).toBe(2)
      expect(f.error).toBe('batch boom')
    }
  })

  it('does not persist a failure for a segment that ultimately succeeds via retry', async () => {
    let n = 0
    const embedder = {
      embedPassages: async (texts: string[]) => {
        n++
        if (n < 3) throw new Error('transient')
        return texts.map(() => new Float32Array([1]))
      },
    }
    const r = fakeRepo()
    const q = new EmbeddingQueue(embedder as never, r as never, {
      modelId: 'm',
      batchSize: 1,
      maxAttempts: 5,
    })
    q.enqueue({ segmentId: 's1', text: 't' })
    await q.drain()
    expect(r.saved.map((s) => s.segmentId)).toEqual(['s1'])
    expect(r.failures).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/embedding-queue-failure-persistence.test.ts
```

Expect FAIL — failure persistence isn't wired yet.

- [ ] **Step 3: Edit `src/main/memory/embeddingQueue.ts`**

Expand the repo `Pick` and update the catch branch in `process()`:

```ts
import type { EmbeddingService } from './embeddingService'
import type { MemoryRepository } from './repository'

interface QueueItem {
  segmentId: string
  text: string
  attempts?: number
}

interface QueueOptions {
  modelId: string
  batchSize?: number
  maxAttempts?: number
}

type RepoSurface = Pick<MemoryRepository, 'saveEmbeddings' | 'recordEmbeddingFailure'>

export class EmbeddingQueue {
  private items: QueueItem[] = []
  private processing: Promise<void> | null = null
  private scheduled = false
  private readonly batchSize: number
  private readonly maxAttempts: number
  private readonly completed = new Set<string>()
  private waiters: { segmentIds: Set<string>; resolve: () => void }[] = []
  private embedder: Pick<EmbeddingService, 'embedPassages'>
  private repo: RepoSurface
  private opts: QueueOptions

  constructor(
    embedder: Pick<EmbeddingService, 'embedPassages'>,
    repo: RepoSurface,
    opts: QueueOptions
  ) {
    this.embedder = embedder
    this.repo = repo
    this.opts = opts
    this.batchSize = opts.batchSize ?? 16
    this.maxAttempts = opts.maxAttempts ?? 3
  }

  enqueue(item: QueueItem): void {
    this.items.push(item)
    if (!this.scheduled) {
      this.scheduled = true
      queueMicrotask(() => {
        this.scheduled = false
        void this.kick()
      })
    }
  }

  size(): number {
    return this.items.length
  }

  async drain(): Promise<void> {
    while (this.items.length > 0 || this.processing || this.scheduled) {
      if (!this.processing) void this.kick()
      await this.processing
    }
  }

  async drainPending(segmentIds: string[], timeoutMs: number): Promise<boolean> {
    const pending = new Set(segmentIds.filter((id) => !this.completed.has(id)))
    if (pending.size === 0) return true
    if (!this.processing) void this.kick()
    return new Promise<boolean>((resolve) => {
      const waiter = { segmentIds: pending, resolve: () => resolve(true) }
      this.waiters.push(waiter)
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        resolve(false)
      }, timeoutMs)
      const origResolve = waiter.resolve
      waiter.resolve = () => {
        clearTimeout(t)
        origResolve()
      }
    })
  }

  private kick(): Promise<void> {
    if (this.processing) return this.processing
    this.processing = this.process().finally(() => {
      this.processing = null
    })
    return this.processing
  }

  private async process(): Promise<void> {
    while (this.items.length > 0) {
      const batch = this.items.splice(0, this.batchSize)
      try {
        const vectors = await this.embedder.embedPassages(batch.map((item) => item.text))
        this.repo.saveEmbeddings(
          batch.map((item, i) => ({
            segmentId: item.segmentId,
            vector: vectors[i],
            model: this.opts.modelId,
          }))
        )
        for (const item of batch) this.completed.add(item.segmentId)
        this.notifyWaiters()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[memory] embedding batch failed:', err)
        const retryable: QueueItem[] = []
        for (const item of batch) {
          const nextAttempts = (item.attempts ?? 0) + 1
          if (nextAttempts < this.maxAttempts) {
            retryable.push({ ...item, attempts: nextAttempts })
          } else {
            this.repo.recordEmbeddingFailure(item.segmentId, nextAttempts, message)
          }
        }
        if (retryable.length > 0) this.items.unshift(...retryable)
      }
    }
  }

  private notifyWaiters(): void {
    for (const waiter of [...this.waiters]) {
      const done = [...waiter.segmentIds].every((id) => this.completed.has(id))
      if (!done) continue
      this.waiters.splice(this.waiters.indexOf(waiter), 1)
      waiter.resolve()
    }
  }
}
```

- [ ] **Step 4: Verify**

```bash
npx vitest run src/test/embedding-queue-failure-persistence.test.ts
npx vitest run src/test/memory-embedding-queue.test.ts
npm run typecheck
npm run lint
```

All tests must pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/embeddingQueue.ts src/test/embedding-queue-failure-persistence.test.ts
git commit -m "feat(embeddings): persist permanent failures via embedding_failures"
```

---

### Task 2.3 — Verify Phase 2

- [ ] **Run phase verification**

```bash
npm run verify:phase 2
```

Expected: `VERDICT: ✅ Phase 2 verified`.

- [ ] **Update `HANDOFF.md` Phase 2 row.**

---

## Phase 3 — Startup backfill + `endMeeting()` cleanup (TDD)

### Task 3.1 — Add the `__workerFactory` test hook

**Files:** `src/main/memory/memoryService.ts`

- [ ] **Step 1: Edit `MemoryServiceOptions`**

```ts
import type { EmbeddingWorkerLike } from './embeddingService'

interface MemoryServiceOptions {
  dbPath: string
  workerPath: string
  modelEnvCacheDir?: string
  summarize?: SummarizeCall
  /** Test-only hook: inject a fake worker instead of spawning from workerPath. */
  __workerFactory?: () => EmbeddingWorkerLike
}
```

- [ ] **Step 2: In `static async initialize(opts)`, replace the `const worker = new Worker(...)` line**

```ts
const worker: EmbeddingWorkerLike = opts.__workerFactory
  ? opts.__workerFactory()
  : (new Worker(opts.workerPath, {
      env: {
        ...process.env,
        ...(opts.modelEnvCacheDir ? { MEMORY_EMBEDDING_CACHE_DIR: opts.modelEnvCacheDir } : {}),
      },
    }) as unknown as EmbeddingWorkerLike)
```

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
npm run lint
git add src/main/memory/memoryService.ts
git commit -m "chore(embeddings): add __workerFactory test hook to MemoryServiceOptions"
```

---

### Task 3.2 — Write failing tests for backfill + non-blocking endMeeting

**Files:** `src/test/memory-service-backfill.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryService } from '../main/memory/memoryService'
import type { MemoryRepository } from '../main/memory/repository'

/** A worker stub that immediately responds with one zero-vector per text. */
function stubWorker() {
  const handlers = {
    message: [] as Array<(m: { id: number; vectors?: Float32Array[]; error?: string }) => void>,
    error: [] as Array<(e: Error) => void>,
  }
  return {
    postMessage: (msg: { id: number; texts: string[] }) => {
      setImmediate(() => {
        for (const h of handlers.message)
          h({ id: msg.id, vectors: msg.texts.map(() => new Float32Array([0.1, 0.2, 0.3])) })
      })
    },
    on: (evt: 'message' | 'error', handler: never) => {
      handlers[evt].push(handler)
    },
    terminate: () => Promise.resolve(0),
  }
}

/** A worker stub that NEVER responds — used to prove endMeeting doesn't block. */
function silentWorker() {
  return {
    postMessage: () => {},
    on: () => {},
    terminate: () => Promise.resolve(0),
  }
}

function repoOf(svc: MemoryService): MemoryRepository {
  return (svc as unknown as { repo: MemoryRepository }).repo
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)))
}

describe('MemoryService — startup backfill', () => {
  it('on initialize, every segment without an embedding gets enqueued and processed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autometic-bf-'))
    const dbPath = join(dir, 'memory.db')

    // First boot: seed segments via repo (bypass transcript hook)
    const s1 = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: stubWorker,
    })
    const meetingId = s1.beginMeeting({ sourceLanguage: 'ko', targetLanguage: 'en' })
    const repo1 = repoOf(s1)
    for (let i = 0; i < 3; i++) {
      repo1.insertSegment({
        id: `seg${i}`,
        meetingId,
        seq: i + 1,
        createdAt: Date.now() + i,
        speakerId: null,
        speakerLabel: null,
        sourceText: `text ${i}`,
        translatedText: null,
        sourceLanguage: 'ko',
      })
    }
    expect(repo1.countSegmentsNeedingEmbedding()).toBe(3)

    // Second boot: same DB, fresh service. Backfill should run.
    const s2 = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: stubWorker,
    })
    await flushMicrotasks()
    await flushMicrotasks()
    expect(repoOf(s2).countSegmentsNeedingEmbedding()).toBe(0)
  })

  it('endMeeting returns within 500ms even with a worker that never responds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autometic-bf-'))
    const dbPath = join(dir, 'memory.db')
    const svc = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: silentWorker,
    })
    svc.beginMeeting({ sourceLanguage: 'ko', targetLanguage: 'en' })
    const repo = repoOf(svc)
    const meetingId = (svc as unknown as { lifecycle: { getCurrentMeetingId: () => string } }).lifecycle.getCurrentMeetingId()
    repo.insertSegment({
      id: 'seg-x',
      meetingId,
      seq: 1,
      createdAt: Date.now(),
      speakerId: null,
      speakerLabel: null,
      sourceText: 'hi',
      translatedText: null,
      sourceLanguage: 'ko',
    })
    const start = Date.now()
    await svc.endMeeting()
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)
  })

  it('a second initialize on a DB with leftover work picks it up via backfill', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autometic-bf-'))
    const dbPath = join(dir, 'memory.db')
    const s1 = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: silentWorker, // never embeds
    })
    const meetingId = s1.beginMeeting({ sourceLanguage: 'ko', targetLanguage: 'en' })
    repoOf(s1).insertSegment({
      id: 'segA',
      meetingId,
      seq: 1,
      createdAt: Date.now(),
      speakerId: null,
      speakerLabel: null,
      sourceText: 'a',
      translatedText: null,
      sourceLanguage: 'ko',
    })
    expect(repoOf(s1).countSegmentsNeedingEmbedding()).toBe(1)
    // Simulate restart with a working worker
    const s2 = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: stubWorker,
    })
    await flushMicrotasks()
    await flushMicrotasks()
    expect(repoOf(s2).countSegmentsNeedingEmbedding()).toBe(0)
  })

  it('segments recorded in embedding_failures are NOT re-tried within the same boot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autometic-bf-'))
    const dbPath = join(dir, 'memory.db')
    const svc = await MemoryService.initialize({
      dbPath,
      workerPath: 'unused',
      __workerFactory: stubWorker,
    })
    const meetingId = svc.beginMeeting({ sourceLanguage: 'ko', targetLanguage: 'en' })
    const repo = repoOf(svc)
    repo.insertSegment({
      id: 'segF',
      meetingId,
      seq: 1,
      createdAt: Date.now(),
      speakerId: null,
      speakerLabel: null,
      sourceText: 'x',
      translatedText: null,
      sourceLanguage: 'ko',
    })
    repo.recordEmbeddingFailure('segF', 3, 'prior')
    // enqueueAllMissingEmbeddings is called by initialize; segF should be skipped.
    expect(repo.countSegmentsNeedingEmbedding()).toBe(0)
    expect(repo.getSegmentsNeedingEmbedding()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/memory-service-backfill.test.ts
```

Expect FAIL — the backfill isn't wired and `endMeeting` still waits.

---

### Task 3.3 — Add backfill + drop drain wait

**Files:** `src/main/memory/memoryService.ts`

- [ ] **Step 1: Add `enqueueAllMissingEmbeddings()` method to the class**

Insert near other public methods (e.g., between `recoverInterruptedMeetings` and `listMeetings`):

```ts
enqueueAllMissingEmbeddings(): void {
  const pending = this.repo.getSegmentsNeedingEmbedding()
  for (const row of pending) {
    this.embeddingQueue.enqueue({ segmentId: row.segmentId, text: row.sourceText })
  }
}
```

- [ ] **Step 2: Call it from `initialize()`**

Just before `attachTranscriptHook(...)`:

```ts
svc.enqueueAllMissingEmbeddings()
attachTranscriptHook(repo, embeddingQueue, () => lifecycle.getCurrentMeetingId())
return svc
```

- [ ] **Step 3: Replace `endMeeting()`**

```ts
async endMeeting(): Promise<string | null> {
  const meetingId = this.lifecycle.endMeeting()
  if (!meetingId) return null
  this.emit({ meetingId, kind: 'ended' })
  // Enqueue this meeting's not-yet-embedded segments. Background processing
  // continues asynchronously; we no longer block on drain.
  const missing = this.repo.getMissingEmbeddings(meetingId)
  for (const row of missing) {
    this.embeddingQueue.enqueue({ segmentId: row.segmentId, text: row.text })
  }
  void this.summaryService
    .generateIfAutoEnabled(meetingId)
    .then(() => this.emitSummaryStatus(meetingId))
    .catch((err) => {
      console.warn('[memory] auto summary failed:', err)
      this.emit({ meetingId, kind: 'summary-failed' })
    })
  return meetingId
}
```

The `timeoutMs = 3000` parameter is removed.

- [ ] **Step 4: Audit callers of `endMeeting(...)`**

```bash
grep -rn "endMeeting" src/ --include="*.ts" --include="*.tsx"
```

Update any call site that passed an argument. Most will not have.

- [ ] **Step 5: Verify**

```bash
npx vitest run src/test/memory-service-backfill.test.ts
npx vitest run src/test/memory-embedding-queue.test.ts
npx vitest run src/test/embedding-queue-failure-persistence.test.ts
npx vitest run src/test/embedding-failures-repository.test.ts
npm run typecheck
npm run lint
```

All tests must pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/memory/memoryService.ts src/test/memory-service-backfill.test.ts
git commit -m "feat(embeddings): startup backfill + non-blocking endMeeting"
```

---

### Task 3.4 — Audit + update other memory-service tests

- [ ] **Step 1: Run the full suite**

```bash
npx vitest run
```

- [ ] **Step 2: If any test failed because `endMeeting()` no longer awaits embeddings, adjust it**

Examples of acceptable adjustments:
- Test was checking `segment_embeddings` had rows immediately after `endMeeting()` returned → change to `await (svc as unknown as { embeddingQueue: { drain(): Promise<void> } }).embeddingQueue.drain()`.
- Test was using the 3-second timeout to verify backpressure → delete the assertion (the contract has changed; the spec explicitly removes this behaviour).

- [ ] **Step 3: Verify suite passes + commit**

```bash
npm run typecheck
npm run lint
npx vitest run
git add -A
git commit -m "test(embeddings): align lifecycle tests with non-blocking endMeeting"
```

(If no other tests needed changes, skip the commit and proceed.)

---

### Task 3.5 — Verify Phase 3

- [ ] **Run phase verification**

```bash
npm run verify:phase 3
```

Expected: `VERDICT: ✅ Phase 3 verified`.

- [ ] **Update `HANDOFF.md` Phase 3 row.**

---

## Phase 4 — Telemetry + worker init surfacing

### Task 4.1 — Add telemetry to `EmbeddingService`

**Files:** `src/main/memory/embeddingService.ts`

- [ ] **Step 1: Import logger**

```ts
import { log } from '../telemetry/logger'
```

- [ ] **Step 2: Log worker init failure in the `worker.on('error', ...)` handler**

```ts
this.worker.on('error', (err: Error) => {
  log('error', 'memory-embedding', 'memory.embedding.worker-init.failure', {
    error: err.message,
  })
  for (const p of this.pending.values()) p.reject(err)
  this.pending.clear()
})
```

- [ ] **Step 3: Log first-success once**

Add a private flag and emit inside the success branch of the `message` handler:

```ts
private firstSuccessLogged = false

// inside the message handler, where vectors arrived successfully:
if (!this.firstSuccessLogged) {
  this.firstSuccessLogged = true
  log('info', 'memory-embedding', 'memory.embedding.worker-init.success', {
    modelId: this.modelId,
  })
}
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/embeddingService.ts
git commit -m "feat(embeddings): telemetry for worker init success + failure"
```

---

### Task 4.2 — Add batch telemetry to `EmbeddingQueue`

**Files:** `src/main/memory/embeddingQueue.ts`

- [ ] **Step 1: Import logger**

```ts
import { log } from '../telemetry/logger'
```

- [ ] **Step 2: Wrap the success/failure paths in `process()`**

```ts
private async process(): Promise<void> {
  while (this.items.length > 0) {
    const batch = this.items.splice(0, this.batchSize)
    const batchStart = Date.now()
    try {
      const vectors = await this.embedder.embedPassages(batch.map((item) => item.text))
      this.repo.saveEmbeddings(
        batch.map((item, i) => ({
          segmentId: item.segmentId,
          vector: vectors[i],
          model: this.opts.modelId,
        }))
      )
      for (const item of batch) this.completed.add(item.segmentId)
      log('info', 'memory-embedding', 'memory.embedding.batch.success', {
        batchSize: batch.length,
        durationMs: Date.now() - batchStart,
      })
      this.notifyWaiters()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[memory] embedding batch failed:', err)
      log('warn', 'memory-embedding', 'memory.embedding.batch.failure', {
        batchSize: batch.length,
        attempt: (batch[0]?.attempts ?? 0) + 1,
        error: message,
      })
      const retryable: QueueItem[] = []
      for (const item of batch) {
        const nextAttempts = (item.attempts ?? 0) + 1
        if (nextAttempts < this.maxAttempts) {
          retryable.push({ ...item, attempts: nextAttempts })
        } else {
          this.repo.recordEmbeddingFailure(item.segmentId, nextAttempts, message)
        }
      }
      if (retryable.length > 0) this.items.unshift(...retryable)
    }
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
npm run lint
npx vitest run
git add src/main/memory/embeddingQueue.ts
git commit -m "feat(embeddings): telemetry for batch success + failure"
```

---

### Task 4.3 — Add backfill telemetry to `MemoryService`

**Files:** `src/main/memory/memoryService.ts`

- [ ] **Step 1: Import logger**

```ts
import { log } from '../telemetry/logger'
```

- [ ] **Step 2: Wrap `enqueueAllMissingEmbeddings()` with begin/end logs**

```ts
enqueueAllMissingEmbeddings(): void {
  const pending = this.repo.getSegmentsNeedingEmbedding()
  if (pending.length === 0) return
  log('info', 'memory-embedding', 'memory.embedding.backfill.started', {
    pendingCount: pending.length,
  })
  const startedAt = Date.now()
  for (const row of pending) {
    this.embeddingQueue.enqueue({ segmentId: row.segmentId, text: row.sourceText })
  }
  void this.embeddingQueue
    .drain()
    .then(() => {
      const remaining = this.repo.countSegmentsNeedingEmbedding()
      const failed = this.repo.listEmbeddingFailures(1_000_000).length
      log('info', 'memory-embedding', 'memory.embedding.backfill.completed', {
        processed: pending.length - remaining,
        failed,
        durationMs: Date.now() - startedAt,
      })
    })
    .catch((err) => {
      log('warn', 'memory-embedding', 'memory.embedding.backfill.error', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
npm run lint
npx vitest run
git add src/main/memory/memoryService.ts
git commit -m "feat(embeddings): telemetry for backfill start + completion"
```

---

### Task 4.4 — Verify Phase 4

- [ ] **Run phase verification**

```bash
npm run verify:phase 4
```

Expected: `VERDICT: ✅ Phase 4 verified`.

- [ ] **Update `HANDOFF.md` Phase 4 row.**

---

## Phase 5 — Final regression + HANDOFF update + push

### Task 5.1 — Full regression sweep

- [ ] **Run general verification**

```bash
npm run verify
```

Expected: `VERDICT: ✅ Verified clean`.

If `npm test` is blocked pre-Vitest by the known Windows `EBUSY` on `better_sqlite3.node`, report it explicitly in the final summary — do not hide it. `npx vitest run` results are the authoritative signal per `CLAUDE.md`.

- [ ] **Run `npm run build`** (touches `src/main/**`)

```bash
npm run build
```

If it fails on the preexisting `tsc -b` error in `src/main/memory/repository.ts` (`lookupSearchHits` return type — see `HANDOFF.md` environment quirks), that is NOT a regression. Document the failure but do not attempt to fix it as part of this work.

---

### Task 5.2 — Update `HANDOFF.md`

- [ ] **Insert a new "Next active stream" block at the top** (replace or move the current Memory Library Chat block to a "Completed stream" section):

```markdown
> **Embedding Pipeline Durability + Startup Backfill.** Bug-fix + infra stream. 5 phases, ~6-10 hours. Fixes a critical silent failure: 892 segments / 8 meetings currently have 0 embeddings → Memory Ask semantic search has never worked for any user. See:
>
> - **Spec:** `docs/superpowers/specs/2026-05-25-embedding-pipeline-durability-design.md`
> - **Plan:** `docs/superpowers/plans/2026-05-25-embedding-pipeline-durability.md`
>
> Start at Phase 1 (Task 1.1). TDD pattern through Phases 1-3; Phase 4 is telemetry; Phase 5 is regression + handoff.
```

- [ ] **Add the active-stream status table:**

```markdown
## Active stream state — Embedding Pipeline Durability

| Phase | Status | Commits | Tests passing |
|---|---|---|---|
| 1 — Schema + repo CRUD (TDD) | ⏳ PENDING | — | — |
| 2 — EmbeddingQueue failure persistence (TDD) | ⏳ PENDING | — | — |
| 3 — Startup backfill + endMeeting fix (TDD) | ⏳ PENDING | — | — |
| 4 — Telemetry | ⏳ PENDING | — | — |
| 5 — Regression + handoff + push | ⏳ PENDING | — | — |
```

As each phase completes, replace the row with the verify-output-backed entry, following the convention used by prior streams in `HANDOFF.md`.

---

### Task 5.3 — Manual smoke (deferred to user)

- [ ] **Document in the final report:**
  - Whether `npm run verify` is ✅ clean
  - That manual smoke is deferred to the user per the spec's success criteria
  - The exact telemetry events the user should look for in the log (`memory.embedding.worker-init.success`, `memory.embedding.backfill.started`, `memory.embedding.backfill.completed`)
  - A note that the first model download takes a few minutes; backfill speed is gated on that

---

### Task 5.4 — Push to `origin/master`

- [ ] **Push**

```bash
git push origin master
```

- [ ] **Mark Phase 5 ✅ COMPLETE in `HANDOFF.md`** with the final commit hash.

---

## Self-review checklist (before declaring the stream done)

- [ ] All 5 phases show ✅ COMPLETE in `HANDOFF.md` with verbatim `npm run verify:phase <N>` output backing them.
- [ ] `segment_embeddings` table can be populated against the real DB (manual smoke confirmed by user).
- [ ] `endMeeting()` returns in <500ms regardless of queue depth (covered by `memory-service-backfill.test.ts`).
- [ ] Killing the app mid-backfill does not lose pending work — next boot's `enqueueAllMissingEmbeddings` recomputes from the schema and picks them up.
- [ ] Telemetry events show up in the log when worker initializes, when batches succeed/fail, when backfill starts/completes.
- [ ] No regression to existing tests (`npx vitest run` count rises by the new tests; full count tracked in `HANDOFF.md`).
- [ ] No deviation from the spec's "In scope" / "Out of scope" sections. If a deviation was necessary, it is documented in `HANDOFF.md` "Notes per phase" with a reason.

## Open questions (deferred to v2, do NOT implement in this stream)

- UI for embedding progress / backfill indicator
- Admin trigger / IPC to clear `embedding_failures` rows on demand (hook exists via `clearEmbeddingFailures`; no UI wiring this stream)
- Pre-download model with progress dialog on first launch
- LLM-based query rewriting for 0-hit queries (Option 3 in brainstorming)
- Auto-generated meaningful meeting titles (Option 2 in brainstorming)
- Vector DB swap, alternate embedding model, threshold tuning
- Multi-worker pool / parallel embedding generation
- Live-meeting prioritization in the queue
