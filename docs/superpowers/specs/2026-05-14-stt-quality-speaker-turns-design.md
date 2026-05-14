# STT Quality - Sentence Cleanup and Speaker Turns

**Date:** 2026-05-14
**Status:** Draft
**Author:** brainstorming session

---

## Overview

AutoMeetic should keep live captions responsive while improving the quality of committed transcript text. The current STT path commits rough realtime chunks directly to the feed and downstream AI features. This produces awkward boundaries, weak punctuation, and no speaker attribution.

The new design adds a main-process transcript post-processing layer. Raw realtime STT partials still drive live captions immediately. Rough committed chunks are buffered for a few seconds, cleaned into proper sentence-level speaker turns, then emitted to the renderer and downstream services.

Speaker attribution is best-effort because the MVP uses only mixed system audio. It should label turns as Speaker A/B/C rather than claiming real identities.

## Goals

- Preserve low-latency live captions from raw STT partials.
- Improve committed transcript readability with sentence boundaries, capitalization, and punctuation.
- Distinguish speaker turns as Speaker A/B/C on a best-effort basis.
- Use processed turns for feed, translation, whiteboard, action items, and Ask the meeting.
- Keep a future path open for speaker rename UI.
- Fall back to raw transcript if post-processing fails.

## Non-Goals

- Perfect diarization from mixed audio.
- Mapping speakers to real participant names.
- Capturing the user's microphone separately.
- Adding external diarization services such as pyannote, Deepgram, or AssemblyAI.
- Replacing the realtime transcription provider.

## Architecture

The STT path splits into raw partial display and processed committed output:

```text
OpenAI realtime transcription delta
  -> stt:partial
  -> renderer live caption / overlay

rough committed chunks
  -> transcriptPostProcessor buffer
  -> 5-10s batch
  -> OpenAI JSON speaker turns
  -> stt:processed
  -> renderer feed / translation / whiteboard / actions / ask
```

Create a main-process module:

```text
src/main/transcriptPostProcessor.ts
```

Responsibilities:

- Buffer rough STT chunks from `sttService`.
- Flush every 7 seconds by default, or sooner when sentence-ending punctuation appears.
- Call OpenAI to clean punctuation and segment speaker turns.
- Emit `stt:processed` events to the renderer.
- Forward processed text to whiteboard and action item services.
- Flush remaining buffered text on Stop.
- Reset buffers and speaker state on Reset.

## Data Model

```ts
export type ProcessedTranscriptTurn = {
  id: string
  speakerId: 'speaker_a' | 'speaker_b' | 'speaker_c' | 'unknown'
  speakerLabel: 'Speaker A' | 'Speaker B' | 'Speaker C' | 'Unknown'
  text: string
  createdAtMs: number
}
```

Extend renderer transcript segments:

```ts
export interface TranscriptSegment {
  id: string
  text: string
  isFinal: boolean
  createdAtMs: number
  source?: 'openai-realtime'
  speakerId?: string
  speakerLabel?: string
}
```

The label fields make rename UI possible later without changing the event contract.

## IPC Contract

Keep existing events:

```text
stt:partial     string
stt:committed   string
```

Add:

```text
stt:processed   { turns: ProcessedTranscriptTurn[] }
```

During MVP, `stt:committed` can remain as legacy/fallback, but renderer should prefer `stt:processed` for final feed entries. The Electron client should listen to `stt:processed` and emit one final `TranscriptSegment` per speaker turn.

## Post-Processing Prompt

The post-processor must preserve meaning. It may clean transcript shape but must not summarize, translate, or invent content.

Expected model response:

```json
{
  "turns": [
    {
      "speakerId": "speaker_a",
      "speakerLabel": "Speaker A",
      "text": "We should ship the beta next Friday. Can you prepare the rollout checklist?"
    },
    {
      "speakerId": "speaker_b",
      "speakerLabel": "Speaker B",
      "text": "Yes, I can draft it today."
    }
  ]
}
```

Rules:

- Do not translate.
- Do not summarize.
- Do not add facts or commitments.
- Preserve names, technical terms, and numbers.
- Remove obvious filler only when it does not change meaning.
- Add punctuation based on tone: `?` for questions, `!` for emphasis, `.` for statements.
- Split into speaker turns, not individual sentences.
- Keep the same speaker when uncertain.
- Use Speaker A/B/C/Unknown only.

## Buffering and Fallback

Recommended defaults:

```ts
const STT_POSTPROCESS_MODEL = process.env.STT_POSTPROCESS_MODEL ?? 'gpt-4.1-mini'
const STT_POSTPROCESS_FLUSH_MS = Number(process.env.STT_POSTPROCESS_FLUSH_MS ?? 7000)
const STT_POSTPROCESS_MIN_CHARS = Number(process.env.STT_POSTPROCESS_MIN_CHARS ?? 50)
const STT_POSTPROCESS_MAX_CHARS = Number(process.env.STT_POSTPROCESS_MAX_CHARS ?? 3500)
```

Behavior:

- If buffered text is shorter than the minimum, wait for the next rough chunk.
- If text reaches max chars, flush immediately.
- If OpenAI fails, emit one fallback `Unknown` turn containing the raw batch.
- If JSON parsing fails, retry once, then fallback.
- On Stop, flush remaining buffer immediately.
- On Reset, clear buffer and speaker state.

## Renderer Behavior

`ElectronSttClient`:

- Keeps raw `stt:partial` handling unchanged.
- Adds `onSttProcessed`.
- Emits each processed turn as a final `TranscriptSegment`.
- Uses speaker fields on the segment.
- Avoids double-emitting final text from legacy `stt:committed` when processed events are enabled.

Caption/feed UI:

- Show speaker label above or beside each final transcript item.
- Keep live partial caption visually separate from processed feed entries.
- Later rename UI can map `speakerId` to a custom display name.

Downstream:

- Translation runs on processed turn text.
- Whiteboard receives processed turn text.
- Action items receive processed turn text.
- Ask the meeting uses caption store items, so it automatically benefits once feed uses processed turns.

## Risks

- Speaker A/B from mixed audio is approximate and can be wrong.
- Post-processing adds several seconds of delay to feed/downstream features.
- LLM cleanup can accidentally alter meaning if the prompt is too loose.
- Additional API calls increase cost.

Mitigations:

- Keep raw partials for live feedback.
- Prompt strongly for meaning preservation.
- Fall back to raw text on failures.
- Make speaker labels generic and best-effort.
- Keep event contract flexible for future true diarization.

## Testing

Minimum verification:

- `npm run typecheck`
- `npm run lint`
- Unit-like smoke test for parsing valid/invalid post-process JSON.
- Manual test with sample meeting audio:
  - partial captions appear immediately
  - feed entries arrive as punctuated speaker turns
  - translation/whiteboard/actions receive cleaned text
  - Stop flushes remaining buffered text
  - Reset clears pending post-processing state

## Future Work

- Speaker rename UI.
- Persist speaker rename mapping per session.
- Separate microphone capture for reliable "me vs others" labeling.
- External diarization backend for stronger speaker accuracy.
- Participant-name matching from calendar, meeting app metadata, or user-provided roster.
