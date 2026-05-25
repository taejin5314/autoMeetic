# autoMeetic Project Index

이 문서는 새 작업자가 프로젝트에서 빠르게 길을 찾기 위한 경로 지도입니다.
최신 진행 상태는 항상 `HANDOFF.md`를 먼저 확인하고, 이 파일은 코드와 문서의 위치를 찾는 색인으로 사용합니다.

## 빠른 시작

| 목적                     | 명령                       |
| ------------------------ | -------------------------- |
| 웹 UI + 프록시 개발 서버 | `npm run dev`              |
| Electron 개발 실행       | `npm run dev:electron`     |
| 타입 검사                | `npm run typecheck`        |
| 린트                     | `npm run lint`             |
| Vitest 직접 실행         | `npx vitest run`           |
| 프로젝트 테스트 스크립트 | `npm test`                 |
| 프로덕션 빌드            | `npm run build`            |
| 전체 CI 루틴             | `npm run ci`               |
| 단계 검증                | `npm run verify:phase <N>` |
| 일반 검증                | `npm run verify`           |

Windows 환경에서는 `npm test`가 `better_sqlite3.node` 파일 잠금으로 `EBUSY`에서 멈출 수 있습니다. 이 경우 `HANDOFF.md`의 현재 convention을 확인하고, 직접 Vitest 실행 결과와 `npm test` 실패 원인을 함께 기록합니다.

## 먼저 읽을 파일

| 파일           | 용도                                                           |
| -------------- | -------------------------------------------------------------- |
| `HANDOFF.md`   | 현재 활성 스트림, 완료된 스트림, 검증 convention, 환경 quirks  |
| `AGENTS.md`    | Codex/agent 작업 규칙, 필수 검증, TDD/리뷰 기준                |
| `CLAUDE.md`    | Claude 계열 작업자용 운영 규칙과 phase verification convention |
| `README.md`    | 기본 프로젝트 README. 현재는 Vite 템플릿 성격이 강함           |
| `package.json` | 실행 스크립트, 의존성, 빌드/테스트 진입점                      |

## 최상위 디렉터리

| 경로                         | 내용                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| `src/main/`                  | Electron main process, IPC, STT, memory, whiteboard, translation, telemetry |
| `src/preload/`               | Renderer에 노출되는 Electron preload bridge와 타입                          |
| `src/renderer/`              | React UI, 상태 store, feature별 컴포넌트                                    |
| `src/test/`                  | Vitest 테스트. main/renderer/IPC 단위 테스트가 함께 있음                    |
| `server/`                    | 웹 개발용 프록시와 whiteboard runtime                                       |
| `scripts/`                   | native deps 준비, smoke test, release/helper scripts                        |
| `docs/superpowers/specs/`    | 기능별 설계 문서                                                            |
| `docs/superpowers/plans/`    | 설계별 구현 계획과 phase breakdown                                          |
| `docs/superpowers/handoffs/` | 오래된 또는 특정 스트림 handoff                                             |
| `harness/`                   | STT/latency/도메인 평가용 Python harness                                    |
| `packages/`                  | 로컬 optional sidecar package metadata                                      |
| `public/`                    | 정적 public asset                                                           |
| `.github/`                   | CI workflow, PR template, GitHub instructions                               |
| `tools/`                     | 로컬 운영/검증용 PowerShell 도구                                            |

## Main Process 지도

| 경로                                | 역할                                                  |
| ----------------------------------- | ----------------------------------------------------- |
| `src/main/index.ts`                 | Electron main 진입점, 서비스 초기화, window lifecycle |
| `src/main/ipc.ts`                   | 주요 IPC handler wiring                               |
| `src/main/ipc-memory-handlers.ts`   | Memory Library 관련 IPC handler                       |
| `src/main/ipc-glossary-handlers.ts` | Glossary 관련 IPC handler                             |
| `src/main/proxyService.ts`          | 로컬 프록시 프로세스 관리                             |
| `src/main/telemetry/logger.ts`      | telemetry/log event 출력                              |
| `src/main/health/pipelineHealth.ts` | pipeline health 상태                                  |

## Memory Library

| 경로                                    | 역할                                                            |
| --------------------------------------- | --------------------------------------------------------------- |
| `src/main/memory/memoryService.ts`      | memory 기능의 상위 service facade                               |
| `src/main/memory/repository.ts`         | SQLite repository, meeting/segment/summary/glossary persistence |
| `src/main/memory/schema.ts`             | SQLite schema 정의                                              |
| `src/main/memory/types.ts`              | memory domain 타입                                              |
| `src/main/memory/meetingLifecycle.ts`   | meeting 시작/종료 lifecycle 처리                                |
| `src/main/memory/transcriptHook.ts`     | transcript segment 저장 hook                                    |
| `src/main/memory/searchService.ts`      | cross-meeting semantic search                                   |
| `src/main/memory/embeddingService.ts`   | embedding 생성                                                  |
| `src/main/memory/embeddingQueue.ts`     | embedding job queue                                             |
| `src/main/memory/embeddingWorker.ts`    | embedding worker entry                                          |
| `src/main/memory/summaryService.ts`     | meeting summary 생성                                            |
| `src/main/memory/markdownExporter.ts`   | memory export                                                   |
| `src/main/memory/meetingLanguages.ts`   | meeting language metadata                                       |
| `src/main/memory/chatService.ts`        | Memory Chat RAG orchestration and streaming                     |
| `src/main/memory/prompts/chat.v1.ts`    | Memory Chat system/user prompt helpers                          |
| `src/main/memory/prompts/summary.v1.ts` | Summary prompt helpers                                          |

## Glossary

| 경로                                          | 역할                                           |
| --------------------------------------------- | ---------------------------------------------- |
| `src/main/glossary/cache.ts`                  | active glossary cache                          |
| `src/main/glossary/extractionPrompt.ts`       | glossary suggestion extraction prompt          |
| `src/main/glossary/promptInjection.ts`        | prompt injection + preserve-term normalization |
| `src/main/glossary/suggestionService.ts`      | glossary auto-suggestion orchestration         |
| `src/renderer/glossary/GlossaryPanel.tsx`     | glossary management UI                         |
| `src/renderer/glossary/GlossaryRowEditor.tsx` | glossary entry editor row                      |
| `src/renderer/glossary/SuggestionRow.tsx`     | suggested glossary term row                    |
| `src/renderer/glossary/useGlossaryStore.ts`   | renderer glossary state/store                  |
| `src/renderer/glossary/types.ts`              | renderer glossary 타입                         |

## Chat / Ask Tab

| 경로                                           | 역할                                  |
| ---------------------------------------------- | ------------------------------------- |
| `src/renderer/ask/AskTab.tsx`                  | Memory Library Ask tab shell          |
| `src/renderer/ask/AskInput.tsx`                | chat input                            |
| `src/renderer/ask/ChatMessageView.tsx`         | chat message rendering                |
| `src/renderer/ask/SourcesList.tsx`             | citation/source list                  |
| `src/renderer/ask/parseAnswerWithCitations.ts` | answer citation marker parser         |
| `src/renderer/ask/useChatStore.ts`             | rolling chat history and stream state |
| `src/renderer/ask/types.ts`                    | renderer chat 타입                    |
| `src/test/chat-service.test.ts`                | main chat orchestration tests         |
| `src/test/chat-ipc.test.ts`                    | chat IPC tests                        |
| `src/test/chat-renderer.test.ts`               | renderer chat parser/store tests      |
| `src/test/chat-prompt.test.ts`                 | chat prompt tests                     |

## Renderer Shell and Panels

| 경로                                            | 역할                                                  |
| ----------------------------------------------- | ----------------------------------------------------- |
| `src/renderer/App.tsx`                          | renderer app composition and high-level state wiring  |
| `src/renderer/App.css`                          | app-level styles                                      |
| `src/renderer/main.tsx`                         | React entry point                                     |
| `src/renderer/api.ts`                           | renderer API helpers/types                            |
| `src/renderer/shell/RightShelf.tsx`             | right-side shelf layout                               |
| `src/renderer/shell/SourceBar.tsx`              | input/source controls                                 |
| `src/renderer/shell/TranscriptColumns.tsx`      | transcript column layout                              |
| `src/renderer/shell/useAnswerAssistHotkey.ts`   | answer assist hotkey                                  |
| `src/renderer/shell/useClockMs.ts`              | clock hook                                            |
| `src/renderer/shell/useFullscreenState.ts`      | fullscreen state hook                                 |
| `src/renderer/shell/useTranscriptScrollSync.ts` | transcript scroll sync                                |
| `src/renderer/library/MemoryLibraryPanel.tsx`   | memory library panel shell                            |
| `src/renderer/library/MeetingsTab.tsx`          | meeting list, transcript, summary, citation highlight |

## Live Feed, STT, Translation

| 경로                                      | 역할                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| `src/main/sttService.ts`                  | STT service coordination                                |
| `src/main/stt/realtimeClient.ts`          | OpenAI realtime/STT client                              |
| `src/main/stt/transcriptBus.ts`           | transcript event bus                                    |
| `src/main/stt/types.ts`                   | STT 타입                                                |
| `src/main/audio/capture.ts`               | audio capture                                           |
| `src/main/audio/types.ts`                 | audio 타입                                              |
| `src/main/translate/translator.ts`        | translation client                                      |
| `src/main/translate/queue.ts`             | translation queue                                       |
| `src/main/transcriptPostProcessor.ts`     | live transcript post-processing, glossary normalization |
| `src/renderer/feed/useFeedTypewriter.ts`  | renderer feed typewriter behavior                       |
| `src/renderer/electronSttClient.ts`       | renderer STT bridge client                              |
| `src/renderer/overlay/CaptionOverlay.tsx` | caption overlay UI                                      |
| `src/renderer/overlay/useCaptionStore.ts` | caption state                                           |
| `src/renderer/overlay/Waveform.tsx`       | audio waveform UI                                       |

## Whiteboard

| 경로                                                    | 역할                               |
| ------------------------------------------------------- | ---------------------------------- |
| `src/main/whiteboardService.ts`                         | whiteboard service orchestration   |
| `src/main/whiteboard/elements.ts`                       | Excalidraw element generation      |
| `src/main/whiteboard/session.ts`                        | whiteboard session state           |
| `src/main/whiteboard/prompt.ts`                         | whiteboard prompt                  |
| `src/main/whiteboard/tools.ts`                          | whiteboard tool definitions        |
| `src/main/whiteboard/keywords.ts`                       | keyword extraction/helpers         |
| `src/main/whiteboard/mindmapState.ts`                   | mind-map tree state                |
| `src/main/whiteboard/mindmapLayout.ts`                  | mind-map radial layout             |
| `src/main/whiteboard/mindmapPrompt.ts`                  | mind-map prompt/parser             |
| `src/main/whiteboard/mindmapColors.ts`                  | mind-map color palette             |
| `src/main/whiteboard/types.ts`                          | whiteboard 타입                    |
| `src/renderer/whiteboard/ExcalidrawCanvas.tsx`          | Excalidraw canvas wrapper          |
| `src/renderer/whiteboard/WhiteboardModal.tsx`           | whiteboard modal shell             |
| `src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx` | whiteboard label language selector |

## Action Items and Answer Assist

| 경로                                                 | 역할                           |
| ---------------------------------------------------- | ------------------------------ |
| `src/main/actionItemService.ts`                      | action item extraction/service |
| `src/renderer/actions/ActionItemsPanel.tsx`          | action items UI                |
| `src/renderer/actions/useActionItemsStore.ts`        | action items renderer store    |
| `src/renderer/actions/types.ts`                      | action item 타입               |
| `src/renderer/answer-assist/AnswerAssistCard.tsx`    | answer assist UI               |
| `src/renderer/answer-assist/useAnswerAssistStore.ts` | answer assist renderer store   |
| `src/renderer/answer-assist/types.ts`                | answer assist 타입             |

## Preload / IPC Contract

| 경로                                | 역할                                   |
| ----------------------------------- | -------------------------------------- |
| `src/preload/index.ts`              | Electron contextBridge exposure        |
| `src/preload/api.ts`                | preload API assembly                   |
| `src/preload/types.ts`              | renderer에서 사용하는 preload API 타입 |
| `src/main/ipc.ts`                   | main-side IPC registration             |
| `src/main/ipc-memory-handlers.ts`   | memory IPC handlers                    |
| `src/main/ipc-glossary-handlers.ts` | glossary IPC handlers                  |

IPC 계약을 바꿀 때는 main handler, preload bridge, renderer type, 관련 테스트를 함께 확인합니다.

## Tests

| 테스트 영역               | 대표 파일                                                          |
| ------------------------- | ------------------------------------------------------------------ |
| Memory repository/service | `src/test/memory-*.test.ts`                                        |
| Memory Chat               | `src/test/chat-*.test.ts`                                          |
| Glossary                  | `src/test/glossary-*.test.ts`                                      |
| Whiteboard                | `src/test/whiteboard-layout.test.ts`, `src/test/mindmap-*.test.ts` |
| Answer assist             | `src/test/answer-assist-prompt.test.ts`                            |
| Native deps scripts       | `src/test/native-deps-scripts.test.ts`                             |
| AI review collaboration   | `src/test/ai-review-collaboration.test.ts`                         |

테스트를 추가할 때는 기능 위치와 가까운 기존 `src/test/*` 패턴을 먼저 따라갑니다.

## Docs and Planning

| 경로                                                                    | 역할                                |
| ----------------------------------------------------------------------- | ----------------------------------- |
| `docs/superpowers/specs/2026-05-23-memory-chat-design.md`               | Memory Library Chat 설계            |
| `docs/superpowers/plans/2026-05-23-memory-chat.md`                      | Memory Library Chat 구현 계획       |
| `docs/superpowers/specs/2026-05-21-mindmap-mode-design.md`              | Whiteboard Mind-Map 설계            |
| `docs/superpowers/plans/2026-05-21-mindmap-mode.md`                     | Whiteboard Mind-Map 구현 계획       |
| `docs/superpowers/specs/2026-05-20-glossary-auto-suggestions-design.md` | Glossary auto-suggestions 설계      |
| `docs/superpowers/plans/2026-05-20-glossary-auto-suggestions.md`        | Glossary auto-suggestions 구현 계획 |
| `docs/superpowers/specs/2026-05-17-meeting-memory-foundation-design.md` | Meeting memory foundation 설계      |
| `docs/superpowers/plans/2026-05-17-meeting-memory-foundation.md`        | Meeting memory foundation 구현 계획 |

새 기능은 보통 `docs/superpowers/specs/YYYY-MM-DD-*-design.md` 설계 문서와 `docs/superpowers/plans/YYYY-MM-DD-*.md` 구현 계획으로 남깁니다.

## Config and Build Files

| 경로                      | 역할                        |
| ------------------------- | --------------------------- |
| `electron.vite.config.ts` | Electron/Vite build 설정    |
| `vite.config.ts`          | renderer Vite 설정          |
| `vitest.config.ts`        | Vitest 설정                 |
| `eslint.config.js`        | ESLint 설정                 |
| `tsconfig.json`           | TS project references entry |
| `tsconfig.main.json`      | main process TS 설정        |
| `tsconfig.preload.json`   | preload TS 설정             |
| `tsconfig.renderer.json`  | renderer TS 설정            |
| `tsconfig.app.json`       | app-wide TS 설정            |
| `electron-builder.yml`    | Electron packaging 설정     |
| `.coderabbit.yaml`        | CodeRabbit 설정             |

## Scripts

| 경로                                         | 역할                                      |
| -------------------------------------------- | ----------------------------------------- |
| `scripts/prepare-native-deps.mjs`            | node/electron native dependency 준비      |
| `scripts/postinstall-memory-deps.mjs`        | postinstall memory native dependency 준비 |
| `scripts/verify.mjs`                         | phase/general verification helper         |
| `scripts/maintenance-checklist.mjs`          | maintenance checklist helper              |
| `scripts/smoke-test-memory-deps.mjs`         | memory native dependency smoke test       |
| `scripts/smoke-test-store-cache.js`          | store cache smoke test                    |
| `scripts/smoke-transcript-postprocessor.mjs` | transcript postprocessor smoke test       |
| `scripts/simulate-whiteboard-agent.js`       | whiteboard agent simulation               |
| `scripts/probe-openai-realtime.js`           | OpenAI realtime probe                     |
| `scripts/run-electron-vite.mjs`              | Electron Vite runner wrapper              |
| `scripts/build-moonshine-sidecars.js`        | Moonshine sidecar package build           |
| `scripts/prepare-release-packages.js`        | release package preparation               |

## External / Runtime Support

| 경로                               | 역할                                     |
| ---------------------------------- | ---------------------------------------- |
| `server/proxy.mjs`                 | local proxy server                       |
| `server/whiteboard-runtime.mjs`    | whiteboard runtime support               |
| `packages/moonshine-darwin-arm64/` | local Moonshine sidecar package metadata |
| `packages/moonshine-darwin-x64/`   | local Moonshine sidecar package metadata |
| `harness/`                         | latency/STT/domain evaluation harness    |

## 작업 전 체크리스트

1. `HANDOFF.md` 상단의 active stream과 verification convention을 확인합니다.
2. `AGENTS.md`의 Required Verification과 TDD Rule을 확인합니다.
3. 수정할 기능의 main/preload/renderer/test 경계를 이 파일에서 찾습니다.
4. behavior change나 bug fix는 가능한 경우 실패하는 테스트를 먼저 추가합니다.
5. renderer/main/preload/config/package 변경 후에는 `npm run build`까지 실행합니다.
6. 완료 보고에는 실제 실행한 명령과 결과를 적고, `npm test`가 `EBUSY`로 막히면 그 사실을 숨기지 않습니다.
