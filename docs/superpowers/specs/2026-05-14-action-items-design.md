# Action Items - Suggested Meeting Tasks

**Date:** 2026-05-14
**Status:** Draft
**Author:** brainstorming session

---

## Overview

AutoMeetic should extract likely action items from the live meeting transcript and show them in the existing Actions tab. The feature should feel helpful but not overconfident: AI-generated items appear as suggestions first, and the user decides whether to accept, edit, dismiss, or mark them done.

The MVP is session-scoped. Items persist while the current app session remains on screen, including after Stop, but Reset clears them.

## Goals

- Automatically create candidate action items from committed transcript text.
- Keep AI extraction in the Electron main process, alongside STT and whiteboard agent work.
- Batch extraction roughly every 30 seconds to reduce cost and avoid noisy updates.
- Show all AI-generated items as `suggested` until the user accepts them.
- Let the user edit title, owner, and due date before or after accepting.
- Avoid duplicate suggestions within the same session.

## Non-Goals

- Persisting action items across app restarts.
- Exporting items to Markdown, JSON, clipboard, calendar, or task tools.
- Assigning priority, category, confidence, or project metadata.
- Replacing the whiteboard or answer-assist flows.

## User Experience

The Actions tab replaces the current empty state with three groups:

- **Suggested:** AI candidates with Accept and Dismiss controls.
- **Accepted:** confirmed action items with Done and Dismiss controls.
- **Done:** completed items, shown compactly near the bottom.

Each item shows:

- title
- optional owner
- optional due date
- source transcript snippet
- status controls

Stop does not clear items, because the user often reviews tasks after ending capture. Reset clears the session transcript, whiteboard, and action items together.

## Data Model

```ts
export type ActionItemStatus = 'suggested' | 'accepted' | 'done' | 'dismissed'

export type ActionItem = {
  id: string
  title: string
  owner?: string
  due?: string
  sourceText: string
  status: ActionItemStatus
  createdAtMs: number
}
```

The renderer may keep dismissed items out of the visible list, but they should remain in memory for dedupe during the current session.

## Architecture

Use a main-process service:

```text
sttService committed text
  -> whiteboardService.enqueueTranscript(text)
  -> actionItemService.enqueueTranscript(text)

actionItemService
  -> buffers final transcript chunks
  -> every ~30s, extracts candidates with OpenAI
  -> dedupes against existing/session candidates
  -> sends actions:suggested IPC event to renderer

renderer Actions tab
  -> stores session action items
  -> handles accept/edit/done/dismiss UI state
```

This keeps AI calls and API key usage out of the renderer. It also follows the existing Electron pattern where STT and whiteboard agent services live in `src/main`.

## Main Process Design

Create `src/main/actionItemService.ts`.

Responsibilities:

- `init(mainWindow)` stores the renderer window reference.
- `enqueueTranscript(text)` appends non-empty final transcript text to a buffer.
- A timer or scheduled flush runs about every 30 seconds while the buffer has enough text.
- `resetActionItems()` clears buffers, seen keys, retry state, and sends a reset event.
- Extraction returns at most 5 candidates per batch.
- Deduping normalizes `title + owner + due`; matching keys are not sent again.

Recommended knobs:

```ts
const ACTION_ITEM_FLUSH_MS = Number(process.env.ACTION_ITEM_FLUSH_MS ?? 30_000)
const ACTION_ITEM_MIN_CHARS = Number(process.env.ACTION_ITEM_MIN_CHARS ?? 120)
const ACTION_ITEM_MAX_BATCH_CHARS = Number(process.env.ACTION_ITEM_MAX_BATCH_CHARS ?? 4_000)
const ACTION_ITEM_MODEL = process.env.ACTION_ITEM_MODEL ?? 'gpt-4.1-mini'
```

When `OPENAI_API_KEY` is missing, the service should stay disabled and log a warning once.

## OpenAI Extraction

The model should be conservative. It should extract only explicit or strongly implied tasks, such as:

- "Sarah should follow up with Finance by Friday."
- "Let's send the customer the revised deck tomorrow."
- "Can you create a ticket for the auth timeout issue?"

It should ignore general discussion, ideas without commitment, filler, and repeated items.

Expected JSON shape:

```json
{
  "items": [
    {
      "title": "Send the customer the revised deck",
      "owner": "Sarah",
      "due": "tomorrow",
      "sourceText": "Sarah, let's send the customer the revised deck tomorrow."
    }
  ]
}
```

If there are no tasks, return:

```json
{ "items": [] }
```

If JSON parsing fails or the API errors, keep the current batch for one retry. After a second failure, drop that batch and continue with later transcript so the service does not get stuck.

## IPC Contract

Add preload types and bridge methods/events:

```ts
onActionItemsSuggested(callback: (items: ActionItem[]) => void): () => void
onActionItemsReset(callback: () => void): () => void
```

Main sends:

```ts
mainWindow.webContents.send('actions:suggested', { items })
mainWindow.webContents.send('actions:reset')
```

Renderer-only state transitions do not need to round-trip to main for MVP, because items are session-scoped and not persisted.

## Renderer Design

Create `src/renderer/actions/`:

- `types.ts` for `ActionItem` and `ActionItemStatus`.
- `useActionItemsStore.ts` or a small hook for session state transitions.
- `ActionItemsPanel.tsx` for the Actions tab UI.

`App.tsx` should import the panel and wire IPC listeners, but should not contain extraction logic.

Store actions:

- `addSuggested(items)`
- `accept(id)`
- `dismiss(id)`
- `markDone(id)`
- `updateItem(id, patch)`
- `reset()`

The Actions tab should show an unavailable/idle state when no suggestions exist yet, but it should not imply an error unless the main process sends one in a later version.

## Reset Behavior

The existing reset flow should call into the action item service in Electron mode. Browser fallback can be added later if needed.

Reset should:

- clear renderer action item state
- clear main service buffers and dedupe keys
- keep Stop behavior unchanged

## Testing

Minimum verification:

- `npm run typecheck`
- unit-like tests or smoke script for normalize/dedupe helpers
- smoke script with a sample transcript to confirm extraction JSON parsing
- manual test: start session, feed transcript with an action item, wait for suggestion, accept/edit/done/dismiss, then Reset

## Future Work

- Export accepted and done items.
- Persist per meeting.
- Add confidence and "why this was suggested" metadata.
- Detect owner names from participants when a participant roster exists.
- Support browser-mode action extraction through the dev proxy.
