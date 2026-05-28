# Pipeline Orchestration — Decouple Live Transcript Consumers via PipelineBus — Design Spec

**Date:** 2026-05-28
**Status:** Draft — pending implementation
**Stream type:** Behavior-preserving architectural refactor in a high-risk area (live feed pipeline)
**Related:** Follows the multi-agent orchestration stream (Deep Ask, `2026-05-26-deep-ask-multi-agent-design.md`) which covered orchestration direction #1 (agents). This is direction #2 (service pipeline) from the same brainstorm. Touches `transcriptPostProcessor.ts` — `CLAUDE.md` flags "Live feed sentence grouping and auto-scroll" as high-risk.

## One-line

Introduce a typed `PipelineBus` (emit + subscribe with per-subscriber error isolation). Convert the three analysis consumers the live transcript pipeline currently calls by direct import (memory persistence, whiteboard agent, action items) into registered subscribers. `transcriptPostProcessor` emits events instead of calling consumers directly, so a new consumer (e.g., a future live-coaching agent) is added by writing a subscriber and registering one line in `index.ts` — never by editing `transcriptPostProcessor`.

## Why this stream

`transcriptPostProcessor.ts` is the de-facto pipeline coordinator, but it is hard-coupled to every downstream consumer through direct imports and inline calls:

```ts
import { enqueueTranscript as enqueueActionTranscript } from './actionItemService'
import { enqueueTranscript as enqueueWhiteboardTranscript } from './whiteboardService'
import { notifySourceTextUpdate, notifyTranslation, notifyTurnFinalized } from './memory/transcriptHook'
```

and fans out inline (`emitFinalDownstream` → whiteboard + actions; `finalizeActiveSourceTurn` → `notifyTurnFinalized`; translation path → `notifyTranslation`; merge-back → `notifySourceTextUpdate`).

Consequences:
- **Adding a consumer means editing the hot-path file.** A live-coaching agent, a sentiment tracker, a second analytics sink — each requires touching `transcriptPostProcessor` and its import list. That file is exactly the high-risk live-feed code we want to touch least.
- **Coupling flows the wrong way.** The producer knows all its consumers. The dependency arrows should point inward (consumers depend on the event contract), not outward (producer depends on every consumer module).
- **No uniform error isolation.** Consumers are called in a synchronous chain; the contract for "what happens if whiteboard enqueue throws" is implicit.

The fix is the standard local **event-bus + subscriber registry** pattern. There is already a precedent in the codebase (`stt/transcriptBus.ts` decouples the realtime STT client from `sttService`). This stream applies the same idea one layer later — at the post-processing fan-out.

This is explicitly a **behavior-preserving refactor**: every current call becomes an event that a thin subscriber adapter handles identically, in the same order. No new analysis behavior ships in this stream.

## Success criteria

1. **New consumer requires no `transcriptPostProcessor` edit:** Demonstrated by the structure — a hypothetical `makeCoachingSubscriber()` would be added with a single `pipelineBus.register(...)` line in `index.ts`.
2. **Behavior identical for existing consumers:** Memory persistence + embedding, whiteboard enqueue, action-items enqueue, translation update, and merge-back source-text update all fire exactly as before, in the same order (whiteboard → actions → memory at finalize).
3. **Error isolation:** A subscriber that throws (sync) or rejects (async) is logged via `telemetry/logger.ts` and does NOT prevent other subscribers from running or break the live feed. Covered by a unit test.
4. **Registration order = execution order:** Subscribers run in registration order, preserving the current finalize ordering. Covered by a test.
5. **Renderer feed untouched:** `stt:processed`, `stt:source-patch`, `stt:translation-patch` IPC sends remain direct calls in `transcriptPostProcessor` (the live UI output is not a pluggable consumer). No added latency to the live feed.
6. **`transcriptPostProcessor` no longer imports consumer modules:** Its imports of `actionItemService`, `whiteboardService`, and `memory/transcriptHook` are removed; it imports only the pipeline bus + event types. The subscriber adapter modules absorb those imports.
7. **Meeting lifecycle events available on the bus:** `meeting-began` / `meeting-ended` are emitted on the bus (from the existing lifecycle bridge in `index.ts`, NOT the hot path) so future subscribers can scope to meeting boundaries. v1 has no consumer for them (memory keeps its existing lifecycle path); they are forward-compat.
8. **No regression:** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` all clean. `memory-postprocessor-regression.test.ts` stays green.

## In scope

### New module `src/main/pipeline/`

- `types.ts`:
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
- `pipelineBus.ts` — `PipelineBus` class with `register(sub): () => void` and `emit(event): void`. `emit` iterates subscribers in registration order; each `onEvent` call is wrapped so a sync throw is caught and an async rejection is `.catch`ed, both logged via `log('error', 'pipeline', ...)` with the subscriber name + event type. A failing subscriber never blocks the others.
- A single shared `PipelineBus` instance, created in `index.ts` (or a small `pipeline/index.ts` factory) and injected where needed. `transcriptPostProcessor` receives it via its existing `init(...)` pathway (it already takes a memory-service promise in init; add the bus there or via a module-level setter consistent with the file's current style).
- `subscribers/memorySubscriber.ts` — wraps `notifyTurnFinalized` / `notifyTranslation` / `notifySourceTextUpdate`. Handles `turn-finalized`, `translation-updated`, `turn-source-updated`.
- `subscribers/whiteboardSubscriber.ts` — wraps `enqueueWhiteboardTranscript`. Handles `turn-finalized` → `enqueueTranscript('${speakerLabel}: ${text}')`.
- `subscribers/actionItemsSubscriber.ts` — wraps `enqueueActionTranscript`. Handles `turn-finalized` identically.

### `transcriptPostProcessor.ts` rewire (behavior-preserving)

| Current call | Becomes |
|---|---|
| `emitFinalDownstream` (whiteboard + actions enqueue) + `notifyTurnFinalized({...})` in `finalizeActiveSourceTurn` | single `pipelineBus.emit({ type: 'turn-finalized', turn })` (subscribers do downstream + persist in registration order: whiteboard → actions → memory) |
| `notifyTranslation(id, translation)` (translation drain path) | `pipelineBus.emit({ type: 'translation-updated', id, translation })` |
| `notifySourceTextUpdate(id, text)` (merge-back) | `pipelineBus.emit({ type: 'turn-source-updated', id, text })` |
| `webContents.send('stt:*', ...)` (renderer feed) | **unchanged** |

- Remove imports of `actionItemService`, `whiteboardService`, `memory/transcriptHook`.
- Preserve the `downstreamSent` guard semantics: `turn-finalized` is emitted exactly once per turn inside `finalizeActiveSourceTurn` (which nulls `activeSourceTurn` at entry, preventing re-entry), so the guard's intent is preserved structurally. Keep the empty-text guard (`if (!active.text.trim()) return` before emit).
- The default-`true` `sendDownstream` branch in `emitProcessedTurn` is dead code (the only caller passes `false`); it is removed as part of the cleanup so the renderer-only path is explicit.

### Lifecycle bridge (`index.ts`)

- Where `memoryService.onMeetingUpdated(...)` is already wired, bridge `began` / `ended` kinds to `pipelineBus.emit({ type: 'meeting-began'|'meeting-ended', meetingId })`. Off the hot path. No current consumer; forward-compat for future subscribers.
- Register the three subscribers once: `pipelineBus.register(makeMemorySubscriber()); pipelineBus.register(makeWhiteboardSubscriber()); pipelineBus.register(makeActionItemsSubscriber())` — in this order, matching today's finalize order.

### Tests

- `src/test/pipeline-bus.test.ts` — register/emit, registration-order execution, sync-throw isolation, async-reject isolation, unregister.
- `src/test/pipeline-subscribers.test.ts` — each adapter calls the right underlying consumer for the right event (with the consumers mocked).
- `src/test/memory-postprocessor-regression.test.ts` — extended/kept green; assert the finalize path produces the same downstream + persist calls through the bus.

## Out of scope (deferred)

- Routing the **renderer feed** (`stt:processed` / `stt:source-patch` / `stt:translation-patch`) through the bus. It stays direct — it is the latency-sensitive UI output, not a pluggable analysis consumer. (User explicitly accepted this boundary; the alternative raises hot-path risk for no extensibility gain.)
- Replacing or merging `stt/transcriptBus.ts` (the pre-post-processing raw-STT bus). Different layer; untouched.
- Observability dashboard / pipeline tracing UI (orchestration direction #2-observability). The bus naturally enables it later, but no UI ships here.
- Retry policies / per-stage backoff (direction #3). Only error *isolation* is in scope; retries remain each subscriber's internal concern (e.g., the embedding queue already retries).
- Declarative / configurable workflow with conditional routing (direction #4). The bus is code-registered, not config-driven.
- Distributed workflow engines (Temporal, Inngest) — overkill for a single-machine Electron app.
- Moving consumer *logic* into subscribers. Subscribers are thin adapters wrapping the existing functions; the functions themselves are unchanged.
- Migrating memory's meeting-lifecycle handling onto the bus. Memory keeps its existing `onMeetingUpdated` path in v1 to avoid double-processing; bus lifecycle events are emit-only.
- Backpressure / event queueing. `emit` is synchronous fan-out as today.

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Pattern | Local typed event bus + subscriber registry | Standard decoupling pattern; precedent exists (`stt/transcriptBus.ts`); zero new dependencies. |
| Event granularity | 5 events: 2 lifecycle + 3 turn-level | Matches the exact current fan-out points. No speculative events. |
| `turn-finalized` carries full turn | One event, three subscribers | Lets whiteboard/actions/memory each derive what they need (downstream string vs persist payload) without the producer formatting per-consumer. |
| Error isolation | `try/catch` (sync) + `.catch` (async) per subscriber in `emit` | A flaky consumer must never break the live feed or sibling consumers. Logged, not swallowed silently. |
| Execution order | Registration order, fixed in `index.ts` to whiteboard → actions → memory | Preserves today's exact finalize ordering — behavior-preserving. |
| Renderer feed | Stays direct (not a subscriber) | Latency-sensitive UI output with fine-grained patch events; not a pluggable consumer; keeping it direct minimizes hot-path risk. |
| Bus instance | Single shared instance injected at init | Matches how `transcriptPostProcessor.init(...)` already receives dependencies (memory service promise). |
| Subscribers are thin adapters | Wrap existing `enqueueTranscript` / `notify*` functions | Zero logic migration → minimal regression surface. The coupling moves from center (producer) to edge (subscriber modules). |
| Lifecycle events | Emit-only in v1, bridged from existing `onMeetingUpdated` | Forward-compat for future subscribers (coaching) without duplicating memory's current lifecycle handling. |
| Dead-code cleanup | Remove the unused `sendDownstream:true` branch in `emitProcessedTurn` | The only caller passes `false`; removing it makes the renderer-only path explicit and avoids confusion during the rewire. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Hot-path refactor regresses the live feed (high-risk area) | Renderer IPC untouched. Subscribers are thin wrappers (no logic change). `memory-postprocessor-regression.test.ts` must stay green; extend it to assert the bus path produces identical calls. |
| Execution-order change causes a subtle behavioral difference | Registration order explicitly fixed to today's order (whiteboard → actions → memory). A unit test asserts order. |
| An async subscriber rejection crashes the process or stalls the feed | `emit` `.catch`es every promise and logs; never awaits. Test: "a throwing subscriber doesn't stop the next one." |
| `turn-finalized` emitted more than once per turn | Emitted only inside `finalizeActiveSourceTurn`, which nulls `activeSourceTurn` at entry; the empty-text guard is preserved. Test the single-emit-per-finalize property. |
| Existing tests mock the direct imports (`enqueueTranscript`, `notify*`) | Audit `memory-postprocessor-regression.test.ts` and any STT tests; redirect mocks to assert via the bus / subscribers. Mechanical. |
| Circular import (pipeline ↔ consumers ↔ pipeline) | Subscribers import consumers; `transcriptPostProcessor` imports only the bus + types; `index.ts` wires them. Dependency graph stays acyclic. |
| Injecting the bus into `transcriptPostProcessor` clashes with its module-level state style | Follow the file's existing `init(...)`/module-setter convention (it already holds module-level refs like `mainWindowRef`, `memoryServicePromiseRef`); add a `pipelineBusRef` set at init. |
| Meeting lifecycle double-handling | v1 keeps memory on its existing `onMeetingUpdated` path; bus lifecycle events have no consumer. No double-processing. |

## Verification approach

Per `CLAUDE.md` phase verification convention:

1. **Each phase:** `npm run verify:phase <N>` shows `VERDICT: ✅ Phase N verified`.
2. **Final:** `npm run verify` clean. `npm run build` clean (touches `src/main/**`).
3. **Manual smoke (deferred to user):**
   - Run a live meeting → confirm transcript feed, translation, whiteboard suggestions, action items, and persisted memory all behave exactly as before.
   - Confirm no console errors from the pipeline bus.
   - (Developer check) Temporarily register a no-op logging subscriber and confirm it receives `turn-finalized` events without any `transcriptPostProcessor` edit — proves the extensibility goal.

## File map (preview — full detail in plan)

| Path | Action | Responsibility |
|---|---|---|
| `src/main/pipeline/types.ts` | Create | `PipelineEvent`, `FinalizedTurn`, `PipelineSubscriber` |
| `src/main/pipeline/pipelineBus.ts` | Create | `PipelineBus` (register/emit + error isolation) |
| `src/main/pipeline/subscribers/memorySubscriber.ts` | Create | Adapter → `notifyTurnFinalized`/`notifyTranslation`/`notifySourceTextUpdate` |
| `src/main/pipeline/subscribers/whiteboardSubscriber.ts` | Create | Adapter → `enqueueWhiteboardTranscript` |
| `src/main/pipeline/subscribers/actionItemsSubscriber.ts` | Create | Adapter → `enqueueActionTranscript` |
| `src/main/transcriptPostProcessor.ts` | Modify | Emit events instead of direct calls; drop consumer imports; remove dead downstream branch; add `pipelineBusRef` at init |
| `src/main/index.ts` | Modify | Create bus, register 3 subscribers (ordered), bridge lifecycle to bus, pass bus into `transcriptPostProcessor.init` |
| `src/test/pipeline-bus.test.ts` | Create | Bus unit tests |
| `src/test/pipeline-subscribers.test.ts` | Create | Subscriber adapter tests |
| `src/test/memory-postprocessor-regression.test.ts` | Modify | Keep green; assert finalize fan-out via bus |
| `HANDOFF.md` | Modify | New active stream block + status table |

## Open questions / explicit non-decisions

- **Should the bus be generic (`EventBus<T>`) or pipeline-specific?** v1: pipeline-specific (`PipelineBus` with the concrete `PipelineEvent` union). A generic bus is speculative; YAGNI.
- **Should subscribers be able to declare which event types they want (filtering at register time)?** v1: no — each `onEvent` switches on `event.type` and ignores the rest. Filtering is a trivial future addition if subscriber count grows.
- **Should `emit` be async (await each subscriber)?** No — fan-out is fire-and-forget as today; awaiting would serialize consumers and add latency to the finalize path.
- **Where does the singleton bus live?** Created in `index.ts` and injected. Avoids a module-global singleton that complicates testing (tests construct their own `PipelineBus`).
- **Do we emit a `turn-started` / partial event?** Not in v1 — no current consumer needs partial turns downstream (`emitProcessedTurn` only sends partials to the renderer, which stays direct). Adding it later is non-breaking.

## Self-review notes

The initial instinct was to also route the renderer feed through the bus for uniformity. Rejected: the renderer feed is not a consumer you add or remove — it is the product's primary output, it is latency-sensitive, and it has fine-grained patch events tied to the active-turn lifecycle. Routing it through the bus increases hot-path risk while delivering no extensibility benefit (you never "register a second renderer feed"). Keeping it direct is the disciplined boundary.

A second consideration was whether to migrate memory's meeting-lifecycle handling onto the bus in this stream. Rejected for v1: memory already handles `onMeetingUpdated` correctly, and moving it risks double-processing for zero immediate benefit. The bus emits lifecycle events for *future* subscribers; the migration of memory itself, if ever wanted, is a separate, optional change.
