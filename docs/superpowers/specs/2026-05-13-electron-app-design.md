# autoMeetic Electron App Design

**Date:** 2026-05-13
**Status:** Draft
**Scope:** Migrate autoMeetic from browser-based Vite+React app to Electron desktop application

---

## 1. Goals

1. **Native audio capture** — Replace `getDisplayMedia` prompts with `desktopCapturer` (Phase 1), later WASAPI/CoreAudio native addon (Phase 2)
2. **Distribution** — Users install `.exe` (Windows) / `.dmg` (macOS) and run without setting up Node.js or a dev server
3. **System integration** — System tray, global hotkeys, always-on-top overlay capability
4. **Server bundling** — Embed `proxy.mjs` logic in Electron main process; no separate server required
5. **Dual-mode** — Keep browser-mode development viable alongside Electron mode

**Target platforms:** Windows (primary), macOS (secondary)

---

## 2. Toolchain

| Role | Tool |
|---|---|
| Build orchestrator | `electron-vite` — unified Vite config for main/preload/renderer |
| Packaging & installers | `electron-builder` — NSIS (Windows), DMG (macOS) |
| Renderer framework | React + Vite (existing) |
| IPC bridge | Electron `contextBridge` + `ipcMain`/`ipcRenderer` |

**Why electron-vite:**
- Minimal migration — existing `src/` structure maps directly to renderer
- Single `electron.vite.config.ts` for 3 build targets
- HMR for both main and renderer processes
- Project structure change is additive, not destructive

**Why not Tauri:** `proxy.mjs` (Express + WebSocket + OpenAI streaming) would need full Rust rewrite. Cost too high at this stage.

**Why not Electron Forge:** More opinionated structure, wraps Vite config in Forge's abstraction. `electron-vite` + `electron-builder` gives more control with less migration friction.

---

## 3. Project Structure

```
autoMeetic/
├── src/
│   ├── main/                    ← Electron main process
│   │   ├── index.ts             ← App entry: BrowserWindow, tray, shortcuts
│   │   ├── proxy.ts             ← proxy.mjs logic ported to TS
│   │   ├── whiteboard-runtime.ts ← whiteboard-runtime.mjs → TS
│   │   ├── audio/               ← Existing (capture.ts, types.ts)
│   │   ├── health/              ← Existing (pipelineHealth.ts)
│   │   ├── stt/                 ← Existing (realtimeClient.ts, transcriptBus.ts, types.ts)
│   │   ├── telemetry/           ← Existing (logger.ts)
│   │   ├── translate/           ← Existing (queue.ts, translator.ts)
│   │   └── whiteboard/          ← Existing (elements.ts, keywords.ts, etc.)
│   ├── preload/                 ← Electron preload script
│   │   ├── index.ts             ← contextBridge: expose IPC to renderer
│   │   └── types.ts             ← ElectronAPI type definitions
│   └── renderer/                ← Web UI (moved from src/)
│       ├── App.tsx
│       ├── App.css
│       ├── main.tsx
│       ├── index.css
│       ├── index.html           ← Moved from project root
│       ├── assets/
│       ├── overlay/             ← CaptionOverlay, Waveform, useCaptionStore
│       ├── whiteboard/          ← ExcalidrawCanvas
│       └── answer-assist/       ← AnswerAssistCard, useAnswerAssistStore
├── server/                      ← Retained for browser-mode dev
│   ├── proxy.mjs
│   └── whiteboard-runtime.mjs
├── electron.vite.config.ts      ← NEW: 3-target build config
├── electron-builder.yml         ← NEW: packaging config
├── package.json                 ← Updated: main field, new scripts
└── ...
```

### Key decisions:
- `src/main/` folder absorbs existing `src/main/*` subdirectories (audio, stt, etc.) plus new Electron entry point and ported server logic
- **Environment split:** Some existing `src/main/` modules currently run in the browser but will move to different execution contexts:
  - `audio/capture.ts` — stays in **renderer** (uses Web Audio API / desktopCapturer), sends chunks via IPC
  - `stt/realtimeClient.ts` — moves to **main process** (manages OpenAI WebSocket directly, no browser WS proxy needed)
  - `stt/transcriptBus.ts` — stays in **renderer** (drives UI updates)
  - `translate/` — moves to **main process** (makes OpenAI HTTP calls)
  - `whiteboard/` — split: `session.ts`/`prompt.ts`/`tools.ts` move to main, `elements.ts` shared
  - `health/`, `telemetry/` — duplicated or shared as needed
- `server/` directory is **not deleted** — enables `npm run dev:web` for browser-only development
- `index.html` moves to `src/renderer/index.html` to follow electron-vite conventions

---

## 4. IPC Communication

### Channel mapping (HTTP/WS → IPC)

| Current (browser mode) | Electron IPC |
|---|---|
| `POST /api/translate` | `invoke('translate', {text, targetLang})` |
| `POST /api/answer-assist` (SSE stream) | `invoke('start-answer-assist', {transcript, lang})` + `on('answer-assist:event')` |
| `POST /api/vocabulary` | `invoke('update-vocabulary', {keywords})` |
| `GET /api/health` | `invoke('check-health')` |
| `ws://.../api/ws/transcribe` | `send('start-transcription', {language})` / `send('send-audio', {chunk})` / `on('stt:partial')` / `on('stt:committed')` |
| `ws://.../api/ws/whiteboard` | `send('whiteboard:user-elements', {elements})` / `on('whiteboard:update')` / `on('whiteboard:viewport')` / `on('whiteboard:agent-status')` |

### Preload API surface (`window.electronAPI`)

```ts
interface ElectronAPI {
  // Actions (invoke → main process handles, returns result)
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

  // Events (main → renderer notifications)
  onSttPartial(callback: (text: string) => void): () => void
  onSttCommitted(callback: (text: string) => void): () => void
  onSttError(callback: (message: string) => void): () => void
  onWhiteboardUpdate(callback: (elements: unknown[]) => void): () => void
  onWhiteboardViewport(callback: (cmd: unknown) => void): () => void
  onWhiteboardAgentStatus(callback: (status: string) => void): () => void
  onAnswerAssistEvent(callback: (event: unknown) => void): () => void
}
```

### Dual-mode renderer pattern

```ts
const isElectron = typeof window !== 'undefined' && !!window.electronAPI
```

Renderer code checks `isElectron` to decide between IPC calls and HTTP/WS fetch. A thin adapter layer (`src/renderer/api.ts`) abstracts this so components don't branch directly.

### IPC conventions

See `.instructions/ipc.instructions.md` for naming rules:
- Actions: present-tense verbs, kebab-case (`start-transcription`, `update-vocabulary`)
- Events: present-tense, kebab-case (`stt:partial`, `whiteboard:update`)
- Preload: camelCase actions, camelCase `on`-prefixed events
- No file paths in IPC parameters

---

## 5. Audio Capture Strategy

### Phase 1 — `desktopCapturer` (initial release)

- Use Electron's `desktopCapturer.getSources()` to enumerate audio sources
- Renderer calls `navigator.mediaDevices.getUserMedia` with `chromeMediaSourceId` — **no user prompt**
- Existing `capture.ts` resampling/PCM logic reused as-is in renderer
- Audio chunks sent to main process via IPC → main process streams to OpenAI Realtime WebSocket
- System tray menu shows audio source selector

### Phase 2 — Native addon (future, separate spec)

- Windows: WASAPI loopback capture via C++ native addon (`node-gyp`)
- macOS: CoreAudio / ScreenCaptureKit
- Removes `desktopCapturer` dependency entirely
- Runs in main process; no renderer involvement for audio

### Audio data flow (Phase 1)

```
[Renderer] desktopCapturer → AudioContext → resample 24kHz → PCM16 base64
    ↓ IPC send('send-audio', chunk)
[Main Process] → OpenAI Realtime WebSocket
    ↓ transcript events
[Main Process] IPC send → [Renderer] onSttPartial / onSttCommitted
```

---

## 6. System Integration

### System tray
- App starts with tray icon
- Tray menu: Start/Stop capture, Audio source, Language, Show/Hide window, Quit
- Window close (X) minimizes to tray instead of quitting

### Global hotkeys (`globalShortcut`)
- Toggle capture: `Ctrl+Shift+M` (configurable)
- Toggle overlay: `Ctrl+Shift+O` (configurable)

### Always-on-top caption overlay
- Phase 1: Caption overlay stays within main BrowserWindow
- Phase 2 (future): Separate frameless `BrowserWindow` with `alwaysOnTop: true`, transparent background, click-through (`setIgnoreMouseEvents`)

### API key storage
- `.env` file with `dotenv/config` — same as current approach
- Development: `.env` in project root
- Packaged app: `.env` in app's user data directory (`app.getPath('userData')`)
- No keychain integration for now (YAGNI)

---

## 7. Packaging & Distribution

### electron-builder configuration

```yaml
appId: com.automeetic.app
productName: AutoMeetic
directories:
  buildResources: build
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
asarUnpack:
  - resources/**
win:
  target: nsis
  executableName: AutoMeetic
nsis:
  artifactName: ${name}-${version}-setup.${ext}
  shortcutName: AutoMeetic
mac:
  target: dmg
dmg:
  artifactName: ${name}-${version}.${ext}
```

### Included in package
- Electron runtime + Chromium
- Built main/preload/renderer code (from `out/`)
- Moonshine sidecar binaries (platform-specific, in `resources/`)
- `.env.example` template

### Excluded from package
- `src/`, `server/`, `harness/`, `docs/`, `scripts/`
- devDependencies
- `.env` (user creates their own)

### Scripts

```json
{
  "dev:electron": "electron-vite dev",
  "dev:web": "concurrently -n proxy,vite \"npm run server\" \"npm run dev:ui\"",
  "build:electron": "electron-vite build",
  "build:win": "electron-vite build && electron-builder --win",
  "build:mac": "electron-vite build && electron-builder --mac",
  "preview:electron": "electron-vite preview"
}
```

---

## 8. Migration Path

Implementation should be incremental — the app must remain functional in browser mode throughout.

### Step 1: Scaffold Electron shell
- Install `electron`, `electron-vite`, `electron-builder`
- Create `electron.vite.config.ts`
- Create `src/main/index.ts` (minimal BrowserWindow loading renderer)
- Create `src/preload/index.ts` (empty bridge)
- Move `index.html` to `src/renderer/index.html`
- Move renderer files to `src/renderer/`
- Verify `npm run dev:electron` opens the existing UI

### Step 2: Port server to main process
- Port `proxy.mjs` → `src/main/proxy.ts`
- Port `whiteboard-runtime.mjs` → `src/main/whiteboard-runtime.ts`
- Wire IPC handlers in main process
- Build preload API surface
- Create renderer adapter (`src/renderer/api.ts`) with dual-mode support

### Step 3: Audio integration
- Implement `desktopCapturer` source selection
- Wire audio IPC channel
- Verify end-to-end: audio capture → transcription → caption display

### Step 4: System integration
- System tray with menu
- Global hotkeys
- Close-to-tray behavior

### Step 5: Packaging
- Configure `electron-builder.yml`
- Test Windows NSIS build
- Test macOS DMG build
- `.env` handling for packaged mode

---

## 9. Out of Scope

- Native WASAPI/CoreAudio addon (Phase 2, separate spec)
- Separate always-on-top overlay window (Phase 2)
- Auto-updater (`electron-updater`)
- Code signing (requires developer certificates)
- Linux support
- Settings UI for API key (`.env` is sufficient)
- Slack huddle detection integration
