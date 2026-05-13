# Electron App Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate autoMeetic from browser-only Vite+React to an Electron desktop app with embedded server, desktopCapturer audio, system tray, and Windows/macOS packaging.

**Architecture:** `electron-vite` builds 3 targets (main/preload/renderer) from a single config. The Express+WebSocket proxy logic moves into the Electron main process and communicates with the renderer via IPC. Browser-mode development is preserved via `npm run dev:web`.

**Tech Stack:** Electron, electron-vite, electron-builder, React, Vite, TypeScript

**Spec:** `docs/superpowers/specs/2026-05-13-electron-app-design.md`

---

## File Map

### New files

| File | Responsibility |
|---|---|
| `electron.vite.config.ts` | 3-target Vite config (main, preload, renderer) |
| `electron-builder.yml` | Packaging config for Windows NSIS + macOS DMG |
| `src/main/index.ts` | Electron app entry: BrowserWindow, tray, shortcuts, IPC registration |
| `src/main/ipc.ts` | IPC handler registration (`registerIpcHandlers`, `registerWindowNotifiers`) |
| `src/main/proxyService.ts` | Translation, answer-assist, vocabulary — ported from proxy.mjs |
| `src/main/sttService.ts` | OpenAI Realtime WebSocket management — ported from proxy.mjs |
| `src/main/whiteboardService.ts` | Whiteboard agent pipeline — ported from proxy.mjs + whiteboard-runtime.mjs |
| `src/preload/index.ts` | contextBridge exposing `window.electronAPI` |
| `src/preload/types.ts` | `ElectronAPI` interface |
| `src/renderer/index.html` | Moved from `./index.html` |
| `src/renderer/api.ts` | Dual-mode adapter (IPC vs HTTP/WS) |
| `tsconfig.main.json` | TypeScript config for main process |
| `tsconfig.preload.json` | TypeScript config for preload scripts |
| `tsconfig.renderer.json` | TypeScript config for renderer (replaces tsconfig.app.json) |
| `build/icon.ico` | App icon for Windows |
| `build/icon.icns` | App icon for macOS |

### Moved files

| From | To |
|---|---|
| `index.html` | `src/renderer/index.html` |
| `src/App.tsx` | `src/renderer/App.tsx` |
| `src/App.css` | `src/renderer/App.css` |
| `src/main.tsx` | `src/renderer/main.tsx` |
| `src/index.css` | `src/renderer/index.css` |
| `src/assets/` | `src/renderer/assets/` |
| `src/renderer/overlay/` | `src/renderer/overlay/` (stays) |
| `src/renderer/whiteboard/` | `src/renderer/whiteboard/` (stays) |
| `src/renderer/answer-assist/` | `src/renderer/answer-assist/` (stays) |

### Modified files

| File | Change |
|---|---|
| `package.json` | Add `main` field, Electron deps, new scripts |
| `vite.config.ts` | Keep for `dev:web` mode only |
| `tsconfig.json` | Update references to new tsconfig files |

### Retained (not moved)

| File | Reason |
|---|---|
| `src/main/audio/capture.ts` | Used in renderer (Web Audio API); imported from renderer code |
| `src/main/stt/transcriptBus.ts` | Used in renderer (drives UI updates) |
| `src/main/stt/types.ts` | Shared types |
| `src/main/health/pipelineHealth.ts` | Used in renderer |
| `src/main/telemetry/logger.ts` | Used in renderer |
| `src/main/whiteboard/types.ts` | Shared types |
| `server/proxy.mjs` | Browser-mode dev fallback |
| `server/whiteboard-runtime.mjs` | Browser-mode dev fallback |

---

## Task 1: Install Electron dependencies and scaffold config

**Files:**
- Modify: `package.json`
- Create: `electron.vite.config.ts`
- Create: `electron-builder.yml`
- Create: `tsconfig.main.json`
- Create: `tsconfig.preload.json`
- Create: `tsconfig.renderer.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: Install electron-vite, electron, electron-builder**

```bash
npm install -D electron electron-vite electron-builder @types/electron
```

- [ ] **Step 2: Add `main` field and scripts to package.json**

In `package.json`, add the `main` field at the top level and new scripts:

```jsonc
{
  "main": "./out/main/index.js",
  "scripts": {
    // Keep existing scripts, add:
    "dev:electron": "electron-vite dev",
    "dev:web": "concurrently -n proxy,vite -c cyan,green \"npm run server\" \"npm run dev:ui\"",
    "build:electron": "electron-vite build",
    "preview:electron": "electron-vite preview",
    "build:win": "electron-vite build && electron-builder --win",
    "build:mac": "electron-vite build && electron-builder --mac"
  }
}
```

Note: Keep the existing `dev`, `dev:ui`, `build`, `server` scripts intact for browser-mode.

- [ ] **Step 3: Create `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
```

- [ ] **Step 4: Create `electron-builder.yml`**

```yaml
appId: com.automeetic.app
productName: AutoMeetic
directories:
  buildResources: build
  output: release
files:
  - '!server/*'
  - '!harness/*'
  - '!docs/*'
  - '!scripts/*'
  - '!src/*'
  - '!*.config.*'
  - '!tsconfig*'
  - '!CLAUDE.md'
  - '!.env'
  - '!.instructions/*'
asarUnpack:
  - resources/**
win:
  target: nsis
  executableName: AutoMeetic
nsis:
  artifactName: ${name}-${version}-setup.${ext}
  shortcutName: AutoMeetic
  uninstallDisplayName: AutoMeetic
mac:
  target: dmg
dmg:
  artifactName: ${name}-${version}.${ext}
```

- [ ] **Step 5: Create TypeScript configs for Electron targets**

`tsconfig.main.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "outDir": "./out/main",
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/main/index.ts", "src/main/ipc.ts", "src/main/proxyService.ts", "src/main/sttService.ts", "src/main/whiteboardService.ts"]
}
```

`tsconfig.preload.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM"],
    "types": ["node"],
    "outDir": "./out/preload",
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/preload/**/*.ts"]
}
```

`tsconfig.renderer.json`:
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.renderer.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "types": ["vite/client"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/renderer/**/*", "src/main/audio/**/*", "src/main/stt/transcriptBus.ts", "src/main/stt/types.ts", "src/main/health/**/*", "src/main/telemetry/**/*", "src/main/whiteboard/types.ts"]
}
```

Update `tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.main.json" },
    { "path": "./tsconfig.preload.json" },
    { "path": "./tsconfig.renderer.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

- [ ] **Step 6: Create placeholder app icon**

Create `build/` directory with a placeholder `icon.png` (256x256 solid color). Real icons come later.

```bash
mkdir build
```

Create a minimal SVG placeholder at `build/icon.svg` (electron-builder can use SVG on some platforms):
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <rect width="256" height="256" rx="32" fill="#18181b"/>
  <text x="128" y="148" text-anchor="middle" font-size="80" font-family="sans-serif" fill="#10b981">AM</text>
</svg>
```

- [ ] **Step 7: Commit**

```bash
git add package.json electron.vite.config.ts electron-builder.yml tsconfig.main.json tsconfig.preload.json tsconfig.renderer.json tsconfig.json build/
git commit -m "chore: scaffold electron-vite, electron-builder, and tsconfig targets"
```

---

## Task 2: Move renderer files to `src/renderer/`

**Files:**
- Move: `index.html` → `src/renderer/index.html`
- Move: `src/App.tsx` → `src/renderer/App.tsx`
- Move: `src/App.css` → `src/renderer/App.css`
- Move: `src/main.tsx` → `src/renderer/main.tsx`
- Move: `src/index.css` → `src/renderer/index.css`
- Move: `src/assets/` → `src/renderer/assets/`
- Modify: `src/renderer/index.html` (update script path)
- Modify: `src/renderer/App.tsx` (update import paths)
- Modify: `src/renderer/main.tsx` (update import paths)
- Modify: `vite.config.ts` (update root for dev:web mode)

- [ ] **Step 1: Move files**

```bash
mv index.html src/renderer/index.html
mv src/App.tsx src/renderer/App.tsx
mv src/App.css src/renderer/App.css
mv src/main.tsx src/renderer/main.tsx
mv src/index.css src/renderer/index.css
mv src/assets/ src/renderer/assets/
```

- [ ] **Step 2: Update `src/renderer/index.html`**

Change the script src to point to the new location:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AutoMeetic</title>
    <script>
      window.EXCALIDRAW_ASSET_PATH = '/node_modules/@excalidraw/excalidraw/dist/prod/'
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

Key change: `src="/src/main.tsx"` → `src="./main.tsx"` (relative since index.html is now in renderer dir).

- [ ] **Step 3: Update imports in `src/renderer/main.tsx`**

```ts
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

No path changes needed since App.tsx is in the same directory.

- [ ] **Step 4: Update imports in `src/renderer/App.tsx`**

Update all relative imports that pointed to `./main/*` to now point to `../main/*`:

- `'./App.css'` → `'./App.css'` (same dir, no change)
- `'./main/audio/capture'` → `'../main/audio/capture'`
- `'./main/health/pipelineHealth'` → `'../main/health/pipelineHealth'`
- `'./main/stt/realtimeClient'` → `'../main/stt/realtimeClient'`
- `'./main/stt/transcriptBus'` → `'../main/stt/transcriptBus'`
- `'./main/stt/types'` → `'../main/stt/types'`
- `'./main/telemetry/logger'` → `'../main/telemetry/logger'`
- `'./main/whiteboard/types'` → `'../main/whiteboard/types'`
- `'./renderer/overlay/CaptionOverlay'` → `'./overlay/CaptionOverlay'`
- `'./renderer/overlay/useCaptionStore'` → `'./overlay/useCaptionStore'`
- `'./renderer/overlay/Waveform'` → `'./overlay/Waveform'`
- `'./renderer/whiteboard/ExcalidrawCanvas'` → `'./whiteboard/ExcalidrawCanvas'`
- `'./renderer/answer-assist/AnswerAssistCard'` → `'./answer-assist/AnswerAssistCard'`
- `'./renderer/answer-assist/useAnswerAssistStore'` → `'./answer-assist/useAnswerAssistStore'`

- [ ] **Step 5: Update `vite.config.ts` for browser-mode dev**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: {
    proxy: {
      '/api/ws': {
        target: 'http://127.0.0.1:3211',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', () => {})
          proxy.on('proxyReqWs', (proxyReq: { removeHeader: (h: string) => void }) => {
            proxyReq.removeHeader('sec-websocket-extensions')
          })
        },
      },
      '/api': { target: 'http://127.0.0.1:3211' },
    },
  },
})
```

- [ ] **Step 6: Verify browser-mode still works**

```bash
npm run dev:web
```

Expected: App loads in browser at `http://localhost:5173` with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: move renderer files to src/renderer/"
```

---

## Task 3: Create preload script and types

**Files:**
- Create: `src/preload/index.ts`
- Create: `src/preload/types.ts`

- [ ] **Step 1: Create `src/preload/types.ts`**

```ts
export interface ElectronAPI {
  // Actions
  translate(text: string, targetLang: string): Promise<{ translation: string }>
  startAnswerAssist(transcript: string, lang: string): Promise<void>
  updateVocabulary(keywords: string[]): Promise<{ count: number }>
  checkHealth(): Promise<{ status: string; ts: number }>

  // Audio/STT
  startTranscription(language: string): Promise<void>
  stopTranscription(): Promise<void>
  sendAudio(base64Chunk: string): void

  // Whiteboard
  sendWhiteboardElements(elements: unknown[]): void
  sendWhiteboardScreenshot(imageDataUrl: string): void

  // Events (main → renderer)
  onSttPartial(callback: (text: string) => void): () => void
  onSttCommitted(callback: (text: string) => void): () => void
  onSttError(callback: (message: string) => void): () => void
  onWhiteboardUpdate(callback: (elements: unknown[]) => void): () => void
  onWhiteboardViewport(callback: (cmd: unknown) => void): () => void
  onWhiteboardAgentStatus(callback: (status: string) => void): () => void
  onAnswerAssistEvent(callback: (event: unknown) => void): () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
```

- [ ] **Step 2: Create `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from './types'

function createEventListener(channel: string) {
  return (callback: (...args: unknown[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const electronAPI: ElectronAPI = {
  // Actions
  translate: (text, targetLang) => ipcRenderer.invoke('translate', { text, targetLang }),
  startAnswerAssist: (transcript, lang) =>
    ipcRenderer.invoke('start-answer-assist', { transcript, lang }),
  updateVocabulary: (keywords) => ipcRenderer.invoke('update-vocabulary', { keywords }),
  checkHealth: () => ipcRenderer.invoke('check-health'),

  // Audio/STT
  startTranscription: (language) => ipcRenderer.invoke('start-transcription', { language }),
  stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
  sendAudio: (base64Chunk) => ipcRenderer.send('send-audio', { chunk: base64Chunk }),

  // Whiteboard
  sendWhiteboardElements: (elements) =>
    ipcRenderer.send('whiteboard:user-elements', { elements }),
  sendWhiteboardScreenshot: (imageDataUrl) =>
    ipcRenderer.send('whiteboard:screenshot', { image: imageDataUrl }),

  // Events
  onSttPartial: createEventListener('stt:partial') as ElectronAPI['onSttPartial'],
  onSttCommitted: createEventListener('stt:committed') as ElectronAPI['onSttCommitted'],
  onSttError: createEventListener('stt:error') as ElectronAPI['onSttError'],
  onWhiteboardUpdate: createEventListener('whiteboard:update') as ElectronAPI['onWhiteboardUpdate'],
  onWhiteboardViewport: createEventListener('whiteboard:viewport') as ElectronAPI['onWhiteboardViewport'],
  onWhiteboardAgentStatus: createEventListener('whiteboard:agent-status') as ElectronAPI['onWhiteboardAgentStatus'],
  onAnswerAssistEvent: createEventListener('answer-assist:event') as ElectronAPI['onAnswerAssistEvent'],
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
```

- [ ] **Step 3: Commit**

```bash
git add src/preload/
git commit -m "feat: create preload script with IPC bridge and ElectronAPI types"
```

---

## Task 4: Create Electron main process entry point

**Files:**
- Create: `src/main/index.ts`

- [ ] **Step 1: Create `src/main/index.ts`**

```ts
import { app, BrowserWindow, shell, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import 'dotenv/config'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Dev: load from Vite dev server. Prod: load built renderer HTML.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Minimize to tray on close
  mainWindow.on('close', (event) => {
    if (tray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
}

function createTray(): void {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('AutoMeetic')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        tray = null
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function registerGlobalShortcuts(): void {
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    mainWindow?.webContents.send('shortcut:toggle-capture')
  })

  globalShortcut.register('CommandOrControl+Shift+O', () => {
    mainWindow?.webContents.send('shortcut:toggle-overlay')
  })
}

app.whenReady().then(() => {
  createWindow()
  createTray()
  registerGlobalShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

- [ ] **Step 2: Install `@electron-toolkit/utils`**

```bash
npm install -D @electron-toolkit/utils
```

- [ ] **Step 3: Verify electron-vite dev launches**

```bash
npm run dev:electron
```

Expected: Electron window opens showing the renderer UI (may have broken imports initially — that's OK, this verifies the Electron shell works).

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts package.json
git commit -m "feat: create Electron main process entry with window, tray, and shortcuts"
```

---

## Task 5: Create IPC handlers (stub)

**Files:**
- Create: `src/main/ipc.ts`

- [ ] **Step 1: Create `src/main/ipc.ts`**

This is the central IPC registration module. It starts with stubs that later tasks fill in.

```ts
import { ipcMain, type BrowserWindow } from 'electron'

let mainWindowRef: BrowserWindow | null = null

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  // Translation
  ipcMain.handle('translate', async (_event, args: { text: string; targetLang: string }) => {
    const { translateText } = await import('./proxyService')
    return translateText(args.text, args.targetLang)
  })

  // Health
  ipcMain.handle('check-health', () => {
    return { status: 'ok', ts: Date.now() }
  })

  // Vocabulary
  ipcMain.handle('update-vocabulary', async (_event, args: { keywords: string[] }) => {
    const { updateVocabulary } = await import('./proxyService')
    return updateVocabulary(args.keywords)
  })

  // Answer assist
  ipcMain.handle('start-answer-assist', async (_event, args: { transcript: string; lang: string }) => {
    const { startAnswerAssist } = await import('./proxyService')
    await startAnswerAssist(args.transcript, args.lang, (event: unknown) => {
      mainWindowRef?.webContents.send('answer-assist:event', event)
    })
  })

  // STT
  ipcMain.handle('start-transcription', async (_event, args: { language: string }) => {
    const { startTranscription } = await import('./sttService')
    startTranscription(args.language, mainWindowRef!)
  })

  ipcMain.handle('stop-transcription', async () => {
    const { stopTranscription } = await import('./sttService')
    stopTranscription()
  })

  ipcMain.on('send-audio', (_event, args: { chunk: string }) => {
    void import('./sttService').then(({ sendAudioChunk }) => {
      sendAudioChunk(args.chunk)
    })
  })

  // Whiteboard
  ipcMain.on('whiteboard:user-elements', (_event, args: { elements: unknown[] }) => {
    void import('./whiteboardService').then(({ handleUserElements }) => {
      handleUserElements(args.elements, mainWindowRef!)
    })
  })

  ipcMain.on('whiteboard:screenshot', (_event, args: { image: string }) => {
    void import('./whiteboardService').then(({ handleScreenshot }) => {
      handleScreenshot(args.image)
    })
  })
}

export function registerWindowNotifiers(_mainWindow: BrowserWindow): void {
  mainWindowRef = _mainWindow
  // Notifiers are called from service modules via mainWindowRef.webContents.send()
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef
}
```

- [ ] **Step 2: Wire IPC into main/index.ts**

Add to `src/main/index.ts` after `createWindow()`:

```ts
import { registerIpcHandlers, registerWindowNotifiers } from './ipc'

// Inside app.whenReady().then():
// After createWindow():
  registerIpcHandlers(mainWindow!)
  registerWindowNotifiers(mainWindow!)
```

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts
git commit -m "feat: register IPC handlers for translate, STT, whiteboard, answer-assist"
```

---

## Task 6: Port translation & vocabulary to main process

**Files:**
- Create: `src/main/proxyService.ts`

- [ ] **Step 1: Create `src/main/proxyService.ts`**

Port the translation, vocabulary, and answer-assist logic from `server/proxy.mjs`:

```ts
const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL ?? 'gpt-4.1-mini'
const ANSWER_ASSIST_MODEL = process.env.ANSWER_ASSIST_MODEL ?? 'gpt-4.1-mini'
const OPENAI_TRANSLATION_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

const LANGUAGE_NAME_BY_CODE = new Map([
  ['ko', 'Korean'],
  ['en', 'English'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
])

let globalVocabulary: string[] = []

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

export async function translateText(
  text: string,
  targetLang: string
): Promise<{ translation: string }> {
  const apiKey = getApiKey()
  const targetLanguage = LANGUAGE_NAME_BY_CODE.get(targetLang) ?? targetLang

  const body = JSON.stringify({
    model: TRANSLATION_MODEL,
    max_tokens: Math.min(Math.max(Math.ceil(text.length * 1.8), 96), 512),
    messages: [
      {
        role: 'system',
        content:
          'You are a precise translation engine. Return only translated text with no quotes, labels, or explanations.',
      },
      {
        role: 'user',
        content: `Translate the following text to ${targetLanguage}. Return ONLY the translation. Do not explain, quote, identify languages, or add a preamble:\n\n${text}`,
      },
    ],
  })

  let response: Response | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(OPENAI_TRANSLATION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    })
    if (response.status === 429 && attempt < 2) {
      const waitMs = Math.min(
        Math.max(parseFloat(response.headers.get('retry-after') || '3') * 1000, 1000),
        10000
      )
      await new Promise((r) => setTimeout(r, waitMs))
      continue
    }
    break
  }

  if (!response || !response.ok) {
    const payload = await response?.json().catch(() => ({}))
    const message = (payload as Record<string, unknown>)?.error
    throw new Error(message ? `OpenAI translation error: ${String(message)}` : 'OpenAI translation failed')
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const translation = payload?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!translation) throw new Error('OpenAI translation returned empty text')

  return { translation }
}

export function updateVocabulary(keywords: string[]): { count: number } {
  globalVocabulary = keywords.filter((k) => typeof k === 'string' && k.length >= 3)
  return { count: globalVocabulary.length }
}

export function getVocabulary(): string[] {
  return globalVocabulary
}

export async function startAnswerAssist(
  transcript: string,
  lang: string,
  sendEvent: (event: unknown) => void
): Promise<void> {
  const apiKey = getApiKey()
  const langName = LANGUAGE_NAME_BY_CODE.get(lang) ?? lang

  const systemPrompt = `You are a real-time meeting answer coach. The user is in a live meeting and needs help responding to what is being discussed.

Your job:
1. Read the transcript and identify the most recent topic, question, or point that the user might need to respond to.
2. If you need factual information to answer well, use web_search_preview to look it up.
3. Write a concise response (3-5 sentences) in ${langName} that the user can speak aloud naturally.
4. Then write "---" on its own line.
5. Then write the Korean translation of your response.

Rules:
- Be concise and direct — this is for speaking aloud, not reading.
- Use a natural conversational tone appropriate for a meeting.
- Do NOT include any labels like "English:" or "Korean:" — just the text.
- Always provide a response.`

  const requestBody = {
    model: ANSWER_ASSIST_MODEL,
    tools: [{ type: 'web_search_preview' }],
    input: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Meeting transcript (most recent 3 minutes):\n\n${transcript.trim()}`,
      },
    ],
    stream: true,
  }

  let response: Response | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })
    if (response!.status === 429 && attempt < 2) {
      const waitMs = Math.min(
        Math.max(parseFloat(response!.headers.get('retry-after') || '3') * 1000, 1000),
        10000
      )
      await new Promise((r) => setTimeout(r, waitMs))
      continue
    }
    break
  }

  if (!response || !response.ok) {
    const errBody = await response?.json().catch(() => ({}))
    const message =
      (errBody as Record<string, Record<string, string>>)?.error?.message ??
      `OpenAI API error: ${response?.status}`
    sendEvent({ type: 'error', message })
    return
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let sentSection = false
  let searchSent = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const json = line.slice(6).trim()
      if (!json || json === '[DONE]') continue

      let event: Record<string, unknown>
      try {
        event = JSON.parse(json) as Record<string, unknown>
      } catch {
        continue
      }

      if (event.type === 'response.web_search_call.in_progress' && !searchSent) {
        searchSent = true
        sendEvent({ type: 'searching', query: 'searching...' })
      }

      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        fullText += event.delta

        if (fullText.includes('[NO_QUESTION]')) {
          sendEvent({ type: 'no_question' })
          return
        }

        if (!sentSection && fullText.includes('\n---\n')) {
          sentSection = true
          sendEvent({ type: 'section', name: 'ko' })
          fullText = fullText.slice(fullText.indexOf('\n---\n') + 5)
          continue
        }

        if (!sentSection && fullText.trimEnd().endsWith('---')) continue

        sendEvent({ type: 'delta', content: event.delta })
      }

      if (event.type === 'response.completed') {
        const respOutput = (event.response as Record<string, unknown[]>)?.output
        const outputText =
          ((respOutput as Array<{ content: Array<{ text: string }> }>)?.[0]?.content?.[0]
            ?.text as string) ?? fullText
        const parts = outputText.split(/\n---\n/)
        sendEvent({
          type: 'done',
          answer: (parts[0] ?? '').trim(),
          answer_ko: (parts[1] ?? '').trim(),
        })
        return
      }
    }
  }

  const parts = fullText.split(/\n---\n/)
  sendEvent({
    type: 'done',
    answer: (parts[0] ?? '').trim(),
    answer_ko: (parts[1] ?? '').trim(),
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit -p tsconfig.main.json
```

Expected: No errors (or only errors from not-yet-created sttService/whiteboardService imports).

- [ ] **Step 3: Commit**

```bash
git add src/main/proxyService.ts
git commit -m "feat: port translation, vocabulary, answer-assist to main process"
```

---

## Task 7: Port STT service to main process

**Files:**
- Create: `src/main/sttService.ts`

- [ ] **Step 1: Create `src/main/sttService.ts`**

Port the OpenAI Realtime WebSocket transcription bridge from `server/proxy.mjs`:

```ts
import { WebSocket } from 'ws'
import type { BrowserWindow } from 'electron'
import { getVocabulary } from './proxyService'

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-realtime-whisper'
const DELTA_QUIET_MS = Number(process.env.STT_DELTA_QUIET_MS ?? 1200)
const TRANSCRIPT_MAX_CHARS = Number(process.env.STT_MAX_CHARS ?? 180)
const TRANSCRIPT_MAX_MS = Number(process.env.STT_MAX_MS ?? 2200)
const TRANSCRIPT_SENTENCE_END_RE = /[.!?。？！]\s*$/
const DEFAULT_KOREAN_TRANSCRIPTION_PROMPT =
  'The audio is Korean. Transcribe only in Korean Hangul. Do not output Japanese, Chinese, English, or romanized text unless those words are clearly spoken.'
const MODELS_WITHOUT_PROMPT_SUPPORT = new Set(['gpt-realtime-whisper'])

let openaiWs: WebSocket | null = null
let mainWindowRef: BrowserWindow | null = null
let deltaBuffer = ''
let deltaQuietTimer: ReturnType<typeof setTimeout> | null = null
let turnStartMs = 0

function buildTranscriptionSession(
  model: string,
  vocabularyPrompt: string,
  language: string
): Record<string, unknown> {
  const transcription: Record<string, unknown> = { model }
  if (language && language !== 'auto') transcription.language = language
  if (!MODELS_WITHOUT_PROMPT_SUPPORT.has(model)) {
    const promptParts: string[] = []
    if (language === 'ko') promptParts.push(DEFAULT_KOREAN_TRANSCRIPTION_PROMPT)
    if (vocabularyPrompt) promptParts.push(vocabularyPrompt)
    const prompt = promptParts.join('\n')
    if (prompt) transcription.prompt = prompt
  }
  return {
    type: 'transcription',
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription,
      },
    },
  }
}

function buildVocabularyPrompt(keywords: string[]): string {
  if (keywords.length === 0) return ''
  const prefix = 'Domain vocabulary that may appear: '
  const suffix = '.'
  let body = ''
  for (const term of keywords) {
    const next = body.length === 0 ? term : `${body}, ${term}`
    if (prefix.length + next.length + suffix.length > 500) continue
    body = next
  }
  if (!body) return ''
  return `${prefix}${body}${suffix}`
}

function commitDelta(): void {
  if (deltaQuietTimer) {
    clearTimeout(deltaQuietTimer)
    deltaQuietTimer = null
  }
  const text = deltaBuffer.trim()
  deltaBuffer = ''
  turnStartMs = 0
  if (text) {
    mainWindowRef?.webContents.send('stt:committed', text)
  }
}

function handleOpenAiMessage(raw: string): void {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }

  if (msg.type === 'session.created' || msg.type === 'session.updated') {
    mainWindowRef?.webContents.send('stt:ready')
    return
  }

  if (msg.type === 'conversation.item.input_audio_transcription.delta') {
    const delta = (msg as Record<string, string>).delta ?? ''
    if (!delta) return

    if (!turnStartMs) turnStartMs = Date.now()
    deltaBuffer += delta

    mainWindowRef?.webContents.send('stt:partial', deltaBuffer.trim())

    // Auto-commit on sentence boundary + enough chars, or max length/time
    const shouldCommit =
      (deltaBuffer.length >= TRANSCRIPT_MAX_CHARS) ||
      (Date.now() - turnStartMs >= TRANSCRIPT_MAX_MS && TRANSCRIPT_SENTENCE_END_RE.test(deltaBuffer))

    if (shouldCommit) {
      commitDelta()
    } else {
      if (deltaQuietTimer) clearTimeout(deltaQuietTimer)
      deltaQuietTimer = setTimeout(commitDelta, DELTA_QUIET_MS)
    }
    return
  }

  if (msg.type === 'conversation.item.input_audio_transcription.completed') {
    const transcript = (msg as Record<string, string>).transcript?.trim() ?? ''
    if (deltaBuffer.trim()) commitDelta()
    if (transcript && transcript !== deltaBuffer.trim()) {
      mainWindowRef?.webContents.send('stt:committed', transcript)
    }
    return
  }

  if (msg.type === 'error') {
    const errorMsg =
      ((msg as Record<string, Record<string, string>>).error?.message) ?? 'Unknown OpenAI error'
    mainWindowRef?.webContents.send('stt:error', errorMsg)
  }
}

export function startTranscription(language: string, mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
  stopTranscription()

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    mainWindow.webContents.send('stt:error', 'OPENAI_API_KEY not configured')
    return
  }

  const vocabPrompt = buildVocabularyPrompt(getVocabulary())
  const session = buildTranscriptionSession(OPENAI_TRANSCRIPTION_MODEL, vocabPrompt, language)

  openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  })

  openaiWs.on('open', () => {
    openaiWs?.send(JSON.stringify({ type: 'session.update', session }))
  })

  openaiWs.on('message', (data: Buffer) => {
    handleOpenAiMessage(data.toString())
  })

  openaiWs.on('error', (err: Error) => {
    mainWindowRef?.webContents.send('stt:error', err.message)
  })

  openaiWs.on('close', () => {
    openaiWs = null
    if (deltaBuffer.trim()) commitDelta()
  })
}

export function stopTranscription(): void {
  if (openaiWs) {
    openaiWs.close()
    openaiWs = null
  }
  if (deltaQuietTimer) {
    clearTimeout(deltaQuietTimer)
    deltaQuietTimer = null
  }
  if (deltaBuffer.trim()) commitDelta()
  deltaBuffer = ''
  turnStartMs = 0
}

export function sendAudioChunk(base64Chunk: string): void {
  if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return
  openaiWs.send(
    JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: base64Chunk,
    })
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/sttService.ts
git commit -m "feat: port STT realtime WebSocket service to main process"
```

---

## Task 8: Port whiteboard service to main process (stub)

**Files:**
- Create: `src/main/whiteboardService.ts`

- [ ] **Step 1: Create `src/main/whiteboardService.ts`**

This is a minimal stub that wires the IPC messages. The full gatekeeper/renderer pipeline from `proxy.mjs` (lines 450-600+) is complex. For the initial Electron migration, we create a pass-through stub that stores state and forwards the existing whiteboard pipeline. The full port is deferred to a follow-up task.

```ts
import type { BrowserWindow } from 'electron'

interface WhiteboardState {
  elements: unknown[]
  latestScreenshot: string | null
}

const state: WhiteboardState = {
  elements: [],
  latestScreenshot: null,
}

export function handleUserElements(elements: unknown[], mainWindow: BrowserWindow): void {
  state.elements = elements
  // TODO: Wire into gatekeeper/renderer pipeline (port from proxy.mjs lines 450+)
  // For now, the whiteboard agent pipeline is only available in browser-mode (dev:web)
  void mainWindow
}

export function handleScreenshot(imageDataUrl: string): void {
  state.latestScreenshot = imageDataUrl
}

export function getWhiteboardState(): WhiteboardState {
  return state
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/whiteboardService.ts
git commit -m "feat: stub whiteboard service in main process (full pipeline deferred)"
```

---

## Task 9: Create renderer dual-mode adapter

**Files:**
- Create: `src/renderer/api.ts`
- Modify: `src/renderer/App.tsx` (wire adapter)

- [ ] **Step 1: Create `src/renderer/api.ts`**

```ts
import type { ElectronAPI } from '../preload/types'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

function getElectronAPI(): ElectronAPI {
  if (!window.electronAPI) throw new Error('electronAPI not available')
  return window.electronAPI
}

// ── Translation ──

export async function translate(
  text: string,
  targetLang: string
): Promise<{ translation: string }> {
  if (isElectron) {
    return getElectronAPI().translate(text, targetLang)
  }
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLang }),
  })
  if (!res.ok) throw new Error(`Translation API error: ${res.status}`)
  return (await res.json()) as { translation: string }
}

// ── Vocabulary ──

export async function updateVocabulary(
  keywords: string[]
): Promise<{ count: number }> {
  if (isElectron) {
    return getElectronAPI().updateVocabulary(keywords)
  }
  const res = await fetch('/api/vocabulary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords }),
  })
  return (await res.json()) as { count: number }
}

// ── Health ──

export async function checkHealth(): Promise<{ status: string; ts: number }> {
  if (isElectron) {
    return getElectronAPI().checkHealth()
  }
  const res = await fetch('/api/health')
  return (await res.json()) as { status: string; ts: number }
}

// ── Mode detection ──

export { isElectron }
```

This adapter is used in `App.tsx` to replace direct `fetch('/api/...')` calls. The STT and whiteboard WebSocket paths are more complex and will be wired in a follow-up refactor of `App.tsx` to use IPC in Electron mode.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/api.ts
git commit -m "feat: create dual-mode API adapter for renderer (IPC vs HTTP)"
```

---

## Task 10: Verify end-to-end dual-mode

**Files:**
- Modify: `src/main/index.ts` (ensure dotenv loads before anything)

- [ ] **Step 1: Run `dev:electron` and verify window opens**

```bash
npm run dev:electron
```

Expected: Electron window opens, UI renders, no console errors about missing IPC.

- [ ] **Step 3: Run `dev:web` and verify browser mode still works**

```bash
npm run dev:web
```

Expected: Browser app loads at `http://localhost:5173`, proxy connects, transcription works.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: verify dual-mode dev (electron + web)"
```

---

## Task 11: Configure electron-builder and test packaging

**Files:**
- Modify: `package.json` (ensure `main` field and build scripts are correct)
- Verify: `electron-builder.yml`

- [ ] **Step 1: Test Windows build**

```bash
npm run build:win
```

Expected: `release/` directory contains `AutoMeetic-0.0.0-setup.exe`.

- [ ] **Step 2: Run the built exe**

Launch the generated installer, install, and verify the app opens and renders the UI correctly.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: verify electron-builder packaging for Windows"
```

---

## Summary

| Task | Description | Key files |
|---:|---|---|
| 1 | Install deps, scaffold config | `electron.vite.config.ts`, `electron-builder.yml`, tsconfigs |
| 2 | Move renderer files | `src/renderer/*`, `vite.config.ts` |
| 3 | Preload script + types | `src/preload/index.ts`, `src/preload/types.ts` |
| 4 | Electron main entry | `src/main/index.ts` |
| 5 | IPC handler registration | `src/main/ipc.ts` |
| 6 | Translation/vocabulary/answer-assist port | `src/main/proxyService.ts` |
| 7 | STT service port | `src/main/sttService.ts` |
| 8 | Whiteboard service stub | `src/main/whiteboardService.ts` |
| 9 | Renderer dual-mode adapter | `src/renderer/api.ts` |
| 10 | Fix async IPC + verify | `src/main/ipc.ts` |
| 11 | Packaging test | `electron-builder.yml` |

### Deferred to follow-up specs

- Full whiteboard agent pipeline port (gatekeeper + renderer — Task 8 is a stub)
- `App.tsx` refactor to use `api.ts` adapter for all fetch calls
- `desktopCapturer` audio source selection UI
- Native WASAPI/CoreAudio addon (Phase 2)
- Always-on-top overlay window (Phase 2)
- Auto-updater
- Code signing
