# App i18n — System Language Selection — Implementation Plan

> **For agentic workers (Codex / Claude / human):** Checkbox (`- [ ]`) tracking. Phase-by-phase. Each phase ends with a clean `npm run verify:phase <N>` before the table in `HANDOFF.md` is updated. Read `HANDOFF.md` and `AGENTS.md` first for environment quirks (Windows better-sqlite3 ABI shim + `EBUSY` `npm test` quirk).

**Goal:** Add `react-i18next` to the renderer, extract every UI string into JSON locale resources for en/ko/ja/zh, expose OS locale via IPC, add a header `[KO ⌄]` picker that lets the user override or follow OS.

**Architecture:** New `src/renderer/i18n/` module owns init, detection, hook, picker, and formatters. One namespace (`common`), nested JSON per locale. OS locale via new `system:get-locale` IPC. Override persists in `localStorage.automeetic.language`. Special `'system'` preference clears override and re-detects. All 4 locale files eagerly bundled (~50 KB gzipped total).

**Tech stack:** React 19, TypeScript strict (no `any`), `i18next` ^23, `react-i18next` ^14, `Intl.*` for date/number formatting, vitest.

**Spec:** `docs/superpowers/specs/2026-05-27-i18n-system-language-design.md`

**Scope reminder (do NOT exceed):** No LLM-generated content translation. No LLM prompt language switching. No RTL. No lazy loading. No translation management platform. No auto-extraction tools. No region variants. No custom CJK font embedding. No flag emojis. UI strings only, all 4 languages shipped together.

---

## File map

(See spec for full file map. Plan phases group files by surface area.)

---

## Phase 1 — i18n infrastructure (TDD)

### Task 1.1 — Add dependencies

**Files:** `package.json`

- [x] **Step 1: Install**

```bash
npm install i18next@^23 react-i18next@^14
```

- [x] **Step 2: Verify React 19 compatibility**

```bash
npm ls react-i18next i18next react
```

Expect `react-i18next@14+` with `react@19` in the tree. If a peer dep warning fires, install `react-i18next@latest` instead and confirm v14+.

- [x] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(i18n): add i18next + react-i18next deps"
```

---

### Task 1.2 — Types + skeleton locale files

**Files:** `src/renderer/i18n/types.ts`, `src/renderer/i18n/locales/{en,ko,ja,zh}.json`

- [x] **Step 1: Create `src/renderer/i18n/types.ts`**

```ts
export const SUPPORTED_LANGUAGES = ['en', 'ko', 'ja', 'zh'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export type LanguagePreference = SupportedLanguage | 'system'

export const LANGUAGE_PREF_STORAGE_KEY = 'automeetic.language'
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

export const LANGUAGE_NATIVE_LABEL: Record<SupportedLanguage, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  zh: '中文',
}
```

- [x] **Step 2: Create skeleton locale files**

Each file starts with the same minimal shape; content fills in across phases. Create all 4:

```json
{
  "_meta": {
    "language": "en",
    "version": 1
  }
}
```

(Same for ko, ja, zh — change `"language"` value accordingly.)

- [x] **Step 3: Commit**

```bash
git add src/renderer/i18n/types.ts src/renderer/i18n/locales/
git commit -m "feat(i18n): scaffold language types + locale file skeletons"
```

---

### Task 1.3 — i18n init + OS locale IPC + hook (TDD)

**Files:** `src/main/ipc.ts`, `src/preload/index.ts`, `src/preload/types.ts`, `src/renderer/i18n/index.ts`, `src/renderer/i18n/detectSystemLanguage.ts`, `src/renderer/i18n/useAppLanguage.ts`, `src/test/i18n-detect.test.ts`

- [x] **Step 1: Add IPC handler in main**

In `src/main/ipc.ts`, register:

```ts
import { app } from 'electron'
// ...
ipcMain.handle('system:get-locale', () => app.getLocale())
```

- [x] **Step 2: Preload bridge**

In `src/preload/index.ts`, add to the existing exposed API:

```ts
system: {
  getLocale: (): Promise<string> => ipcRenderer.invoke('system:get-locale'),
},
```

In `src/preload/types.ts`:

```ts
system: {
  getLocale(): Promise<string>
}
```

- [x] **Step 3: Write failing tests**

Create `src/test/i18n-detect.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { detectSystemLanguage, resolveLanguagePreference } from '../renderer/i18n/detectSystemLanguage'

describe('detectSystemLanguage', () => {
  it('maps full locale to supported language code', async () => {
    expect(await detectSystemLanguage(() => Promise.resolve('ko-KR'))).toBe('ko')
    expect(await detectSystemLanguage(() => Promise.resolve('en-US'))).toBe('en')
    expect(await detectSystemLanguage(() => Promise.resolve('ja-JP'))).toBe('ja')
    expect(await detectSystemLanguage(() => Promise.resolve('zh-CN'))).toBe('zh')
    expect(await detectSystemLanguage(() => Promise.resolve('zh-TW'))).toBe('zh')
  })

  it('falls back to en for unsupported locale', async () => {
    expect(await detectSystemLanguage(() => Promise.resolve('fr-FR'))).toBe('en')
    expect(await detectSystemLanguage(() => Promise.resolve('de'))).toBe('en')
  })

  it('falls back to en when IPC throws', async () => {
    expect(await detectSystemLanguage(() => Promise.reject(new Error('boom')))).toBe('en')
  })
})

describe('resolveLanguagePreference', () => {
  it('returns stored value when valid', async () => {
    const r = await resolveLanguagePreference({
      readStorage: () => 'ko',
      detectFn: vi.fn(),
    })
    expect(r).toBe('ko')
  })

  it('calls detect when stored value is "system"', async () => {
    const detect = vi.fn().mockResolvedValue('ja')
    const r = await resolveLanguagePreference({
      readStorage: () => 'system',
      detectFn: detect,
    })
    expect(r).toBe('ja')
    expect(detect).toHaveBeenCalled()
  })

  it('calls detect when no stored value', async () => {
    const detect = vi.fn().mockResolvedValue('zh')
    const r = await resolveLanguagePreference({
      readStorage: () => null,
      detectFn: detect,
    })
    expect(r).toBe('zh')
  })

  it('falls back to en when stored value is corrupted', async () => {
    const r = await resolveLanguagePreference({
      readStorage: () => 'klingon',
      detectFn: vi.fn().mockResolvedValue('en'),
    })
    // Treat invalid stored as if no preference set
    expect(r).toBe('en')
  })
})
```

- [x] **Step 4: Implement `src/renderer/i18n/detectSystemLanguage.ts`**

```ts
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_PREF_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  type LanguagePreference,
  type SupportedLanguage,
} from './types'

type GetLocale = () => Promise<string>

function defaultGetLocale(): Promise<string> {
  return window.electronAPI.system.getLocale()
}

export async function detectSystemLanguage(
  getLocale: GetLocale = defaultGetLocale
): Promise<SupportedLanguage> {
  try {
    const raw = await getLocale()
    const base = raw.split('-')[0].toLowerCase()
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(base)) {
      return base as SupportedLanguage
    }
    return DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

export function readStoredPreference(): LanguagePreference | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(LANGUAGE_PREF_STORAGE_KEY)
  if (!raw) return null
  if (raw === 'system') return 'system'
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(raw)) {
    return raw as SupportedLanguage
  }
  return null
}

export function writeStoredPreference(pref: LanguagePreference): void {
  if (pref === 'system') {
    window.localStorage.removeItem(LANGUAGE_PREF_STORAGE_KEY)
  } else {
    window.localStorage.setItem(LANGUAGE_PREF_STORAGE_KEY, pref)
  }
}

interface ResolveArgs {
  readStorage: () => string | null
  detectFn: () => Promise<SupportedLanguage>
}

export async function resolveLanguagePreference(args: ResolveArgs): Promise<SupportedLanguage> {
  const stored = args.readStorage()
  if (stored && stored !== 'system') {
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
      return stored as SupportedLanguage
    }
  }
  return await args.detectFn()
}
```

- [x] **Step 5: Implement `src/renderer/i18n/index.ts`**

```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ko from './locales/ko.json'
import ja from './locales/ja.json'
import zh from './locales/zh.json'
import {
  detectSystemLanguage,
  readStoredPreference,
  resolveLanguagePreference,
} from './detectSystemLanguage'

export async function initI18n(): Promise<void> {
  const resolved = await resolveLanguagePreference({
    readStorage: () => readStoredPreference(),
    detectFn: detectSystemLanguage,
  })

  await i18n.use(initReactI18next).init({
    resources: {
      en: { common: en },
      ko: { common: ko },
      ja: { common: ja },
      zh: { common: zh },
    },
    lng: resolved,
    fallbackLng: 'en',
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
  })
}

export default i18n
```

- [x] **Step 6: Implement `src/renderer/i18n/useAppLanguage.ts`**

```ts
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  detectSystemLanguage,
  readStoredPreference,
  writeStoredPreference,
} from './detectSystemLanguage'
import type { LanguagePreference, SupportedLanguage } from './types'

export function useAppLanguage(): {
  current: SupportedLanguage
  preference: LanguagePreference
  setPreference: (pref: LanguagePreference) => Promise<void>
} {
  const { i18n } = useTranslation()
  const [preference, setPreferenceState] = useState<LanguagePreference>(
    () => readStoredPreference() ?? 'system'
  )

  const setPreference = useCallback(
    async (pref: LanguagePreference) => {
      writeStoredPreference(pref)
      setPreferenceState(pref)
      const next = pref === 'system' ? await detectSystemLanguage() : pref
      await i18n.changeLanguage(next)
    },
    [i18n]
  )

  useEffect(() => {
    // No-op; i18n's languageChanged event triggers re-renders via context.
  }, [])

  return {
    current: i18n.language as SupportedLanguage,
    preference,
    setPreference,
  }
}
```

- [x] **Step 7: Verify + commit**

```bash
npx vitest run src/test/i18n-detect.test.ts
npm run typecheck
npm run lint
git add src/main/ipc.ts src/preload/index.ts src/preload/types.ts src/renderer/i18n/index.ts src/renderer/i18n/detectSystemLanguage.ts src/renderer/i18n/useAppLanguage.ts src/test/i18n-detect.test.ts
git commit -m "feat(i18n): init, OS locale IPC, hook, detection + persistence"
```

---

### Task 1.4 — LanguagePicker component + format helpers + boot wiring

**Files:** `src/renderer/i18n/LanguagePicker.tsx`, `src/renderer/i18n/format.ts`, `src/renderer/main.tsx`, `src/renderer/App.css`, `src/test/i18n-language-picker.test.ts`

- [x] **Step 1: Write failing test**

`src/test/i18n-language-picker.test.ts`:

```ts
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LanguagePicker } from '../renderer/i18n/LanguagePicker'

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { common: {} } },
  })
})

describe('LanguagePicker', () => {
  it('renders 5 options (System + 4 languages)', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguagePicker />
      </I18nextProvider>
    )
    const opts = screen.getAllByRole('option')
    expect(opts).toHaveLength(5)
    expect(opts.map((o) => o.textContent?.trim())).toEqual([
      'System',
      'English',
      '한국어',
      '日本語',
      '中文',
    ])
  })

  it('changes preference via select', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguagePicker />
      </I18nextProvider>
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'ko' } })
    expect(window.localStorage.getItem('automeetic.language')).toBe('ko')
  })
})
```

- [x] **Step 2: Implement `src/renderer/i18n/LanguagePicker.tsx`**

```tsx
import { LANGUAGE_NATIVE_LABEL, SUPPORTED_LANGUAGES } from './types'
import { useAppLanguage } from './useAppLanguage'

export function LanguagePicker() {
  const { preference, setPreference } = useAppLanguage()
  return (
    <select
      className="language-picker"
      value={preference}
      onChange={(e) => {
        void setPreference(e.target.value as never)
      }}
      aria-label="UI language"
      title="UI language"
    >
      <option value="system">System</option>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {LANGUAGE_NATIVE_LABEL[lang]}
        </option>
      ))}
    </select>
  )
}
```

- [x] **Step 3: Implement `src/renderer/i18n/format.ts`**

```ts
import i18n from './index'

export function formatDate(ms: number, opts: Intl.DateTimeFormatOptions = { dateStyle: 'short' }): string {
  return new Intl.DateTimeFormat(i18n.language, opts).format(ms)
}

export function formatTime(ms: number, opts: Intl.DateTimeFormatOptions = { timeStyle: 'short' }): string {
  return new Intl.DateTimeFormat(i18n.language, opts).format(ms)
}

export function formatNumber(n: number, opts: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(i18n.language, opts).format(n)
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat(i18n.language, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}
```

- [x] **Step 4: Wire boot in `src/renderer/main.tsx`**

Before `ReactDOM.createRoot(...).render(...)`:

```tsx
import { initI18n } from './i18n'

await initI18n()
```

If the entry isn't an async-friendly module, wrap in `void initI18n().then(() => { ReactDOM.createRoot(...).render(<App />) })`.

- [x] **Step 5: Add CSS for `.language-picker` in `App.css`**

```css
.language-picker {
  font-size: 12px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid var(--p-border);
  border-radius: 6px;
  background: var(--p-bg-card);
  color: var(--p-text);
  cursor: pointer;
}
.language-picker:focus { outline: 2px solid var(--p-primary); }
```

- [x] **Step 6: Verify + commit**

```bash
npx vitest run src/test/i18n-language-picker.test.ts
npm run typecheck
npm run lint
git add src/renderer/i18n/LanguagePicker.tsx src/renderer/i18n/format.ts src/renderer/main.tsx src/renderer/App.css src/test/i18n-language-picker.test.ts
git commit -m "feat(i18n): LanguagePicker + Intl formatters + boot wiring"
```

---

### Task 1.5 — Test shim + parity test

**Files:** `src/test/__i18n-shim__.ts`, `src/test/i18n-locales-parity.test.ts`

- [x] **Step 1: Create the test shim**

`src/test/__i18n-shim__.ts`:

```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

void i18n.use(initReactI18next).init({
  lng: 'cimode',
  fallbackLng: 'cimode',
  resources: {},
  interpolation: { escapeValue: false },
})

export default i18n
```

In `vitest.config.ts`, add it as a setup file:

```ts
test: {
  setupFiles: ['./src/test/__i18n-shim__.ts'],
  // ...
}
```

(If `setupFiles` already exists, append the path to the array.)

- [x] **Step 2: Write parity test**

`src/test/i18n-locales-parity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import en from '../renderer/i18n/locales/en.json'
import ko from '../renderer/i18n/locales/ko.json'
import ja from '../renderer/i18n/locales/ja.json'
import zh from '../renderer/i18n/locales/zh.json'

function leafKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix]
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    out.push(...leafKeys(v, path))
  }
  return out
}

describe('locale parity', () => {
  const enKeys = new Set(leafKeys(en).filter((k) => !k.startsWith('_meta')))

  for (const [name, dict] of [['ko', ko], ['ja', ja], ['zh', zh]] as const) {
    it(`${name}.json has identical leaf-key set to en.json`, () => {
      const dictKeys = new Set(leafKeys(dict).filter((k) => !k.startsWith('_meta')))
      const missing = [...enKeys].filter((k) => !dictKeys.has(k))
      const extra = [...dictKeys].filter((k) => !enKeys.has(k))
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    })
  }
})
```

- [x] **Step 3: Verify + commit**

```bash
npx vitest run src/test/i18n-locales-parity.test.ts
npm run typecheck
npm run lint
git add src/test/__i18n-shim__.ts src/test/i18n-locales-parity.test.ts vitest.config.ts
git commit -m "test(i18n): cimode shim + locale parity check"
```

---

### Task 1.6 — Mount LanguagePicker in header + Phase 1 verify

**Files:** `src/renderer/App.tsx`

- [x] **Step 1: Mount the picker in the existing header**

Find the current header element in `App.tsx` (search for header bar / control row near the top of the rendered tree). Add:

```tsx
import { LanguagePicker } from './i18n/LanguagePicker'
// ...
<LanguagePicker />
```

Place next to existing header controls (whiteboard toggle, glossary button, etc.).

- [x] **Step 2: Verify phase**

```bash
npm run verify:phase 1
```

Expected: `VERDICT: ✅ Phase 1 verified`. Update `HANDOFF.md` Phase 1 row.

- [x] **Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(i18n): mount LanguagePicker in header"
```

---

## Phase 2 — Shell + capture/transcription/overlay UI extraction

**Goal:** Extract all strings from the main app shell (App.tsx top-level, shell/, overlay/, feed/). Fill en + ko translations for these strings in their respective JSON files. Leave ja + zh entries with placeholder English values (parity test will pass since keys are present; values are translated in Phase 6).

### Task 2.1 — App.tsx + shell/ extraction

**Files:** `src/renderer/App.tsx`, `src/renderer/shell/SourceBar.tsx`, `src/renderer/shell/TranscriptColumns.tsx`, `src/renderer/shell/RightShelf.tsx`, `src/renderer/i18n/LanguagePicker.tsx`, `src/renderer/i18n/locales/en.json`, `src/renderer/i18n/locales/ko.json`, `src/renderer/i18n/locales/ja.json`, `src/renderer/i18n/locales/zh.json`

- [x] **Step 1: Identify each visible user-facing string in `App.tsx` and `shell/*.tsx`**

For each one:
- Pick a key under `shell.<purpose>` (e.g., `shell.statusIdle`, `shell.btnStart`, `shell.btnStop`).
- Replace the literal with `t('shell.<key>')`.
- Add to `en.json` under `shell.<key>` with the English string.
- Add to `ko.json` under `shell.<key>` with the Korean string if one already exists in the code, else mirror English (temporary; Phase 6 fixes).
- Add the same key to `ja.json` + `zh.json` with the English string as placeholder.

Suggested namespaces:
- `shell.*` — App shell, status badges, capture controls
- `transcript.*` — TranscriptColumns, Original / Translated headers, empty state
- `overlay.*` — CaptionOverlay, Waveform labels
- `feed.*` — Live feed messaging

- [x] **Step 2: Run i18n parity test repeatedly**

```bash
npx vitest run src/test/i18n-locales-parity.test.ts
```

After every JSON edit, this test verifies the 4 locales stay in sync. Failing test → missing keys somewhere.

- [x] **Step 3: Update any existing test that asserts on shell/ literal strings**

For each failing test:
- If it's checking "did the right thing happen" → migrate assertion to a key-based check (`expect(...).toHaveTextContent('shell.btnStop')` since cimode returns keys).
- If it's checking actual user-visible copy → import test fixture and load real translations.

- [x] **Step 4: Verify + commit**

```bash
npm run typecheck
npm run lint
npx vitest run
git add -A
git commit -m "feat(i18n): extract shell + transcript + overlay + feed strings (en/ko)"
```

---

### Task 2.2 — Verify Phase 2

```bash
npm run verify:phase 2
```

Update `HANDOFF.md` Phase 2 row.

---

## Phase 3 — Memory Library + Ask + Deep Ask + Answer Assist + Action Items

### Task 3.1 — Extract Memory Library, Ask, Deep Ask, Answer Assist, Action Items strings

**Files:** `src/renderer/library/MemoryLibraryPanel.tsx`, `src/renderer/library/MeetingsTab.tsx`, `src/renderer/ask/AskTab.tsx`, `src/renderer/ask/AskInput.tsx`, `src/renderer/ask/ChatMessageView.tsx`, `src/renderer/ask/SourcesList.tsx`, `src/renderer/ask/DeepAskToggle.tsx`, `src/renderer/ask/DeepAskProgressCard.tsx`, `src/renderer/ask/AnswerFooter.tsx`, `src/renderer/answer-assist/AnswerAssistCard.tsx`, `src/renderer/actions/ActionItemsPanel.tsx`, `src/renderer/i18n/locales/en.json`, `src/renderer/i18n/locales/ko.json`, `src/renderer/i18n/locales/ja.json`, `src/renderer/i18n/locales/zh.json`

Suggested namespaces:
- `library.*` — MemoryLibraryPanel header, tabs, close button
- `meetings.*` — MeetingsTab list, search, detail, export, regen summary
- `ask.*` — AskTab, AskInput placeholder/send/stop, ChatMessageView, SourcesList
- `deepAsk.*` — DeepAskToggle, DeepAskProgressCard step labels, AnswerFooter format string
- `answerAssist.*` — AnswerAssistCard
- `actions.*` — ActionItemsPanel

For each component:
- Replace every JSX text literal, `placeholder`, `title`, `aria-label` with `t(...)`.
- Use interpolation for dynamic parts: `t('deepAsk.footer.format', { agents, toolCalls, usd, seconds })`.
- For pluralized counts, use `_one`/`_other` suffix pattern in JSON.

- [x] **Step 1: Per-component extraction** (do in batches; each batch + commit)

- [x] **Step 2: Update existing test assertions affected by the extraction**

- [x] **Step 3: Verify**

```bash
npx vitest run src/test/i18n-locales-parity.test.ts
npm run typecheck
npm run lint
npx vitest run
git add -A
git commit -m "feat(i18n): extract library + ask + deep-ask + answer-assist + actions strings"
```

### Task 3.2 — Verify Phase 3

```bash
npm run verify:phase 3
```

Update `HANDOFF.md`.

---

## Phase 4 — Glossary surface

### Task 4.1 — Extract Glossary strings

**Files:** `src/renderer/glossary/GlossaryPanel.tsx`, `src/renderer/glossary/GlossaryRowEditor.tsx`, `src/renderer/glossary/SuggestionRow.tsx`, `src/renderer/glossary/VariantCandidatePicker.tsx`, `src/renderer/glossary/GlossarySaveSuccessCard.tsx`, `src/renderer/glossary/GlossaryMark.tsx`, `src/renderer/i18n/locales/en.json`, `src/renderer/i18n/locales/ko.json`, `src/renderer/i18n/locales/ja.json`, `src/renderer/i18n/locales/zh.json`

Glossary has the most existing Korean text (`변형 찾기`, `STT 오인일 수 있음`, success card body lines). All four target languages need clean translations here because this is the most copy-heavy surface.

Suggested namespaces:
- `glossary.panel.*` — header, tabs, search, empty states
- `glossary.editor.*` — row editor labels, find-variants button, scanning state, variant chip remove button
- `glossary.suggestions.*` — SuggestionRow accept / dismiss / bulk accept
- `glossary.variantPicker.*` — modal title, hint, frequency suffix, confirm/cancel
- `glossary.success.*` — GlossarySaveSuccessCard header, body variants (existing message, new term, short word warning), example label, future-tense line
- `glossary.mark.*` — HighlightedText tooltip lines

- [x] **Step 1: Replace strings, write JSON entries for en + ko**
- [x] **Step 2: Update affected tests**
- [x] **Step 3: Verify + commit**

```bash
npx vitest run src/test/i18n-locales-parity.test.ts
npm run typecheck
npm run lint
npx vitest run
git add -A
git commit -m "feat(i18n): extract glossary strings (panel + editor + suggestions + variants + success)"
```

### Task 4.2 — Verify Phase 4

```bash
npm run verify:phase 4
```

Update `HANDOFF.md`.

---

## Phase 5 — Whiteboard + Mind-map + date/number formatter rollout

### Task 5.1 — Extract Whiteboard / Mind-map UI strings

**Files:** `src/renderer/whiteboard/WhiteboardModal.tsx`, `src/renderer/whiteboard/WhiteboardLabelLangSelect.tsx`, `src/renderer/whiteboard/ExcalidrawCanvas.tsx`, `src/renderer/ask/AnswerFooter.tsx`, `src/renderer/ask/ChatMessageView.tsx`, `src/renderer/ask/SourcesList.tsx`, `src/renderer/glossary/SuggestionRow.tsx`, `src/renderer/library/MeetingsTab.tsx`, `src/renderer/i18n/locales/en.json`, `src/renderer/i18n/locales/ko.json`, `src/renderer/i18n/locales/ja.json`, `src/renderer/i18n/locales/zh.json`

Suggested namespaces:
- `whiteboard.modal.*` — WhiteboardModal header, controls, close
- `whiteboard.labelLang.*` — WhiteboardLabelLangSelect labels
- `whiteboard.mode.*` — Freeform / Mind map toggle

(LLM-facing prompts inside whiteboard prompt builders are NOT translated — they're internal LLM strings, not UI.)

- [x] **Step 1: Replace strings, write JSON entries**
- [x] **Step 2: Apply `formatDate` / `formatTime` / `formatNumber` / `formatCurrency` across the whole renderer**

Find every `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`, `toFixed`, etc. in renderer code. Where the value is user-visible, replace with the helpers from `src/renderer/i18n/format.ts`.

Specific known sites:
- `src/renderer/ask/AnswerFooter.tsx`: `costBreakdown.total.estimatedUsd.toFixed(2)` → `formatCurrency(costBreakdown.total.estimatedUsd)`
- Meeting detail date formatting in `MeetingsTab.tsx`
- Memory Chat sources timestamp display
- Any other `Date` / number rendering

- [x] **Step 3: Verify + commit**

```bash
npx vitest run src/test/i18n-locales-parity.test.ts
npm run typecheck
npm run lint
npx vitest run
git add -A
git commit -m "feat(i18n): extract whiteboard strings + roll out Intl formatters"
```

### Task 5.2 — Verify Phase 5

```bash
npm run verify:phase 5
```

Update `HANDOFF.md`.

---

## Phase 6 — Fill ja + zh translations + final regression + push

### Task 6.1 — Fill Japanese + Chinese translations

**Files:** `src/renderer/i18n/locales/ja.json`, `src/renderer/i18n/locales/zh.json`

Strategy: LLM-assisted translation. For each key in `en.json`, generate a Japanese and Chinese translation. Document in the commit and HANDOFF that ja/zh are LLM-translated and pending native review (v1.1 follow-up).

- [x] **Step 1: Generate ja.json**

Take the full `en.json` resource tree (after Phases 2–5 filled it in). For each leaf string, produce a Japanese translation. Maintain interpolation tokens (`{{var}}`) verbatim. Preserve plural suffix conventions (`_one`/`_other`).

Practical workflow (run once by the human or LLM):
- Feed `en.json` to GPT-4 / Claude with prompt: "Translate every leaf value to natural Japanese. Preserve `{{var}}` tokens. Keep JSON structure identical. Output only the JSON."
- Spot-check ~20 random keys against expectations.
- Write the result to `ja.json`.

- [x] **Step 2: Generate zh.json**

Same procedure for Chinese (Simplified, `zh-CN` style — but stored under the key `zh` since v1 doesn't split variants).

- [x] **Step 3: Verify parity**

```bash
npx vitest run src/test/i18n-locales-parity.test.ts
```

Must show clean (zero missing/extra keys per locale).

- [x] **Step 4: Verify + commit**

```bash
npm run typecheck
npm run lint
npx vitest run
git add src/renderer/i18n/locales/ja.json src/renderer/i18n/locales/zh.json
git commit -m "feat(i18n): fill Japanese + Chinese translations (LLM-assisted, native review pending v1.1)"
```

### Task 6.2 — Full regression

```bash
npm run verify
npm run build
```

Document Windows `EBUSY` if `npm test` blocked. `tsc -b` preexisting build issue not in this stream's scope.

### Task 6.3 — Update `HANDOFF.md`

- [x] **Move "Deep Ask Multi-Agent" + "Memory panel scroll fix" / other recent streams to a Completed section** if not already.
- [x] **Insert new "Next active stream" block + status table** with all 6 rows ⏳ PENDING (replaced phase by phase as work progresses).

### Task 6.4 — Manual smoke (deferred to user)

Document:
- Picker visible in header with 5 options.
- Selecting each language rerenders the entire UI immediately.
- "System" option clears the override; closing + reopening picks up OS locale fresh.
- CJK characters render correctly (no boxes / fallback fonts).
- Dates and numbers format correctly per locale (e.g., currency in `$0.27` style for en, `0.27 US$` or similar for zh).
- Meeting content (transcripts, summaries, Memory Chat answers) is unaffected by UI language toggle.
- Closing app + reopening preserves the chosen language.

### Task 6.5 — Push

```bash
git push origin master
```

Mark Phase 6 ✅ COMPLETE in `HANDOFF.md`.

---

## Self-review checklist

- [x] All 6 phases ✅ COMPLETE in `HANDOFF.md` with verbatim verify output.
- [x] Every renderer component file that renders user-visible text uses `t()` (audit by grep for stray Korean characters + common English UI words outside of `i18n/locales/`).
- [x] All 4 locale files have identical leaf-key sets (parity test passes).
- [x] `LanguagePicker` in header. Changing it rerenders without restart.
- [x] OS detect works on fresh install (no localStorage entry).
- [x] Selecting "System" clears localStorage + re-detects.
- [x] Bundle size delta < 50 KB gzipped.
- [x] No regression in any existing surface (STT, translation, embedding, glossary backend, Deep Ask backend).
- [x] No deviation from spec's "In scope" / "Out of scope".

## Open questions (deferred to v2)

- Native review cycle for ja/zh (v1.1)
- Pseudo-locale for layout overflow testing
- Region variants (`zh-TW`, `en-GB`)
- LLM prompt language switching to UI language
- Telemetry dimension for UI language
- Flag emojis in picker
- `userData/settings.json` migration for preference storage
- Lazy-loaded namespaces
- Translation management platform integration
- Auto-extraction tooling
