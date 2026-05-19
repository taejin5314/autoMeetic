# Meeting Memory Foundation — Design

Date: 2026-05-17
Status: Draft (under review)
Owner: autoMeetic
Implementation target: Codex (CLI agent)

---

## 0. Problem Framing

### What is being improved

autoMeetic은 라이브 미팅 STT, 번역, 화이트보드, Answer Assist, Action Items까지 갖췄지만 **모든 미팅 데이터가 휘발됨**. 캡처를 중단하는 순간 transcript / 번역 / 액션 아이템이 사라진다. 사용자가 "지난주에 그거 뭐라고 했지?"를 물을 곳이 없다.

이 스펙은 **미팅을 영속화하고, 자동 요약을 생성하고, 자연어로 의미 검색**할 수 있는 메모리 레이어를 처음으로 도입한다.

### Unit of evaluation

한 미팅의 라이프사이클(시작 → 캡처 → 종료 → 요약 → 검색 가능)이 끝까지 동작하는지 확인하는 5개 수동 E2E 시나리오 + 신규 단위 테스트 25개 이상.

### Fixed vs changeable

**Fixed (변경 금지)**:

- 기존 STT pipeline: [src/main/sttService.ts](../../../src/main/sttService.ts), [src/main/stt/transcriptBus.ts](../../../src/main/stt/transcriptBus.ts), [src/main/translate/](../../../src/main/translate)
- 기존 IPC 채널 시그니처 (`start-transcription`, `stop-transcription`, `stt:partial`, `stt:committed` 등)
- 기존 라이브 캡션 / 화이트보드 / Answer Assist / Action Items UI
- Live feed latency 기준 (`docs/superpowers/specs/2026-05-14-live-feed-latency-v2-design.md`)

**Changeable**:

- `src/main/ipc.ts` 에 새 핸들러 등록
- `src/main/sttService.ts` 에 lifecycle hook 호출 (라인 추가만)
- `src/preload/`에 `window.api.memory.*` 노출
- `src/renderer/App.tsx` 에 Library 토글 + 현재 미팅 인라인 표시

### Honest differentiation

이 스펙 단독으로는 Granola/Otter가 이미 제공하는 표준 기능군이다. 진짜 차별화 — "내 미팅이 Claude/ChatGPT에서 직접 쿼리 가능" — 은 **다음 스펙(MCP 서버 노출)**에서 완성된다. 이번 라운드는 그 위에 얹을 foundation이다.

---

## 1. Harness Definition

### Interface contract

새로 추가되는 사용자-가시 인터페이스:

| 위치 | 인터페이스 |
| --- | --- |
| Renderer | `window.api.memory.listMeetings(limit, offset): MeetingSummary[]` |
| Renderer | `window.api.memory.getMeeting(id): MeetingDetail` |
| Renderer | `window.api.memory.search(query, limit): SearchHit[]` |
| Renderer | `window.api.memory.renameMeeting(id, title): void` |
| Renderer | `window.api.memory.deleteMeeting(id): void` |
| Renderer | `window.api.memory.exportMeeting(id, 'markdown'): string` |
| Renderer | `window.api.memory.regenerateSummary(id): void` |
| Main → Renderer event | `memory:meeting-updated` (요약 생성 / 임베딩 완료 등) |
| UI | 메인 화면 Library 토글 버튼 (라이브 화면 그대로 두고 풀스크린 sheet) |
| UI | 캡처 토글 옆 현재 미팅 제목 인라인 표시 (클릭으로 제목 변경) |

### Out of scope (이 스펙)

- **MCP 서버 노출** — Spec #2
- **다중 미팅 가로지르는 LLM 답변 합성** ("지난달 1:1 요약 알려줘") — RAG 응답 합성은 Spec #2 또는 #3
- **외부 통합** (Notion / Linear / Slack / webhook)
- **미팅 타입별 Recipe 모드** (인터뷰, 강의 등)
- **공유 화면 OCR / 슬라이드 컨텍스트**
- **이름 붙은 화자 식별** (현재 `Speaker A/B/C` 그대로 사용)
- **미팅 수동 분할 / 병합**
- **DB 암호화** (운영체제 사용자 권한에 의존, 평문)
- **백업 / 동기화** (수동 markdown export만)
- **검색 필터** (언어/기간/화자) — v2
- **FTS5 키워드 매칭 보강** — 임베딩만으로 정확도 측정 후 결정

### Approach comparison (record of decisions)

| 결정 항목 | 선택 | 대안 | 이유 |
| --- | --- | --- | --- |
| 데이터 저장소 | SQLite (`better-sqlite3`) | LanceDB, DuckDB, 평문 JSON | Electron + sync API + WAL + 작은 native footprint. JSON은 검색/JOIN 약함. |
| 벡터 인덱스 | SQLite + JS in-memory KNN | `sqlite-vec` 확장 | 5k 미팅까지 50ms 이내. native binding 추가 회피. v2에서 `sqlite-vec`로 확장 옵션 명시. |
| 임베딩 모델 | `@xenova/transformers` + `Xenova/multilingual-e5-small` (WASM) | ONNX Runtime Node, Python sidecar | 빌드 매트릭스 영향 0. Python sidecar는 Windows 빌드 폭발. ONNX Node는 native rebuild 비용. |
| 임베딩 실행 위치 | Node.js `worker_threads` | 메인 스레드, renderer | 메인 스레드 200-500ms 첫 추론이 IPC 막음. renderer는 모델 캐시 위치 분리 어려움. |
| 요약 모델 | OpenAI `gpt-4o-mini` (proxyService 재활용) | 로컬 LLM | 한국어 요약 품질 + 짧은 호출 비용 + 기존 인프라 재활용. |
| 요약 트리거 | 미팅 종료 직후 자동 + 수동 재생성 가능 | 명시적 요청만 | 사용자 의도("회상용")에 맞춤. 토큰 한도/끄기 옵션 제공. |
| 검색 쿼리 prefix | e5 표준 `query:` / `passage:` | prefix 없음 | e5는 prefix 없으면 정확도 크게 떨어짐. |
| 미팅 경계 | STT start/stop과 1:1 | 명시적 미팅 생성 버튼 | 사용자 동선 최소. 캡처 시작이 곧 미팅 시작. |

### Blast radius

- 새 디렉토리: `src/main/memory/`, `src/renderer/library/`
- 수정 대상: `ipc.ts`, `sttService.ts`, `preload/index.ts`, `App.tsx`, `electron-builder.yml`, `package.json`
- 신규 native dep: `better-sqlite3` (Electron rebuild 필요)
- 신규 pure JS dep: `@xenova/transformers`
- DB 마이그레이션: v0 (없던 상태) → v1. 첫 부팅 시 빈 DB 생성.

---

## 2. Architecture

### Component map

```
사용자 액션                           Main process                            Renderer
─────────────                         ─────────────                           ────────
Library 토글 ────────────────────────────────────────────────────────────────▶ LibraryPanel.tsx
                                                                              MeetingDetailView.tsx
                                                                              useMeetingLibraryStore.ts

캡처 시작 ──▶ start-transcription ──▶ sttService.startTranscription()
                                       └─▶ meetingLifecycle.beginMeeting() ──▶ memory:meeting-updated
                                              └─▶ repository.createMeeting()
TranscriptBus (final) ──────────────▶ segmentSink.onSegment()
                                       ├─▶ repository.insertSegment()
                                       └─▶ embeddingQueue.enqueue(segmentId,text)
                                              └─▶ worker_thread:
                                                    pipeline('feature-extraction', e5-small)
                                                    repository.saveEmbedding()

캡처 중단 ──▶ stop-transcription ───▶ sttService.stopTranscription()
                                       └─▶ meetingLifecycle.endMeeting()
                                              ├─▶ repository.markCompleted()
                                              └─▶ summaryService.generate(meetingId) (bg)
                                                    └─▶ proxyService → OpenAI gpt-4o-mini
                                                          └─▶ repository.saveSummary()
                                                                └─▶ memory:meeting-updated

검색 입력 ──▶ memory:search ─────────▶ searchService.search(query)
                                       ├─▶ embed query (worker)
                                       └─▶ in-memory KNN over segment_embeddings
                                              └─▶ join meetings/segments → SearchHit[]
```

### Module inventory

#### New main process modules — `src/main/memory/`

| File | Exports | Responsibility |
| --- | --- | --- |
| `types.ts` | `Meeting`, `Segment`, `Summary`, `SegmentEmbedding`, `MeetingSummary`, `MeetingDetail`, `SearchHit`, `MemoryConfig` | DB row types + public API types |
| `repository.ts` | `class MemoryRepository` | better-sqlite3 위 CRUD. PRAGMA WAL, foreign_keys=ON. 모든 read는 sync, write는 transaction. |
| `meetingLifecycle.ts` | `beginMeeting()`, `endMeeting()`, `getCurrentMeetingId()`, `recoverInterruptedMeetings()` | 미팅 ID 발급 + STT 라이프사이클 hook. 앱 부팅 시 `status='live'`인 미팅을 `failed`로 마킹. |
| `transcriptHook.ts` | `attachTranscriptHook(repo, queue, getCurrentId)`, `notifyTurnFinalized(turn)`, `notifyTranslation(turnId, translation)` | `transcriptPostProcessor.ts`가 호출할 callback. turn finalize 시 segment row insert + 임베딩 enqueue. translation 도착 시 row update. |
| `embeddingService.ts` | `class EmbeddingService` with `embedPassages(texts)`, `embedQuery(text)` | worker_thread 띄우고 메시지로 통신. lazy load. e5 prefix 적용. |
| `embeddingWorker.ts` | `worker_threads` entry | `@xenova/transformers` 로드, message receive → batch infer → reply |
| `embeddingQueue.ts` | `class EmbeddingQueue` with `enqueue()`, `drain()` | FIFO + batch size 16 + 동시 1 워크 |
| `summaryService.ts` | `generateSummary(meetingId): Promise<Summary>` | repo에서 transcript 로드 → 시간 청크 분할 (15분 경계) → OpenAI 호출 → JSON 파싱 + 1회 재시도 → repo 저장 |
| `searchService.ts` | `search(query, limit): SearchHit[]` | 모든 임베딩을 한 번에 로드(또는 LRU 캐시) → query 벡터 임베딩 → cosine similarity 정렬 → top-K |
| `markdownExporter.ts` | `exportMeetingMarkdown(meetingId): string` | 미팅 + 요약 + transcript를 마크다운으로 |
| `memoryService.ts` | `class MemoryService` | 위 모듈들 wire up + IPC가 호출할 facade |

#### New renderer modules — `src/renderer/library/`

| File | Responsibility |
| --- | --- |
| `LibraryPanel.tsx` | 풀스크린 sheet 컨테이너. 미팅 목록 카드 그리드 + 검색 바 |
| `MeetingCard.tsx` | 미팅 카드 (제목, 날짜, 길이, 언어, shortSummary) |
| `MeetingDetailView.tsx` | 미팅 상세 (요약 / 핵심포인트 / 액션아이템 / transcript) |
| `SearchBar.tsx` | 디바운스 250ms |
| `SearchResultList.tsx` | 결과 카드 (미팅 메타 + 세그먼트 + 번역 + 유사도) |
| `useMeetingLibraryStore.ts` | jotai atoms: meetings list, currentMeetingDetail, searchQuery, searchResults |
| `libraryApi.ts` | `window.api.memory.*` 호출 thin wrapper |

#### Modified files

| File | Change |
| --- | --- |
| `src/main/index.ts` | 앱 부팅 시 `MemoryService.initialize()` 호출 + `meetingLifecycle.recoverInterruptedMeetings()` |
| `src/main/ipc.ts` | `memory:*` IPC 핸들러 등록. `start-transcription` / `stop-transcription`에 `beginMeeting/endMeeting` 호출 추가 |
| `src/main/transcriptPostProcessor.ts` | `finalizeActiveSourceTurn` / `emitFinalDownstream`에서 memory hook (`notifyTurnFinalized`) 호출. `drainTranslationQueue`에서 translation 응답 받은 후 `notifyTranslation` 호출. 변경 라인 최소 (각 위치에 한 줄씩 추가). **AGENTS.md 명시 high-risk 영역.** |
| `src/preload/index.ts` | `memory: { listMeetings, getMeeting, search, renameMeeting, deleteMeeting, exportMeeting, regenerateSummary }` 노출 + `onMeetingUpdated(handler)` 이벤트 구독 |
| `src/renderer/App.tsx` | 헤더에 Library 토글 버튼 + 현재 미팅 제목 인라인. Library 열렸을 때 본 화면 sheet 뒤로 |
| `src/main/proxyService.ts` | `summarizeMeeting(transcript: string): Promise<SummaryJSON>` 함수 추가. 기존 패턴 유지. |
| `package.json` | `better-sqlite3`, `@xenova/transformers` 추가. `postinstall: electron-rebuild`. |
| `electron-builder.yml` | `asarUnpack`에 `node_modules/better-sqlite3/build/**` 추가 |
| `electron.vite.config.ts` | `better-sqlite3`, `@xenova/transformers` external 처리 (main process build) |

---

## 3. Data Model

### SQLite schema

DB path: `app.getPath('userData')/memory.db`. PRAGMA `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`.

```sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY
);
INSERT INTO schema_version(version) VALUES (1);

CREATE TABLE meetings (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  source_language TEXT,
  target_language TEXT,
  status          TEXT NOT NULL CHECK (status IN ('live','completed','failed')),
  segment_count   INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER
);
CREATE INDEX idx_meetings_started ON meetings(started_at DESC);
CREATE INDEX idx_meetings_status ON meetings(status);

CREATE TABLE segments (
  id              TEXT PRIMARY KEY,
  meeting_id      TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  speaker_id      TEXT,
  speaker_label   TEXT,
  source_text     TEXT NOT NULL,
  translated_text TEXT,
  source_language TEXT
);
CREATE INDEX idx_segments_meeting_seq ON segments(meeting_id, seq);

CREATE TABLE summaries (
  meeting_id        TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  short_summary     TEXT NOT NULL,
  detailed_summary  TEXT NOT NULL,
  key_points        TEXT NOT NULL,  -- JSON string[]
  action_items      TEXT NOT NULL,  -- JSON {text,owner?,due?}[]
  generated_at      INTEGER NOT NULL,
  model             TEXT NOT NULL,
  prompt_version    TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('ok','failed')) DEFAULT 'ok'
);

CREATE TABLE segment_embeddings (
  segment_id TEXT PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
  vector     BLOB NOT NULL,                  -- Float32Array 384 dims (1536 bytes)
  model      TEXT NOT NULL
);
```

### TypeScript types — `src/main/memory/types.ts`

```ts
export interface Meeting {
  id: string
  title: string
  startedAt: number
  endedAt: number | null
  sourceLanguage: string | null
  targetLanguage: string | null
  status: 'live' | 'completed' | 'failed'
  segmentCount: number
  durationMs: number | null
}

export interface Segment {
  id: string
  meetingId: string
  seq: number
  createdAt: number
  speakerId: string | null
  speakerLabel: string | null
  sourceText: string
  translatedText: string | null
  sourceLanguage: string | null
}

export interface SummaryJSON {
  shortSummary: string
  detailedSummary: string
  keyPoints: string[]
  actionItems: Array<{ text: string; owner?: string; due?: string }>
}

export interface Summary extends SummaryJSON {
  meetingId: string
  generatedAt: number
  model: string
  promptVersion: string
  status: 'ok' | 'failed'
}

export interface MeetingSummary {
  meeting: Meeting
  shortSummary: string | null    // null when summary not yet generated
}

export interface MeetingDetail {
  meeting: Meeting
  summary: Summary | null
  segments: Segment[]
}

export interface SearchHit {
  meetingId: string
  meetingTitle: string
  startedAt: number
  segmentId: string
  seq: number
  speakerLabel: string | null
  sourceText: string
  translatedText: string | null
  score: number
}
```

### ID format

- 미팅: `mtg_<base36 timestamp>_<6 random base36 chars>`
- 세그먼트: **`transcriptPostProcessor.ts`의 `makeTurnId` 결과 (`turn_<ts>_<rand>`)를 그대로 PK로 사용.** 별도 ID를 만들면 turn ↔ segment 매핑 테이블이 필요해 복잡도가 늘어남. renderer가 이미 turn ID를 알고 있어 검색 결과에서 해당 라이브 row로 점프할 때도 같은 ID 활용 가능.

`src/main/audio/capture.ts`의 `makeId()` 패턴 재사용 (미팅 ID 한정).

### Storage estimates

- 1시간 미팅 (300 세그먼트, 평균 100자):
  - segments rows: ~120KB
  - segment_embeddings: 300 × (16+1536) = ~470KB
  - summary: ~5KB
  - 총 ~600KB → **3MB는 보수적 상한**
- 1000개 미팅 (1시간씩): 약 600MB
- multilingual-e5-small 모델 파일 (`userData/embedding-cache`): ~120MB

---

## 4. Meeting Lifecycle

### Begin

```
사용자 'Start' 클릭
  → renderer: ipc.invoke('start-transcription', {language})
  → main ipc.ts:
       sttService.startTranscription(language, mainWindow)          // 기존
       const meetingId = memoryService.beginMeeting({                // 신규
         sourceLanguage: language,
         targetLanguage: currentTargetLanguage
       })
       webContents.send('memory:meeting-updated', {meetingId, kind:'began'})
```

`beginMeeting`:

1. ID 발급
2. `meetings` row insert: `status='live'`, `started_at=now`, `title='미팅 ' + format(now,'yyyy-MM-dd HH:mm')`
3. `currentMeetingId`를 module-level 변수에 저장

### Segment ingest (실제 코드 흐름에 맞춤)

라이브 transcript는 [src/main/transcriptPostProcessor.ts](../../../src/main/transcriptPostProcessor.ts) 안에서:

1. delta가 누적되며 `activeSourceTurn`이 자라고 (`emitSourcePatch`)
2. 문장 끝 또는 타임아웃에 `finalizeActiveSourceTurn` 호출 → 한 turn 확정
3. translation은 별도 큐에서 처리되어 `emitTranslationPatch(id, translation)`로 같은 turn ID에 후속 도착

**Memory sink 통합 지점 두 군데** — `transcriptPostProcessor.ts`에 라인 추가:

```ts
// 1) finalizeActiveSourceTurn 안, emitFinalDownstream(active) 바로 다음:
import { notifyTurnFinalized } from './memory/transcriptHook'
// ...
function finalizeActiveSourceTurn(options: { translateImmediately: boolean }): void {
  const active = activeSourceTurn
  if (!active) return
  activeSourceTurn = null
  clearActiveTimers(active)
  emitSourcePatch(active.id, active.text)
  emitFinalDownstream(active)
  notifyTurnFinalized({                    // ← 추가
    id: active.id,
    text: active.text,
    sourceLanguage: active.hints.sourceLanguageHint,
    targetLanguage: active.hints.targetLanguage,
    createdAtMs: active.createdAtMs,
    speakerId: 'unknown',
    speakerLabel: 'Unknown'
  })
  if (options.translateImmediately) scheduleTranslation(active, 0)
}

// 2) drainTranslationQueue 안, emitTranslationPatch 다음:
if (translationVersionsById.get(next.id) === next.version && response.translation) {
  emitTranslationPatch(next.id, response.translation)
  notifyTranslation(next.id, response.translation)   // ← 추가
}
```

`src/main/memory/transcriptHook.ts`:

```ts
import type { MemoryRepository } from './repository'
import type { EmbeddingQueue } from './embeddingQueue'

let repo: MemoryRepository | null = null
let queue: EmbeddingQueue | null = null
let getCurrentMeetingId: (() => string | null) | null = null

export function attachTranscriptHook(
  r: MemoryRepository,
  q: EmbeddingQueue,
  getCurrent: () => string | null
): void {
  repo = r
  queue = q
  getCurrentMeetingId = getCurrent
}

interface TurnPayload {
  id: string
  text: string
  sourceLanguage: string
  targetLanguage: string
  createdAtMs: number
  speakerId: string
  speakerLabel: string
}

export function notifyTurnFinalized(turn: TurnPayload): void {
  if (!repo || !queue || !getCurrentMeetingId) return
  const meetingId = getCurrentMeetingId()
  if (!meetingId) return
  const seq = repo.nextSeq(meetingId)
  repo.insertSegment({
    id: turn.id,             // turn_* ID를 그대로 PK로
    meetingId,
    seq,
    createdAt: turn.createdAtMs,
    speakerId: turn.speakerId,
    speakerLabel: turn.speakerLabel,
    sourceText: turn.text,
    translatedText: null,
    sourceLanguage: turn.sourceLanguage,
  })
  repo.incrementSegmentCount(meetingId)
  queue.enqueue({ segmentId: turn.id, text: turn.text })
}

export function notifyTranslation(turnId: string, translation: string): void {
  if (!repo) return
  repo.updateTranslation(turnId, translation)
}
```

**중요**: hook이 attach 되지 않은 상태 (test / 기능 disabled)에서는 모든 notify가 no-op이어야 함. 기존 `transcriptPostProcessor`의 동작에 영향 0. **이게 AGENTS.md가 명시한 high-risk 영역 회귀 방지의 핵심.**

### End

```
사용자 'Stop' 클릭
  → renderer: ipc.invoke('stop-transcription')
  → main ipc.ts:
       sttService.stopTranscription()                                 // 기존
       await embeddingQueue.drainPending(meetingId, timeoutMs=3000)   // 신규: 임베딩 일부 대기
       memoryService.endMeeting(meetingId)                            // 신규
```

`endMeeting`:

1. `meetings` row update: `ended_at=now`, `duration_ms=ended_at-started_at`, `status='completed'`
2. `currentMeetingId = null`
3. `summaryService.generate(meetingId)` 백그라운드 fire-and-forget
4. `webContents.send('memory:meeting-updated', {meetingId, kind:'ended'})`

요약 생성 끝나면 `memory:meeting-updated` `{meetingId, kind:'summary-ready'}` 발송.

### Recover

`MemoryService.initialize()` 안에서 부팅 시:

```ts
const stale = repo.findMeetingsByStatus('live')
for (const m of stale) {
  repo.markMeetingStatus(m.id, 'failed')
  // 요약 생성 시도하지 않음. 사용자가 라이브러리에서 보고 '요약 재생성' 누를 수 있음.
}
```

### Title editing

- 라이브러리 카드 더블클릭 또는 상세 뷰 상단 제목 클릭으로 inline edit
- `memory:rename-meeting(id, title)` → `repo.updateTitle` → `memory:meeting-updated` 발송

---

## 5. Summary Pipeline

### Trigger

미팅 종료 시 자동 1회. 환경변수 `MEMORY_SUMMARY_AUTO=false`로 끄기 가능 (그래도 수동 재생성 버튼은 동작).

`regenerateSummary(meetingId)` IPC로 수동 재생성. 기존 summary row가 있으면 덮어쓰기 (prompt_version 갱신).

### Input serialization

`generateSummary(meetingId)`:

1. `repo.getSegments(meetingId)` → 시간순
2. 직렬화:
   ```
   [00:01:23] Speaker A: ...원문...
   [00:01:30] Speaker B: ...원문...
   ```
3. 미팅 길이 분기:
   - `duration_ms <= 15*60*1000` → 단일 호출
   - 그 외 → 시간 기준 청크 (각 10분, 30초 오버랩). 청크별 요약 → 최종 reduce 호출.

청크 분할 알고리즘:

```ts
function chunkByTime(segments: Segment[], windowMs: number, overlapMs: number) {
  const chunks: Segment[][] = []
  if (segments.length === 0) return chunks
  const first = segments[0].createdAt
  const last = segments[segments.length - 1].createdAt
  let cursor = first
  while (cursor <= last) {
    const end = cursor + windowMs
    chunks.push(segments.filter(s => s.createdAt >= cursor && s.createdAt < end))
    cursor = end - overlapMs
  }
  return chunks.filter(c => c.length > 0)
}
```

### Prompt (v1)

`promptVersion = "v1"`. `src/main/memory/prompts/summary.v1.ts`로 분리.

System prompt:

```
당신은 미팅 분석가입니다. transcript를 받아 다음 JSON 스키마로만 한국어로 응답하세요.

{
  "shortSummary": "1-2문장",
  "detailedSummary": "마크다운 bullet 3-7개",
  "keyPoints": ["핵심 결정/사실 3-5개"],
  "actionItems": [{"text": "...", "owner": "Speaker A | 미지정", "due": "선택사항"}]
}

규칙:
- 원문 transcript의 사실만 사용. 새로운 정보를 만들지 마세요.
- 화자 식별이 불분명하면 owner를 "미지정"으로.
- 출력은 JSON만. 코드펜스나 설명 문장 금지.
```

User prompt: 직렬화된 transcript.

Reduce 호출 (긴 미팅용) — 시스템 프롬프트는 동일, user는 청크별 요약 JSON들을 이어붙여 보냄 + "이 청크별 요약들을 하나로 통합해 최종 JSON을 만들어 주세요."

### API call

`src/main/proxyService.ts`에 추가:

```ts
export async function summarizeMeeting(systemPrompt: string, userPrompt: string): Promise<string> {
  // 기존 proxyService의 OpenAI client / baseURL / API key 처리 패턴 그대로
  // response_format: { type: 'json_object' } 명시
  // 모델: process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4o-mini'
  // 반환: raw assistant content (JSON string)
}
```

### Parsing & retry

```ts
async function callAndParse(...): Promise<SummaryJSON> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await proxy.summarizeMeeting(sys, user)
    try {
      return validateSummaryJSON(JSON.parse(raw))
    } catch (err) {
      log.warn('[memory] summary JSON parse failed, attempt', attempt, err)
    }
  }
  throw new SummaryParseError()
}
```

`validateSummaryJSON`은 4개 필드 존재 + 타입 검증. `actionItems[].text` 비어있으면 제거.

### Token guardrail

호출 직전 input 토큰 추정 (간단히 `length / 3.5`로). `MEMORY_SUMMARY_MAX_INPUT_TOKENS`(기본 200000) 초과 시 `SummaryTooLargeError` throw, repo에 `status='failed'` + `short_summary='미팅이 너무 길어 요약을 생성할 수 없습니다 (수동 분할 권장).'` 저장.

토큰 사용량은 호출마다 [src/main/telemetry/logger.ts](../../../src/main/telemetry/logger.ts)로 로깅.

### Failure storage

요약 실패 시에도 row 저장 — `status='failed'`, `short_summary='요약 생성 실패. 다시 시도해 보세요.'`, 나머지 필드 빈값. UI에서 재시도 버튼 노출.

---

## 6. Embedding Pipeline

### Model

- `Xenova/multilingual-e5-small` (ONNX quantized, ~120MB)
- 384 dim
- 100개 언어 학습, 한국어 포함, 크로스링구얼 검색에 강함

### Prefix convention

```ts
// 저장 시 (passage)
const text = 'passage: ' + segment.sourceText
// 검색 시 (query)
const text = 'query: ' + userQuery
```

### Worker thread

`src/main/memory/embeddingWorker.ts`:

```ts
import { parentPort } from 'node:worker_threads'
import { pipeline } from '@xenova/transformers'

let extractor: any = null

async function ensure() {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
      quantized: true,
      cache_dir: process.env.MEMORY_EMBEDDING_CACHE_DIR
    })
  }
}

parentPort!.on('message', async (msg: { id: number; texts: string[] }) => {
  try {
    await ensure()
    const out = await extractor(msg.texts, { pooling: 'mean', normalize: true })
    // out.data is Float32Array; out.dims = [batch, 384]
    const vectors: Float32Array[] = []
    for (let i = 0; i < msg.texts.length; i++) {
      vectors.push(new Float32Array(out.data.buffer, out.data.byteOffset + i*384*4, 384).slice())
    }
    parentPort!.postMessage({ id: msg.id, vectors })
  } catch (err: any) {
    parentPort!.postMessage({ id: msg.id, error: err.message })
  }
})
```

`src/main/memory/embeddingService.ts`:

```ts
export class EmbeddingService {
  private worker: Worker
  private nextId = 0
  private pending = new Map<number, {resolve, reject}>()

  constructor(workerPath: string) {
    this.worker = new Worker(workerPath)
    this.worker.on('message', (m) => {
      const p = this.pending.get(m.id)
      this.pending.delete(m.id)
      if (m.error) p.reject(new Error(m.error))
      else p.resolve(m.vectors)
    })
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    return this.embedRaw(texts.map(t => 'passage: ' + t))
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [v] = await this.embedRaw(['query: ' + text])
    return v
  }

  private async embedRaw(texts: string[]): Promise<Float32Array[]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject})
      this.worker.postMessage({ id, texts })
    })
  }
}
```

### Queue

`src/main/memory/embeddingQueue.ts`:

- FIFO buffer of `{segmentId, text}`
- 워크 루프: 큐가 비어있지 않으면 최대 16개 take → `embeddingService.embedPassages` → `repo.saveEmbeddings`
- 동시 워크 1 (워커 자체가 1)
- `drainPending(meetingId, timeoutMs)`: 특정 미팅에 속한 segment의 임베딩이 끝날 때까지 대기 (or timeout). End meeting 직전 호출.

### Storage

`Float32Array(384)` → `Buffer.from(f32.buffer)` → BLOB. 384 × 4 = 1536 bytes per row.

읽을 때 `new Float32Array(buf.buffer, buf.byteOffset, 384)`.

### Recovery

부팅 시 `MemoryService.initialize()`에서:

```sql
SELECT s.id, s.source_text
FROM segments s
LEFT JOIN segment_embeddings e ON e.segment_id = s.id
WHERE e.segment_id IS NULL
```

결과를 임베딩 큐에 재투입.

### Offline behavior

`@xenova/transformers` 첫 로드 시 모델 다운로드 (HuggingFace CDN). 네트워크 없으면:

1. 워커가 timeout (15초) 후 에러
2. `EmbeddingService.healthy = false`
3. `search()` 호출 시 `EmbeddingUnavailableError` throw
4. UI: 검색바에 "검색 기능이 비활성화됨 (모델 다운로드 필요)" 안내
5. 미팅 저장/요약(OpenAI는 별도)은 정상 동작
6. 다음 미팅 종료 시 또는 검색 시도 시 재시도

---

## 7. Search

### Algorithm

1. 쿼리 임베딩 (worker 1회, ~30ms)
2. 모든 `segment_embeddings` 로드 (in-memory). 캐시 LRU 또는 단순히 module-level 변수 + invalidation on insert
3. 코사인 유사도 = dot product (e5는 normalize=true라서 dot=cosine)
4. score >= 0.5 필터
5. score DESC 정렬, top-K (기본 20)
6. JOIN으로 `meetings`, `segments` 컬럼 채워서 반환

In-memory KNN 구현은 단순 Float32Array dot product 루프. 5000 세그먼트 × 1000 미팅 = 5M dot, 384 dim → ~50ms.

### Query path

```
SearchBar.tsx (debounce 250ms)
  → useMeetingLibraryStore.search(query)
  → libraryApi.search(query)
  → window.api.memory.search(query, limit)
  → ipcMain.handle('memory:search')
  → memoryService.search(query, limit)
  → embeddingService.embedQuery + scoring loop
  → SearchHit[]
```

### Empty states

- 미팅 0개: 라이브러리 진입 시 "아직 저장된 미팅이 없어요. 캡처를 시작해 보세요."
- 쿼리 결과 0건: `"<query>"에 매칭되는 내용이 없어요. 다른 단어로 시도해 보세요.`

---

## 8. Library UI

### Layout (Tailwind v3, project guidelines 준수)

- 컨테이너: `min-h-[100dvh] max-w-[1400px] mx-auto px-6 py-8`
- 그리드: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`
- 카드 elevation: zinc-tinted shadow, no white glow
- 타이포: `Geist` (이미 프로젝트에서 사용 추정 — 확인 후 fallback `system-ui`)
- 색상: 기존 [src/renderer/theme/](../../../src/renderer/theme) 토큰 재사용. 새 색 도입 금지.

### Library Panel sheet behavior

- App.tsx 헤더에 `[Library]` 버튼. 클릭 → renderer-only state `isLibraryOpen=true`
- 라이브 화면은 `aria-hidden` + 시각적 dim. 캡처는 계속 동작.
- ESC 또는 [X] 버튼으로 닫기. 닫으면 currentMeetingDetail 비움.

### Meeting cards

```
┌─────────────────────────────────────────┐
│ 미팅 05-17 14:30                  ⋮     │
│ 32분 · 영어 → 한국어                     │
│ ─────────────────────────────────────── │
│ Q2 로드맵 정리 미팅. 수요 예측은 prophet  │
│ 으로 결정.                               │
└─────────────────────────────────────────┘
```

- 요약 미생성 상태: `shortSummary` 자리에 `"요약 생성 중..."` skeleton
- 요약 실패 상태: `"요약 생성 실패 (재시도)"`, 버튼으로 regenerate

### Meeting Detail View

- 상단 우측 메뉴 (`⋮`): `제목 변경` / `Markdown으로 내보내기` / `요약 재생성` / `삭제` (확인 모달)
- 요약 / 자세히 / 핵심 포인트 / 액션 아이템: 콜랩서블 카드. 기본 펼침은 `요약`만.
- transcript: 가상 스크롤 X (1시간 미팅 300 row면 보통 DOM도 OK). 5000 row 넘는 미팅은 v2.
- 각 row: `[mm:ss] Speaker A: 원문 / 번역 (있으면)`.

### Search results

- 카드 그리드는 사라지고 결과 리스트로 전환
- 결과 카드 클릭 시 미팅 상세 뷰로 push navigation + `seq` 위치로 anchor scroll + 5초 동안 하이라이트
- 결과 위에 "검색 결과 N개 · 쿼리: 〈...〉 / [전체 미팅 보기]" 클리어 액션

### Inline current-meeting title

App.tsx 헤더, 캡처 토글 옆:

```
[●REC] [미팅 05-17 14:30  (편집)]   30 발화
```

- 클릭 → inline `<input>` 으로 전환 → blur 또는 Enter → `memory:rename-meeting`
- ESC로 취소

### Notification toast

- 캡처 중단 직후: "미팅 저장 완료. 요약 생성 중…"
- 요약 준비됨: "요약 준비됨 → 라이브러리에서 보기" (CTA 라이브러리 오픈)
- 요약 실패: "요약 생성 실패 — 라이브러리에서 재시도하세요"
- 토스트 컴포넌트는 새로 만들지 말고, 기존에 있으면 재사용. 없으면 가장 단순한 `aria-live=polite` div 한 개로.

---

## 9. IPC contracts (final)

### Preload exposure — `src/preload/index.ts`

```ts
window.api.memory = {
  listMeetings: (limit?: number, offset?: number) => Promise<MeetingSummary[]>,
  getMeeting: (id: string) => Promise<MeetingDetail>,
  search: (query: string, limit?: number) => Promise<SearchHit[]>,
  renameMeeting: (id: string, title: string) => Promise<void>,
  deleteMeeting: (id: string) => Promise<void>,
  exportMeeting: (id: string, format: 'markdown') => Promise<string>,
  regenerateSummary: (id: string) => Promise<void>,
  onMeetingUpdated: (handler: (evt: { meetingId: string; kind: 'began' | 'segment-added' | 'ended' | 'summary-ready' | 'summary-failed' | 'renamed' | 'deleted' }) => void) => () => void
}
```

### IPC channels

| Channel | Direction | Args | Returns |
| --- | --- | --- | --- |
| `memory:list-meetings` | invoke | `{limit?, offset?}` | `MeetingSummary[]` |
| `memory:get-meeting` | invoke | `{id}` | `MeetingDetail` |
| `memory:search` | invoke | `{query, limit?}` | `SearchHit[]` |
| `memory:rename-meeting` | invoke | `{id, title}` | `void` |
| `memory:delete-meeting` | invoke | `{id}` | `void` |
| `memory:export-meeting` | invoke | `{id, format}` | `string` |
| `memory:regenerate-summary` | invoke | `{id}` | `void` |
| `memory:meeting-updated` | event (main→renderer) | `{meetingId, kind}` | — |

기존 채널 변경 없음.

---

## 10. Evaluation Plan

### Primary metric (PR ready)

- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm test` 통과 (신규 ≥25개 포함)
- `npm run build:win` 통과 (better-sqlite3 native build 확인)
- 수동 E2E 5종 통과

### Manual E2E scenarios

1. **저장 라이프사이클**: 캡처 시작 → 한국어 10문장 발화 → 중단 → 라이브러리에 카드 1개, 요약 자동 생성 (≤30초)
2. **크로스링구얼 요약**: 영어 미팅 5분 → 중단 → 요약이 한국어로 출력됨
3. **의미 검색**: "수요 예측" 한국어 쿼리로 영어 미팅 세그먼트 검색됨 (top-1 score ≥ 0.5)
4. **삭제 cascade**: 미팅 삭제 → 해당 segments / embeddings / summary 모두 사라짐 (DB 확인)
5. **복구**: 캡처 중 앱 강제 종료(Task Manager kill) → 재시작 → 'live' 미팅이 'failed'로 마킹됨, UI에 "복구된 미팅" 표시

### Secondary metrics

- 미팅 종료 후 요약 P50 ≤ 8초 (10분 미팅)
- 라이브 캡션 latency 회귀 없음 — [docs/superpowers/specs/2026-05-14-live-feed-latency-v2-design.md](2026-05-14-live-feed-latency-v2-design.md) 의 측정 절차 재실행
- 임베딩 큐 lag P95 ≤ 2초
- 검색 응답 P95 ≤ 200ms (≤5k 세그먼트)
- DB 크기: 1시간 미팅 ≤ 3MB

### Test inventory (≥25)

| Module | Tests |
| --- | --- |
| `meetingLifecycle.ts` | begin→end 상태 전이; ID 유니크; recover marks live→failed; 동시 begin 호출 거부; getCurrent reset |
| `repository.ts` | insert/get/list; cascade delete; updateTitle; updateTranslation; nextSeq monotonic; transaction rollback; concurrent reads |
| `transcriptHook.ts` | hook 미장착 시 no-op (회귀 가드); 정상 hook 시 insert+enqueue; meeting-less turn 무시; translation update; multiple meetings 격리 |
| `embeddingQueue.ts` | batch up to 16; FIFO; drainPending timeout; error swallow |
| `embeddingService.ts` (worker mocked) | passage prefix; query prefix; batch; pending map cleared |
| `summaryService.ts` | short meeting single-call; long meeting chunking; reduce step called; JSON parse retry; token guard rejects oversized; failed status saved |
| `searchService.ts` | top-K sorted; threshold filter; empty result; cosine accuracy on known vectors |
| `markdownExporter.ts` | meeting + summary + segments roundtrip; missing summary handled |
| IPC handlers | each channel happy path; error → renderer error response |
| Regression | transcriptPostProcessor → 기존 라이브 UI 이벤트 (`stt:processed`, `stt:source-patch`, `stt:translation-patch`) 가 memory hook 비장착/장착 둘 다에서 동일하게 발송됨 |

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `better-sqlite3` Electron rebuild 실패 (특히 Windows) | 빌드 차단 | `postinstall: electron-rebuild`. CI workflow에 Windows + macOS 빌드 매트릭스 확인 추가. 첫 PR에서 검증. |
| 임베딩 모델 다운로드 실패 (오프라인) | 검색 비활성 | 캐시 디렉토리에 한 번 다운로드되면 영속. 실패 시 UI 안내 + 다음 시도에서 재요청. 미팅 저장/요약은 영향 없음. |
| `@xenova/transformers` worker_threads 호환성 | 임베딩 작동 안 함 | 첫 PR 첫 task에서 worker 실행 가능성 단독 검증. 안 되면 fallback: setImmediate로 메인 스레드 yield 처리하면서 임베딩. |
| 미팅 5000개 초과 시 in-memory KNN 느려짐 | 검색 latency 증가 | v1 충분히 빠름. v2에서 `sqlite-vec` 도입을 spec #2 또는 #3에서 다루기. |
| OpenAI 요약 비용 누적 | 청구 부담 | 토큰 로깅. `MEMORY_SUMMARY_AUTO=false`로 끄기 가능. |
| JSON 파싱 실패 반복 | 요약 없음 | `response_format: json_object` + 1회 재시도. 두 번 실패 시 `status='failed'` 저장, 사용자가 재생성 가능. |
| 기존 live 화면 latency 회귀 | 사용자 가시 영향 | segmentSink는 transcript-bus 리스너로 떼어내 메인 스레드 영향 최소. 워커는 별도 스레드. AGENTS.md 회귀 테스트 명시. |
| 두 캡처 세션을 동시에 트리거 (UI bug) | 미팅 ID 충돌 | `beginMeeting`은 `currentMeetingId !== null`이면 throw. 또는 이전 미팅을 강제 end. v1은 throw 후 UI에서 표시. |
| DB 손상 (OS 크래시 중 쓰기) | 데이터 손실 | WAL 모드로 완화. 손상 감지 시 (PRAGMA integrity_check 실패) `memory.db.corrupted.<ts>`로 rename + 빈 DB 재생성. |

---

## 12. Migration & Versioning

- **v0 → v1**: 영속화가 없던 상태에서 v1 도입. 마이그레이션 없음. 첫 부팅 시 `schema_version` 테이블 없으면 `init.sql` 전체 실행.
- 향후 스키마 변경 시 `migrations/v2.sql` 등을 순차 적용. 본 스펙은 마이그레이션 프레임워크까지는 짓지 않음 (단순 if-not-exists로 v1 생성).

---

## 13. Honest differentiation summary

이 라운드는 foundation이다.

| Tool | 미팅 영속화 | 요약 | 의미 검색 | LLM이 직접 쿼리 |
| --- | --- | --- | --- | --- |
| Granola | ✓ | ✓ | ✓ | ✓ (MCP) |
| Otter | ✓ | ✓ | ✓ | — |
| Fireflies | ✓ | ✓ | ✓ | — |
| autoMeetic (이 스펙 후) | ✓ | ✓ | ✓ | — |
| autoMeetic (Spec #2 후) | ✓ | ✓ | ✓ | ✓ (로컬 MCP) |

이 스펙 단독으로는 경쟁 대등(평가절상). Spec #2(MCP)와 합쳐졌을 때 "로컬 우선 + Claude/ChatGPT에서 직접 쿼리"라는 Granola/Otter가 못 하는 영역으로 진입.

---

## 14. References

- [WEEK1_EXECUTION_TASKS.md](../../../WEEK1_EXECUTION_TASKS.md) — MVP 동결 아키텍처
- [docs/superpowers/specs/2026-05-14-live-feed-latency-v2-design.md](2026-05-14-live-feed-latency-v2-design.md) — 라이브 latency 기준
- [docs/superpowers/specs/2026-05-14-action-items-design.md](2026-05-14-action-items-design.md) — Action Items 스토어 (영속화 미적용 상태)
- [AGENTS.md](../../../AGENTS.md) — 검증 명령어 / 고위험 영역
- [CLAUDE.md](../../../CLAUDE.md) — Meta-Harness 원칙 / UI 가이드
- `@xenova/transformers` — https://github.com/xenova/transformers.js
- `multilingual-e5-small` — https://huggingface.co/intfloat/multilingual-e5-small
