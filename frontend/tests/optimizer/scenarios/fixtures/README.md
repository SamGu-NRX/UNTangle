# spring-2027-trimmed.json

Real Spring 2027 enrollment options, captured once from the source the app
uses and trimmed to the courses the scenario evaluation needs.

- Source: `https://vsb.untgrades.app/data/spring-2027.json` (the same URL
  `frontend/src/lib/sections/config.ts` builds; schema version 2)
- Captured: 2026-10-15, one polite GET with a descriptive User-Agent
- Upstream file says `updated_at` 2026-10-04T19:02:54 UTC
- Trim: top-level fields kept as-is; `courses` kept only for the 56 course
  codes the student scenarios schedule, byte-for-byte from the capture
- 2026-10-17: PSYC 1630 added, byte-for-byte from a second GET of the same
  URL. The upstream file still said `updated_at` 2026-10-04T19:02:54 UTC, and
  its other 56 courses matched this file exactly. The student-auto journey's
  tray Auto plans PSYC 1630 once Auto draws from the degree audit.
- 2026-10-17, edge only: PHYS 1410 added the same way. A third GET still
  said `updated_at` 2026-10-04T19:02:54 UTC, and the other 57 courses matched
  this file exactly. With edge's larger catalog, the student-auto journey's
  tray Auto plans PHYS 1410 instead of PSYC 1630.

The harness parses this file with the app's own `parseTerm`, so the scenarios
run on the same data path as the live proxy without touching the network.
