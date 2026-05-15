## Summary

-

## Risk Areas

- [ ] live feed sentence grouping / auto-scroll
- [ ] translation source/target language routing
- [ ] answer assist prompt/context
- [ ] whiteboard layout / Excalidraw conversion
- [ ] renderer/main IPC contracts
- [ ] proxy/network failure modes
- [ ] packaging/build

## Test Evidence

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build` (required when `src/main/**`, `src/renderer/**`, `src/preload/**`, config, or dependencies changed)
- [ ] Additional targeted checks (list command + result)

## AI Review Triage

List unresolved or accepted AI review comments and classify each as one of:

- `must-fix`:
- `should-fix`:
- `note`:

If no blocking findings:

- `No must-fix findings`

## Deferred Follow-Ups

- Include any intentionally deferred `should-fix` items and linked issue/next PR.

## Notes For Reviewers

- If CI is failing, fix CI before lower-severity review comments.
- If an AI finding is non-reproducible, add a test proving safe behavior or explain why it is not applicable.
