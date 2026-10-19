# eval run — a11y-polish

- target: `d42166faca133b58eba410d0c0fd6b5a0fde38c1` at /home/user/work/untangle-target (checkout HEAD: d42166faca133b58eba410d0c0fd6b5a0fde38c1)
- started: 2026-10-19T18:21:00.632Z · finished: 2026-10-19T18:27:02.805Z
- backend start mode: node-tsx (see stubs)
- blocked RateMyProfessors requests: 5
- hashes: CONTRACT.md `86072811b2c376b5fcc0cf25035bbeb0fb050d5e7e4c7ebab7aa55f579b9ae0a` · bars.json `c23e2119dec43debb2381a5aed70fabc3d0b173dc1e4a3923db3ffbc2aa0ae7a`

## suite a11y-polish

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| a11y/axe-home | pass | 0 serious+critical; impact counts {"moderate":1} | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-courses | fail | 1 serious+critical violations: color-contrast(seriousx3) | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-detail | pass | 0 serious+critical; impact counts {} | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-instructor | pass | 0 serious+critical; impact counts {} | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-schedule | fail | 1 serious+critical violations: color-contrast(seriousx4) | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-map | pass | 0 serious+critical; impact counts {} | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-auth | fail | 2 serious+critical violations: aria-prohibited-attr(seriousx1), color-contrast(seriousx1) | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/keyboard-core-path | fail | — | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/focus-indicator | pass | outline none 3px; boxShadow rgba(0, 0, 0, 0) 0px 0px 0px 0px | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/reduced-motion | pass | 0 long-running animations under prefers-reduced-motion: reduce | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/no-horizontal-overflow-mobile | fail | /courses: scrollWidth 613 > clientWidth 390 | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/image-icon-labeling | pass | all images have alt; icons are labelled or hidden | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |

## preflight steps

- target-dir: **pass** (0ms) — /home/user/work/untangle-target
- contract-hash: **pass** (1ms) — harness evals/CONTRACT.md sha256 86072811b2c376b5fcc0cf25035bbeb0fb050d5e7e4c7ebab7aa55f579b9ae0a (/home/user/work/untangle-journey-repair/evals/CONTRACT.md); the target is not required to carry evals/
- submodule-backend: **pass** (59ms) — already initialized at pinned SHA 0a49d4d863161c3b568f6aa6d3da4b4e68637a44
- backend-install: **pass** (1ms) — cached install present (better-sqlite3 native binding + tsx)
- backend-sqlite-build: **pass** (3600ms) — native SQLite addon loads in node (memory-db roundtrip ok); backend tsc build emitted dist/
- backend-seed: **pass** (1871ms) — backend grade catalog seeded via the backend's own seed script (tsx src/db/seed.ts)
- postgres-init: **pass** (897ms) — fresh cluster at /home/user/work/pgdata-r2-a11y-polish-repaired/run-1792434066696-410320
- postgres-start: **pass** (183ms) — postgres up on 127.0.0.1:54321, database untangle created
- frontend-install: **pass** (11ms) — cached workspace install present (next + drizzle-kit)
- migrations-apply: **pass** (809ms) — drizzle migrations applied (frontend/node_modules/.bin/drizzle-kit) against postgres://postgres@127.0.0.1:54321/untangle
- db-roundtrip: **pass** (23ms) — probe row roundtrip-ce1c0cacf0713653 written and read back via DATABASE_URL (persistence gate satisfied)
- backend-start: **pass** (1243ms) — backend healthy on http://127.0.0.1:3950 under node/tsx (rmp-block preload via NODE_OPTIONS --require). bun --preload attempt failed: bun --preload backend: process exited early (code 1, signal none) — expected: the backend's better-sqlite3 addon crashes Bun at runtime (backend/README.md "Bun Notes")
- frontend-build: **pass** (45836ms) — mode: production-build (next build); fonts: pinned via NEXT_FONT_GOOGLE_MOCKED_RESPONSES (vercel/next.js#99114 workaround)
- frontend-start: **pass** (1522ms) — frontend serving http://localhost:3900 (DATABASE_URL set, BETTER_AUTH_URL aligned to origin, fresh random BETTER_AUTH_SECRET)
- playwright-launch: **pass** (1955ms) — chromium (headless) launched and rendered http://localhost:3900/ (body 6246 chars)

<details><summary>runtime versions</summary>

```json
{
  "bun": "1.3.14",
  "node": "v20.20.2",
  "postgres": "postgres (PostgreSQL) 17.11 (Debian 17.11-0+deb13u1)",
  "playwright": "1.64.0",
  "os": "Linux 6.1.158+ x64"
}
```

</details>
