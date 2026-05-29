# Slack Huddle Detection — Auto-Capture on Huddle Start — Design Spec

**Date:** 2026-05-28
**Status:** Draft — pending implementation
**Stream type:** Net-new feature (first external meeting-app integration)
**Related:** First entry in a planned "meeting-app compatibility" line (Slack first, others later). Independent of the Pipeline Orchestration stream (also dated 2026-05-28) — no dependency between them.

## One-line

Add a Slack connection (one-time token setup, stored encrypted via Electron `safeStorage`) and a **"Huddle Arm"** mode. Arming shares an audio source once (the required `getDisplayMedia` gesture) and opens a Slack **Socket Mode** WebSocket that listens for `user_huddle_changed`. When the authenticated user enters a huddle, autoMeetic auto-begins a transcription session on the already-held stream; when the huddle ends, it auto-finalizes. v1 detects start/end and auto-captures; participant correlation / speaker labels are deferred to v2.

## Why this stream

autoMeetic already transcribes Slack Huddles — it is a "bot-free" assistant that captures system/tab audio via `getDisplayMedia`, so it works where bot-based assistants (Otter etc.) can't reliably join Huddles. The gap is **manual start**: the user must notice a Huddle began, click into autoMeetic, share the source, and press Start. The goal is to remove that friction — arm once, and let autoMeetic start/stop transcription automatically as Huddles come and go.

Research (validated against `docs.slack.dev/reference/events/user_huddle_changed`) confirmed the official, bot-free detection path:
- `user_huddle_changed` is **Events-API compatible** ("Compatible APIs: Events, RTM") → deliverable over **Socket Mode** (a WebSocket the desktop app opens outbound — no public URL/backend needed).
- Required scope is just **`users:read`**.
- Payload carries per-user huddle state: `huddle_state: "in_a_huddle"`, `huddle_state_expiration_ts`, `huddle_state_call_id`. It is per-user (identical to `user_change`), not a single "huddle started" event — so we filter to the authenticated user's own member ID.

A hard platform constraint shapes the whole design: **`getDisplayMedia` requires a user gesture and shows an OS picker** — autoMeetic cannot silently begin capturing system audio the instant a Huddle is detected. Therefore "Arm" performs the one-time share, holds the stream, and Huddle detection only toggles transcription on/off over that held stream.

## Success criteria

1. **One-time Slack setup:** A Slack settings panel accepts an app-level token (`xapp-…`), a bot token (`xoxb-…`), and the user's Slack member ID. "Test connection" calls `auth.test` and shows success/failure. Tokens persist encrypted (`safeStorage`) across restarts and are never written to logs.
2. **Arm flow:** Toggling "Huddle Arm" on triggers the `getDisplayMedia` picker once (user shares Slack window or system audio), then shows "Listening — will auto-start on Huddle." The Socket Mode connection is established.
3. **Auto-start on Huddle:** When the authenticated user joins a Huddle (their `user_huddle_changed` shows `huddle_state: "in_a_huddle"`), autoMeetic begins a meeting + transcription on the held stream within ~2 s, exactly as if Start were pressed.
4. **Auto-stop on Huddle end:** When the user leaves the Huddle (`huddle_state` clears), autoMeetic ends the meeting (existing end-of-meeting flow: summary etc.) and returns to "Listening," keeping the shared stream for the next Huddle.
5. **Member-ID filtering:** A coworker joining a Huddle (a different `user.id`) does NOT trigger autoMeetic. Only the configured member ID does.
6. **Reconnect resilience:** If the Socket Mode WebSocket drops, the detector reconnects automatically; status reflects `connected` / `reconnecting` / `error`.
7. **Disarm:** Toggling off stops capture (`capture.stop()`) and closes the socket.
8. **No interference with manual flow:** Manual Start/Stop still works. If a meeting is already active when a Huddle-start fires, the detector does not start a second one (idempotent guard).
9. **Status visibility:** UI shows `not connected` / `connected` / `listening (armed)` / `transcribing huddle` / `error`.
10. **No regression:** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` clean. Existing capture/STT/meeting flows unchanged when the feature is unused.

## In scope

### Slack module (main process) — `src/main/slack/`

- `types.ts` — `SlackTokens { appToken; botToken; memberId }`, `SlackStatus`, `HuddleTransition`, `UserHuddleChangedEvent`.
- `slackTokens.ts` — encrypted token storage:
  - `saveTokens(tokens)` → `safeStorage.encryptString(JSON.stringify(tokens))` written to `userData/slack-tokens.enc` (base64). Guard on `safeStorage.isEncryptionAvailable()`.
  - `loadTokens()` → decrypt, parse; returns null if absent/undecryptable.
  - `clearTokens()`.
  - `testConnection(botToken)` → POST `https://slack.com/api/auth.test` with the bot token; returns `{ ok, team, user }` or an error.
- `huddleTransition.ts` — **pure** transition classifier (the testable core):
  - `classifyHuddleTransition(prevInHuddle: boolean, event: UserHuddleChangedEvent, myMemberId: string): { kind: 'started' | 'ended' | 'none'; callId?: string; nextInHuddle: boolean }`.
  - Returns `started` when `event.user.id === myMemberId` and the user transitions into `in_a_huddle`; `ended` on the reverse transition; `none` otherwise (including events for other users).
- `slackHuddleDetector.ts` — Socket Mode shell:
  - `start(tokens, onTransition)`: opens a Socket Mode connection (via `@slack/socket-mode`, using the app-level token), subscribes to `user_huddle_changed`, ACKs envelopes, feeds each event through `classifyHuddleTransition`, and calls `onTransition` for `started` / `ended`. Tracks `prevInHuddle`.
  - `stop()`: disconnects.
  - Auto-reconnect handled by `@slack/socket-mode`; surface connection status via a callback.

### Dependency

- Add `@slack/socket-mode` (official; handles the `apps.connections.open` handshake, ACKs, ping/pong, reconnect). `auth.test` uses plain `fetch` (no need for `@slack/web-api`).

### IPC + preload

- `slack:save-tokens` (tokens → save) , `slack:load-status` (→ has-tokens + member id, never returns raw tokens), `slack:test` (→ auth.test result), `slack:clear-tokens`.
- `slack:arm` / `slack:disarm` — start/stop the detector (renderer has already done/undone the `getDisplayMedia` share).
- Main → renderer events: `slack:huddle-started`, `slack:huddle-ended`, `slack:status` ({ state, detail }).
- Preload bridge `window.electronAPI.slack.{ saveTokens, loadStatus, test, clearTokens, arm, disarm, onHuddleStarted, onHuddleEnded, onStatus }`.

### Renderer — orchestration + UI

- **Arm toggle** (in the main shell, near existing capture controls): on enable → `capture.start()` (the `getDisplayMedia` gesture) → `electronAPI.slack.arm()`. On disable → `capture.stop()` + `slack.disarm()`.
- **Huddle event handling:** subscribe to `onHuddleStarted` → run the existing "begin session" path (begin meeting + start STT pushing the held stream's chunks). `onHuddleEnded` → run the existing "end session" path. Reuse the renderer's current Start/Stop session logic; do not duplicate it. Guard: ignore `huddle-started` if a session is already active.
- **Slack settings panel:** token inputs (masked), member-ID input, "Test connection" button + result, "Save" / "Clear". Reached from a settings entry point.
- **Status indicator:** reflects `slack:status` events.
- **Stream-ended handling:** if the held capture stream ends (user revoked the share via the OS), surface "Arm released — re-arm to continue" and flip the toggle off.

### Tests

- `src/test/slack-huddle-transition.test.ts` — exhaustive `classifyHuddleTransition` (self start, self end, other-user ignored, no-op repeats, missing profile).
- `src/test/slack-tokens.test.ts` — save/load/clear round-trip with an injected cipher (mock `safeStorage`); `testConnection` happy/error path with mocked `fetch`.
- `src/test/slack-detector.test.ts` — detector shell with an injected fake Socket Mode transport: feeds `user_huddle_changed` envelopes, asserts ACK + `onTransition` calls + status transitions.

## Out of scope (deferred)

- **Participant correlation / speaker labels** (matching `huddle_state_call_id` across users). v2. v1 detects only the authenticated user's start/end.
- **OAuth install flow.** v1 uses manual token paste (self-hosted desktop standard). A guided "create your Slack app from this manifest" doc/link is in scope as onboarding help, but no automated OAuth dance.
- **Automatic member-ID detection** (e.g., via a user token + `auth.test`). v1 = manual paste. (`auth.test` with a bot token returns the bot's ID, not the human's, so a user token would be required — deferred.)
- **Other meeting apps** (Zoom, Google Meet, Teams). Slack first; the detector is intentionally Slack-specific in v1, though the renderer "auto-start/stop session" wiring is reusable.
- **Non-huddle Slack features** (posting summaries to Slack — that was the other branch; messaging; slash commands).
- **VAD audio-activity auto-start** (the alternative approach B). Not combined in v1; could be a fallback in a later hybrid.
- **Auto-sharing the source without a gesture.** Impossible per the `getDisplayMedia` constraint; not attempted.
- **Multiple workspaces.** v1 supports one Slack connection.
- **Recording/transcribing Huddles the user is NOT in.** Detection is scoped to the authenticated user's own huddle state.

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Detection mechanism | Slack `user_huddle_changed` via Socket Mode | Only official, bot-free way to actually know a Huddle started. Validated Events-API compatible → Socket Mode works without a public URL/backend. |
| Socket transport | `@slack/socket-mode` dependency | Handles `apps.connections.open`, envelope ACK, ping/pong, reconnect — the fiddly, must-be-robust parts. Raw `ws` was the alternative; rejected for reconnect robustness. |
| Auth-test client | plain `fetch` to `auth.test` | One simple POST; avoids pulling `@slack/web-api`. |
| Token storage | Electron `safeStorage` (OS keychain) → `userData/slack-tokens.enc` | Tokens are secrets; `localStorage` is inappropriate. `safeStorage` is the Electron-native encrypted store. |
| "Me" identification | Manual Slack member-ID paste | `user_huddle_changed` is per-user; we must filter to the human. Bot-token `auth.test` gives the bot's ID, not the human's. Member ID is a 2-click copy from the Slack profile. Auto-detect (user token) is v2. |
| getDisplayMedia constraint | "Arm" = one-time share + hold stream; detection toggles transcription | The OS picker needs a gesture; silent capture-start is impossible. Arming at a deliberate moment is the correct UX and matches the user's mental model ("turn it on, it auto-starts"). |
| Detector location | Main process | Socket Mode + tokens + `safeStorage` belong in main; the renderer can't hold long-lived secrets safely. |
| Session control location | Renderer | The capture stream + STT session already live in the renderer; main only signals start/stop via IPC. Keeps the stream owner in one place. |
| Transition logic | Pure `classifyHuddleTransition` function | Isolates the testable core (start/end/filter) from the hard-to-test socket shell. |
| Idempotency | Guard against double-start if a session is active | Manual + auto paths must not collide; the detector only signals transitions, the renderer guards actual start. |
| Stream reuse across huddles | Keep the shared stream while armed | Re-prompting the OS picker every huddle would defeat the purpose; one share serves many huddles per arm session. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `getDisplayMedia` cannot auto-start | Designed around it: Arm does the one gesture; detection toggles transcription on the held stream. Documented as the central constraint. |
| User shares the wrong source (no Huddle audio) | Onboarding hint at Arm time: "share the Slack window with audio, or system audio." Track-ended handling re-prompts. The existing "no audio track" error already guides this. |
| `user_huddle_changed` fires for all workspace users | `classifyHuddleTransition` filters strictly to the configured member ID. Tested. |
| Member ID entered wrong → never triggers | "Test connection" + a clear "listening for member <id>" status. v2 auto-detect removes this footgun. |
| Socket Mode token/app misconfigured | `auth.test` + explicit error status. Onboarding doc with the exact app manifest (scopes: `users:read`; Socket Mode on; event subscription `user_huddle_changed`; app-level token with `connections:write`). |
| Token leakage | `safeStorage` encryption; `loadStatus` never returns raw tokens to the renderer; tokens redacted from logs. |
| Socket drops mid-huddle | `@slack/socket-mode` auto-reconnects; if a huddle-end is missed during a drop, the next state event reconciles; a max-session safeguard (existing meeting timeout) bounds it. |
| Double meeting start (manual + auto) | Renderer guards: ignore `huddle-started` if a session is active; ignore `huddle-ended` if none. |
| `safeStorage` unavailable (some Linux) | `isEncryptionAvailable()` checked; if false, show "secure storage unavailable — Slack auto-capture disabled" rather than storing plaintext. |
| Huddle detected but stream was revoked | `track.onended` → flip Arm off + notify; no silent failure. |
| Scope creep into participants/OAuth | Explicitly deferred to v2; v1 is detection + auto-capture only. |

## Verification approach

Per `CLAUDE.md` phase verification convention:

1. **Each phase:** `npm run verify:phase <N>` shows `VERDICT: ✅ Phase N verified`.
2. **Final:** `npm run verify` clean. `npm run build` clean (touches main + preload + renderer + a new dependency).
3. **Manual smoke (deferred to user — requires a real Slack workspace):**
   - Create the Slack app from the provided manifest, enable Socket Mode, install, copy app + bot tokens + member ID into settings → "Test connection" succeeds.
   - Toggle Arm → share the Slack window (with audio) → status "Listening."
   - Start a Huddle → autoMeetic auto-begins transcription within ~2 s.
   - Leave the Huddle → autoMeetic ends the meeting + generates a summary, returns to "Listening."
   - Have a coworker (different member) toggle a huddle → autoMeetic does NOT start.
   - Kill Wi-Fi briefly → status shows reconnecting → recovers.
   - Toggle Arm off → capture + socket stop.

## File map (preview — full detail in plan)

| Path | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `@slack/socket-mode` |
| `src/main/slack/types.ts` | Create | Slack tokens / status / event / transition types |
| `src/main/slack/slackTokens.ts` | Create | `safeStorage` token save/load/clear + `auth.test` |
| `src/main/slack/huddleTransition.ts` | Create | Pure `classifyHuddleTransition` |
| `src/main/slack/slackHuddleDetector.ts` | Create | Socket Mode shell + transition dispatch + status |
| `src/main/ipc.ts` | Modify | Slack IPC handlers (save/load-status/test/clear/arm/disarm) + status/huddle events |
| `src/preload/index.ts` | Modify | `slack` bridge |
| `src/preload/types.ts` | Modify | Slack API types |
| `src/renderer/slack/SlackSettingsPanel.tsx` | Create | Token + member-ID inputs, test, save/clear |
| `src/renderer/slack/useSlackArm.ts` | Create | Arm toggle state + capture share + huddle event handling |
| `src/renderer/App.tsx` (or shell) | Modify | Mount Arm toggle + status; wire huddle-started/ended to existing begin/end session |
| `src/renderer/App.css` | Modify | Panel + toggle + status styles |
| `src/test/slack-huddle-transition.test.ts` | Create | Pure transition tests |
| `src/test/slack-tokens.test.ts` | Create | Token store + auth.test tests |
| `src/test/slack-detector.test.ts` | Create | Detector shell w/ fake transport |
| `HANDOFF.md` | Modify | New active stream block + status table |

## Open questions / explicit non-decisions

- **Where does the Slack settings panel live?** A new entry in the existing header/settings area (consistent with the Glossary/Library buttons). Exact placement decided during UI implementation.
- **Should Arm auto-enable on app launch if previously armed?** No (v1). Arming requires the `getDisplayMedia` gesture, which can't fire on launch. User re-arms each session.
- **What if the user is in a Huddle when they Arm?** v1: the detector emits `started` on the first `user_huddle_changed` reflecting `in_a_huddle`; if already in a huddle with no new event, detection waits for the next transition. Documented limitation; v2 could query current state on connect (`users.info`).
- **App manifest distribution.** Provide a documented manifest (scopes + Socket Mode + event subscription) in onboarding help text; not bundled as a file in v1.
- **One Slack connection only.** Multi-workspace is v2.

## Self-review notes

The pivotal realization was the `getDisplayMedia` gesture constraint: an earlier framing imagined "Huddle detected → silently start capturing system audio," which is impossible in the browser/Electron security model. Reframing "Arm = the one gesture, detection = transcription toggle over a held stream" resolved it and, conveniently, matches the user's stated mental model ("turn it on and it auto-starts"). This is why Arm — not Huddle detection — owns the share.

The second clarification was the payload shape: `user_huddle_changed` is per-user (identical to `user_change`), not a single huddle event with a roster. This is why "me" filtering by member ID is mandatory and why participant rosters require `call_id` correlation (deferred to v2). The spec avoids overpromising a participant list in v1.
