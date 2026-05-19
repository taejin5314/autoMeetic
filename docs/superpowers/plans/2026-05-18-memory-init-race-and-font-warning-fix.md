# Memory Init Race And Font Warning Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the observed `Memory service not initialized` IPC error and triage the Excalidraw dev font decode warnings.

**Architecture:** Treat memory startup as an async dependency that IPC handlers can await instead of checking a nullable global synchronously. Keep renderer UX responsive by returning a loading/error state only when initialization really fails. Treat Excalidraw font warnings as a dev-server asset-serving issue until proven otherwise because the local font files are valid WOFF2.

**Tech Stack:** Electron 41, electron-vite, TypeScript, React, Vitest, Vite dev server.

---

## Observed Logs

```text
Error occurred in handler for 'memory:list-meetings': Error: Memory service not initialized
    at .../out/main/index.js:129:32
```

```text
[renderer:WARN] Failed to decode downloaded font:
http://localhost:5173/node_modules/@excalidraw/excalidraw/dist/prod/fonts/Xiaolai/Xiaolai-Regular-15dc6d811c9cd078f9086a740d5a1038.woff2
[renderer:WARN] OTS parsing error: invalid sfntVersion: 1008821359
```

## Evidence Gathered

- `npm run smoke:memory-deps` passes in Node:

```text
[smoke] sqlite OK
[smoke] embedding worker OK, dims= [ 1, 384 ]
[smoke] all dependency smoke checks passed
```

- Electron runtime can load `better-sqlite3` directly:

```powershell
node_modules\.bin\electron.cmd -e "try { require('better-sqlite3'); console.log('electron better-sqlite3 ok'); process.exit(0) } catch (e) { console.error(e); process.exit(1) }"
```

Expected current result:

```text
electron better-sqlite3 ok
```

- `out/main/embeddingWorker.js` exists.
- The local Xiaolai font file starts with `77 4F 46 32` (`wOF2`), so the file on disk is not obviously corrupted.

## Working Hypotheses

1. `Memory service not initialized` is most likely an IPC readiness race: renderer calls `memory:list-meetings` before `setMemoryService()` has run.
2. If memory initialization later fails, current IPC hides the real root cause behind the generic nullable-global error.
3. Excalidraw font warnings likely occur because the active renderer page requests font URLs from a stale or wrong Vite dev server port that returns non-font bytes. Confirm by checking the active HTTP response body and content type.

---

## File Map

- Modify: `src/main/ipc.ts`
  - Add `setMemoryServicePromise()`.
  - Make memory handlers await the memory initialization promise.
  - Make start/stop transcription use the same async memory service access.
- Modify: `src/main/index.ts`
  - Create the memory initialization promise during `app.whenReady()`.
  - Register it with IPC before renderer memory calls can fail.
- Test: `src/test/memory-ipc-readiness.test.ts`
  - Verify handlers wait for delayed memory initialization.
  - Verify failed initialization produces a specific error.
- Verify: Excalidraw font URL over HTTP from the active renderer server.

---

### Task 1: Add Failing IPC Readiness Tests

**Files:**
- Create: `src/test/memory-ipc-readiness.test.ts`
- Modify only after RED: `src/main/ipc-memory-handlers.ts` or `src/main/ipc.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/memory-ipc-readiness.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildMemoryHandlers } from '../main/ipc-memory-handlers'

function delayedMemory() {
  let resolve!: (value: {
    listMeetings: () => string[]
    getMeeting: () => null
    search: () => Promise<unknown[]>
    renameMeeting: () => void
    deleteMeeting: () => void
    exportMeeting: () => string
    regenerateSummary: () => Promise<void>
  }) => void

  const promise = new Promise<Parameters<typeof buildMemoryHandlers>[0]>((r) => {
    resolve = r
  })

  return { promise, resolve }
}

describe('memory IPC readiness', () => {
  it('waits for memory initialization instead of throwing while it is still starting', async () => {
    const ready = delayedMemory()
    const handlers = buildMemoryHandlers(() => ready.promise)
    const pending = handlers['memory:list-meetings']({})

    ready.resolve({
      listMeetings: () => ['ready'],
      getMeeting: () => null,
      search: async () => [],
      renameMeeting: () => {},
      deleteMeeting: () => {},
      exportMeeting: () => '# export',
      regenerateSummary: async () => {},
    })

    await expect(pending).resolves.toEqual(['ready'])
  })

  it('reports the real initialization failure if memory cannot start', async () => {
    const handlers = buildMemoryHandlers(() => Promise.reject(new Error('sqlite failed')))
    await expect(handlers['memory:list-meetings']({})).rejects.toThrow(
      /Memory service failed to initialize: sqlite failed/
    )
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm test -- src/test/memory-ipc-readiness.test.ts
```

Expected: FAIL because `buildMemoryHandlers` currently accepts a concrete memory object, not an async getter.

---

### Task 2: Make Memory IPC Await Initialization

**Files:**
- Modify: `src/main/ipc-memory-handlers.ts`
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Change `buildMemoryHandlers` to accept an async getter**

Replace `src/main/ipc-memory-handlers.ts` with:

```ts
import type { MemoryService } from './memory/memoryService'

type MemoryApi = Pick<
  MemoryService,
  | 'listMeetings'
  | 'getMeeting'
  | 'search'
  | 'renameMeeting'
  | 'deleteMeeting'
  | 'exportMeeting'
  | 'regenerateSummary'
>

type GetMemory = () => Promise<MemoryApi>

async function getReadyMemory(getMemory: GetMemory): Promise<MemoryApi> {
  try {
    return await getMemory()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Memory service failed to initialize: ${message}`)
  }
}

export function buildMemoryHandlers(getMemory: GetMemory) {
  return {
    'memory:list-meetings': async (args: { limit?: number; offset?: number } = {}) => {
      const memory = await getReadyMemory(getMemory)
      return memory.listMeetings(args.limit, args.offset)
    },
    'memory:get-meeting': async (args: { id: string }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.getMeeting(args.id)
    },
    'memory:search': async (args: { query: string; limit?: number }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.search(args.query, args.limit)
    },
    'memory:rename-meeting': async (args: { id: string; title: string }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.renameMeeting(args.id, args.title)
    },
    'memory:delete-meeting': async (args: { id: string }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.deleteMeeting(args.id)
    },
    'memory:export-meeting': async (args: { id: string; format: 'markdown' }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.exportMeeting(args.id, args.format)
    },
    'memory:regenerate-summary': async (args: { id: string }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.regenerateSummary(args.id)
    },
  }
}
```

- [ ] **Step 2: Update `src/main/ipc.ts`**

Add:

```ts
let memoryServicePromise: Promise<MemoryService> | null = null

export function setMemoryServicePromise(promise: Promise<MemoryService>): void {
  memoryServicePromise = promise.then((svc) => {
    setMemoryService(svc)
    return svc
  })
}

async function getMemoryService(): Promise<MemoryService> {
  if (memoryServiceRef) return memoryServiceRef
  if (!memoryServicePromise) throw new Error('Memory service startup was not scheduled')
  return memoryServicePromise
}
```

Then change memory handlers to:

```ts
const memHandlers = buildMemoryHandlers(getMemoryService)
for (const [channel, handler] of Object.entries(memHandlers)) {
  ipcMain.handle(channel, async (_event, args) => handler(args as never))
}
```

Change start/stop memory integration to use `getMemoryService()`:

```ts
void getMemoryService()
  .then((memory) => {
    memory.beginMeeting(resolveMeetingLanguages(args.language, transcriptLanguages))
  })
  .catch((err) => {
    console.error('[memory] begin meeting failed:', err)
  })
```

```ts
void getMemoryService()
  .then((memory) => memory.endMeeting(3000))
  .catch((err) => {
    console.error('[memory] end meeting failed:', err)
  })
```

- [ ] **Step 3: Run the readiness test and verify GREEN**

```powershell
npm test -- src/test/memory-ipc-readiness.test.ts
```

Expected: PASS.

---

### Task 3: Schedule Memory Initialization Before Renderer Calls Matter

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Import the new promise setter**

Change:

```ts
import { registerIpcHandlers, registerWindowNotifiers, setMemoryService } from './ipc'
```

to:

```ts
import { registerIpcHandlers, registerWindowNotifiers, setMemoryServicePromise } from './ipc'
```

- [ ] **Step 2: Replace fire-and-forget memory init**

Replace the current async IIFE in `app.whenReady().then(() => { ... })`:

```ts
void (async () => {
  try {
    const userData = app.getPath('userData')
    const memoryService = await MemoryService.initialize({
      dbPath: join(userData, 'memory.db'),
      workerPath: defaultWorkerPath(),
      modelEnvCacheDir: join(userData, 'embedding-cache'),
    })
    const recovered = memoryService.recoverInterruptedMeetings()
    if (recovered > 0) console.log(`[memory] recovered ${recovered} interrupted meeting(s)`)
    setMemoryService(memoryService)
  } catch (err) {
    console.error('[memory] init failed:', err)
  }
})()
```

with:

```ts
const userData = app.getPath('userData')
setMemoryServicePromise(
  MemoryService.initialize({
    dbPath: join(userData, 'memory.db'),
    workerPath: defaultWorkerPath(),
    modelEnvCacheDir: join(userData, 'embedding-cache'),
  }).then((memoryService) => {
    const recovered = memoryService.recoverInterruptedMeetings()
    if (recovered > 0) console.log(`[memory] recovered ${recovered} interrupted meeting(s)`)
    return memoryService
  })
)
```

- [ ] **Step 3: Run targeted tests**

```powershell
npm test -- src/test/memory-ipc-readiness.test.ts src/test/memory-meeting-languages.test.ts
```

Expected: PASS.

---

### Task 4: Confirm Or Dismiss The Excalidraw Font Warning

**Files:**
- No code changes unless HTTP evidence shows a real app issue.

- [ ] **Step 1: Start renderer dev server**

```powershell
npm run dev:ui
```

Expected: Vite prints the active local URL and port.

- [ ] **Step 2: Request the exact font URL from that active port**

If Vite prints `http://localhost:5173/`, run:

```powershell
$r = Invoke-WebRequest -Uri "http://localhost:5173/node_modules/@excalidraw/excalidraw/dist/prod/fonts/Xiaolai/Xiaolai-Regular-15dc6d811c9cd078f9086a740d5a1038.woff2"
$r.Headers["Content-Type"]
[System.BitConverter]::ToString($r.Content[0..3])
```

Expected:

```text
font/woff2
77-4F-46-32
```

- [ ] **Step 3: If the response is HTML or not WOFF2**

Add a Vite dev-server middleware in `vite.config.ts` or `electron.vite.config.ts` only if the active server cannot serve `/node_modules/@excalidraw/...` font assets correctly. The middleware should set `Content-Type: font/woff2` for `.woff2` files under `node_modules/@excalidraw`.

- [ ] **Step 4: If the response is valid WOFF2**

Treat the warning as stale-port/cache noise. Stop all old Vite/Electron processes, restart `npm run dev:electron`, and verify the warning does not persist on the active port.

---

### Task 5: Electron Dev QA

**Files:**
- No code changes unless QA exposes a new first error.

- [ ] **Step 1: Run Electron dev**

```powershell
npm run dev:electron
```

Expected:
- No `Memory service not initialized` when opening Meeting Memory.
- No `[memory] init failed` line.
- If `OPENAI_API_KEY` is missing, transcription may fail only when starting STT; memory list should still work.

- [ ] **Step 2: Use the app**

Manual QA:
- Open Meeting Memory panel before starting a meeting.
- Expected: no IPC exception in terminal; empty state or existing meetings list appears.
- Start/stop a short meeting.
- Expected: new meeting appears in library.
- Click Export.
- Expected: Markdown copied, no terminal exception.

---

### Task 6: Full Verification And Commit

**Files:**
- Commit all modified source/tests/plans.

- [ ] **Step 1: Run required checks**

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Expected:
- Typecheck exits 0.
- Lint exits 0.
- Tests pass.
- Build exits 0; existing large chunk warnings are allowed.

- [ ] **Step 2: Run memory/Electron checks**

```powershell
npm run smoke:memory-deps
npm run build:electron
```

Expected:
- SQLite smoke passes.
- Embedding worker smoke returns dimension 384.
- Electron build includes `out/main/embeddingWorker.js`.

- [ ] **Step 3: Commit**

```powershell
git add src/main/ipc.ts src/main/index.ts src/main/ipc-memory-handlers.ts src/test/memory-ipc-readiness.test.ts docs/superpowers/plans/2026-05-18-memory-init-race-and-font-warning-fix.md
git commit -m "fix(memory): await initialization in ipc handlers"
```

---

## Self-Review

- Spec coverage: Covers the pasted memory IPC error and font warning.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: Memory handler getter type is introduced before use; IPC code uses the same async getter throughout.

## Implementation Note

During execution, Electron dev mode also required the startup fix documented in
`2026-05-18-electron-dev-startup-fix.md`: main/preload now build as CJS, the memory worker path is
`out/main/embeddingWorker.cjs`, and `npm run dev:electron` removes inherited
`ELECTRON_RUN_AS_NODE`. After adding the Electron renderer font middleware, the active dev server
returned `Content-Type: font/woff2` and a `77-4F-46-32` WOFF2 header for the Excalidraw Xiaolai
font URL.
