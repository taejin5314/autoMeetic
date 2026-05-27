# App i18n — System Language Selection — Design Spec

**Date:** 2026-05-27
**Status:** Draft — pending implementation
**Stream type:** Cross-cutting UX infrastructure (touches ~30–40 renderer files)
**Related:** First i18n stream in the project. Builds on existing renderer architecture (React 19 + Vite + Electron). No prior i18n infrastructure exists.

## One-line

Add `react-i18next` to the renderer, extract every UI string from ~30 component files into JSON locale resources for English / Korean / Japanese / Chinese, expose the OS locale from the main process via a new IPC, and add a header `[KO ⌄]` dropdown that lets the user pick a language (or follow OS). Auto-detect on first launch, persist override to localStorage.

## Why this stream

The app's UI today is bilingual by accident — some labels are Korean (`변형 찾기`, `메모리`), some English (`Deep`, `Streaming...`), some mixed inside one panel. A non-Korean-and-non-English speaker can't use the app coherently. There is no language toggle. The hard-coded strings are scattered across ~30 component files (`MeetingsTab.tsx` alone has ~70 string references).

For the app to scale beyond Korean-and-English users (or to be usable when a Korean user demos to an English colleague), the UI needs:
- A canonical translation infrastructure (one library, one resource format)
- Coverage of all four target languages (en / ko / ja / zh) in a single release so users don't see partial translations
- A toggle that defaults to OS locale but lets the user override
- A test strategy that doesn't bind every test to a specific string

This is purely UI surface work. LLM-generated content (summaries, action items, Memory Chat answers) is **not** part of this stream — those follow the meeting's source language and are conceptually separate.

## Success criteria

1. **Default behavior:** Fresh install. App detects OS locale via Electron's `app.getLocale()`. If it maps to one of the four supported languages, UI renders in that language. Otherwise falls back to English.
2. **Manual override:** Header has a small dropdown (`System | EN | KO | JA | ZH`). Selecting one immediately rerenders the entire UI in that language without app restart. Selection persists to `localStorage.automeetic.language` and survives restart.
3. **"System" option:** Selecting "System" clears the localStorage override and re-runs OS detection. Useful for users who set their OS language and want the app to follow.
4. **All four languages complete on ship day:** No partial translations. Every UI string visible to the user is translated in all 4 languages. (Japanese and Chinese are LLM-translated in v1 with the explicit note that native review is a v1.1 follow-up.)
5. **No LLM-generated content affected:** Memory Chat answers, summaries, action items, Deep Ask plan reasoning — all remain in the meeting's source language or whatever the LLM emits. The UI labels surrounding them are translated, the content inside is not.
6. **Existing tests pass without per-string edits:** Tests that previously asserted Korean/English literal strings get migrated to assert on translation **keys** (via `cimode` test setup) rather than translated text. Cost: mechanical updates to existing assertions; benefit: tests don't break when copy changes.
7. **Date/time/number formatting respects the active locale:** Calls like `new Date().toLocaleString()` are replaced with `Intl.DateTimeFormat(currentLang, ...).format(...)` so e.g., `2026-05-27` shows as `5/27/2026` in en-US, `2026. 5. 27.` in ko, `2026/5/27` in ja, `2026/5/27` in zh.
8. **No regression to non-UI surfaces:** STT, translation, embedding, glossary, Deep Ask — none of them change. They consume the *meeting's* language pair, not the UI's. Confirm by audit.
9. **No regression to existing tests** (`npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` all clean).
10. **Bundle impact under 50 KB gzipped:** `react-i18next` + `i18next` + 4 JSON files. Acceptable for a desktop app.

## In scope

### Library + infra

- New dependencies: `i18next` (runtime), `react-i18next` (React bindings). Both MIT-licensed, mature, widely adopted.
- New folder `src/renderer/i18n/` containing:
  - `index.ts` — i18n init function called once at app boot before React renders
  - `locales/en.json`, `ko.json`, `ja.json`, `zh.json` — translation resources (nested JSON, one namespace `common`)
  - `useAppLanguage.ts` — hook exposing `{ current, preference, setPreference }` for the picker UI
  - `detectSystemLanguage.ts` — IPC-fronted OS locale detection with `en` fallback
  - `LanguagePicker.tsx` — the dropdown component for the header
  - `format.ts` — `formatDate`, `formatTime`, `formatNumber` helpers using `Intl.*` with current language
  - `types.ts` — `SupportedLanguage`, `LanguagePreference`

### IPC

- New channel `system:get-locale` (one-shot request, no event stream). Main process responds with `app.getLocale()` (string like `'ko-KR'` or `'en-US'`).
- Preload bridge exposes `window.electronAPI.system.getLocale(): Promise<string>`.

### Header UI

- New `<LanguagePicker>` component mounted in the existing header bar (alongside other header controls). Renders as a compact `<select>` with five options:
  - `System` (follows OS, clears localStorage override)
  - `English`
  - `한국어`
  - `日本語`
  - `中文`
- Native-name labels in each language (not transliterated) so users see their language as it's spelled natively.

### String extraction

- Every hard-coded string in the renderer that's visible to the user gets replaced with `t('namespace.key')`. Strings include:
  - Buttons, labels, headings, tab names
  - Placeholders (`placeholder="..."` on inputs)
  - Tooltip `title="..."` attributes
  - `aria-label`, `aria-description`
  - Empty-state messages
  - Error toasts and status messages
  - Format strings with interpolation (e.g., `"Found {count} mentions"` → `t('glossary.success.mentionsFound', { count })`)
- Key naming convention: `<surface>.<component>.<purpose>`, e.g., `library.panel.title`, `glossary.editor.findVariantsBtn`, `ask.input.placeholder`.
- en.json is the source of truth for what keys exist. Other locales mirror its structure. CI-style check: a small unit test asserts all 4 locale files have identical key sets (preventing drift).

### Translation source

- **en.json**: extracted from existing English UI text. Source of truth for key set.
- **ko.json**: extracted from existing Korean UI text where present; otherwise translated from en by a Korean reviewer (the developer themselves is Korean-speaking).
- **ja.json + zh.json**: v1 ships with LLM-generated translations (Claude or GPT-4 fed the en.json structure). Explicit disclaimer in the spec + a v1.1 native-review follow-up.

### Date / number formatting

- All `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` calls that currently use the JS default locale get replaced with `Intl.DateTimeFormat(i18n.language, ...).format(...)`.
- Number formatting (counts, durations, token tallies) uses `Intl.NumberFormat(i18n.language)`.
- Implementation: small helpers in `src/renderer/i18n/format.ts` that read the current language from i18n once; components import the helpers.

### Test infrastructure

- New test shim `src/test/__i18n-shim__.ts` that initializes i18n in `cimode` (returns translation keys as-is). Existing test files import this once at top, so any `useTranslation()` call returns keys instead of crashing.
- Existing assertions that check specific Korean or English text get rewritten to assert against the **key** (`expect(button).toHaveTextContent('library.panel.closeAria')`) OR get rewritten to render with a fixture i18n init that loads the actual translations. Strategy decided per test file based on what's being verified.
- A new test `src/test/i18n-locales-parity.test.ts` asserts that all 4 locale JSON files have the same set of leaf keys — catches missing translations at CI time.

## Out of scope (deferred)

- LLM-generated content translation (summaries, action items, Memory Chat answers, Deep Ask plan reasoning). These remain in whatever language the LLM emits based on the meeting context. Out of scope by design — the spec is UI-only.
- LLM prompt language switching (e.g., having the synthesizer respond in the UI language instead of the question language). Out of scope; separate decision.
- RTL languages (Arabic, Hebrew). All four chosen languages are LTR.
- Lazy-loaded namespaces. v1 bundles all 4 JSONs eagerly. Lazy loading is a v2 optimization if bundle size becomes a concern (won't with 4 languages).
- Translation management platform integration (Crowdin, Lokalise, Phrase). v1 uses raw JSON in the repo.
- Automated string extraction tools (`i18next-parser`, etc.). v1 is a one-time manual extraction.
- Region variants (`zh-TW` vs `zh-CN`, `en-US` vs `en-GB`). v1 normalizes to language-only codes (`zh`, `en`).
- Custom CJK font embedding. Relies on system fonts (modern Windows/macOS/Linux all have CJK fonts installed).
- Native review of ja/zh translations in v1. Explicit follow-up scope (v1.1) — LLM-translated first ship.
- Translating the marketing/landing page, README, error messages from the main process, or backend logs. Renderer UI only.
- Pluralization for languages beyond `_one`/`_other`. v1 covers English's two-form plurals; CJK don't pluralize so they get `_other` only.

## Key design decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Library | `react-i18next` + `i18next` | Most mature, largest ecosystem, best documentation, used in countless production apps. MIT. ~20 KB gzipped. Korean tutorial coverage is strong. |
| Source-of-truth language | `en` | English is the most common base for translation. Other locale files mirror its key structure. |
| Resource format | Nested JSON, single namespace (`common`) | More readable than flat. Single namespace avoids the complexity of dynamic loading; bundle cost is negligible for 4 languages. |
| Key naming | `<surface>.<component>.<purpose>` (e.g., `glossary.editor.findVariantsBtn`) | Self-documenting + grep-friendly + matches file structure. |
| OS locale source | `app.getLocale()` in main + IPC | Reliable cross-platform via Electron. `navigator.language` in renderer is unreliable inside Electron's Chromium build. |
| Override storage | `localStorage.automeetic.language` (values: `'en' \| 'ko' \| 'ja' \| 'zh' \| 'system'`) | Synchronous read on init, no race. Same pattern as `automeetic.showGlossaryHighlights`. |
| "System" preference | Special value that clears the override and re-runs detection on each app start | Simpler than tracking "stored vs auto-detected" — semantics are explicit. |
| Selector UI location | Main header bar, between existing controls | Discoverable but not intrusive. Changing language is a rare action; doesn't need primary placement. |
| Selector native labels | `English / 한국어 / 日本語 / 中文` | Users recognize their language in its native script. |
| Date / number formatting | `Intl.*` APIs in helper functions, not i18next's formatter | Native APIs are zero-cost (already in V8) and standard. Helpers centralize the "what's current language" lookup. |
| Test default | i18n init in `cimode` (returns keys verbatim) | Existing tests don't crash; assertions migrate to key-based. Some tests can opt into real translations via fixture init. |
| Locale parity test | Unit test that diffs leaf-key sets across all 4 JSON files | Catches drift the moment a new key is added in en but forgotten in others. CI-level safety. |
| Translation source for ja/zh | LLM-generated (Claude or GPT-4) for v1 | Pragmatic: ship 4 languages now, schedule v1.1 native review. Spec explicitly discloses. |
| Fallback chain | Missing key in current locale → `en` → key string + dev-only `console.warn` | Standard i18next behavior. Loud in dev, silent in prod (UI shows English instead of crashing). |
| Bundle strategy | All 4 locales eagerly bundled | <50 KB total. Lazy loading is v2 if needed. |
| Pluralization | i18next's `_one` / `_other` suffix pattern (English-style) | CJK don't pluralize so the `_other` form is used for any count. Covers all v1 needs. |
| Interpolation | i18next's `{{var}}` syntax | Standard. React-safe (escapeValue=false because React already escapes). |
| Component re-render on language change | i18next emits a `languageChanged` event; `react-i18next` auto-subscribes via context | No manual wiring needed. |
| Migration ordering | Surface-by-surface internally (across phases), but ship all together | All 4 languages must be present in one release to avoid mixed-language UI for any subset of users. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| ~30 component files, ~300+ strings — large blast radius | Phase-by-phase extraction with isolated commits. Each phase passes `verify:phase` before moving on. The plan splits work by surface so any single phase's diff is reviewable. |
| Existing tests with literal-string assertions break | `cimode` shim returns keys; per-file migration of assertions is mechanical. The `i18n-locales-parity` test catches the "I forgot to translate this" class of bug at CI. |
| ja/zh quality is LLM-translated (not native-reviewed) | Explicit disclaimer in spec + UI footer notice ("Japanese/Chinese translations are machine-assisted; review in progress") *optional v1 nice-to-have*. Native review scheduled as v1.1 (separate stream). |
| Locale drift between JSON files (key added in en, forgotten in ko) | Parity test in CI. Optional dev helper script `scripts/check-locales.mjs` that prints missing keys per locale. |
| String marked for translation but never wired up | i18next emits `missingKey` events in dev; could surface to console for visibility. Acceptable noise floor. |
| Date format surprises (e.g., `Intl.DateTimeFormat(ko)` defaults differ from previous hard-coded format) | Audit existing date sites; pick `dateStyle: 'short'` or explicit options to control output. Test snapshots for each locale's expected format. |
| Some strings are inside non-React contexts (e.g., main process log messages) | Out of scope. Main process logs stay in English. Only renderer UI gets translated. |
| User had Korean OS but expected to keep using the app in current bilingual state | First launch detects `ko` → app appears fully in Korean. If they prefer mixed/English, they switch via picker. Documented behavior; not a regression because there was no language preference before. |
| CJK font rendering issue on older Windows | All four languages target modern Windows 10/11 + macOS 13+ + recent Linux; all have CJK fonts. If user reports issue, font embedding is v2. |
| `react-i18next` peer dep mismatch with React 19 | `react-i18next` 14+ supports React 19. Verify version at install. |
| Existing Korean text inside dynamic content (e.g., `RealtimeOrchestrator (12번 등장)`) needs untangling between fixed-language Korean ("번 등장") and counted parts | Treat as templated string: `t('foundCount', { count, term })` → translation looks like `"{{term}} (mentioned {{count}} times)"` in en, `"{{term}} ({{count}}번 등장)"` in ko, similar in ja/zh. |

## Verification approach

Per `CLAUDE.md` phase verification convention:

1. **Each phase:** `npm run verify:phase <N>` shows `VERDICT: ✅ Phase N verified`.
2. **Final:** `npm run verify` clean. `npm run build` clean.
3. **Manual smoke (deferred to user):**
   - Launch app with system in Korean → confirm UI defaults to Korean.
   - Open language picker → switch to English → entire UI rerenders to English without restart.
   - Switch to Japanese → confirm CJK characters render correctly.
   - Switch to Chinese → confirm same.
   - Switch to "System" → confirm it reverts to OS-detected (Korean if OS is Korean).
   - Close + reopen app → confirm last-selected language persists.
   - Try a meeting in mixed Korean/English → confirm meeting content (transcripts, summaries) is unaffected by UI language toggle.
   - Try Memory Chat → confirm citations + answer use meeting content language, but surrounding UI labels match selected UI language.
   - Date/time displays correctly per locale (e.g., `2026/5/27` in zh, `2026. 5. 27.` in ko).

## File map (preview — full detail in plan)

| Path | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `i18next` + `react-i18next` deps |
| `src/renderer/i18n/index.ts` | Create | i18n init function |
| `src/renderer/i18n/types.ts` | Create | `SupportedLanguage`, `LanguagePreference` |
| `src/renderer/i18n/detectSystemLanguage.ts` | Create | OS locale via IPC + fallback |
| `src/renderer/i18n/useAppLanguage.ts` | Create | Hook for current + preference + setter |
| `src/renderer/i18n/LanguagePicker.tsx` | Create | Header dropdown component |
| `src/renderer/i18n/format.ts` | Create | `formatDate`, `formatTime`, `formatNumber` helpers |
| `src/renderer/i18n/locales/en.json` | Create | English (source-of-truth) translations |
| `src/renderer/i18n/locales/ko.json` | Create | Korean translations |
| `src/renderer/i18n/locales/ja.json` | Create | Japanese translations (LLM-assisted in v1) |
| `src/renderer/i18n/locales/zh.json` | Create | Chinese translations (LLM-assisted in v1) |
| `src/renderer/main.tsx` | Modify | Call `initI18n()` before `ReactDOM.createRoot` render |
| `src/renderer/App.tsx` | Modify | Mount `<LanguagePicker>`; replace strings with `t()` |
| `src/renderer/shell/*.tsx` | Modify | Replace strings with `t()` |
| `src/renderer/library/*.tsx` | Modify | Replace strings with `t()` |
| `src/renderer/glossary/*.tsx` | Modify | Replace strings with `t()` |
| `src/renderer/ask/*.tsx` | Modify | Replace strings with `t()` |
| `src/renderer/answer-assist/*.tsx` | Modify | Replace strings with `t()` |
| `src/renderer/actions/*.tsx` | Modify | Replace strings with `t()` |
| `src/renderer/overlay/*.tsx` | Modify | Replace strings with `t()` |
| `src/renderer/feed/*.tsx` | Modify | Replace strings with `t()` |
| `src/renderer/whiteboard/*.tsx` | Modify | Replace strings with `t()` |
| `src/main/ipc.ts` | Modify | Register `system:get-locale` handler |
| `src/preload/index.ts` | Modify | Expose `system.getLocale` |
| `src/preload/types.ts` | Modify | Type addition |
| `src/test/__i18n-shim__.ts` | Create | Test-mode i18n init (`cimode`) |
| `src/test/i18n-locales-parity.test.ts` | Create | Asserts identical key sets across all 4 locale JSONs |
| `src/test/i18n-detect.test.ts` | Create | Detection logic + override + persistence |
| `src/test/i18n-language-picker.test.ts` | Create | Picker UI behavior |
| Various existing `src/test/*.test.ts` | Modify | Import the i18n shim; migrate literal-string assertions to key-based where needed |
| `HANDOFF.md` | Modify | New active stream block + status table |

## Open questions / explicit non-decisions

- **Should the picker show flag emojis next to language names?** v1: no. Flag-for-language is sometimes politically charged (e.g., 🇨🇳 vs 🇹🇼 for Chinese). Text labels only. v2 may add subtle icons.
- **Should the dev-mode "missing key" warning be a toast or just console?** v1: console only. Toast is noise in dev.
- **Should there be a Pseudo-locale for testing layout overflow (e.g., `[--Loading--]` becomes `[--Lóóáding--]`)?** v2 nice-to-have, not v1.
- **Should we extract numeric formatting (e.g., `0.27` as USD) to use `Intl.NumberFormat`'s `currency` style?** v1: yes, where the value is currency (Deep Ask footer's `$X` becomes locale-aware). Other numbers use plain `Intl.NumberFormat`.
- **Should we add a "Translate this UI" reporting button so users can flag bad translations?** v2.
- **Should we track UI language as a telemetry dimension (e.g., `memory.deep-ask.submit { ..., uiLanguage }`)?** v2 nice-to-have, not required for ship.
- **Should `localStorage` be replaced with a more durable Electron `userData/settings.json` for the language preference?** v1: `localStorage` for consistency with existing settings (e.g., glossary highlight toggle). Migration to `settings.json` is a separate cross-cutting decision.

## Self-review notes

The first pass split this into "ship en+ko first, ja+zh later as v2." On reflection: shipping partial language coverage means a user with Japanese OS gets an English-fallback experience until the v2 stream, which is worse than them getting LLM-translated Japanese now. Decision flipped to ship all 4 together with the explicit "ja/zh native review pending" disclaimer.

The first pass also considered automating string extraction with `i18next-parser`. For ~300 strings, a one-shot manual extraction is faster than configuring the tool, and the result is more reviewable (each phase touches a known surface). Automation is v2 if string churn becomes a maintenance burden.

A risk surfaced during review: existing tests assert on Korean/English literal strings. Two valid responses are (a) migrate all assertions to keys, or (b) load real translations in test setup. (a) is more disciplined but more churn. (b) preserves test intent but ties tests to translation copy. The plan chose (a) as the default with (b) available per-file where checking the actual user-visible text matters.
