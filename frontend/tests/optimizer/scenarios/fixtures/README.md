# spring-2027-trimmed.json

Real Spring 2027 enrollment options, captured once from the source the app
uses and trimmed to the courses the scenario evaluation needs.

- Source: `https://vsb.untgrades.app/data/spring-2027.json` (the same URL
  `frontend/src/lib/sections/config.ts` builds; schema version 2)
- Captured: 2026-10-15, one polite GET with a descriptive User-Agent
- Upstream file says `updated_at` 2026-10-04T19:02:54 UTC
- Trim: top-level fields kept as-is; `courses` kept only for the 56 course
  codes the student scenarios schedule, byte-for-byte from the capture

The harness parses this file with the app's own `parseTerm`, so the scenarios
run on the same data path as the live proxy without touching the network.
