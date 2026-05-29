# Slack Huddle Detection — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Checkbox (`- [ ]`) tracking. Phase-by-phase. Each phase ends with a clean `npm run verify:phase <N>` before the table in `HANDOFF.md` is updated. Read `HANDOFF.md` and `AGENTS.md` first for environment quirks (Windows better-sqlite3 ABI shim + `EBUSY` `npm test`). Capture/STT is renderer-orchestrated; Slack detection + tokens live in main. Manual Slack smoke is deferred to the user.

**Goal:** Add a Slack connection (encrypted token storage) + a "Huddle Arm" mode. Arm shares an audio source once (`getDisplayMedia` gesture) and opens a Socket Mode WebSocket for `user_huddle_changed`. The authenticated user's huddle start → auto-begin transcription on the held stream; huddle end → auto-finalize. v1 = detection + auto-capture only (no participant labels).

**Architecture:** `src/main/slack/` owns tokens (`safeStorage`), a pure transition classifier, and a Socket Mode detector. IPC bridges to the renderer, which owns the capture stream + session: it does the one-time share on Arm and runs its existing begin/end-session logic on `huddle-started`/`huddle-ended` IPC events. Hard constraint: `getDisplayMedia` needs a user gesture, so Arm (not detection) performs the share.

**Tech stack:** TypeScript strict (no `any`), Electron `safeStorage`, `@slack/socket-mode`, `fetch` for `auth.test`, vitest.

**Spec:** `docs/superpowers/specs/2026-05-28-slack-huddle-detection-design.md`

**Scope reminder (do NOT exceed):** No participant correlation/speaker labels. No OAuth install flow (manual token paste). No auto member-ID detection. No other meeting apps. No Slack messaging. No VAD fallback. No multi-workspace. One Slack connection. Reuse the renderer's existing begin/end-session logic — don't duplicate it.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `@slack/socket-mode` |
| `src/main/slack/types.ts` | Create | Tokens / status / event / transition types |
| `src/main/slack/huddleTransition.ts` | Create | Pure `classifyHuddleTransition` |
| `src/main/slack/slackTokens.ts` | Create | `safeStorage` save/load/clear + `auth.test` |
| `src/main/slack/slackHuddleDetector.ts` | Create | Socket Mode shell + transition dispatch + status |
| `src/main/ipc.ts` | Modify | Slack IPC handlers + status/huddle events |
| `src/preload/index.ts` | Modify | `slack` bridge |
| `src/preload/types.ts` | Modify | Slack API types |
| `src/renderer/slack/SlackSettingsPanel.tsx` | Create | Token + member-ID inputs, test, save/clear |
| `src/renderer/slack/useSlackArm.ts` | Create | Arm state + share + huddle event handling |
| `src/renderer/App.tsx` | Modify | Mount Arm toggle + status + settings panel; wire huddle events to existing begin/end session |
| `src/renderer/App.css` | Modify | Styles |
| `src/test/slack-huddle-transition.test.ts` | Create | Pure transition tests |
| `src/test/slack-tokens.test.ts` | Create | Token store + auth.test tests |
| `src/test/slack-detector.test.ts` | Create | Detector shell w/ fake transport |
| `HANDOFF.md` | Modify | New active stream block + status table |

---

## Phase 1 — Tokens + pure transition classifier (TDD)

### Task 1.1 — Add dependency

```bash
npm install @slack/socket-mode
npm ls @slack/socket-mode
git add package.json package-lock.json
git commit -m "chore(slack): add @slack/socket-mode dependency"
```

### Task 1.2 — Types

**Files:** `src/main/slack/types.ts`

```ts
export interface SlackTokens {
  appToken: string   // xapp-...
  botToken: string   // xoxb-...
  memberId: string   // Uxxxxxxxx (the human's Slack member ID)
}

export type SlackConnectionState =
  | 'not-connected'
  | 'connected'
  | 'listening'
  | 'transcribing'
  | 'reconnecting'
  | 'error'

export interface SlackStatus {
  state: SlackConnectionState
  detail?: string
}

export interface UserHuddleChangedEvent {
  type: 'user_huddle_changed'
  user: {
    id: string
    profile?: {
      huddle_state?: string
      huddle_state_call_id?: string
    }
  }
}

export interface HuddleTransition {
  kind: 'started' | 'ended' | 'none'
  callId?: string
  nextInHuddle: boolean
}
```

```bash
npm run typecheck
git add src/main/slack/types.ts
git commit -m "feat(slack): add slack module types"
```

### Task 1.3 — Pure transition classifier (TDD)

**Files:** `src/main/slack/huddleTransition.ts`, `src/test/slack-huddle-transition.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { classifyHuddleTransition } from '../main/slack/huddleTransition'
import type { UserHuddleChangedEvent } from '../main/slack/types'

const ME = 'U_ME'
const ev = (id: string, huddle_state?: string, callId?: string): UserHuddleChangedEvent => ({
  type: 'user_huddle_changed',
  user: { id, profile: { huddle_state, huddle_state_call_id: callId } },
})

describe('classifyHuddleTransition', () => {
  it('started: my user enters in_a_huddle from not-in', () => {
    const r = classifyHuddleTransition(false, ev(ME, 'in_a_huddle', 'C1'), ME)
    expect(r.kind).toBe('started')
    expect(r.callId).toBe('C1')
    expect(r.nextInHuddle).toBe(true)
  })

  it('ended: my user leaves (huddle_state cleared)', () => {
    const r = classifyHuddleTransition(true, ev(ME, ''), ME)
    expect(r.kind).toBe('ended')
    expect(r.nextInHuddle).toBe(false)
  })

  it('none: event for a different user is ignored', () => {
    const r = classifyHuddleTransition(false, ev('U_OTHER', 'in_a_huddle'), ME)
    expect(r.kind).toBe('none')
    expect(r.nextInHuddle).toBe(false) // my state unchanged
  })

  it('none: repeated in_a_huddle (no transition)', () => {
    const r = classifyHuddleTransition(true, ev(ME, 'in_a_huddle', 'C1'), ME)
    expect(r.kind).toBe('none')
    expect(r.nextInHuddle).toBe(true)
  })

  it('none: repeated not-in-huddle', () => {
    const r = classifyHuddleTransition(false, ev(ME, ''), ME)
    expect(r.kind).toBe('none')
    expect(r.nextInHuddle).toBe(false)
  })

  it('handles missing profile gracefully (treated as not in huddle)', () => {
    const r = classifyHuddleTransition(true, { type: 'user_huddle_changed', user: { id: ME } }, ME)
    expect(r.kind).toBe('ended')
    expect(r.nextInHuddle).toBe(false)
  })
})
```

- [ ] **Step 2: Implement**

```ts
import type { HuddleTransition, UserHuddleChangedEvent } from './types'

export function classifyHuddleTransition(
  prevInHuddle: boolean,
  event: UserHuddleChangedEvent,
  myMemberId: string
): HuddleTransition {
  if (event.user.id !== myMemberId) {
    return { kind: 'none', nextInHuddle: prevInHuddle }
  }
  const inHuddle = event.user.profile?.huddle_state === 'in_a_huddle'
  if (inHuddle && !prevInHuddle) {
    return { kind: 'started', callId: event.user.profile?.huddle_state_call_id, nextInHuddle: true }
  }
  if (!inHuddle && prevInHuddle) {
    return { kind: 'ended', nextInHuddle: false }
  }
  return { kind: 'none', nextInHuddle: inHuddle }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/test/slack-huddle-transition.test.ts
npm run typecheck
npm run lint
git add src/main/slack/huddleTransition.ts src/test/slack-huddle-transition.test.ts
git commit -m "feat(slack): pure huddle transition classifier"
```

### Task 1.4 — Token store + auth.test (TDD)

**Files:** `src/main/slack/slackTokens.ts`, `src/test/slack-tokens.test.ts`

- [ ] **Step 1: Write failing tests** — inject the cipher + fetch so `safeStorage`/network aren't needed:

```ts
import { describe, expect, it, vi } from 'vitest'
import { makeTokenStore, testConnection } from '../main/slack/slackTokens'

function memoryCipher() {
  let blob: string | null = null
  return {
    available: true,
    encrypt: (s: string) => Buffer.from(`enc:${s}`),
    decrypt: (b: Buffer) => b.toString().replace(/^enc:/, ''),
    read: () => blob,
    write: (b: string) => { blob = b },
    remove: () => { blob = null },
  }
}

describe('token store', () => {
  it('save → load round-trips', () => {
    const store = makeTokenStore(memoryCipher())
    store.save({ appToken: 'xapp-1', botToken: 'xoxb-1', memberId: 'U1' })
    expect(store.load()).toEqual({ appToken: 'xapp-1', botToken: 'xoxb-1', memberId: 'U1' })
  })
  it('clear removes', () => {
    const c = memoryCipher()
    const store = makeTokenStore(c)
    store.save({ appToken: 'a', botToken: 'b', memberId: 'U1' })
    store.clear()
    expect(store.load()).toBeNull()
  })
  it('load returns null when encryption unavailable', () => {
    const store = makeTokenStore({ ...memoryCipher(), available: false })
    expect(store.load()).toBeNull()
  })
})

describe('testConnection', () => {
  it('returns ok with team/user on success', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, team: 'T', user: 'bot' }) })
    expect(await testConnection('xoxb-1', fetchFn as never)).toEqual({ ok: true, team: 'T', user: 'bot' })
  })
  it('returns error on ok:false', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ json: async () => ({ ok: false, error: 'invalid_auth' }) })
    const r = await testConnection('xoxb-bad', fetchFn as never)
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Implement** `slackTokens.ts` with a `makeTokenStore(cipher)` factory (production passes a `safeStorage`-backed cipher reading/writing `userData/slack-tokens.enc`) and `testConnection(botToken, fetchFn = fetch)` POSTing to `https://slack.com/api/auth.test`. Production helper `loadTokenStore()` wires `safeStorage` + the userData file path; guard `safeStorage.isEncryptionAvailable()`.

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/test/slack-tokens.test.ts
npm run typecheck
npm run lint
git add src/main/slack/slackTokens.ts src/test/slack-tokens.test.ts
git commit -m "feat(slack): encrypted token store + auth.test connection check"
```

### Task 1.5 — Verify Phase 1

```bash
npm run verify:phase 1
```

Update `HANDOFF.md` Phase 1 row.

---

## Phase 2 — Socket Mode detector (TDD)

### Task 2.1 — Detector shell with injectable transport (TDD)

**Files:** `src/main/slack/slackHuddleDetector.ts`, `src/test/slack-detector.test.ts`

- [ ] **Step 1: Design for testability** — the detector takes a `transport` abstraction so tests feed events without a real socket:

```ts
export interface HuddleTransport {
  connect(): Promise<void>
  disconnect(): Promise<void>
  onEvent(handler: (event: UserHuddleChangedEvent) => void): void
  onStatus(handler: (status: SlackStatus) => void): void
}
```

Production transport wraps `@slack/socket-mode`'s `SocketModeClient` (constructed with the app-level token), listening for the `user_huddle_changed` slack event and forwarding `payload.event`. The client auto-ACKs and auto-reconnects; map its `connecting`/`connected`/`disconnected` events to `SlackStatus`.

- [ ] **Step 2: Write failing tests** with a fake transport that lets the test emit events + status, asserting `onTransition('started'|'ended')` fires correctly and `prevInHuddle` is tracked across events.

- [ ] **Step 3: Implement** `createHuddleDetector({ transport, memberId, onTransition, onStatus })` with `start()/stop()`. It holds `prevInHuddle`, runs each event through `classifyHuddleTransition`, updates `prevInHuddle = result.nextInHuddle`, and calls `onTransition` for `started`/`ended`.

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/test/slack-detector.test.ts
npm run typecheck
npm run lint
git add src/main/slack/slackHuddleDetector.ts src/test/slack-detector.test.ts
git commit -m "feat(slack): Socket Mode huddle detector (injectable transport)"
```

### Task 2.2 — Verify Phase 2

```bash
npm run verify:phase 2
```

Update `HANDOFF.md` Phase 2 row.

---

## Phase 3 — IPC + preload + renderer (Arm orchestration + UI)

### Task 3.1 — IPC handlers + preload bridge

**Files:** `src/main/ipc.ts`, `src/preload/index.ts`, `src/preload/types.ts`

- [ ] Register: `slack:save-tokens`, `slack:load-status` (returns `{ hasTokens, memberId }` — never raw tokens), `slack:test`, `slack:clear-tokens`, `slack:arm`, `slack:disarm`.
- [ ] `slack:arm` loads tokens, builds the production transport + detector, starts it; `onTransition` → `mainWindow.webContents.send('slack:huddle-started'|'slack:huddle-ended')`; `onStatus` → `send('slack:status', status)`. `slack:disarm` stops the detector.
- [ ] Preload bridge `window.electronAPI.slack.{ saveTokens, loadStatus, test, clearTokens, arm, disarm, onHuddleStarted, onHuddleEnded, onStatus }` + types.

```bash
npm run typecheck && npm run lint
git add src/main/ipc.ts src/preload/index.ts src/preload/types.ts
git commit -m "feat(slack): IPC handlers + preload bridge for arm/detect/status"
```

### Task 3.2 — Renderer Arm orchestration

**Files:** `src/renderer/slack/useSlackArm.ts`, `src/renderer/App.tsx`

- [ ] **Step 1: Find the existing begin/end-session logic** in `App.tsx` (whatever the manual Start/Stop button invokes — capture start + beginMeeting + STT). Extract it into callables if not already, so both the button and huddle events use the same path. Do NOT duplicate.
- [ ] **Step 2: `useSlackArm.ts`** — exposes `{ armed, status, arm(), disarm() }`:
  - `arm()`: `await capture.start()` (the `getDisplayMedia` gesture) → `electronAPI.slack.arm()`.
  - `disarm()`: `capture.stop()` + `electronAPI.slack.disarm()`.
  - Subscribes to `onHuddleStarted` → call the shared begin-session fn (guard: skip if a session is already active); `onHuddleEnded` → shared end-session fn (guard: skip if none).
  - Subscribes to `onStatus` → expose status.
  - Handles capture `track.onended` → `disarm()` + surface "Arm released."
- [ ] **Step 3: Mount the Arm toggle + status** in the shell near existing capture controls.

```bash
npm run typecheck && npm run lint && npx vitest run
git add src/renderer/slack/useSlackArm.ts src/renderer/App.tsx
git commit -m "feat(slack): renderer Arm orchestration (share + huddle-driven session)"
```

### Task 3.3 — Slack settings panel + styles

**Files:** `src/renderer/slack/SlackSettingsPanel.tsx`, `src/renderer/App.tsx`, `src/renderer/App.css`

- [ ] Panel: masked inputs for app token / bot token / member ID; "Test connection" (→ `slack.test`, show result); "Save" (→ `slack.saveTokens`); "Clear". On open, `slack.loadStatus()` to show `hasTokens` + memberId (never raw tokens).
- [ ] Mount a settings entry point (near Glossary/Library buttons). Add styles.
- [ ] i18n: use `t(...)` keys consistent with the i18n stream already shipped (add keys to all 4 locale files; parity test must stay green).

```bash
npm run typecheck && npm run lint && npx vitest run
git add src/renderer/slack/SlackSettingsPanel.tsx src/renderer/App.tsx src/renderer/App.css src/renderer/i18n/locales/
git commit -m "feat(slack): settings panel (tokens + member id + test) with i18n"
```

### Task 3.4 — Verify Phase 3

```bash
npm run verify:phase 3
npm run build
```

Update `HANDOFF.md` Phase 3 row.

---

## Phase 4 — Regression + handoff + push

### Task 4.1 — Full regression

```bash
npm run verify
npm run build
```

- i18n locale parity test green (new Slack keys in all 4 files).
- Document Windows `EBUSY` if `npm test` blocked. Preexisting `tsc -b` issue not this stream's concern.

### Task 4.2 — Update `HANDOFF.md` + onboarding doc

- [ ] Move prior streams to Completed if needed; new "Next active stream" block + status table.
- [ ] Add an onboarding note (in HANDOFF or a short doc) with the **Slack app manifest essentials**: scopes `users:read`; Socket Mode enabled; event subscription `user_huddle_changed`; app-level token with `connections:write`. So the user can reproduce the setup.

### Task 4.3 — Manual smoke (deferred to user, requires real Slack)

Document the spec's smoke checklist (create app → tokens → test → arm → start huddle → auto-transcribe → end → summary → coworker does NOT trigger → reconnect).

### Task 4.4 — Push

```bash
git push origin master
```

Mark Phase 4 ✅ COMPLETE in `HANDOFF.md`.

---

## Self-review checklist

- [ ] All 4 phases ✅ COMPLETE in `HANDOFF.md` with verbatim verify output.
- [ ] Tokens stored only via `safeStorage`; renderer never receives raw tokens; logs redact tokens.
- [ ] `classifyHuddleTransition` filters strictly to the configured member ID (tested).
- [ ] Arm performs the one `getDisplayMedia` gesture; detection only toggles transcription.
- [ ] Renderer reuses existing begin/end-session logic (no duplication); double-start guarded.
- [ ] Socket reconnect surfaces status; `track.onended` re-prompts.
- [ ] i18n parity test green with new Slack keys.
- [ ] No deviation from spec's "In scope" / "Out of scope".

## Open questions (deferred to v2)

- Participant correlation (`huddle_state_call_id`) → speaker labels
- OAuth install flow (replace manual token paste)
- Auto member-ID detection (user token + `auth.test`)
- Current-huddle query on connect (`users.info`) for the "armed while already in a huddle" case
- Other meeting apps (Zoom / Meet / Teams)
- Multi-workspace
- VAD fallback when Slack not connected
