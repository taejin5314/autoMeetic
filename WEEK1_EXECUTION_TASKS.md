# Week 1 Execution Tasks (MVP)

Date: 2026-05-11
Owner: autoMeetic

## 0) Scope Lock

This week only includes:

1. System-wide audio capture (Windows baseline)
2. Realtime transcription pipeline
3. Async translation pipeline (2-3s delay allowed)
4. Minimal live caption UI (original + translated)

Out of scope this week:

1. Slack-only app audio isolation (Pro backlog)
2. Whiteboard/Answer This features
3. Zoom/Meet/YouTube connectors

## 1) Architecture Freeze

Task:

1. Freeze data flow for MVP path
2. Define retry/failure behavior per stage

Deliverable:

1. One page architecture note in this file (Section 8)

Acceptance criteria:

1. Input -> STT -> Translate -> Overlay flow is unambiguous
2. Each stage has timeout + fallback defined

## 2) Audio Ingestion (System Audio)

Task:

1. Implement Windows system audio capture module
2. Expose stream interface for downstream STT

Suggested file targets:

1. src/main/audio/capture.ts
2. src/main/audio/types.ts

Acceptance criteria:

1. Audio chunks are emitted continuously for 10+ minutes
2. Capture restarts after transient device error
3. Logs include capture start/stop/error with timestamps

## 3) Realtime STT Pipeline

Task:

1. Connect capture chunks to OpenAI Realtime session
2. Emit partial/final transcript events

Suggested file targets:

1. src/main/stt/realtimeClient.ts
2. src/main/stt/transcriptBus.ts

Acceptance criteria:

1. Transcript events stream while audio is active
2. Session reconnect works after network interruption
3. No API key leakage in logs

## 4) Async Translation Pipeline

Task:

1. Consume final transcript segments
2. Translate asynchronously (target UX delay 2-3s)
3. Maintain ordering by segment id

Suggested file targets:

1. src/main/translate/translator.ts
2. src/main/translate/queue.ts

Acceptance criteria:

1. Translation appears within 3s for normal network
2. Out-of-order responses are re-ordered correctly
3. On translation failure, original transcript still shown

## 5) Caption Overlay (Minimal)

Task:

1. Render two-line captions: source + translated
2. Keep latest N segments with smooth updates

Suggested file targets:

1. src/renderer/overlay/CaptionOverlay.tsx
2. src/renderer/overlay/useCaptionStore.ts

Acceptance criteria:

1. UI updates in near realtime for source text
2. Translation line updates asynchronously without flicker
3. Overlay remains usable on 1366x768 and 1920x1080

## 6) Observability + Resilience

Task:

1. Add structured logs for each pipeline stage
2. Add health state (connected/degraded/disconnected)

Suggested file targets:

1. src/main/telemetry/logger.ts
2. src/main/health/pipelineHealth.ts

Acceptance criteria:

1. Operator can identify failing stage from logs in <1 minute
2. Health state updates when STT/translation is degraded

## 7) Week 1 Demo Exit Criteria

Required demo flow:

1. Start app
2. Capture system audio
3. Show live source transcript
4. Show delayed translated captions
5. Recover from one simulated network failure

Pass criteria:

1. 10-minute run without fatal crash
2. Source captions continuously visible
3. Translation appears with expected async delay
4. Failure recovery observed at least once

## 8) Frozen MVP Data Flow

1. Capture service emits PCM chunks
2. STT client sends chunks to OpenAI Realtime
3. Transcript bus emits partial/final segments
4. Translation queue consumes final segments only
5. UI store merges source + translation by segment id
6. Overlay renders latest caption window

Timeout/fallback rules:

1. STT timeout: reconnect session and continue capture
2. Translation timeout: mark segment as untranslated and continue
3. Capture device error: retry with exponential backoff

## 9) Daily Plan (Week 1)

Day 1:

1. Audio ingestion skeleton + logging
2. Realtime STT client wiring

Day 2:

1. Transcript bus + buffering
2. Async translation queue

Day 3:

1. Overlay UI integration
2. Segment ordering + dedup logic

Day 4:

1. Failure/reconnect handling
2. Health indicators + telemetry polish

Day 5:

1. End-to-end demo rehearsal
2. Bugfix and stability pass
