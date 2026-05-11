# Week 0 — CRITICAL BLOCKERS 검증 결과

**Date:** 2026-05-11 (진행 중)

---

## 1️⃣ BLOCKER 1: Slack Call API 오디오 지원 여부

**상태:** ✅ **검증 완료 (공개 API 기준 불가)**

### 발견 사항

**공식 Slack Events API 문서 검색 결과:**
- URL: https://docs.slack.dev/reference/events
- 이벤트 목록 중 Call 관련:
  - `call_rejected` — A call was rejected (Events)
  - `user_huddle_changed` — A user's huddle status has changed (Events)
  
**주요 관찰:**
1. `call.started`, `call.ended` 같은 명시적 허들 시작/종료 이벤트는 **리스트에 없음**
2. 오디오 스트림을 직접 제공하는 API는 **공식 문서에서 명시되지 않음**
3. Call API 자체는 Slack에 존재하지만, **Socket Mode에서 실시간 오디오 바이트 스트림 접근 가능 여부는 불명확**

### 추가 확인 (공식 문서 + SDK 코드)

- Calls API는 Slack UI에 외부 통화 앱 정보를 연결하는 용도이며, Slack이 오디오 바이트를 전달하는 모델이 아님
   - https://docs.slack.dev/apis/web-api/using-the-calls-api/
   - https://docs.slack.dev/reference/methods/calls.add
- Socket Mode는 이벤트/인터랙션 JSON payload 수신용이며 미디어 스트림 전송 명세 없음
   - https://docs.slack.dev/apis/events-api/using-socket-mode/
   - https://docs.slack.dev/reference/methods/apps.connections.open
- huddle 관련 이벤트는 상태 정보 중심이며 오디오 바이트 필드 없음
   - https://docs.slack.dev/reference/events/user_huddle_changed
- Bolt/SDK 구현도 이벤트 라우팅 중심 (오디오 스트림 처리 API 없음)
   - https://github.com/slackapi/bolt-js/blob/main/src/receivers/SocketModeReceiver.ts

### 최종 결론

⚠️ **공개 Slack API로 huddle/call 실시간 오디오 바이트 스트림 수신은 불가** (신뢰도 높음)

**폴백 계획 (if fails):**
- 100% 시스템 오디오 (WASAPI) 로 전환
- Slack API는 "huddle이 시작되었음" 감지만 사용
- 타임라인: 영향 없음 (WASAPI가 작동한다면)

---

## 2️⃣ BLOCKER 2: Windows WASAPI + VB-Cable 격리 테스트

**상태:** 🔍 **사전점검 완료, 설치 블로킹 확인**

### 준비 사항

사용자가 다음을 수행해야 함:

1. **VB-Cable Virtual Audio Device 설치**
   - URL: https://vb-audio.com/Cable/
   - Windows 11에 호환 여부 확인 필요

2. **오디오 라우팅 설정**
   - Slack 출력 → VB-Cable로 설정
   - 시스템 음 (예: YouTube) → 기본 스피커로 설정

3. **Node.js 모듈로 테스트**
   - `npm install node-speaker`
   - VB-Cable에서 오디오 캡처
   - Slack 음성은 캡처, YouTube 음성은 필터됨 확인

### 예상 시간

- VB-Cable 설치 + 라우팅 설정: 20분
- Node.js 테스트 코드 작성: 30분
- 실제 테스트 (Slack + YouTube 병행): 20분

### 현재 상태

사전점검 결과:

- 실행 스크립트: `tools/test-b2-wasapi-vbcable.ps1`
- 결과 파일: `harness/wasapi_vbcable_result.json`
- `status`: `BLOCKED_INSTALL_VB_CABLE`
- `vb_cable_detected`: `false`
- `slack_running`: `true`
- `chrome_running`: `true`

즉시 액션:

1. VB-Cable 설치 (`https://vb-audio.com/Cable/`)
2. 재부팅(필요 시)
3. 아래 명령 재실행

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\test-b2-wasapi-vbcable.ps1
Get-Content .\harness\wasapi_vbcable_result.json
```

수동 검증 체크리스트: `harness/B2_WASAPI_CHECKLIST.md`

---

## 3️⃣ BLOCKER 3: GPT Realtime API latency 측정

**상태:** ✅ **True Realtime 측정 완료 (목표 미달)**

### 계획

```python
# pseudocode
import openai

# 1. GPT Realtime 연결
client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])

# 2. 마이크 입력 시작
# 3. 5초 영어 음성 녹음

# 4. 시간 측정
start = time.time()
transcript = client.audio.transcriptions.create(...)
stt_latency = time.time() - start  # 목표: <200ms

# 5. Claude 번역
start = time.time()
translation = anthropic_client.messages.create(...)
translation_latency = time.time() - start  # 목표: <600ms

# 6. 총 지연시간
total_latency = stt_latency + translation_latency  # 목표: <800ms
```

### 1차 실행 결과 (2026-05-11)

- 실행 파일: `harness/test_gpt_latency.py`
- 결과: `FAILED`
- 원인: `OPENAI_API_KEY` 환경 변수 미설정
- 산출물: `harness/gpt_latency_result.json`
   - `status: FAILED`
   - `reason: Missing OPENAI_API_KEY`

### 다음 단계

1. `OPENAI_API_KEY` 설정
2. `ANTHROPIC_API_KEY` 설정
3. `python harness/test_gpt_latency.py` 재실행
4. 목표 판정: 총 지연시간 `<800ms`

### 현재 블로킹 상태 (2026-05-11)

- 현재 PowerShell 세션 기준:
   - `.env` 로딩은 정상
   - API 키는 읽히는 상태
- 현재 차단 원인:
   - Anthropic 계정/환경에서 사용 가능한 Sonnet/Haiku 모델 식별 불가
   - 스크립트 결과: `No available Anthropic model for this account/environment`

### 최신 실행 결과 (2026-05-11)

- `python harness/test_gpt_latency.py`
- `status`: `SUCCESS`
- `model_used`: `claude-sonnet-4-6`
- `stt_latency_ms`: `1355.95`
- `translation_latency_ms`: `1077.06`
- `total_latency_ms`: `2433.01`
- `result`: `FAIL` (`> 800ms`)

참고: 위 수치는 `audio.transcriptions(whisper-1)` 기반 측정으로, True Realtime WebSocket STT와는 경로가 다름.

### True Realtime 재검증 결과 (2026-05-11)

- 실행 파일: `harness/test_gpt_realtime_latency.py`
- 경로: OpenAI Realtime WebSocket (`gpt-4o-realtime-preview`)
- 결과: `SUCCESS` (수치 산출 성공)
- STT 지연: `839.88ms`
- 번역 지연: `2296.49ms` (`claude-sonnet-4-6`)
- 총 지연: `3136.37ms`
- 판정: `FAIL` (`> 800ms`)

현재 결론:
1. True Realtime 경로 측정 자체는 성공
2. 병목은 번역 구간(약 2.3초)
3. MVP는 비동기 번역(2-3초) 폴백 유지가 현실적

### 결론

⚠️ **목표(<800ms) 미달**. 현재 구성에서는 동기 실시간 번역 UX 달성이 어려움.

**폴백 적용:** 비동기 번역(2-3초 지연) 모드로 MVP 진행.

재실행용 명령어 (PowerShell):

```powershell
$env:OPENAI_API_KEY = "<YOUR_OPENAI_KEY>"
$env:ANTHROPIC_API_KEY = "<YOUR_ANTHROPIC_KEY>"
python harness/test_gpt_latency.py
Get-Content harness/gpt_latency_result.json
```

---

## 의존성 정리

| Blocker | 결과 예상 | 영향 | 폴백 |
|---------|---------|------|------|
| **B1: Slack API** | 공개 API 기준 불가(확정) | 높음 (아키텍처) | B2 (WASAPI)에 의존 |
| **B2: WASAPI** | 성공/실패 | 높음 (오디오) | 순수 Slack API만 |
| **B3: GPT latency** | 성공/경계선 | 중간 (UX) | 비동기 번역 |

**Critical Dependency:**
- B1 실패 + B2 실패 = 아키텍처 재평가 (타임라인 +1-2주)
- B1 실패 + B2 성공 = OK (WASAPI만 사용)
- B2 실패 + B1 성공 = OK (Slack API만 사용)

---

## 제품 결정 (2026-05-11)

### 결정 사항

1. **MVP 기본 경로는 전체 시스템 오디오 캡처**로 진행
2. **Slack 앱 단독 캡처(앱별 오디오 분리)는 고급/프로 기능으로 후순위**

### 이유

1. Slack 공개 API로 huddle 오디오 스트림 직접 수신이 불가
2. MVP 목표는 설치/검증 속도와 실제 사용성 확보
3. 앱별 분리는 품질 향상에는 유리하지만 구현/온보딩 복잡도가 높음

### 구현 원칙

1. 기본 모드: 시스템 오디오 캡처 + 비동기 번역 폴백
2. 고급 모드(후속): VB-Cable/BlackHole 기반 앱별 오디오 분리
3. UI에서는 모드를 명확히 분리해 사용자 기대치를 관리

---

## 타임라인 (금요일까지)

| 시간 | 작업 | 담당 | 상태 |
|------|------|------|------|
| 오늘 (오후) | B1 완료 (Slack API + GitHub) | 나 | ✅ 완료 |
| 목요일 09:00-12:00 | B2 테스트 (VB-Cable 설치 + WASAPI) | 사용자 | ⏳ 예정 |
| 목요일 13:00-15:00 | B1 결과 통합 + 최종 정리 | 나 | ✅ 완료 |
| 금요일 09:00-11:00 | B3 실행 (GPT latency 측정) | 나 | 🔍 1차 완료 (키 누락) |
| 금요일 15:00 | 최종 리포트 + Week 1 타임라인 확정 | 나 | ⏳ 예정 |

---

## 실시간 업데이트 (여기에 기록)

### 2026-05-11 14:50

- B1 결론: 공개 Slack API/Socket Mode/Bolt 기준으로 huddle 오디오 스트림 수신 API 확인 불가.
- B3 1차: `python harness/test_gpt_latency.py` 실행했으나 `OPENAI_API_KEY` 누락으로 FAIL.
- 액션: 환경 변수 설정 후 B3 재측정 필요.

### 2026-05-11 15:20

- B3 재실행: `.env` 자동 로드 + Anthropic 모델 fallback 적용 후 테스트.
- 결과: Anthropic 모델 접근 실패로 번역 지연시간/총 지연시간 계산 불가.
- 다음 액션:
   1. Anthropic 콘솔에서 사용 가능한 모델 ID 확인
   2. 스크립트 모델 후보에 해당 ID 추가
   3. 재실행 후 `<800ms` 판정

### 2026-05-11 15:40

- B3 최종 측정 완료 (`model_used: claude-sonnet-4-6`)
- 측정값: STT `1355.95ms` + 번역 `1077.06ms` = 총 `2433.01ms`
- 판정: `FAIL` (목표 `<800ms` 미달)
- 의사결정: MVP는 비동기 번역 폴백(2-3초)으로 진행

### 2026-05-11 16:05

- True Realtime 전용 스크립트(`harness/test_gpt_realtime_latency.py`) 작성 및 실행
- 확인: Realtime WebSocket 경로는 실제 사용됨
- 실패 원인: `input_audio_buffer_commit_empty`
- 액션: 오디오 입력 버퍼 이벤트 포맷 정합성 확인 후 True Realtime 재측정

### 2026-05-11 16:30

- True Realtime 재측정 성공 (`harness/test_gpt_realtime_latency.py`)
- 결과: STT `839.88ms`, 번역 `2296.49ms`, 총 `3136.37ms`
- 최종 판정: 목표 `<800ms` 미달 (`FAIL`)

### 2026-05-11 16:50

- B2 사전점검 스크립트 추가: `tools/test-b2-wasapi-vbcable.ps1`
- 체크리스트 추가: `harness/B2_WASAPI_CHECKLIST.md`
- 사전점검 결과: VB-Cable 미설치 (`BLOCKED_INSTALL_VB_CABLE`)

### 2026-05-11 17:05

- 제품 방향 확정: 당장은 전체 시스템 오디오 캡처를 기본 경로로 채택
- Slack 앱 단독 캡처는 고급/프로 기능으로 백로그 이동

