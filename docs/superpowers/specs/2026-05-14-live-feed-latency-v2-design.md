---
title: Live Feed Latency Reduction (v2 — parallel source/translation)
date: 2026-05-14
status: design
---

# Live Feed Latency Reduction v2

## Problem

After the v1 latency plan ([2026-05-14-live-feed-latency-design.md](./2026-05-14-live-feed-latency-design.md)) was implemented, the live feed still shows ~3–4 seconds of latency for short Korean fragments. The user is producing short, mid-sentence chunks (e.g. `무슨 용기사 키우고`, `한 개`, `유`) but they still arrive late on screen.

Diagnosis of the remaining latency budget (말 끝난 시점 → source 컬럼 표시):

| 단계 | 위치 | 시간 |
|---|---|---|
| OpenAI realtime STT 내부 지연 | server-side | ~300–800ms |
| `DELTA_QUIET_MS` 침묵 대기 | [sttService.ts](../../../src/main/sttService.ts) | **800ms** (문장끝 없으면 항상) |
| `STT_POSTPROCESS_MIN_CHARS` floor 대기 | [transcriptPostProcessor.ts](../../../src/main/transcriptPostProcessor.ts) | **2000ms** (3자 미만 fragment) |
| OpenAI 번역 API (`gpt-4.1-nano`) | postprocessor | 500–1500ms |
| 직렬화(serialize) 대기 | postprocessor | 앞 호출이 안 끝나면 누적 |
| 타자기 렌더 | useFeedTypewriter | <100ms |

대표 사례:
- `감사합니다.` (sentence-end) → STT + LLM ≈ **1.2초**
- `무슨 용기사 키우고` (9자, 마침표 없음) → STT + 800ms quiet + LLM ≈ **2.1초**
- `유` (1자, 마침표 없음) → STT + 800ms quiet + 2000ms floor + LLM ≈ **약 4초** ← 화면 일치

## Goal

말 끝난 시점부터 **source 컬럼**까지의 P50 지연을 **<1초**로 줄인다. 번역 컬럼은 source와 동시 표시를 포기하고, source 뒤에 비동기로 채워지는 것을 허용한다.

## Solution Overview

세 가지 변경을 함께 적용한다 (순서대로 평가하면 누적 효과가 잘 보임).

### 1. `DELTA_QUIET_MS` 기본값 800 → 350

- 파일: [src/main/sttService.ts:12](../../../src/main/sttService.ts#L12)
- 변경: `const DELTA_QUIET_MS = Number(process.env.STT_DELTA_QUIET_MS ?? 800)` → `?? 350`
- 효과: 문장끝 없이 발화가 끝났을 때 commit까지의 대기를 450ms 단축.
- 트레이드오프: STT delta가 더 자주 쪼개질 수 있어 한 줄이 두 줄로 갈리는 빈도가 늘어남. 200–400ms 사이에서 추가 튜닝 여지.

### 2. `STT_POSTPROCESS_MIN_CHARS` 기본값 3 → 1

- 파일: [src/main/transcriptPostProcessor.ts:7](../../../src/main/transcriptPostProcessor.ts#L7)
- 변경: `?? 3` → `?? 1`
- 효과: 1–2자 한국어 fragment의 2000ms floor 대기 제거.
- 트레이드오프: `응`, `네`, `ok` 같은 trivial 발화마다 LLM 호출 발생. 비용 증가는 nano 모델로 흡수.

### 3. Source/Translation 병렬화 — source 즉시 emit, translation은 비동기 patch

현재 파이프라인은 `enqueueRoughTranscript` → LLM 번역 → `stt:processed` 한 이벤트로 source+translation을 함께 emit한다. LLM 응답을 기다리는 동안 source도 못 보여주는 것이 가장 큰 단일 지연 요인이다.

**새 파이프라인**:

```
enqueueRoughTranscript(text)
  ├─ (즉시) emit stt:processed { id, text, translation: null }
  │     → 피드에 source만 채워진 줄이 바로 추가됨, source 타이핑 시작
  │     → downstream (whiteboard, action items)도 이 시점에 raw text 전달
  └─ (병렬) translation queue에 push → 직렬 LLM 호출
        → 응답: emit stt:translation-patch { id, translation }
              → 같은 id의 줄을 찾아 fullTranslation 채움
              → 번역 컬럼에 타자기 효과로 렌더
```

`id`로 patch하므로 LLM이 순서 어긋나게 응답해도 화면 정합성은 유지된다. 그래도 비용/레이트리밋 안전상 한 번에 한 건만 inflight (single-slot queue).

## Components Changing

### `src/main/transcriptPostProcessor.ts`

핵심 재작성. 기존의 buffer/inFlight 구조를 두 개로 분리:

- **즉시 emit 경로**: `enqueueRoughTranscript`는 trim 후 source turn (translation=null)을 build하고 `stt:processed`로 즉시 보냄. 새 helper `emitSourceAndQueueTranslation(text, hints)`.
- **Coalesce buffer**: MIN_CHARS 미만(기본 1자)인 경우만 짧게 모았다가 `STT_POSTPROCESS_FLOOR_FLUSH_MS` 후 flush. 기본 MIN_CHARS=1이면 사실상 안 쓰이지만 env var로 다시 키울 수 있게 유지.
- **Translation queue**: `PendingTranslation[]` (id, text, hints)를 큐로 들고 있고 `translationInFlight` 플래그로 직렬화. drain 시 LLM 호출 후 `stt:translation-patch` 이벤트 emit. 실패 시 patch 안 보냄 (source만 남고 번역 없음).
- **신규 IPC 이벤트**: `stt:translation-patch` payload `{ id: string, translation: string }`.
- **Downstream**: whiteboard/action 서비스는 `emitProcessedTurn` 시점에 한 번만 raw text를 받는다 (지금과 동일, 번역에 의존하지 않음).
- **기존 export 유지**: `init`, `enqueueRoughTranscript`, `flushPendingTranscript`, `resetTranscriptPostProcessor`, `parseProcessedTranscriptResponse`.

`buildTurn`의 id 생성을 helper `makeTurnId(createdAtMs)`로 분리해 source emit과 (만약 쓸 경우) parser가 같은 형식을 쓰게 한다.

### `src/preload/types.ts`

- 신규 타입 `TranslationPatchEvent { id: string; translation: string }`.
- `ElectronAPI`에 `onSttTranslationPatch(callback: (event: TranslationPatchEvent) => void): () => void` 추가.

### `src/preload/index.ts`

- `onSttTranslationPatch: createEventListener('stt:translation-patch') as ElectronAPI['onSttTranslationPatch']` 노출.

### `src/renderer/overlay/useCaptionStore.ts`

- `CaptionAction`에 `{ type: 'patch-translation'; id: string; translation: string }` 추가.
- reducer: 해당 id의 item에 대해 `fullTranslation: action.translation`, `displayedTranslation: ''`, `typing: true`, `updatedAtMs: Date.now()` 세팅.
- `patchTranslation(id, translation)` callback export.

### `src/renderer/feed/useFeedTypewriter.ts`

두 가지 수정:

1. **커서 시드 변경**: `stateRef.current = { id, src: 0, tr: 0 }` → `src: typingItem.displayedSource.length`, `tr: typingItem.displayedTranslation.length`. 번역 patch가 도착해서 typing이 재개될 때 source가 처음부터 다시 타이핑되지 않게 함.
2. **번역 독립 진행**: source가 다 그려진 뒤(`cursor.src >= fullSrcLen`)에는 ratio 게이트 대신 step 단위로 `cursor.tr`을 증가. source가 아직 진행 중이면 기존의 ratio≥0.3 로직 유지.

### `src/renderer/App.tsx`

- `useCaptionStore` destructure에 `patchTranslation` 추가.
- `useEffect`에서 `api.onSttTranslationPatch((event) => { if (!event?.id || !event.translation) return; patchTranslation(event.id, event.translation) })` 구독, cleanup에서 해제.
- deps에 `patchTranslation` 추가.

### `src/main/sttService.ts`

- DELTA_QUIET_MS 기본값만 350으로 변경. 다른 임계값(`TRANSCRIPT_MAX_CHARS=200`, `TRANSCRIPT_MAX_MS=3000`)은 건드리지 않음.

## Ordering & Edge Cases

- **순서 보장**: source는 STT commit 순서대로 즉시 emit. 번역은 patch가 id 기반이라 응답 순서에 무관하게 올바른 줄에 채워짐. 안전을 위해 LLM 호출은 single-slot 직렬화 유지.
- **번역 patch가 source 타이핑 중 도착**: reducer가 `fullTranslation` 세팅 → 다음 타자기 tick에서 ratio≥0.3 게이트 만족하면 번역도 같이 타이핑됨.
- **번역 patch가 source 타이핑 끝난 뒤 도착**: reducer가 `typing: true` 재설정 → typewriter useEffect의 `items.some(typing)` 조건이 다시 켜져서 RAF 시작 → cursor 시드는 displayedSource 길이부터 시작하므로 source 재타이핑 없이 번역만 진행.
- **번역 OFF 모드**: `targetLanguage === 'off'`이거나 source==target → 큐에 push 안 함, patch 안 옴. source만 즉시 표시되고 번역 컬럼은 비어 있음.
- **OPENAI_API_KEY 없음**: 한 번 경고 로그 후 모든 translation 호출 스킵. source는 정상 표시.
- **LLM 실패**: catch에서 warn 로그만 남기고 patch 안 보냄. 화면에는 source만 남음 (의도된 graceful degradation).
- **`flushPendingTranscript({ force: true })`**: coalesce 버퍼만 비우면 됨. 큐의 in-flight 번역은 그냥 알아서 끝남.

## Out of Scope

- STT 모델 변경 / engine 교체.
- Translation provider 교체 (Groq, Together 등). 별도 후속 작업.
- Speaker 다이어리제이션 (이미 v1에서 빠짐).
- UI 레이아웃/스타일 변경.
- 번역과 source를 강제 동기화하는 옵션 (의도적으로 비동기 선택).

## Success Criteria

**Primary — source 컬럼 지연:**

말 끝나는 시점부터 source 컬럼 첫 글자 표시까지:
- 문장끝 commit: P50 < 0.5s
- 비-문장끝 commit: P50 < 1.0s
- 1자 fragment: P50 < 1.0s (기존 4초)

**Secondary:**
- `tsc --noEmit` clean, `eslint` clean.
- 번역 patch가 도착하면 같은 줄에 자연스럽게 채워짐 (source 재타이핑 없음).
- 빠른 연속 발화 시 source 순서가 STT commit 순서와 일치.
- 번역 OFF 시 번역 컬럼은 빈 채로 source만 표시.
- Downstream 에이전트 (whiteboard, action items)는 기존과 동일하게 raw text 받음.

**Failure modes / defenses:**
- 번역 patch가 영원히 안 옴 (LLM 실패 후): source만 남음. 줄이 `typing: true`로 영원히 남지 않게, source 타이핑 완료 시점에 `typing: false` 처리됨 (현 typewriter 로직이 처리). patch가 오면 다시 `typing: true`.
- DELTA_QUIET_MS를 너무 낮추면 한 문장이 여러 줄로 갈림. 350ms는 보수적 기본값. 200ms까지는 실험 권장.

## Risks

- 번역이 source와 시각적으로 분리되면 UX 인상이 달라질 수 있음. "동시 출현이 자연스럽다"는 v1의 explicit 결정과 충돌. 사용자가 직접 요청한 트레이드오프이므로 진행.
- 짧은 trivial 발화마다 LLM 호출 → 비용 약간 상승. nano 모델로 흡수, env로 더 가벼운 모델로 갈아끼울 수 있음.
- React 리렌더 횟수가 늘어남 (source emit + translation patch 두 번). `MAX_ITEMS=50` 캡 안에서 무시 가능.

## Implementation Notes for the Implementer

- TypeScript strict 모드 (`any` 금지). 이미 프로젝트 CLAUDE.md에 명시.
- 검증은 `npm run typecheck` + `npm run lint` + 수동 QA (`npm run dev:electron`). 테스트 러너는 없음.
- Commit 메시지는 기존 prefix 스타일 (`feat(stt):`, `tweak(stt):`, `fix(feed):`)을 따른다.
- 각 변경은 가능하면 독립 commit으로 분리:
  1. `tweak(stt): lower DELTA_QUIET_MS default to 350ms`
  2. `tweak(stt): lower STT_POSTPROCESS_MIN_CHARS default to 1`
  3. `feat(stt): parallelize source emit and translation patch`
- 3번은 IPC 채널을 추가하므로 main↔preload↔renderer 세 곳의 변경이 한 commit에 묶여야 깨지지 않음.

## Verification Checklist (manual QA)

1. `npm run dev:electron` 후 콘솔에 에러 없음.
2. Start 누르고 한국어 짧은 발화 5–10개 (`안녕`, `한 개`, `유`, `감사합니다`, `무슨 용기사 키우고` 등).
3. 각 발화에 대해 source 컬럼 첫 글자가 1초 이내에 뜨는지 시각적으로 확인.
4. 같은 발화의 번역이 source 뒤 500–1500ms 안에 같은 줄에 채워지는지 확인. source가 다시 처음부터 타이핑되면 버그.
5. 빠르게 연속해서 발화 (예: "하나. 둘. 셋.") 시 source 순서가 정확한지.
6. 언어 설정 → 번역 OFF로 바꾸고 다시 발화 — 번역 컬럼이 비고 source만 즉시 뜨는지.
7. Whiteboard / Action items 패널이 여전히 입력을 받는지 (UI 동작이 끊기지 않으면 됨).
