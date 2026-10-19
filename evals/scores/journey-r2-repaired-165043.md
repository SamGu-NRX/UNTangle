# eval run — journey

- target: `d42166faca133b58eba410d0c0fd6b5a0fde38c1` at /home/user/work/untangle-target (checkout HEAD: d42166faca133b58eba410d0c0fd6b5a0fde38c1)
- started: 2026-10-19T16:50:43.335Z · finished: 2026-10-19T17:33:46.646Z
- backend start mode: node-tsx (see stubs)
- blocked RateMyProfessors requests: 89
- hashes: CONTRACT.md `86072811b2c376b5fcc0cf25035bbeb0fb050d5e7e4c7ebab7aa55f579b9ae0a` · bars.json `c23e2119dec43debb2381a5aed70fabc3d0b173dc1e4a3923db3ffbc2aa0ae7a`

## suite journey

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| journey/discover-guest-desktop | pass | discovered CSCE 1030 and read its detail page | every case passes for both personas at both viewports | — |
| journey/discover-guest-mobile | pass | discovered CSCE 1030 and read its detail page | every case passes for both personas at both viewports | — |
| journey/discover-registered-desktop | pass | discovered CSCE 1030 and read its detail page | every case passes for both personas at both viewports | — |
| journey/discover-registered-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/instructor-guest-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/instructor-guest-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/instructor-registered-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/instructor-registered-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/build-guest-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/build-guest-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/build-registered-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/build-registered-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/save-guest-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/save-guest-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/save-registered-desktop | fail | — | every case passes for both personas at both viewports | /home/user/work/untangle-r2-repair-journey-165043/preflight-logs/journey__journey_save-registered-desktop__persisted-diff.json |
| journey/save-registered-mobile | fail | — | every case passes for both personas at both viewports | /home/user/work/untangle-r2-repair-journey-165043/preflight-logs/journey__journey_save-registered-mobile__persisted-diff.json |
| journey/plan-guest-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/plan-guest-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/plan-registered-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/plan-registered-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/map-guest-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/map-guest-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/map-registered-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/map-registered-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/auth-guest-desktop | pass | auth page rendered (h1: Sign in with your UNT email.); password mode and reset link present | every case passes for both personas at both viewports | — |
| journey/auth-guest-mobile | pass | auth page rendered (h1: Sign in with your UNT email.); password mode and reset link present | every case passes for both personas at both viewports | — |
| journey/auth-registered-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/auth-registered-mobile | pass | synthetic sign-up → auto sign-in → sign-out → sign-in all succeeded (synthetic-registered persona) | every case passes for both personas at both viewports | — |

## preflight steps

- target-dir: **pass** (0ms) — /home/user/work/untangle-target
- contract-hash: **pass** (0ms) — harness evals/CONTRACT.md sha256 86072811b2c376b5fcc0cf25035bbeb0fb050d5e7e4c7ebab7aa55f579b9ae0a (/home/user/work/untangle-journey-repair/evals/CONTRACT.md); the target is not required to carry evals/
- submodule-backend: **pass** (68ms) — already initialized at pinned SHA 0a49d4d863161c3b568f6aa6d3da4b4e68637a44
- backend-install: **pass** (1ms) — cached install present (better-sqlite3 native binding + tsx)
- backend-sqlite-build: **pass** (2875ms) — native SQLite addon loads in node (memory-db roundtrip ok); backend tsc build emitted dist/
- backend-seed: **pass** (1626ms) — backend grade catalog seeded via the backend's own seed script (tsx src/db/seed.ts)
- postgres-init: **pass** (899ms) — fresh cluster at /home/user/work/pgdata-r2-journey-repaired/run-1792428648416-397668
- postgres-start: **pass** (196ms) — postgres up on 127.0.0.1:54321, database untangle created
- frontend-install: **pass** (4ms) — cached workspace install present (next + drizzle-kit)
- migrations-apply: **pass** (787ms) — drizzle migrations applied (frontend/node_modules/.bin/drizzle-kit) against postgres://postgres@127.0.0.1:54321/untangle
- db-roundtrip: **pass** (20ms) — probe row roundtrip-96190dd2cf39c4d1 written and read back via DATABASE_URL (persistence gate satisfied)
- backend-start: **pass** (1252ms) — backend healthy on http://127.0.0.1:3950 under node/tsx (rmp-block preload via NODE_OPTIONS --require). bun --preload attempt failed: bun --preload backend: process exited early (code 1, signal none) — expected: the backend's better-sqlite3 addon crashes Bun at runtime (backend/README.md "Bun Notes")
- frontend-build: **pass** (39651ms) — mode: production-build (next build); fonts: pinned via NEXT_FONT_GOOGLE_MOCKED_RESPONSES (vercel/next.js#99114 workaround)
- frontend-start: **pass** (1240ms) — frontend serving http://localhost:3900 (DATABASE_URL set, BETTER_AUTH_URL aligned to origin, fresh random BETTER_AUTH_SECRET)
- playwright-launch: **pass** (1556ms) — chromium (headless) launched and rendered http://localhost:3900/ (body 6246 chars)

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
