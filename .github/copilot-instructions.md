# AutoMeetic Copilot Instructions

AutoMeetic is a TypeScript, React, Vite, and Electron application.

Before suggesting completion for code changes, prefer evidence from:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` for integration changes

For reviews, focus on:

- live caption latency and sentence grouping regressions
- whiteboard diagram overlap, lost elements, and theme readability
- source/target language routing bugs
- answer assist prompt/context mismatches
- missing regression tests for user-reported bugs

When proposing fixes, prefer small patches that follow existing project patterns.
