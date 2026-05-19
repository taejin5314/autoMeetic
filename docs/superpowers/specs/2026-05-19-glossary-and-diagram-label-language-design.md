# Glossary + Diagram Label Language — Design Spec

**Date:** 2026-05-19
**Status:** Draft — pending user review before implementation plan
**Positioning lever:** Bilingual × Visual (autoMeetic's unique combination of bilingual transcripts and AI-generated diagrams)

## One-line

Let users define glossary terms once and have them stay consistent across the bilingual transcript columns, the whiteboard diagram labels, and the Answer Assist replies — and let users pick a target language for diagram labels independently of the translation column.

## Why this wedge

Competitive research (Product Hunt + Indie Hackers, May 2026) showed glossary/terminology as a recurring premium differentiator (Cuckoo, Wordly, KUDO) and a clear lever to justify a paid tier. Crucially, this single feature reinforces autoMeetic's unique positioning: terminology consistency benefits both the bilingual columns (text) and the whiteboard agent (visual). Granola does not have it, JotMe and Talo don't have the visual angle, and Cuckoo doesn't have the whiteboard. The intersection is open.

Pre-meeting document upload (RAG) is a natural v2 but is out of scope here to keep the wedge shippable in 4–6 weeks of solo work.

## Success criteria

1. A user registers `RealtimeOrchestrator → preserve` and `kunchen → ko: "쿤 첸"` in the glossary, starts an English meeting, and both terms appear in the Korean translation column exactly as defined.
2. In the same meeting, the user sets diagram label language to Korean. The whiteboard agent produces shape labels in Korean, but `RealtimeOrchestrator` remains untranslated.
3. In a subsequent meeting, the global glossary entries are automatically applied. Meeting-scoped entries from the previous meeting are not.
4. With an empty glossary and no diagram-label-language set, the app behaves identically to the pre-feature baseline (zero regression).

## In scope

- Local sqlite-backed glossary store (global + per-meeting scopes)
- Prompt injection into:
  - Translation queue in `transcriptPostProcessor.ts`
  - Answer Assist endpoint in `server/proxy.mjs`
  - Whiteboard agent prompt builder
  - STT vocabulary bias prompt (as a bonus — improves recognition of registered terms)
- Diagram label language as a per-user preference (renderer localStorage), passed alongside each whiteboard agent run
- Deterministic post-pass that normalizes casing/spacing of `preserve=true` source terms in LLM outputs (translation, whiteboard element labels)
- A dedicated glossary management panel and a header entry point
- A label-language selector inside the whiteboard shelf panel header

## Out of scope (v2 or later)

- Pre-meeting document upload / retrieval-augmented context
- Sharing links, export to Notion/Slack/Linear, team-shared glossary
- CSV / Anki imports
- Automatic term extraction with "suggest registering this term" UX
- Fuzzy matching of translation rules (only canonical-form post-pass is enforced; mapped translations are advisory to the LLM)
- Inline transcript/diagram highlighting of glossary-matched tokens

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Diagram label language vs translation target | Independent settings | Core to "Bilingual × Visual" positioning: user may read Korean transcript while sharing English-labelled diagram, or vice versa. Default is "Auto (follow translation target)" so no surprise on day one. |
| Glossary scope granularity | Both global and per-meeting | Common terms (`autoMeetic`, `GPU`) live globally. Per-meeting holds names/companies for that specific session. Meeting-scoped entries override globals on `source_term` collision. |
| UI surface | Dedicated panel (`MemoryLibraryPanel` pattern) | Editing requires space for multi-language translation forms. Consistent with existing memory library code shape. |
| Repository ownership | Extend `MemoryRepository` | Same sqlite db, same migration path, same init plumbing. Avoids new connection lifecycle. |
| Cache location | Module-level in `transcriptPostProcessor.ts` only | Translation runs many times per minute (hot path). STT and whiteboard call infrequently and can hit sqlite directly. |
| Label-language IPC channel | None — piggyback on `whiteboard:agent-run` payload | localStorage is source of truth; no need for separate IPC channel. Renderer attaches `labelLanguage` to each agent invocation. |
| Translation-mapping enforcement | LLM advisory only (no deterministic forcing) | "Render `kunchen` as `쿤 첸` in Korean" is a hint to the LLM. Forcing it deterministically would require fuzzy matching, which is v2. |
| `preserve=true` post-pass | Yes, regex-replace on output | LLM may keep the term but lowercase or hyphenate it. Cheap to enforce canonical form. Does not insert missing terms. |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer (src/renderer/)                                     │
│                                                              │
│  GlossaryPanel.tsx ── useGlossaryStore.ts                   │
│         │                  │                                 │
│         │                  └─ window.electronAPI.glossary.*  │
│         │                                                    │
│  App.tsx (header entry button)                              │
│  WhiteboardLabelLangSelect.tsx (shelf header)               │
│         │                                                    │
│         └─ localStorage: automeetic.diagramLabelLanguage     │
└────────────────────┬─────────────────────────────────────────┘
                     │ ipcRenderer.invoke
                     ▼
┌──────────────────────────────────────────────────────────────┐
│ Preload (src/preload/)                                       │
│   glossary: { list, upsert, delete, active, onChanged }      │
└────────────────────┬─────────────────────────────────────────┘
                     │ ipcMain.handle
                     ▼
┌──────────────────────────────────────────────────────────────┐
│ Main process (src/main/)                                     │
│                                                              │
│   buildGlossaryHandlers(getMemory)                          │
│         │                                                    │
│         ▼                                                    │
│   MemoryRepository (extended)                                │
│      listGlossary / upsertGlossary / deleteGlossary          │
│      activeGlossary(meetingId)                               │
│         │                                                    │
│         ▼                                                    │
│   sqlite: glossary_entries table                             │
│                                                              │
│ Consumers:                                                   │
│   transcriptPostProcessor.ts  (cached) ─┐                    │
│   whiteboardService.ts        (direct) ─┼─► formatGlossary  │
│   sttService.ts               (direct) ─┘    PromptSection() │
└──────────────────────────────────────────────────────────────┘
```

## Data model

### sqlite schema (extends `src/main/memory/schema.ts`)

Bump `SCHEMA_VERSION` from 1 to 2. The current `MemoryRepository.initialize()` only inserts a version row when none exists (no real migration runner), so the bump is informational: existing v1 databases keep their `schema_version=1` row but pick up the new table from the idempotent `IF NOT EXISTS` statements. Implementing a proper migration runner is out of scope for this spec.

Append to `SCHEMA_SQL`:

```sql
CREATE TABLE IF NOT EXISTS glossary_entries (
  id              TEXT PRIMARY KEY,
  scope           TEXT NOT NULL CHECK (scope IN ('global', 'meeting')),
  meeting_id      TEXT REFERENCES meetings(id) ON DELETE CASCADE,
  source_term     TEXT NOT NULL,
  translations    TEXT NOT NULL DEFAULT '{}',
  preserve        INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_glossary_scope_meeting
  ON glossary_entries(scope, meeting_id);
CREATE INDEX IF NOT EXISTS idx_glossary_source
  ON glossary_entries(source_term COLLATE NOCASE);
```

Cross-field validation (`scope='global'` requires `meeting_id IS NULL`; `scope='meeting'` requires `meeting_id IS NOT NULL`) is enforced in `MemoryRepository.upsertGlossary` at the repository layer. Sqlite-level CHECK is not used because the error messages from validation code carry more context for the renderer to surface.

### TypeScript types (`src/main/memory/types.ts` + mirrored in `src/preload/types.ts`)

```ts
export interface GlossaryEntry {
  id: string
  scope: 'global' | 'meeting'
  meetingId: string | null
  sourceTerm: string
  translations: Record<string, string>  // 'ko' → '쿤 첸', 'ja' → 'クン・チェン'
  preserve: boolean
  note: string | null
  createdAt: number
  updatedAt: number
}

export interface GlossaryEntryInput {
  id?: string  // omit to create; provide to update
  scope: 'global' | 'meeting'
  meetingId: string | null
  sourceTerm: string
  translations: Record<string, string>
  preserve: boolean
  note: string | null
}
```

### Semantics

Each row is one **concept** with multiple language renderings.

| Scenario | sourceTerm | translations | preserve | Result |
|---|---|---|---|---|
| Code symbol | `RealtimeOrchestrator` | `{}` | `true` | Verbatim in every output. |
| Person name romanised | `kunchen` | `{"ko":"쿤 첸"}` | `false` | KO output renders `쿤 첸`; other languages left to LLM. |
| Company name | `Anthropic` | `{}` | `true` | Always `Anthropic`. |
| Korean → English term | `오토미틱` | `{"en":"autoMeetic"}` | `false` | EN labels/translation render `autoMeetic`. |
| Combined | `Anthropic` | `{"ko":"앤트로픽"}` | `true` | KO uses `앤트로픽` (lang override wins); other outputs verbatim. |

When both `preserve=true` and a language-specific translation exist, the language-specific translation wins for that language; all other languages get the verbatim source.

### Active glossary resolution

```ts
listGlossary(scope, meetingId?) // raw rows
activeGlossary(meetingId: string | null): GlossaryEntry[]
```

`activeGlossary` does:

```sql
SELECT *
FROM glossary_entries
WHERE scope = 'global'
   OR (scope = 'meeting' AND meeting_id = ?)
ORDER BY scope DESC, updated_at DESC
```

Then in-memory dedup: when a `meeting`-scoped row shares a case-insensitive `source_term` with a `global` row, the meeting row wins.

### Diagram label language storage

- Renderer localStorage key: `automeetic.diagramLabelLanguage`
- Value: `null` (= "Auto, follow translation target") | language code (`'ko'`, `'en'`, …)
- Default: `null` → preserves current zero-regression behaviour
- No sqlite, no separate IPC channel. The renderer attaches the resolved label language as a field on every `whiteboard:agent-run` payload.

## Three integration points

### Shared utility

`src/main/glossary/promptInjection.ts`:

```ts
export function formatGlossaryPromptSection(
  entries: GlossaryEntry[],
  targetLang: string | null
): string {
  if (entries.length === 0) return ''
  const verbatim: string[] = []
  const mapped: Array<[string, string]> = []
  for (const e of entries) {
    if (targetLang && e.translations[targetLang]) {
      mapped.push([e.sourceTerm, e.translations[targetLang]])
    } else if (e.preserve) {
      verbatim.push(e.sourceTerm)
    }
  }
  if (verbatim.length === 0 && mapped.length === 0) return ''

  const lines: string[] = ['GLOSSARY (apply strictly, do not paraphrase):']
  if (verbatim.length) {
    lines.push(`- Keep verbatim in all output: ${verbatim.map(quote).join(', ')}`)
  }
  if (mapped.length) {
    const langName = LANGUAGE_NAME_BY_CODE[targetLang!] ?? targetLang
    lines.push(`- When producing ${langName}, render:`)
    for (const [src, dst] of mapped) lines.push(`  · ${quote(src)} → ${quote(dst)}`)
  }
  return lines.join('\n')
}

export function normalizePreserveTerms(
  output: string,
  entries: GlossaryEntry[]
): string {
  for (const e of entries) {
    if (!e.preserve) continue
    const re = new RegExp(`\\b${escapeRegex(e.sourceTerm)}\\b`, 'gi')
    output = output.replace(re, e.sourceTerm)
  }
  return output
}
```

`quote()` wraps a term in double quotes for prompt clarity. `escapeRegex()` escapes regex metacharacters. Empty-glossary calls return early so the prompt sees no noise.

### Integration ① STT vocabulary bias (bonus)

`server/proxy.mjs` already exposes `buildVocabularyPrompt(keywords)` and accepts a `vocabularyPrompt` argument at session connect time. In `src/main/sttService.ts`, prepend active glossary `sourceTerm` values to the existing keywords list:

```ts
const glossaryTerms = repo.activeGlossary(meetingLifecycle.getCurrentMeetingId())
  .map(e => e.sourceTerm)
sttClient.connect({
  ...config,
  vocabularyKeywords: dedupe([...whiteboardKeywords, ...glossaryTerms]),
})
```

OpenAI Realtime STT applies the bias at session start only. Mid-meeting glossary edits do not retroactively bias STT until the next session. Documented in the panel as a tooltip.

### Integration ② Translation queue + Answer Assist

#### Translation queue (`src/main/transcriptPostProcessor.ts`)

Module-level cache, pull-based on each translate call (no event subscriptions needed):

```ts
let cachedGlossary: GlossaryEntry[] = []
let cachedMeetingId: string | null = null
let glossaryEpoch = 0  // bumped by IPC mutation handlers
let cachedEpoch = -1

function ensureFreshGlossary(repo: MemoryRepository, meetingId: string | null): void {
  if (meetingId === cachedMeetingId && cachedEpoch === glossaryEpoch) return
  cachedGlossary = repo.activeGlossary(meetingId)
  cachedMeetingId = meetingId
  cachedEpoch = glossaryEpoch
}

export function bumpGlossaryEpoch(): void {
  glossaryEpoch += 1
}
```

Invalidation triggers:

1. The translation code path calls `ensureFreshGlossary(repo, meetingLifecycle.getCurrentMeetingId())` right before reading `cachedGlossary`. When the active meeting changes or a mutation has occurred, the cache reloads transparently. No callback wiring needed.
2. IPC `glossary:upsert` / `glossary:delete` handlers call `bumpGlossaryEpoch()` after a successful mutation; the next translate call notices the bumped epoch and refreshes.

This pull-based design avoids cross-module subscription wiring and survives a code path that calls `cachedGlossary` "first time after meeting begin" without any explicit notification from `MeetingLifecycle`.

The translate call site builds the system message as:

```ts
const glossaryBlock = formatGlossaryPromptSection(cachedGlossary, hints.targetLanguage)
const systemContent = glossaryBlock
  ? `You are a precise translation engine. Return only translated text with no quotes, labels, or explanations.\n\n${glossaryBlock}`
  : 'You are a precise translation engine. Return only translated text with no quotes, labels, or explanations.'
```

After receiving the response: `output = normalizePreserveTerms(output, cachedGlossary)`.

#### Answer Assist (`server/proxy.mjs`)

The renderer fetches active glossary via IPC and attaches it to the Answer Assist request body:

```ts
{ transcript, sourceLang, targetLang, glossary: GlossaryEntry[] }
```

`buildAnswerAssistPrompt(sourceLang, targetLang)` is extended to a new signature `buildAnswerAssistPrompt(sourceLang, targetLang, glossary)` and appends the prompt section. The `translateText()` helper in the same file is similarly extended to receive an optional glossary array.

### Integration ③ Whiteboard agent

`src/main/whiteboard/prompt.ts`:

```ts
export interface WhiteboardPromptOptions {
  viewport?: WhiteboardViewport
  labelLanguage?: string | null
  glossary?: GlossaryEntry[]
}

export function whiteboardSystemPrompt(opts: WhiteboardPromptOptions = {}): string {
  // ... existing prompt body ...
  const labelBlock = opts.labelLanguage
    ? buildLabelLanguageBlock(opts.labelLanguage)
    : ''
  const glossaryBlock = formatGlossaryPromptSection(opts.glossary ?? [], opts.labelLanguage ?? null)
  return [existingBody, labelBlock, glossaryBlock].filter(Boolean).join('\n\n')
}
```

`buildLabelLanguageBlock`:

```ts
function buildLabelLanguageBlock(langCode: string): string {
  const languageName = LANGUAGE_NAME_BY_CODE[langCode] ?? langCode
  return `LABEL LANGUAGE:
- Output ALL shape labels, text titles, and arrow labels in ${languageName}.
- Translate concepts from the transcript into ${languageName} for the diagram, even if the speaker used a different language.
- Glossary terms marked verbatim must NEVER be translated — copy them as-is.`
}
```

When `opts.labelLanguage` is `null`, `undefined`, or an empty string, the block is omitted (zero-regression default).

`src/main/whiteboardService.ts` (or `whiteboard/session.ts`) reads `labelLanguage` from the incoming `whiteboard:agent-run` payload, fetches `repo.activeGlossary(meetingId)` directly (no cache — agent runs are infrequent), and passes both to `whiteboardSystemPrompt`.

After the agent returns element updates, `normalizePreserveTerms` runs on every `element.label.text` and every standalone `element.text` (where `element.type === 'text'`). This keeps verbatim terms canonical even when the LLM lowercases or hyphenates.

## UI surfaces

### Header entry point

A new `v4p-iconbtn ghost` button in the right cluster, between the Memory Library button and the Fullscreen button.

```
[Theme] [Lang ↓→↓] [Record] [Panel] [Library] [📖 Glossary] [Fullscreen] [Ask]
```

- Icon: 14×14 SVG, 1.5 stroke (Phosphor / Radix style). A book-with-bookmark glyph.
- `aria-label="Glossary"`, `title="Glossary"`.
- Click toggles `glossaryPanelOpen` state in `App.tsx`.

### Glossary panel (`src/renderer/glossary/GlossaryPanel.tsx`)

Modal-ish overlay mirroring `MemoryLibraryPanel` (same shell, same close/escape behaviour, same width breakpoints). Sections from top to bottom:

1. **Title bar** — "Glossary" + close button. A small mono label: `Active in this meeting: {n} terms`.
2. **Tab row** — `Global` (active by default) and `This meeting` (disabled with tooltip when no live meeting).
3. **Toolbar** — search input (substring match on `sourceTerm` and any `translations` value), `+ Add term` button.
4. **List** — virtualised if entries exceed 200, plain list otherwise. Each row shows: `sourceTerm`, comma-separated translations (`ko: 쿤 첸 · ja: クン・チェン`), a small `Preserve ✓` chip when `preserve=true`, edit and delete affordances.
5. **Inline editor** — appears when adding or editing. Fields: `sourceTerm` (text), `preserve` (toggle), `translations` (mini-form: language select + value input + add button; existing entries listed with remove buttons), `note` (optional text).
6. **Footer** — entry count + a small line: "Meeting-scoped entries apply only to the current meeting."

Empty state (global tab, zero entries):

> Glossary is empty. Register product names and proper nouns like `autoMeetic` or `kunchen` and they will stay consistent across your transcripts and diagrams.

### Diagram label language selector (`src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx`)

Placed inside the shelf panel header (the area that already holds the `[Whiteboard]` / `[Actions]` tabs and the close button). When the `Whiteboard` tab is active, a small mono `<select>` appears at the right:

```
[Whiteboard 3] [Actions]                Labels: KO ▾ [✕]
```

- Options: `Auto` (value `''`) + the same `LANGUAGE_OPTIONS` already used by the translation select, minus `auto`.
- Value source: localStorage `automeetic.diagramLabelLanguage` (read on mount, written on change).
- On change: write localStorage. The next `whiteboard:agent-run` IPC/WS message includes the new value.

### Renderer store (`src/renderer/glossary/useGlossaryStore.ts`)

```ts
interface GlossaryStore {
  entries: GlossaryEntry[]
  status: 'idle' | 'loading' | 'error'
  errorMessage: string | null
  loadAll(meetingId: string | null): Promise<void>
  upsert(input: GlossaryEntryInput): Promise<void>
  delete(id: string): Promise<void>
}
```

Subscribes to `window.electronAPI.glossary.onChanged()` on mount to re-fetch when other surfaces mutate the store.

### Active indicator

Not shipped in v1. No inline highlighting of glossary matches in the transcript or whiteboard. Visualising the rule application is reserved for v2.

## IPC + storage layer

### Repository extension (`src/main/memory/repository.ts`)

```ts
class MemoryRepository {
  // ... existing methods ...

  listGlossary(scope: 'global' | 'meeting', meetingId?: string): GlossaryEntry[]
  upsertGlossary(input: GlossaryEntryInput): GlossaryEntry
  deleteGlossary(id: string): void
  activeGlossary(meetingId: string | null): GlossaryEntry[]
}
```

Validation inside `upsertGlossary`:

- `sourceTerm` non-empty after trim, ≤ 100 characters.
- Each `translations[lang]` value ≤ 100 characters.
- `note` ≤ 500 characters.
- `scope === 'meeting'` requires non-null `meetingId`. `scope === 'global'` requires null `meetingId`.
- Reject duplicates: same `(scope, meetingId, lowercased sourceTerm)` already exists with different id.
- `translations` is JSON-stringified for storage; parsed on read.

Errors thrown as `Error` instances with descriptive messages. IPC layer surfaces these directly (matching the existing `memory:*` handler pattern).

### IPC handlers (`src/main/ipc-glossary-handlers.ts`)

New file, mirroring `ipc-memory-handlers.ts` shape:

```ts
export function buildGlossaryHandlers(getMemory: GetMemory, getMeetingLifecycle: GetMeetingLifecycle) {
  return {
    'glossary:list': async (args: {
      scope: 'global' | 'meeting'
      meetingId?: string
    }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.listGlossary(args.scope, args.meetingId)
    },
    'glossary:upsert': async (args: { entry: GlossaryEntryInput }) => {
      const memory = await getReadyMemory(getMemory)
      const result = memory.upsertGlossary(args.entry)
      broadcastChanged()
      return result
    },
    'glossary:delete': async (args: { id: string }) => {
      const memory = await getReadyMemory(getMemory)
      memory.deleteGlossary(args.id)
      broadcastChanged()
    },
    'glossary:active': async (args: { meetingId?: string } = {}) => {
      const memory = await getReadyMemory(getMemory)
      return memory.activeGlossary(args.meetingId ?? getMeetingLifecycle().getCurrentMeetingId())
    },
  }
}
```

`broadcastChanged()` is defined inside `buildGlossaryHandlers`:

```ts
function broadcastChanged(): void {
  bumpGlossaryEpoch()  // exported from transcriptPostProcessor.ts
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('glossary:changed')
  }
}
```

The `bumpGlossaryEpoch()` call ensures the postprocessor cache reloads on the next translate call; the broadcast notifies any open renderer windows so panels refresh their displayed list.

Errors thrown by repository or memory readiness propagate as rejected IPC promises (matching existing memory handlers; no `{ok, error}` envelope).

### Preload bridge (`src/preload/index.ts` + types)

```ts
glossary: {
  list: (scope: 'global' | 'meeting', meetingId?: string) =>
    ipcRenderer.invoke('glossary:list', { scope, meetingId }),
  upsert: (entry: GlossaryEntryInput) =>
    ipcRenderer.invoke('glossary:upsert', { entry }),
  delete: (id: string) =>
    ipcRenderer.invoke('glossary:delete', { id }),
  active: (meetingId?: string) =>
    ipcRenderer.invoke('glossary:active', { meetingId }),
  onChanged: (handler: () => void) => {
    const wrapped = () => handler()
    ipcRenderer.on('glossary:changed', wrapped)
    return () => ipcRenderer.removeListener('glossary:changed', wrapped)
  },
}
```

Corresponding type declarations added to `src/preload/types.ts`.

### Cache invalidation summary

| Trigger | Action |
|---|---|
| Any translate / Answer Assist / whiteboard agent call | `ensureFreshGlossary(repo, currentMeetingId)` at the start (pull-based; reloads only if meeting changed or epoch bumped) |
| `glossary:upsert` IPC success | `bumpGlossaryEpoch()` + broadcast `glossary:changed` to all renderer windows |
| `glossary:delete` IPC success | `bumpGlossaryEpoch()` + broadcast `glossary:changed` to all renderer windows |

`MeetingLifecycle` does not need to call into the cache — the pull-based check picks up the meeting change automatically on the first translate after `beginMeeting()`.

## Error handling

| Layer | Pattern |
|---|---|
| Repository | `throw new Error(message)` on validation or sqlite errors. |
| IPC handler | No explicit catch; rejected invoke promise propagates to renderer. |
| Renderer store | Catches `invoke` rejection, sets `status='error'` + `errorMessage`, panel shows an inline error banner above the list. |
| Prompt injection | Empty array short-circuits to empty string. No throw path. |
| Post-pass | Pure string operation; no throw path. |

## Testing strategy

Unit-level (vitest):

- `repository.glossary.test.ts` — insert/list/update/delete/activeGlossary round-trips, validation rejections, scope override behaviour.
- `promptInjection.test.ts` — empty, verbatim-only, mapped-only, mixed, duplicate `sourceTerm` across scopes, `targetLang=null`.
- `normalizePreserveTerms.test.ts` — casing variants, word-boundary edge cases (e.g., `GPU` inside `GPUS`).
- `transcriptPostProcessor.cache.test.ts` — cache refresh on meeting begin/end and on glossary mutation.
- IPC round-trip happy path in `glossary-ipc.test.ts` (mirroring `memory-ipc-readiness.test.ts`).

Regression (must pass with empty glossary):

- Existing translation tests run unchanged.
- Existing whiteboard prompt tests run unchanged when `labelLanguage` and `glossary` arguments are omitted.

## Security and validation

- Bounded string lengths enforced at repository layer (above).
- `meetingId` foreign key enforced by sqlite (`ON DELETE CASCADE` handles cleanup when meetings are deleted).
- No HTML or markdown rendering of glossary fields — plain text everywhere in the UI.
- LLM output is already trusted-but-bounded; post-pass is regex on plain strings, no eval.

## Web mode parity

The repo supports two run modes: `npm run dev:electron` (main process owns translation and whiteboard agent) and `npm run dev:web` (browser renderer talks to `server/proxy.mjs` and `server/whiteboard-runtime.mjs`). The design above is Electron-first because that is the primary distribution target.

Web mode reaches parity through two extensions:

- `server/proxy.mjs` already takes glossary on Answer Assist; for the renderer's web-mode translation flow (`ProxyTranslator` in `src/main/translate/translator.ts`), the `/api/translate` endpoint must accept an optional `glossary: GlossaryEntry[]` field in the request body and apply the same prompt injection + post-pass as the Electron path.
- `server/whiteboard-runtime.mjs` (the WS-driven whiteboard runtime for web mode) must accept `labelLanguage` and `glossary` fields on the `whiteboard:agent-run` payload it receives, and apply the same prompt builder + element-label post-pass.

Both mirror the Electron path. The shared helpers (`formatGlossaryPromptSection`, `normalizePreserveTerms`, `buildLabelLanguageBlock`) live in `src/main/glossary/promptInjection.ts` and are imported from the server files via the existing build pipeline (or duplicated as a thin wrapper if the build does not currently expose them — to be decided in writing-plans).

In web mode the glossary read path is necessarily different: the browser cannot reach sqlite directly, so the renderer fetches via a new `/api/glossary` REST surface that mirrors the Electron IPC. This is the primary additional scope item for web-mode parity and adds roughly 1 week of work; if web mode is not a current priority, this scope can be deferred to v2 without affecting Electron functionality.

## Open questions (resolve during implementation plan)

- Does the existing memory IPC `getReadyMemory` plumbing accept multiple handler factories cleanly, or does it need a small shape adjustment to expose `MeetingLifecycle`? Verify before adding `getMeetingLifecycle` to `buildGlossaryHandlers`.
- Should the glossary panel surface a "Move to global / Move to this meeting" action to migrate entries between scopes, or require delete+recreate? Lean toward delete+recreate for v1 to keep the surface small.
- Visualise meeting-vs-global rows differently in the merged active view (e.g., a small `M` chip on meeting entries when viewing `This meeting` tab)? Lean yes — useful clarity for low cost.

## Files touched (estimated)

- `src/main/memory/schema.ts` — append CREATE TABLE
- `src/main/memory/repository.ts` — add glossary methods
- `src/main/memory/types.ts` — add `GlossaryEntry`, `GlossaryEntryInput`
- `src/main/glossary/promptInjection.ts` — new file (shared helpers)
- `src/main/glossary/cache.ts` — new file exporting `ensureFreshGlossary` and `bumpGlossaryEpoch`
- `src/main/transcriptPostProcessor.ts` — wire cache + prompt injection + post-pass
- `src/main/whiteboard/prompt.ts` — extend signature, add label-language + glossary blocks
- `src/main/whiteboardService.ts` (or `whiteboard/session.ts`) — fetch glossary, pass to prompt, post-pass element labels
- `src/main/sttService.ts` — extend vocabulary keywords with active glossary terms
- `src/main/ipc-glossary-handlers.ts` — new file
- `src/main/index.ts` (or wherever IPC is registered) — wire new handlers
- `server/proxy.mjs` — extend Answer Assist + `translateText` to accept and apply glossary
- `src/preload/index.ts` — expose glossary API
- `src/preload/types.ts` — type declarations
- `src/renderer/glossary/GlossaryPanel.tsx` — new
- `src/renderer/glossary/useGlossaryStore.ts` — new
- `src/renderer/glossary/types.ts` — new (re-export of preload types)
- `src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx` — new
- `src/renderer/App.tsx` — header button + panel mounting + label-language attachment to `whiteboard:agent-run` payload
- `src/renderer/App.css` — glossary panel styles, label-lang select
- Test files listed above.

## Estimated effort

4–6 weeks for a solo developer, broken roughly as:

- Week 1 — schema, repository, prompt injection helpers, unit tests.
- Week 2 — IPC handlers, preload bridge, cache wiring, translation integration.
- Week 3 — whiteboard integration, STT bias, post-pass, end-to-end manual testing.
- Week 4 — UI panel + label-language selector + header entry.
- Week 5 — polish, edge cases (overflow, validation messages), regression sweep.
- Week 6 — buffer (the schedule never holds; reserve real buffer).
