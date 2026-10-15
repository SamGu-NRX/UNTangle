# Provider boundary record — privacy, confirmation, and a11y checks

Task: verification streams on branch `obv/untangle-privacy-a11y-checks`
(synthetic transcript privacy tests, confirmation-flow tests, keyboard/mobile/
reduced-motion browser checks). This record states exactly what was sent to any
external provider while performing them.

**Date:** 2026-10-10
**Sandbox:** repo sandbox for `SamGu-NRX/UNTangle` (offline) + project sandbox browser session against a local dev-server preview.

## Result: NOTHING was sent to any external provider

- **Tests (`bun test tests/`):** fully offline. No test performs network I/O.
  All transcript fixtures are fabricated synthetic data invented for the tests
  ("Test Student", fake IDs `10012345` / `88990077`, fake address, fake email
  `test.student@example.invalid`, fake digit runs `123-45-6789` /
  `817-555-0142`). No Puter SDK, no ORS, no live model call, no email send.
- **Component-level choice:** the confirmation-flow tests are logic-level on
  purpose. Rendering `TranscriptImportClient` would mount its unconditional
  `next/script` tag for `https://js.puter.com/v2/`
  (`frontend/src/components/transcript-import-client.tsx`), so the tests
  exercise the extracted pure gate (`selectApprovedTranscriptRecords`) and the
  planner persistence path instead of loading that script in a test process.
- **Browser session:** one local Next.js dev server (`bun run dev` in
  `frontend/`, tmux) served the planner page (`/schedule`) through a sandbox
  preview URL. `agent-browser` request-log review at the end of the session
  showed exactly two hosts requested: the preview origin itself and the
  agent-browser localhost daemon. No `js.puter.com`, no OpenStreetMap tile
  host, no font CDN, no analytics endpoint. As a belt-and-braces measure,
  abort routes were registered for `js.puter.com`, `tile.openstreetmap.org`,
  `fonts.googleapis.com`, and `fonts.gstatic.com` before the first navigation;
  none was ever hit.
- **Map/reverse-geocode services (ORS, Nominatim):** not visited, not called.
- **Puter file storage / OCR (`puter.ai.img2txt`):** not run — the transcript
  import page was deliberately **not opened in the browser session** (see
  below).

## Live-provider checks: NOT RUN

No live-provider check was executed. Specifically:

- **Puter AI analysis (text or image path): NOT RUN.** No Puter SDK was
  loaded, no Puter sign-in was attempted, no model alias was called, and no
  data was uploaded to Puter file storage at any point.
- **OpenRouteService geocoding/routing: NOT RUN.**
- **Resend email: NOT RUN.**
- **OpenStreetMap tile fetch: NOT RUN** (and the map page was never opened).

The transcript-import page UI (`/courses/import`) could not be opened in the
browser session without violating the no-external-loads constraint, because
the page renders `<Script src="https://js.puter.com/v2/">` unconditionally on
mount. Keyboard/mobile verification therefore covered the planner page
(`/schedule`) and its section-swap dialog in-browser; the import page's
redaction behavior is covered by the offline unit tests instead of a live
browser pass. This is recorded as a known gap, not a run.

## Verification summary

- `bun test tests/`: **89 passed, 0 failed** (74 pre-existing + 15 new).
- `bunx tsc --noEmit`: clean. `bun run lint`: clean.
- Browser evidence: `docs/evidence/tc-3-planner-focus.png`,
  `tc-3-dialog-focus.png`, `tc-4-mobile-planner.png`,
  `tc-4-mobile-dialog.png`, `tc-5-reduced-motion-dialog.png`.
