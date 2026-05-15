---
title: Live Sentence Row Feed
date: 2026-05-14
status: approved
---

# Live Sentence Row Feed

## Problem

The v2 latency work shows source text quickly, but each short STT commit becomes its own feed row. Korean speech such as `저는 / 퇴근하는 / 시바룸입니다 / .` reads as fragmented rows instead of one sentence.

## Goal

Keep first-source-character latency close to v2 while rendering one growing feed row per sentence.

## Design

The postprocessor keeps one active source turn. The first fragment immediately emits `stt:processed` with `translation: null`. Later fragments append to the active turn and emit `stt:source-patch` with the same `id` and the full source text.

The active turn finalizes when any of these happen:

- source text ends with sentence punctuation (`.`, `?`, `!`, `。`, `？`, `！`)
- no new fragment arrives for `STT_LIVE_SENTENCE_FINALIZE_MS` (default 1400ms)
- source text reaches `STT_LIVE_SENTENCE_MAX_CHARS` (default 220)
- transcription stop/flush/reset occurs

Translation stays asynchronous. While the row is still growing, translation is debounced with `STT_TRANSLATION_DEBOUNCE_MS` (default 650ms). Finalized rows enqueue translation immediately. Translation responses carry a per-row version; stale responses for older source text are ignored.

Downstream whiteboard/action services receive the finalized source sentence once, instead of every fragment.

## Renderer

Preload exposes `onSttSourcePatch`. The caption store patches the matching item by replacing `fullSource` and `sourceText`, preserving already displayed characters, and setting `typing: true` so the typewriter continues from the current cursor.

## Out of Scope

- Changing STT provider or model.
- Adding sentence reconstruction with an LLM.
- Layout/style changes.
