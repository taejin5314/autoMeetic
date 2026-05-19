# Electron Dev Startup Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Electron dev startup crash caused by named ESM imports from the `electron` package.

**Architecture:** Keep the existing ESM Electron/Vite output, but change runtime imports from `electron` to default import plus destructuring so Node can load the CommonJS Electron bridge safely. Type-only imports can remain type-only because they are erased at build time.

**Tech Stack:** Electron 41, electron-vite, TypeScript ESM, Vitest, PowerShell on Windows.

---

## Observed Failure

Command:

```powershell
npm run dev:electron
```

Current failure:

```text
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
```

The generated file `out/main/index.js` starts with:

```js
import { BrowserWindow, Menu, Tray, app, desktopCapturer, globalShortcut, ipcMain, nativeImage, session, shell } from "electron";
```

This is invalid for the current runtime because `electron` is loaded as CommonJS.

## File Map

- Modify: `src/main/index.ts`
  - Replace runtime named import from `electron` with default import and destructuring.
- Modify: `src/main/ipc.ts`
  - Replace runtime `ipcMain` named import with default import and destructuring.
- Modify: `src/preload/index.ts`
  - Replace runtime `contextBridge`/`ipcRenderer` named import with default import and destructuring.
- Test/Verify only: `out/main/index.js`, `out/preload/index.mjs`
  - Confirm generated output no longer imports named runtime bindings from `electron`.

---

### Task 1: Reproduce The Startup Crash

**Files:**
- No code changes.

- [ ] **Step 1: Run Electron dev startup**

```powershell
npm run dev:electron
```

Expected before fix: FAIL with:

```text
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
```

- [ ] **Step 2: Stop if another different error appears**

If the command fails with a different first error, pause and investigate that first error before changing imports.

---

### Task 2: Fix Main Process Electron Runtime Imports

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Change the Electron import**

Replace the current import:

```ts
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} from 'electron'
```

with:

```ts
import electron from 'electron'
import type { BrowserWindow as BrowserWindowType } from 'electron'

const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} = electron
```

- [ ] **Step 2: Update the `mainWindow` type**

Change:

```ts
let mainWindow: BrowserWindow | null = null
```

to:

```ts
let mainWindow: BrowserWindowType | null = null
```

- [ ] **Step 3: Typecheck**

```powershell
npm run typecheck
```

Expected: PASS.

---

### Task 3: Fix Main IPC Electron Runtime Imports

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Change the Electron import**

Replace:

```ts
import { ipcMain, type BrowserWindow } from 'electron'
```

with:

```ts
import electron from 'electron'
import type { BrowserWindow } from 'electron'

const { ipcMain } = electron
```

- [ ] **Step 2: Typecheck**

```powershell
npm run typecheck
```

Expected: PASS.

---

### Task 4: Fix Preload Electron Runtime Imports

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Change the Electron import**

Replace:

```ts
import { contextBridge, ipcRenderer } from 'electron'
```

with:

```ts
import electron from 'electron'

const { contextBridge, ipcRenderer } = electron
```

- [ ] **Step 2: Typecheck**

```powershell
npm run typecheck
```

Expected: PASS.

---

### Task 5: Verify Generated Electron Output

**Files:**
- Verify: `out/main/index.js`
- Verify: `out/preload/index.mjs`

- [ ] **Step 1: Rebuild Electron output**

```powershell
npm run build:electron
```

Expected: PASS, with `out/main/embeddingWorker.js` still present in the output list.

- [ ] **Step 2: Confirm generated imports are safe**

```powershell
rg -n "import \\{.*from \"electron\"|from 'electron'" out/main out/preload
```

Expected: no runtime named import from `electron` in `out/main/index.js` or `out/preload/index.mjs`.

---

### Task 6: Run Electron Dev Startup QA

**Files:**
- No code changes.

- [ ] **Step 1: Start Electron dev mode**

```powershell
npm run dev:electron
```

Expected:

```text
electron main process built successfully
electron preload scripts built successfully
starting electron app...
```

The previous `BrowserWindow` named export crash must not appear.

- [ ] **Step 2: Check the first runtime logs**

If memory initializes, no `[memory] init failed` line should appear. If `OPENAI_API_KEY` is missing, that is acceptable until transcription is started.

- [ ] **Step 3: Stop the dev process**

Use Ctrl+C after the window opens and the startup logs are clean.

---

### Task 7: Full Verification

**Files:**
- No code changes unless verification exposes a new issue.

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
- Build exits 0, allowing existing chunk-size/plugin timing warnings.

- [ ] **Step 2: Run memory/Electron checks**

```powershell
npm run smoke:memory-deps
npm run build:electron
```

Expected:
- SQLite smoke passes.
- Embedding worker smoke returns a vector with dimension 384.
- Electron build includes `out/main/embeddingWorker.js`.

- [ ] **Step 3: Commit**

```powershell
git add src/main/index.ts src/main/ipc.ts src/preload/index.ts docs/superpowers/plans/2026-05-18-electron-dev-startup-fix.md
git commit -m "fix(electron): load electron cjs bridge from esm output"
```

---

## Self-Review

- Spec coverage: This plan targets the reproduced `electron` named export startup crash directly and includes build/runtime verification.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: Runtime imports use `electron` default import; BrowserWindow remains type-only where needed.

## Implementation Note

During execution, the default-import approach still failed on this Windows environment because
`ELECTRON_RUN_AS_NODE=1` was inherited by the Electron child process. The final fix emits
main/preload as CommonJS (`out/main/index.cjs`, `out/preload/index.cjs`), updates the package
entry/preload/worker paths, and runs `electron-vite dev` through a wrapper that removes
`ELECTRON_RUN_AS_NODE` from the inherited environment.
