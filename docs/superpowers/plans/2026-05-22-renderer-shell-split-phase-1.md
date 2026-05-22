# Renderer Shell Split Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract stable renderer shell presentation components from `src/renderer/App.tsx` without changing behavior, state stores, IPC adapters, or visual class names.

**Architecture:** Keep `App.tsx` as the owner of state, effects, callbacks, stores, and IPC wiring. Move only JSX presentation blocks into small sibling components under `src/renderer/shell/`, passing all data and callbacks explicitly through props. Preserve existing CSS class names and DOM structure as closely as possible.

**Tech Stack:** React 19, TypeScript, existing Vite/Electron renderer, existing `npm run maintenance:check` verification gate.

---

## File Structure

- Create `src/renderer/shell/SourceBar.tsx`: renders the source/mic/reset/counter bar from the current `App.tsx` source bar block.
- Create `src/renderer/shell/TranscriptColumns.tsx`: renders original and translation transcript columns.
- Create `src/renderer/shell/RightShelf.tsx`: renders the right shelf tabs, whiteboard preview, and action panel wrapper.
- Modify `src/renderer/App.tsx`: import the new shell components, pass existing values/callbacks as props, and remove the moved JSX blocks.

No CSS file should be changed in Phase 1. No state store, IPC adapter, or helper module should be moved in Phase 1.

## Invariant

The renderer shell must keep the same user-visible behavior and class names:

- Source bar still shows system/mic status, reset button, error, caption count, word count, and waveform.
- Transcript columns still render original/translation rows, empty states, timing labels, typing classes, and scroll refs.
- Right shelf still switches between whiteboard and actions, shows tab badges, label language select, whiteboard preview, agent status badges, and action item callbacks.

## Task 1: Extract SourceBar

**Files:**
- Create: `src/renderer/shell/SourceBar.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create `SourceBar.tsx`**

Create `src/renderer/shell/SourceBar.tsx` with this content:

```tsx
import { Waveform } from '../overlay/Waveform'

type SourceBarProps = {
  running: boolean
  analyser: AnalyserNode | null
  error: string | null
  resetConfirming: boolean
  resetSession: () => void
  transcriptCount: number
  sourceWordCount: number
}

export function SourceBar({
  running,
  analyser,
  error,
  resetConfirming,
  resetSession,
  transcriptCount,
  sourceWordCount,
}: SourceBarProps) {
  return (
    <div className="v4p-sourcebar">
      <div className={`v4p-source-cell ${running ? 'on' : ''}`}>
        <svg
          className="v4p-source-icon"
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 4v3h2l2.5 2V2L4 4H2z" />
          <path d="M8 3.5c.7.7 1 1.3 1 2s-.3 1.3-1 2" />
        </svg>
        <span className="v4p-source-name">System</span>
        <span className="v4p-source-app">tab / window audio</span>
        <div className="v4p-source-wave" aria-hidden="true">
          <Waveform analyser={analyser} active={running} />
        </div>
      </div>
      <div className="v4p-source-cell v4p-source-cell-mic">
        <svg
          className="v4p-source-icon"
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          <rect x="4" y="1.5" width="3" height="5.5" rx="1.5" />
          <path d="M2.5 5.5a3 3 0 006 0M5.5 8.5V10" />
        </svg>
        <span className="v4p-source-name">Mic</span>
        <span className="v4p-source-app">disabled</span>
      </div>
      <div className="v4p-source-cell v4p-source-cell-meta">
        {error && <span className="v4p-source-error">{error}</span>}
        <button
          type="button"
          className={`v4p-resetbtn ${resetConfirming ? 'confirming' : ''}`}
          onClick={resetSession}
          title="Reset session"
        >
          {resetConfirming ? 'Confirm reset' : 'Reset'}
        </button>
        <span className="v4p-source-dot">·</span>
        <span className="amw-mono v4p-meta-num">{transcriptCount}</span>
        <span className="v4p-meta-lbl">captions</span>
        <span className="v4p-source-dot">·</span>
        <span className="amw-mono v4p-meta-num">{sourceWordCount}</span>
        <span className="v4p-meta-lbl">words</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace source bar JSX in `App.tsx`**

Add this import near the other renderer imports:

```tsx
import { SourceBar } from './shell/SourceBar'
```

Replace the entire source bar block beginning with:

```tsx
{/* ── Source bar
```

and ending at the closing `</div>` just before:

```tsx
{/* ── Main: columns + shelf
```

with:

```tsx
      {/* ── Source bar ───────────────────────────────────────── */}
      <SourceBar
        running={running}
        analyser={analyser}
        error={error}
        resetConfirming={resetConfirming}
        resetSession={resetSession}
        transcriptCount={transcriptCount}
        sourceWordCount={sourceWordCount}
      />
```

- [ ] **Step 3: Run focused verification**

Run:

```powershell
npm run typecheck
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit Task 1**

Run:

```powershell
git add src/renderer/App.tsx src/renderer/shell/SourceBar.tsx
git commit -m "refactor(renderer): extract source bar"
```

Expected: commit succeeds with only the two listed files.

## Task 2: Extract TranscriptColumns

**Files:**
- Create: `src/renderer/shell/TranscriptColumns.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Inspect the feed item type in `App.tsx`**

Run:

```powershell
rg -n "items =|type .*Feed|displayedSource|displayedTranslation|createdAtMs" src/renderer/App.tsx
```

Expected: identify the local item shape used by the transcript column rendering. Use that exact shape in the new component props.

- [ ] **Step 2: Create `TranscriptColumns.tsx`**

Create `src/renderer/shell/TranscriptColumns.tsx` with this content, adjusting the `TranscriptColumnItem` fields only if Step 1 shows the field names differ:

```tsx
import type { RefObject } from 'react'

export type TranscriptColumnItem = {
  id: string
  createdAtMs: number
  fullSource: string
  displayedSource: string
  fullTranslation: string | null
  displayedTranslation: string
  typing: boolean
}

type TranscriptColumnsProps = {
  items: TranscriptColumnItem[]
  hasFeedContent: boolean
  showTranslationColumn: boolean
  sourceLang: string
  targetLang: string
  languageLock: string | null
  detectedLanguage: string | null
  sessionStartMs: number | null
  enColRef: RefObject<HTMLDivElement | null>
  koColRef: RefObject<HTMLDivElement | null>
  langCode: (code: string) => string
  formatDuration: (ms: number) => string
  languageLabelByCode: Map<string, string>
}

export function TranscriptColumns({
  items,
  hasFeedContent,
  showTranslationColumn,
  sourceLang,
  targetLang,
  languageLock,
  detectedLanguage,
  sessionStartMs,
  enColRef,
  koColRef,
  langCode,
  formatDuration,
  languageLabelByCode,
}: TranscriptColumnsProps) {
  return (
    <section className="v4p-cols">
      <div className="v4p-col">
        <div className="v4p-col-hd">
          <span className="v4p-col-mark">{langCode(sourceLang)}</span>
          <span className="v4p-col-name">
            <em>Original</em>
            {languageLock && <> · {languageLabelByCode.get(languageLock) ?? languageLock}</>}
            {!languageLock && detectedLanguage && (
              <> · detecting {languageLabelByCode.get(detectedLanguage) ?? detectedLanguage}</>
            )}
          </span>
        </div>
        <div className="v4p-col-body amw-scroll" ref={enColRef}>
          <div className="v4p-col-pad">
            {!hasFeedContent && (
              <p className="v4p-empty">
                <em>Idle.</em> Press <kbd>Start</kbd> and share a tab with audio to begin.
              </p>
            )}
            {items.map((item) => (
              <div className="v4p-line" key={`en-${item.id}`}>
                <div className="v4p-line-time amw-mono">
                  {formatDuration(Math.max(item.createdAtMs - (sessionStartMs ?? item.createdAtMs), 0))}
                </div>
                <div
                  className={`v4p-line-text${
                    item.typing && item.displayedSource.length < item.fullSource.length
                      ? ' v4p-line-typing'
                      : ''
                  }`}
                >
                  {item.displayedSource}
                </div>
              </div>
            ))}
            <div className="v4p-trail">· · ·</div>
          </div>
        </div>
      </div>

      {showTranslationColumn && (
        <div className="v4p-col v4p-col-trans">
          <div className="v4p-col-hd">
            <span className="v4p-col-mark v4p-col-mark-alt">{langCode(targetLang)}</span>
            <span className="v4p-col-name">
              <em>Translation</em> · {languageLabelByCode.get(targetLang) ?? targetLang}
            </span>
          </div>
          <div className="v4p-col-body amw-scroll" ref={koColRef}>
            <div className="v4p-col-pad">
              {items.length === 0 && (
                <p className="v4p-empty">
                  <em>Translations appear here.</em>
                </p>
              )}
              {items.map((item) => {
                if (item.fullTranslation === null) return null
                return (
                  <div className="v4p-line" key={`tr-${item.id}`}>
                    <div className="v4p-line-time amw-mono">
                      {formatDuration(
                        Math.max(item.createdAtMs - (sessionStartMs ?? item.createdAtMs), 0)
                      )}
                    </div>
                    <div
                      className={`v4p-line-text${
                        item.typing &&
                        item.displayedTranslation.length < item.fullTranslation.length
                          ? ' v4p-line-typing'
                          : ''
                      }`}
                    >
                      {item.displayedTranslation}
                    </div>
                  </div>
                )
              })}
              <div className="v4p-trail">· · ·</div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Replace transcript columns JSX in `App.tsx`**

Add this import:

```tsx
import { TranscriptColumns } from './shell/TranscriptColumns'
```

Replace the `<section className="v4p-cols">...</section>` block inside `<div className="v4p-main">` with:

```tsx
          <TranscriptColumns
            items={items}
            hasFeedContent={hasFeedContent}
            showTranslationColumn={showTranslationColumn}
            sourceLang={sourceLang}
            targetLang={targetLang}
            languageLock={languageLock}
            detectedLanguage={detectedLanguage}
            sessionStartMs={sessionStartMs}
            enColRef={enColRef}
            koColRef={koColRef}
            langCode={langCode}
            formatDuration={formatDuration}
            languageLabelByCode={LANGUAGE_LABEL_BY_CODE}
          />
```

- [ ] **Step 4: Run focused verification**

Run:

```powershell
npm run typecheck
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add src/renderer/App.tsx src/renderer/shell/TranscriptColumns.tsx
git commit -m "refactor(renderer): extract transcript columns"
```

Expected: commit succeeds with only the two listed files.

## Task 3: Extract RightShelf

**Files:**
- Create: `src/renderer/shell/RightShelf.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create `RightShelf.tsx`**

Create `src/renderer/shell/RightShelf.tsx` with this content:

```tsx
import { ActionItemsPanel } from '../actions/ActionItemsPanel'
import type { ActionItem } from '../actions/types'
import { ExcalidrawCanvas } from '../whiteboard/ExcalidrawCanvas'
import { WhiteboardLabelLangSelect } from '../whiteboard/WhiteboardLabelLangSelect'
import type { WhiteboardElement, ViewportCommand } from '../../main/whiteboard/types'

export type Shelf = 'whiteboard' | 'actions' | 'closed'

type RightShelfProps = {
  shelf: Shelf
  setShelf: (shelf: Shelf) => void
  whiteboardElements: WhiteboardElement[]
  actionItemList: ActionItem[]
  canvasResetVersion: number
  viewportCommand: ViewportCommand | null
  setWhiteboardMaximized: (maximized: boolean) => void
  agentStatus: 'idle' | 'thinking' | 'error'
  acceptActionItem: (id: string) => void
  dismissActionItem: (id: string) => void
  markActionItemDone: (id: string) => void
  updateActionItem: (id: string, patch: Partial<Pick<ActionItem, 'title' | 'owner' | 'due'>>) => void
}

export function RightShelf({
  shelf,
  setShelf,
  whiteboardElements,
  actionItemList,
  canvasResetVersion,
  viewportCommand,
  setWhiteboardMaximized,
  agentStatus,
  acceptActionItem,
  dismissActionItem,
  markActionItemDone,
  updateActionItem,
}: RightShelfProps) {
  if (shelf === 'closed') return null

  return (
    <aside className="v4p-shelf">
      <div className="v4p-shelf-tabs">
        <button
          className={`v4p-shelf-tab ${shelf === 'whiteboard' ? 'on' : ''}`}
          onClick={() => setShelf('whiteboard')}
        >
          Whiteboard
          {whiteboardElements.length > 0 && (
            <span className="v4p-shelf-tab-badge amw-mono">{whiteboardElements.length}</span>
          )}
        </button>
        <button
          className={`v4p-shelf-tab ${shelf === 'actions' ? 'on' : ''}`}
          onClick={() => setShelf('actions')}
        >
          Actions
          {actionItemList.length > 0 && (
            <span className="v4p-shelf-tab-badge amw-mono">{actionItemList.length}</span>
          )}
        </button>
        {shelf === 'whiteboard' && <WhiteboardLabelLangSelect />}
        <button
          className="v4p-shelf-x"
          onClick={() => setShelf('closed')}
          title="Close panel"
          aria-label="Close panel"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            stroke="currentColor"
            strokeWidth="1.3"
            fill="none"
            strokeLinecap="round"
          >
            <path d="M2 2l7 7M9 2l-7 7" />
          </svg>
        </button>
      </div>
      <div className="v4p-shelf-body">
        <div
          className={`v4p-shelf-panel ${shelf === 'whiteboard' ? 'on' : ''}`}
          aria-hidden={shelf !== 'whiteboard'}
        >
          <div className="v4p-wb">
            <ExcalidrawCanvas
              key={`canvas-${canvasResetVersion}`}
              elements={whiteboardElements}
              viewportCommand={viewportCommand}
              compact
              onMaximize={() => setWhiteboardMaximized(true)}
            />
            {whiteboardElements.length === 0 && (
              <div className="v4p-wb-empty">
                <em>Diagram appears here</em> as the agent finds key concepts.
              </div>
            )}
            {agentStatus === 'thinking' && (
              <div className="v4p-wb-badge">
                <span className="v4p-wb-spinner" /> Agent thinking
              </div>
            )}
            {agentStatus === 'error' && <div className="v4p-wb-badge error">Diagram failed</div>}
          </div>
        </div>
        <div
          className={`v4p-shelf-panel ${shelf === 'actions' ? 'on' : ''}`}
          aria-hidden={shelf !== 'actions'}
        >
          <ActionItemsPanel
            items={actionItemList}
            onAccept={acceptActionItem}
            onDismiss={dismissActionItem}
            onDone={markActionItemDone}
            onUpdate={updateActionItem}
          />
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Verify imported types and callback signatures**

Run:

```powershell
rg -n "export type ActionItem|type ActionItem|agentStatus|markActionItemDone|updateActionItem" src/renderer src/preload
```

Expected: confirm whether `ActionItem`, `WhiteboardElement`, `ViewportCommand`, and callback signatures match the new component. If TypeScript reports a mismatch in Step 4, adjust only the prop types in `RightShelf.tsx`; do not change runtime behavior.

- [ ] **Step 3: Replace right shelf JSX in `App.tsx`**

Add this import:

```tsx
import { RightShelf } from './shell/RightShelf'
```

Remove imports that become unused:

```tsx
import { ExcalidrawCanvas } from './whiteboard/ExcalidrawCanvas'
import { WhiteboardLabelLangSelect } from './whiteboard/WhiteboardLabelLangSelect'
```

Replace the `{shelf !== 'closed' && (...)}` right shelf block with:

```tsx
          <RightShelf
            shelf={shelf}
            setShelf={setShelf}
            whiteboardElements={whiteboardElements}
            actionItemList={actionItemList}
            canvasResetVersion={canvasResetVersion}
            viewportCommand={viewportCommand}
            setWhiteboardMaximized={setWhiteboardMaximized}
            agentStatus={agentStatus}
            acceptActionItem={acceptActionItem}
            dismissActionItem={dismissActionItem}
            markActionItemDone={markActionItemDone}
            updateActionItem={updateActionItem}
          />
```

- [ ] **Step 4: Run focused verification**

Run:

```powershell
npm run typecheck
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add src/renderer/App.tsx src/renderer/shell/RightShelf.tsx
git commit -m "refactor(renderer): extract right shelf"
```

Expected: commit succeeds with only the two listed files.

## Task 4: Final Verification And Review

**Files:**
- No new files beyond Tasks 1-3.

- [ ] **Step 1: Run maintenance checklist**

Run:

```powershell
npm run maintenance:check
```

Expected: output includes `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` because renderer files changed. Output may also flag high-risk whiteboard/theme checks because `App.tsx` and whiteboard preview paths are involved.

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Expected:

- `npm run typecheck` exits 0.
- `npm run lint` exits 0.
- `npm test` exits 0.
- `npm run build` exits 0. Existing Vite chunk-size/plugin timing warnings are acceptable if exit code is 0.

- [ ] **Step 3: Inspect diff shape**

Run:

```powershell
git diff --stat HEAD~3..HEAD
```

Expected:

- `src/renderer/App.tsx` shrinks.
- `src/renderer/shell/SourceBar.tsx`, `TranscriptColumns.tsx`, and `RightShelf.tsx` are new.
- No CSS, IPC, store, main-process, or package files changed.

- [ ] **Step 4: Request final code review**

Ask a reviewer to inspect the range from before Task 1 to HEAD. Review focus:

- Behavior-preserving extraction.
- Prop signatures and type imports.
- No state ownership moved out of `App.tsx`.
- DOM/className structure is preserved closely enough to avoid CSS regressions.

If the reviewer finds Critical or Important issues, fix them before completion.

## Self-Review

- Spec coverage: This plan implements only Track 1, Renderer Shell Split Phase 1, as requested by the codebase refactor design.
- Scope check: CSS split, whiteboard service split, duplicate cleanup, and server proxy decomposition are intentionally out of scope for this implementation slice.
- Placeholder scan: No placeholders remain. Each task names exact files, expected code shape, commands, and commits.
- Type consistency: `SourceBar`, `TranscriptColumns`, and `RightShelf` are imported from `src/renderer/shell/*`; `App.tsx` remains state owner.
