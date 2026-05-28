# Pipeline Orchestration — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Checkbox (`- [ ]`) tracking. Phase-by-phase. Each phase ends with a clean `npm run verify:phase <N>` before the table in `HANDOFF.md` is updated. Read `HANDOFF.md` and `AGENTS.md` first for environment quirks (Windows better-sqlite3 ABI shim + `EBUSY` `npm test`). **This touches a CLAUDE.md high-risk area (live feed pipeline). Behavior preservation is the prime directive — TDD + the existing regression test must stay green.**

**Goal:** Introduce a typed `PipelineBus`; convert the three direct-import consumers (memory, whiteboard, action items) into registered subscribers; rewire `transcriptPostProcessor` to emit events instead of calling consumers directly. A new consumer becomes a subscriber + one `register(...)` line in `index.ts` — no `transcriptPostProcessor` edit.

**Architecture:** `src/main/pipeline/` owns the bus, event types, and three subscriber adapters that thinly wrap the existing consumer functions. `transcriptPostProcessor` emits `turn-finalized` / `translation-updated` / `turn-source-updated`. `index.ts` creates the bus, registers subscribers (order = whiteboard → actions → memory, matching today), bridges meeting lifecycle to the bus, and injects the bus into `transcriptPostProcessor.init`. Renderer feed IPC stays direct.

**Tech stack:** TypeScript strict (no `any`), vitest, existing `telemetry/logger.ts`.

**Spec:** `docs/superpowers/specs/2026-05-28-pipeline-orchestration-design.md`

**Scope reminder (do NOT exceed):** Renderer feed IPC stays direct (not bus-routed). No retry policies. No declarative/config workflow. No observability UI. No `stt/transcriptBus.ts` changes. No consumer *logic* migration (thin adapters only). Memory keeps its existing `onMeetingUpdated` lifecycle path; bus lifecycle events are emit-only.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/main/pipeline/types.ts` | Create | `PipelineEvent`, `FinalizedTurn`, `PipelineSubscriber` |
| `src/main/pipeline/pipelineBus.ts` | Create | `PipelineBus` (register/emit + error isolation) |
| `src/main/pipeline/subscribers/memorySubscriber.ts` | Create | Adapter → transcriptHook functions |
| `src/main/pipeline/subscribers/whiteboardSubscriber.ts` | Create | Adapter → `enqueueTranscript` (whiteboard) |
| `src/main/pipeline/subscribers/actionItemsSubscriber.ts` | Create | Adapter → `enqueueTranscript` (actions) |
| `src/main/transcriptPostProcessor.ts` | Modify | Emit events; drop consumer imports; remove dead branch; `pipelineBusRef` at init |
| `src/main/index.ts` | Modify | Create bus, register subscribers, bridge lifecycle, inject bus |
| `src/test/pipeline-bus.test.ts` | Create | Bus unit tests |
| `src/test/pipeline-subscribers.test.ts` | Create | Subscriber adapter tests |
| `src/test/memory-postprocessor-regression.test.ts` | Modify | Keep green; assert finalize fan-out via bus |
| `HANDOFF.md` | Modify | New active stream block + status table |

---

## Phase 1 — PipelineBus + event types (TDD)

### Task 1.1 — Event types + subscriber interface

**Files:** `src/main/pipeline/types.ts`

- [ ] **Step 1: Create**

```ts
export interface FinalizedTurn {
  id: string
  text: string
  sourceLanguage: string
  targetLanguage: string
  createdAtMs: number
  speakerId: string
  speakerLabel: string
}

export type PipelineEvent =
  | { type: 'meeting-began'; meetingId: string }
  | { type: 'meeting-ended'; meetingId: string }
  | { type: 'turn-finalized'; turn: FinalizedTurn }
  | { type: 'turn-source-updated'; id: string; text: string }
  | { type: 'translation-updated'; id: string; translation: string }

export interface PipelineSubscriber {
  name: string
  onEvent(event: PipelineEvent): void | Promise<void>
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
git add src/main/pipeline/types.ts
git commit -m "feat(pipeline): add PipelineEvent + subscriber types"
```

---

### Task 1.2 — PipelineBus with error isolation (TDD)

**Files:** `src/main/pipeline/pipelineBus.ts`, `src/test/pipeline-bus.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/pipeline-bus.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { PipelineBus } from '../main/pipeline/pipelineBus'
import type { PipelineEvent, PipelineSubscriber } from '../main/pipeline/types'

const ev: PipelineEvent = { type: 'turn-source-updated', id: 's1', text: 'hi' }

function sub(name: string, onEvent: PipelineSubscriber['onEvent']): PipelineSubscriber {
  return { name, onEvent }
}

describe('PipelineBus', () => {
  it('delivers events to all subscribers', () => {
    const bus = new PipelineBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.register(sub('a', a))
    bus.register(sub('b', b))
    bus.emit(ev)
    expect(a).toHaveBeenCalledWith(ev)
    expect(b).toHaveBeenCalledWith(ev)
  })

  it('runs subscribers in registration order', () => {
    const bus = new PipelineBus()
    const order: string[] = []
    bus.register(sub('first', () => void order.push('first')))
    bus.register(sub('second', () => void order.push('second')))
    bus.register(sub('third', () => void order.push('third')))
    bus.emit(ev)
    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('isolates a synchronous throw: later subscribers still run', () => {
    const bus = new PipelineBus()
    const after = vi.fn()
    bus.register(sub('boom', () => {
      throw new Error('sync boom')
    }))
    bus.register(sub('after', after))
    expect(() => bus.emit(ev)).not.toThrow()
    expect(after).toHaveBeenCalledWith(ev)
  })

  it('isolates an async rejection: emit does not reject and later subs run', async () => {
    const bus = new PipelineBus()
    const after = vi.fn()
    bus.register(sub('asyncBoom', async () => {
      throw new Error('async boom')
    }))
    bus.register(sub('after', after))
    bus.emit(ev)
    expect(after).toHaveBeenCalledWith(ev)
    await Promise.resolve() // flush microtasks; no unhandled rejection
  })

  it('unregister stops delivery', () => {
    const bus = new PipelineBus()
    const a = vi.fn()
    const off = bus.register(sub('a', a))
    off()
    bus.emit(ev)
    expect(a).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/test/pipeline-bus.test.ts
```

- [ ] **Step 3: Implement `src/main/pipeline/pipelineBus.ts`**

```ts
import { log } from '../telemetry/logger'
import type { PipelineEvent, PipelineSubscriber } from './types'

export class PipelineBus {
  private subscribers: PipelineSubscriber[] = []

  register(sub: PipelineSubscriber): () => void {
    this.subscribers.push(sub)
    return () => {
      const i = this.subscribers.indexOf(sub)
      if (i >= 0) this.subscribers.splice(i, 1)
    }
  }

  emit(event: PipelineEvent): void {
    for (const sub of this.subscribers) {
      try {
        const result = sub.onEvent(event)
        if (result instanceof Promise) {
          result.catch((err) => this.logFailure(sub.name, event, err))
        }
      } catch (err) {
        this.logFailure(sub.name, event, err)
      }
    }
  }

  private logFailure(name: string, event: PipelineEvent, err: unknown): void {
    log('error', 'pipeline', 'pipeline.subscriber.failed', {
      subscriber: name,
      event: event.type,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/pipeline-bus.test.ts
npm run typecheck
npm run lint
git add src/main/pipeline/pipelineBus.ts src/test/pipeline-bus.test.ts
git commit -m "feat(pipeline): PipelineBus with per-subscriber error isolation"
```

---

### Task 1.3 — Verify Phase 1

```bash
npm run verify:phase 1
```

Expected: `VERDICT: ✅ Phase 1 verified`. Update `HANDOFF.md` Phase 1 row.

---

## Phase 2 — Subscriber adapters + rewire transcriptPostProcessor (TDD, behavior-preserving)

### Task 2.1 — Subscriber adapters (TDD)

**Files:** `src/main/pipeline/subscribers/memorySubscriber.ts`, `src/main/pipeline/subscribers/whiteboardSubscriber.ts`, `src/main/pipeline/subscribers/actionItemsSubscriber.ts`, `src/test/pipeline-subscribers.test.ts`

- [ ] **Step 1: Inspect the consumer signatures** to wrap them exactly:
  - `whiteboardService.enqueueTranscript(text: string)` and `actionItemService.enqueueTranscript(text: string)`
  - `transcriptHook.notifyTurnFinalized(payload)`, `notifyTranslation(id, translation)`, `notifySourceTextUpdate(id, text)`

- [ ] **Step 2: Write failing tests**

Create `src/test/pipeline-subscribers.test.ts`. Use dependency injection so the underlying consumer functions are mockable (each `make*Subscriber` takes its consumer fns as args with production defaults):

```ts
import { describe, expect, it, vi } from 'vitest'
import { makeWhiteboardSubscriber } from '../main/pipeline/subscribers/whiteboardSubscriber'
import { makeActionItemsSubscriber } from '../main/pipeline/subscribers/actionItemsSubscriber'
import { makeMemorySubscriber } from '../main/pipeline/subscribers/memorySubscriber'
import type { FinalizedTurn } from '../main/pipeline/types'

const turn: FinalizedTurn = {
  id: 't1', text: 'hello world', sourceLanguage: 'en', targetLanguage: 'ko',
  createdAtMs: 1, speakerId: 'unknown', speakerLabel: 'Unknown',
}

describe('whiteboardSubscriber', () => {
  it('enqueues "speakerLabel: text" on turn-finalized', () => {
    const enqueue = vi.fn()
    const s = makeWhiteboardSubscriber(enqueue)
    s.onEvent({ type: 'turn-finalized', turn })
    expect(enqueue).toHaveBeenCalledWith('Unknown: hello world')
  })
  it('ignores other events', () => {
    const enqueue = vi.fn()
    const s = makeWhiteboardSubscriber(enqueue)
    s.onEvent({ type: 'translation-updated', id: 't1', translation: 'x' })
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('actionItemsSubscriber', () => {
  it('enqueues "speakerLabel: text" on turn-finalized', () => {
    const enqueue = vi.fn()
    const s = makeActionItemsSubscriber(enqueue)
    s.onEvent({ type: 'turn-finalized', turn })
    expect(enqueue).toHaveBeenCalledWith('Unknown: hello world')
  })
})

describe('memorySubscriber', () => {
  it('persists on turn-finalized, updates translation, updates source text', () => {
    const deps = {
      notifyTurnFinalized: vi.fn(),
      notifyTranslation: vi.fn(),
      notifySourceTextUpdate: vi.fn(),
    }
    const s = makeMemorySubscriber(deps)
    s.onEvent({ type: 'turn-finalized', turn })
    expect(deps.notifyTurnFinalized).toHaveBeenCalledWith({
      id: 't1', text: 'hello world', sourceLanguage: 'en', targetLanguage: 'ko',
      createdAtMs: 1, speakerId: 'unknown', speakerLabel: 'Unknown',
    })
    s.onEvent({ type: 'translation-updated', id: 't1', translation: '안녕' })
    expect(deps.notifyTranslation).toHaveBeenCalledWith('t1', '안녕')
    s.onEvent({ type: 'turn-source-updated', id: 't1', text: 'hello world?' })
    expect(deps.notifySourceTextUpdate).toHaveBeenCalledWith('t1', 'hello world?')
  })
})
```

- [ ] **Step 3: Implement the three adapters**

`whiteboardSubscriber.ts`:
```ts
import { enqueueTranscript } from '../../whiteboardService'
import type { PipelineEvent, PipelineSubscriber } from '../types'

export function makeWhiteboardSubscriber(
  enqueue: (text: string) => void = enqueueTranscript
): PipelineSubscriber {
  return {
    name: 'whiteboard',
    onEvent(event: PipelineEvent) {
      if (event.type !== 'turn-finalized') return
      enqueue(`${event.turn.speakerLabel}: ${event.turn.text}`)
    },
  }
}
```

`actionItemsSubscriber.ts`: identical, importing `enqueueTranscript` from `../../actionItemService`, `name: 'actionItems'`.

`memorySubscriber.ts`:
```ts
import {
  notifySourceTextUpdate,
  notifyTranslation,
  notifyTurnFinalized,
} from '../../memory/transcriptHook'
import type { PipelineEvent, PipelineSubscriber } from '../types'

interface MemoryDeps {
  notifyTurnFinalized: typeof notifyTurnFinalized
  notifyTranslation: typeof notifyTranslation
  notifySourceTextUpdate: typeof notifySourceTextUpdate
}

export function makeMemorySubscriber(
  deps: MemoryDeps = { notifyTurnFinalized, notifyTranslation, notifySourceTextUpdate }
): PipelineSubscriber {
  return {
    name: 'memory',
    onEvent(event: PipelineEvent) {
      if (event.type === 'turn-finalized') {
        deps.notifyTurnFinalized({
          id: event.turn.id,
          text: event.turn.text,
          sourceLanguage: event.turn.sourceLanguage,
          targetLanguage: event.turn.targetLanguage,
          createdAtMs: event.turn.createdAtMs,
          speakerId: event.turn.speakerId,
          speakerLabel: event.turn.speakerLabel,
        })
      } else if (event.type === 'translation-updated') {
        deps.notifyTranslation(event.id, event.translation)
      } else if (event.type === 'turn-source-updated') {
        deps.notifySourceTextUpdate(event.id, event.text)
      }
    },
  }
}
```

> Note the memory `turn-finalized` previously used `active.text.trim()` for the persisted text. Preserve that: in `transcriptPostProcessor`, build the `FinalizedTurn.text` with the SAME value passed to `notifyTurnFinalized` today (i.e., `active.text.trim()` for the memory field but `active.text.trim()` for downstream too — verify exact current values). If memory used `.trim()` and downstream used `.trim()`, the event's `text` should be the trimmed text and subscribers use it directly. Match precisely (see Task 2.2).

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/pipeline-subscribers.test.ts
npm run typecheck
npm run lint
git add src/main/pipeline/subscribers/ src/test/pipeline-subscribers.test.ts
git commit -m "feat(pipeline): memory + whiteboard + actionItems subscriber adapters"
```

---

### Task 2.2 — Rewire `transcriptPostProcessor` to emit events

**Files:** `src/main/transcriptPostProcessor.ts`

- [ ] **Step 1: Add a bus ref + init injection**

Add module state near the other refs (e.g., `mainWindowRef`):
```ts
import type { PipelineBus } from './pipeline/pipelineBus'
let pipelineBusRef: PipelineBus | null = null
```
In the existing `init(...)` export (the one that already receives `memoryServicePromise`), accept and store the bus. If signatures differ, follow the file's existing convention; ensure `index.ts` passes it.

- [ ] **Step 2: Reconcile the exact text values currently sent**

Read `finalizeActiveSourceTurn`, `emitFinalDownstream`, and `notifyTurnFinalized` to capture exact strings:
- downstream today: `emitFinalDownstream` → `'Unknown: ${active.text.trim()}'`
- memory today: `notifyTurnFinalized({ text: active.text.trim(), speakerLabel: 'Unknown', speakerId: 'unknown', ... })`

So both use `active.text.trim()` and `speakerLabel='Unknown'`. The `FinalizedTurn` event should carry `text: active.text.trim()`, `speakerLabel: 'Unknown'`, `speakerId: 'unknown'`, and the same `sourceLanguage`/`targetLanguage`/`createdAtMs`. Subscribers then reproduce identical calls.

- [ ] **Step 3: Replace the finalize fan-out**

In `finalizeActiveSourceTurn`, replace the `emitFinalDownstream(active)` + `notifyTurnFinalized({...})` block with:
```ts
if (active.text.trim()) {
  pipelineBusRef?.emit({
    type: 'turn-finalized',
    turn: {
      id: active.id,
      text: active.text.trim(),
      sourceLanguage: active.hints.sourceLanguageHint,
      targetLanguage: active.hints.targetLanguage,
      createdAtMs: active.createdAtMs,
      speakerId: 'unknown',
      speakerLabel: 'Unknown',
    },
  })
}
```
Keep `emitSourcePatch(active.id, active.text)` (renderer) and the `lastFinalizedTurn = {...}` bookkeeping. Delete `emitFinalDownstream` (now unused) and its `downstreamSent` field if nothing else uses it (verify — `downstreamSent` was only set/read by `emitFinalDownstream`; if so, remove the field from `ActiveSourceTurn` and its initialization).

- [ ] **Step 4: Replace translation + merge-back calls**

- Translation drain path: `notifyTranslation(next.id, response.translation)` → `pipelineBusRef?.emit({ type: 'translation-updated', id: next.id, translation: response.translation })`.
- Merge-back: `notifySourceTextUpdate(lastFinalizedTurn.id, merged)` → `pipelineBusRef?.emit({ type: 'turn-source-updated', id: lastFinalizedTurn.id, text: merged })`.

- [ ] **Step 5: Remove dead downstream branch + consumer imports**

- In `emitProcessedTurn`, remove the `if (!options.sendDownstream) return; ... enqueue...` block (dead: only caller passes `false`). Reduce it to the renderer send + early return on empty text. Simplify the signature if `sendDownstream` is now unused.
- Remove the top-of-file imports: `enqueueActionTranscript`, `enqueueWhiteboardTranscript`, and `notifyTurnFinalized`/`notifyTranslation`/`notifySourceTextUpdate` from `memory/transcriptHook`. Add the `PipelineBus` type import.

- [ ] **Step 6: Verify**

```bash
npm run typecheck
npm run lint
npx vitest run
```

Existing `memory-postprocessor-regression.test.ts` will likely fail here because it mocked the direct imports. Fix in Task 2.3.

---

### Task 2.3 — Wire `index.ts` + update regression test

**Files:** `src/main/index.ts`, `src/test/memory-postprocessor-regression.test.ts`

- [ ] **Step 1: Create the bus + register subscribers + bridge lifecycle in `index.ts`**

Where services are initialized:
```ts
import { PipelineBus } from './pipeline/pipelineBus'
import { makeMemorySubscriber } from './pipeline/subscribers/memorySubscriber'
import { makeWhiteboardSubscriber } from './pipeline/subscribers/whiteboardSubscriber'
import { makeActionItemsSubscriber } from './pipeline/subscribers/actionItemsSubscriber'

const pipelineBus = new PipelineBus()
// Order MUST match today's finalize order: whiteboard → actions → memory
pipelineBus.register(makeWhiteboardSubscriber())
pipelineBus.register(makeActionItemsSubscriber())
pipelineBus.register(makeMemorySubscriber())
```
Pass `pipelineBus` into `transcriptPostProcessor`'s `init(...)`.

Bridge lifecycle where `memoryService.onMeetingUpdated(...)` is already wired:
```ts
memoryService.onMeetingUpdated((evt) => {
  if (evt.kind === 'began') pipelineBus.emit({ type: 'meeting-began', meetingId: evt.meetingId })
  else if (evt.kind === 'ended') pipelineBus.emit({ type: 'meeting-ended', meetingId: evt.meetingId })
  // ... keep existing handling (glossary extraction etc.) intact
})
```
(Do NOT remove existing `onMeetingUpdated` logic — only add the bus emit alongside it.)

- [ ] **Step 2: Update `memory-postprocessor-regression.test.ts`**

The test previously asserted via mocked direct imports. Update it to drive the post-processor with a real (or stub) `PipelineBus` injected at init, and assert the bus received the expected `turn-finalized` / `translation-updated` events in order. Preserve the test's original intent (the finalize path persists + translates correctly).

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck
npm run lint
npx vitest run
npm run build
git add src/main/transcriptPostProcessor.ts src/main/index.ts src/test/memory-postprocessor-regression.test.ts
git commit -m "feat(pipeline): emit events from transcriptPostProcessor + register subscribers"
```

---

### Task 2.4 — Verify Phase 2

```bash
npm run verify:phase 2
```

Expected: `VERDICT: ✅ Phase 2 verified`. Update `HANDOFF.md` Phase 2 row.

---

## Phase 3 — Regression + handoff + push

### Task 3.1 — Full regression

```bash
npm run verify
npm run build
```

- `memory-postprocessor-regression.test.ts` green.
- Confirm `transcriptPostProcessor` no longer imports `actionItemService` / `whiteboardService` / `memory/transcriptHook` (grep to verify).
- Document Windows `EBUSY` if `npm test` blocked (`npx vitest run`). Preexisting `tsc -b` issue not this stream's concern.

### Task 3.2 — Extensibility proof (optional, then revert)

- [ ] Temporarily register a no-op logging subscriber in `index.ts`, run the app, confirm it receives `turn-finalized` without editing `transcriptPostProcessor`. Revert the temporary subscriber. (This validates the success criterion; do not ship the temp subscriber.)

### Task 3.3 — Update `HANDOFF.md`

- [ ] Move "STT Sentence Boundary Fix" (and prior) to a Completed section if not already.
- [ ] Insert new "Next active stream" block + status table with 3 rows ⏳ PENDING.

### Task 3.4 — Manual smoke (deferred to user)

Document the spec's smoke checklist:
- Live meeting → feed, translation, whiteboard, action items, memory all behave as before.
- No pipeline-bus console errors.

### Task 3.5 — Push

```bash
git push origin master
```

Mark Phase 3 ✅ COMPLETE in `HANDOFF.md`.

---

## Self-review checklist

- [ ] All 3 phases ✅ COMPLETE in `HANDOFF.md` with verbatim verify output.
- [ ] `transcriptPostProcessor` imports only the bus + types (no consumer modules).
- [ ] Subscriber registration order = whiteboard → actions → memory (matches today).
- [ ] Error isolation proven by test (sync throw + async reject).
- [ ] `turn-finalized` emitted once per finalize, empty-text guard preserved.
- [ ] Renderer feed IPC unchanged.
- [ ] `memory-postprocessor-regression.test.ts` green.
- [ ] No deviation from spec's "In scope" / "Out of scope".

## Open questions (deferred to v2)

- Routing the renderer feed through the bus
- Subscriber-declared event-type filtering at register time
- Migrating memory's meeting-lifecycle handling onto the bus
- Observability dashboard built on the bus
- `turn-started` / partial-turn events
