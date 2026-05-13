# Answer Assist — AI Meeting Answer Coach

**Date:** 2026-05-13
**Status:** Draft
**Author:** brainstorming session

---

## Overview

미팅 중 질문을 받았을 때 사용자가 버튼을 눌러 AI 답변 초안을 받는 기능. transcript buffer를 읽고, 필요 시 웹 검색을 수행하여 미팅 언어 + 한국어 번역으로 답변을 제공한다. 사용자가 참고해서 직접 말하는 코치/프롬프터 용도.

## Requirements

| # | 요구사항 | 우선순위 |
|---|---------|---------|
| R1 | 수동 트리거 (버튼 + 단축키 `Ctrl+Shift+A`) | MVP |
| R2 | 최근 3분 transcript에서 질문 식별 + 답변 생성 | MVP |
| R3 | OpenAI Responses API `web_search_preview`로 웹 검색 | MVP |
| R4 | 미팅 언어 답변 + 한국어 번역 동시 표시 | MVP |
| R5 | 플로팅 카드 UI (드래그, 닫기, 복사) | MVP |
| R6 | SSE 스트리밍 응답 (실시간 타이핑) | MVP |
| R7 | 커스텀 소스 검색 (Confluence, Notion 등) | Future |
| R8 | 답변 히스토리 저장 | Future |
| R9 | 자동 질문 감지 | Future |

## Architecture

```
┌─────────────── BROWSER ───────────────────────────────────┐
│                                                            │
│  [Answer Assist 버튼] ──── click ────┐                     │
│                                      │                     │
│  useCaptionStore ─── getRecentTranscript(180s)             │
│  (committed segments, isFinal:true)  │                     │
│                                      ▼                     │
│                            POST /api/answer-assist         │
│                            { transcript, lang }            │
│                                      │                     │
│                                 SSE stream                 │
│                                      │                     │
│  ┌───────────────────────────────────▼──────────────┐      │
│  │ AnswerAssistCard (플로팅 카드)                     │      │
│  │ ┌──────────────────────────────────────────┐     │      │
│  │ │ [EN] React Server Components allow...    │     │      │
│  │ ├──────────────────────────────────────────┤     │      │
│  │ │ [KR] React 서버 컴포넌트는...              │     │      │
│  │ └──────────────────────────────────────────┘     │      │
│  │                          [복사 EN] [복사 KR]      │      │
│  └──────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────── PROXY (Node.js) ───────────────────────────┐
│                                                            │
│  POST /api/answer-assist                                   │
│  ├─ transcript 수신 (최근 3분)                              │
│  ├─ OpenAI Responses API 호출                               │
│  │   model: gpt-4.1-mini                                   │
│  │   tools: [web_search_preview]                           │
│  │   input: system prompt + transcript                     │
│  ├─ SSE 스트리밍 응답 → 브라우저                             │
│  └─ 응답: answer (미팅 언어) + answer_ko (한국어)            │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## Proxy Endpoint — `POST /api/answer-assist`

### Request

```
POST /api/answer-assist
Content-Type: application/json
Accept: text/event-stream

{
  "transcript": "string — 최근 3분간 committed transcript 합침",
  "lang": "en"  // App.tsx의 language detection에서 감지된 source language
}
```

### Server Processing

```js
const response = await openai.responses.create({
  model: process.env.ANSWER_ASSIST_MODEL || "gpt-4.1-mini",
  tools: [{ type: "web_search_preview" }],
  input: [
    { role: "system", content: ANSWER_ASSIST_SYSTEM_PROMPT },
    { role: "user", content: transcript }
  ],
  stream: true
});
```

### System Prompt

핵심 지시사항:
- 주어진 transcript에서 가장 최근 질문을 식별
- 필요하면 `web_search_preview`로 관련 정보 검색
- 답변을 미팅 언어(`lang` 파라미터)로 먼저 작성
- 이어서 한국어 번역 작성
- 간결하게 3-5문장, 바로 말할 수 있는 자연스러운 톤
- 두 섹션을 `---` 구분자로 분리 (proxy가 파싱하여 `section` SSE 이벤트로 변환)
- 질문이 감지되지 않으면 `[NO_QUESTION]` 마커로 응답 (proxy가 파싱하여 `no_question` SSE 이벤트로 변환)

### SSE Response Format

```
data: {"type":"searching","query":"React Server Components benefits"}
data: {"type":"delta","content":"React Server Components allow..."}
data: {"type":"delta","content":"...server-side rendering"}
data: {"type":"section","name":"ko"}
data: {"type":"delta","content":"React 서버 컴포넌트는..."}
data: {"type":"done","answer":"full answer","answer_ko":"전체 한국어 답변"}
```

이벤트 타입:
- `searching` — 웹 검색 시작 (쿼리 표시용)
- `delta` — 답변 텍스트 청크 (스트리밍)
- `section` — 언어 섹션 전환 (`ko` 시작)
- `done` — 전체 답변 완료 (최종 텍스트 포함)
- `error` — 에러 발생
- `no_question` — 질문이 감지되지 않음

### Error Handling

- transcript 비어있거나 20자 미만 → HTTP 400
- 질문 미감지 → SSE `no_question` 이벤트
- API 429 → 3x retry (기존 proxy 패턴과 동일)
- 이전 요청 진행 중 → 클라이언트 측 AbortController로 취소

## Frontend — Transcript Collection

### `useCaptionStore` 수정

`getRecentTranscript(windowMs)` 헬퍼 추가:
- `items[]`에서 `createdAtMs`가 `Date.now() - windowMs` 이후인 세그먼트 필터링
- 시간순 정렬 후 `.text` 합침
- 최소 20자 미만이면 빈 문자열 반환

### Transcript 수집 파라미터

| 파라미터 | 기본값 | 환경변수 |
|---------|-------|---------|
| 수집 범위 | 180,000ms (3분) | `ANSWER_ASSIST_TRANSCRIPT_WINDOW_MS` |
| 최소 길이 | 20자 | 하드코딩 |

## Frontend — Answer Assist Store

### `useAnswerAssistStore`

```ts
interface AnswerAssistState {
  status: 'idle' | 'loading' | 'searching' | 'streaming' | 'done' | 'error'
  searchQuery: string | null
  answer: string
  answerKo: string
  errorMessage: string | null
  abortController: AbortController | null
}
```

### 상태 전이

```
idle → loading (버튼 클릭)
loading → searching (searching 이벤트 수신)
loading → streaming (첫 delta 이벤트 수신, 검색 없이 바로 답변)
searching → streaming (첫 delta 이벤트 수신)
streaming → done (done 이벤트 수신)
loading → error (에러 또는 no_question)
any → idle (카드 닫기)
any → loading (재요청 — 이전 abort 후)
```

### 액션

- `requestAnswer(transcript, lang)` — 요청 시작, SSE 연결, 상태 업데이트
- `dismiss()` — 카드 닫기, abort, 상태 idle로 리셋
- `copyAnswer(section: 'source' | 'ko')` — 클립보드 복사 (source = 미팅 언어)

## Frontend — AnswerAssistCard UI

### 레이아웃

```
┌─────────────────────────────────────────────┐
│  Answer Assist                    [×]       │
├─────────────────────────────────────────────┤
│                                             │
│  "React Server Components" 검색 중...        │  ← searching
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  React Server Components allow you to       │  ← 미팅 언어 답변
│  render components on the server...         │
│                                             │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│                                             │
│  React 서버 컴포넌트는 서버에서 컴포넌트를     │  ← 한국어 번역
│  렌더링하여...                               │
│                                             │
├─────────────────────────────────────────────┤
│                         [복사 EN] [복사 KR]  │
└─────────────────────────────────────────────┘
```

### 상태별 표시

| 상태 | 표시 내용 |
|-----|---------|
| `idle` | 카드 숨김 |
| `loading` | 카드 표시 + "답변 준비 중..." 스켈레톤 |
| `searching` | 검색 쿼리 + 로딩 인디케이터 |
| `streaming` | 답변 텍스트 실시간 타이핑 |
| `done` | 전체 답변 + 복사 버튼 활성화 |
| `error` | 에러 메시지 ("질문이 감지되지 않았습니다" 등) |

### 동작

- **드래그 이동** — 미팅 화면 가림 방지
- **닫기** — 닫기 버튼 또는 `Esc`
- **복사** — 각 언어별 텍스트 클립보드 복사
- **최대 높이** — 카드 높이 제한 + 내부 스크롤
- **기본 위치** — 화면 우하단, 자막 오버레이와 겹치지 않게

### 스타일링

- 배경: `bg-zinc-900/95` + `backdrop-blur-sm`
- 보더: `border border-white/10` + `shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`
- 텍스트: `text-sm text-zinc-100` (답변), `text-sm text-zinc-400` (한국어)
- 버튼: `text-xs` + Phosphor `Copy` / `X` 아이콘
- 라운딩: `rounded-xl`
- 너비: `w-[400px]` 고정, 최대 높이 `max-h-[50vh]`

## App.tsx 수정

- Answer Assist 트리거 버튼 추가 (자막 오버레이 영역 근처)
- `Ctrl+Shift+A` 단축키 등록 (`useEffect` + `keydown` 리스너)
- `<AnswerAssistCard />` 컴포넌트 마운트
- 버튼 상태: idle → 기본, loading/streaming → 스피너

## File Changes

### 새로 추가

| 파일 | 목적 |
|-----|-----|
| `src/renderer/answer-assist/AnswerAssistCard.tsx` | 플로팅 카드 UI |
| `src/renderer/answer-assist/useAnswerAssistStore.ts` | 상태 관리 |
| `src/renderer/answer-assist/types.ts` | 타입 정의 |

### 수정

| 파일 | 변경 내용 |
|-----|---------|
| `server/proxy.mjs` | `POST /api/answer-assist` 엔드포인트 추가 |
| `src/App.tsx` | 트리거 버튼 + 카드 마운트 + 단축키 |
| `src/renderer/overlay/useCaptionStore.ts` | `getRecentTranscript()` 헬퍼 노출 |

### 변경 없음

- STT 파이프라인 (capture, realtimeClient, transcriptBus)
- 화이트보드 파이프라인 (session, prompt, tools, elements)
- 번역 파이프라인 (translator, queue)

## Environment Variables

| 변수 | 기본값 | 설명 |
|-----|-------|-----|
| `ANSWER_ASSIST_MODEL` | `gpt-4.1-mini` | 답변 생성 모델 |
| `ANSWER_ASSIST_TRANSCRIPT_WINDOW_MS` | `180000` | transcript 수집 범위 (ms) |

## Testing

- `scripts/test-answer-assist.js` — proxy 엔드포인트 스모크 테스트 (샘플 transcript → SSE 응답 확인)
- 수동 QA: 실제 미팅 녹음 재생 → 버튼 클릭 → 플로팅 카드 답변 확인

## Out of Scope

- 답변 히스토리 저장/조회
- 사전 자료 업로드 (RAG)
- 커스텀 소스 검색 (Confluence, Notion)
- TTS로 답변 읽어주기
- 자동 질문 감지 (트리거 자동화)
- 답변 편집 기능
