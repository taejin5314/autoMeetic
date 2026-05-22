# Codebase Refactor Design

## Purpose

AutoMeetic needs incremental refactoring that improves maintainability without changing user-visible behavior. The current codebase has several large files and a small amount of duplication, but the main risk is not copy-paste volume. The main risk is that high-traffic workflows are concentrated in large modules where unrelated changes can accidentally affect live feed behavior, whiteboard rendering, translation routing, or renderer state.

This design defines a staged refactoring program. It applies the newly added maintenance verification matrix and the installed refactoring skills:

- `refactor`: behavior-preserving, small-step refactoring.
- `jscpd`: duplication detection with an AI-friendly reporter.
- `dry-refactoring`: guided duplicate elimination after `jscpd` identifies clone pairs.

## Research Summary

The researched refactoring guidance converges on the same operating model:

- Preserve behavior; refactoring changes structure, not external outcomes.
- Work in small steps with tests between changes.
- Add characterization tests when behavior is important but under-covered.
- Commit at safe points.
- Use duplication detection as one signal, not the only signal.

The `jscpd` scan on `src`, `server`, and `scripts` found only `0.2%` duplication with `--min-lines 10 --min-tokens 80`. That means duplication cleanup should be opportunistic. The stronger refactoring signal is file size and responsibility concentration.

## Current Hotspots

The largest active files are:

- `src/renderer/App.css`: renderer-wide styling, including unrelated layout areas.
- `server/proxy.mjs`: proxy server responsibilities, streaming, whiteboard runtime, and API routing.
- `src/renderer/App.tsx`: top-level renderer shell, meeting controls, shelves, overlays, and whiteboard preview.
- `src/main/whiteboardService.ts`: whiteboard mode state, gatekeeper flow, renderer calls, mindmap handling, and update broadcasting.
- `src/main/memory/repository.ts`: persistence for meetings, summaries, glossary suggestions, and memory data.
- `src/renderer/whiteboard/ExcalidrawCanvas.tsx`: Excalidraw conversion, canvas rendering, scene sync, and cleanup logic.

These files should not be rewritten wholesale. Each should be split only along boundaries that are already visible in the code and protected by focused tests.

## Scope

This refactoring program covers:

- Large-file decomposition.
- Repeated parsing or mapping helper extraction.
- CSS organization by feature area.
- Stronger module boundaries for renderer shell and whiteboard service code.
- Focused tests before behavior-sensitive movement.

This refactoring program does not cover:

- New product behavior.
- UI redesign.
- Dependency upgrades.
- Performance optimization unless a metric and budget are defined first.
- Replacing Electron, Vite, React, Excalidraw, or the storage layer.

## Principles

1. Preserve behavior unless a specific task says otherwise.
2. Prefer extraction over rewrite.
3. Keep public IPC and renderer/main contracts stable.
4. Move code only when the destination has a clearer responsibility.
5. Each step must leave the repo in a verifiable state.
6. Avoid abstractions that hide domain terms or make tests harder to read.

## Refactoring Tracks

### Track 1: Renderer Shell Split

Start here. `App.tsx` is active in the IDE, large, user-facing, and already has visible UI regions. The first implementation plan should split only stable presentation and wiring boundaries.

Candidate boundaries:

- App-level session controls and meeting state display.
- Shelf navigation and shelf header controls.
- Whiteboard preview shell.
- Overlay/caption controls.
- Memory/action/glossary panel composition.

The first pass should avoid changing store APIs, IPC calls, or visual class names. Components can be extracted while keeping props explicit and local.

Verification:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- Targeted renderer smoke check if visual structure changes.

### Track 2: Renderer CSS Split

Split `App.css` after or alongside renderer shell extraction. CSS should be divided by feature area while preserving class names.

Candidate files:

- `src/renderer/styles/app-shell.css`
- `src/renderer/styles/whiteboard.css`
- `src/renderer/styles/feed.css`
- `src/renderer/styles/memory.css`
- `src/renderer/styles/glossary.css`

The exact file names can change during implementation if existing imports suggest a better local pattern.

Verification:

- Build must pass.
- Manual or browser smoke check should verify no obvious layout collapse.
- Dark/light theme rendering is high-risk and requires targeted inspection.

### Track 3: Whiteboard Service Boundary Split

Split `src/main/whiteboardService.ts` only after renderer shell work is stable. This file touches high-risk whiteboard behavior.

Candidate boundaries:

- Mode state and mindmap initialization.
- Gatekeeper decision flow.
- Renderer API call/retry handling.
- Element application and broadcasting.
- Transcript scheduling.

Verification:

- Existing `whiteboard-layout`, `mindmap-layout`, `mindmap-state`, and `mindmap-prompt-parser` tests.
- New characterization tests before moving behavior that lacks coverage.
- Build and full required verification.

### Track 4: Low-Risk Duplicate Cleanup

Use `jscpd` and `dry-refactoring` only for clone pairs that produce clear, boring abstractions.

Initial candidates:

- Glossary suggestion row mapping in `src/main/memory/repository.ts`.
- SSE line parsing pattern shared by answer-assist proxy and renderer store.

The SSE parsing candidate should be treated carefully because it crosses main/renderer concerns. It may be better as two local helpers with the same shape rather than one shared module.

Verification:

- Repository tests for glossary mapping.
- Answer assist stream tests or characterization tests before SSE parser movement.

### Track 5: Server Proxy Decomposition

Treat `server/proxy.mjs` as a later track because it mixes runtime server concerns and likely has fewer TypeScript safety rails.

Candidate boundaries:

- Route registration.
- OpenAI request helpers.
- Whiteboard runtime adapter.
- Translation/proxy helpers.
- SSE utilities.

Verification:

- Existing smoke scripts where applicable.
- New focused tests or script-level smoke checks before moving route behavior.

## First Implementation Slice

The first implementation plan should target Track 1 only:

**Renderer Shell Split, Phase 1**

Goal:
Extract stable renderer shell components from `src/renderer/App.tsx` without changing behavior or visual class names.

Initial extraction candidates:

- Shelf header controls.
- Whiteboard preview section.
- Session status/control strip if props remain manageable.

Do not split state stores or IPC adapters in this first slice. Keep logic close to `App.tsx` if moving it would require new abstractions.

## Verification Plan

Before each refactoring slice:

- Run `npm run maintenance:check`.
- Identify whether the change is `refactor` or `cleanup`.
- State the behavior-preserving invariant.
- Run the closest focused tests if they exist.

After each slice:

- Run focused tests.
- Run `npm run typecheck`.
- Run `npm run lint`.
- Run `npm test`.
- Run `npm run build` for renderer/main/preload/config/package changes.

For high-risk areas:

- Live feed changes require sentence grouping and renderer state checks.
- Translation changes require explicit language routing tests.
- Whiteboard changes require layout and Excalidraw conversion tests.
- Theme changes require dark/light visual inspection.
- IPC changes require request/response shape checks.

## Sources

- skills.sh documentation: https://skills.sh/docs
- GitHub `refactor` skill: https://skills.sh/github/awesome-copilot/refactor
- jscpd agent skill documentation: https://jscpd.dev/getting-started/agent-skill
- skillcreatorai `code-refactoring` reference: https://skills.sh/skillcreatorai/ai-agent-skills/code-refactoring
