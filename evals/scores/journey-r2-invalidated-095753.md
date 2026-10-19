# eval run — journey

- target: `d42166faca133b58eba410d0c0fd6b5a0fde38c1` at /home/user/work/untangle-target (checkout HEAD: d42166faca133b58eba410d0c0fd6b5a0fde38c1)
- started: 2026-10-19T09:57:53.930Z · finished: 2026-10-19T10:11:38.709Z
- backend start mode: node-tsx (see stubs)
- blocked RateMyProfessors requests: 0
- hashes: CONTRACT.md `86072811b2c376b5fcc0cf25035bbeb0fb050d5e7e4c7ebab7aa55f579b9ae0a` · bars.json `c23e2119dec43debb2381a5aed70fabc3d0b173dc1e4a3923db3ffbc2aa0ae7a`

## suite journey

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| journey/discover-guest-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/discover-guest-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/discover-registered-desktop | fail | — | every case passes for both personas at both viewports | — |
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
| journey/save-registered-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/save-registered-mobile | fail | — | every case passes for both personas at both viewports | /home/user/work/untangle-r2-journey-095753/preflight-logs/journey__journey_save-registered-mobile__persisted-diff.json |
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
| journey/auth-registered-desktop | pass | synthetic sign-up → auto sign-in → sign-out → sign-in all succeeded (synthetic-registered persona) | every case passes for both personas at both viewports | — |
| journey/auth-registered-mobile | pass | synthetic sign-up → auto sign-in → sign-out → sign-in all succeeded (synthetic-registered persona) | every case passes for both personas at both viewports | — |

## preflight steps

- target-dir: **pass** (0ms) — /home/user/work/untangle-target
- contract-hash: **pass** (0ms) — harness evals/CONTRACT.md sha256 86072811b2c376b5fcc0cf25035bbeb0fb050d5e7e4c7ebab7aa55f579b9ae0a (/home/user/work/untangle-r2/evals/CONTRACT.md); the target is not required to carry evals/
- submodule-backend: **pass** (55ms) — already initialized at pinned SHA 0a49d4d863161c3b568f6aa6d3da4b4e68637a44
- backend-install: **pass** (2ms) — cached install present (better-sqlite3 native binding + tsx)
- backend-sqlite-build: **pass** (3754ms) — native SQLite addon loads in node (memory-db roundtrip ok); backend tsc build emitted dist/
- postgres-init: **pass** (1255ms) — fresh cluster at /home/user/work/pgdata-r2-journey/run-1792403878487-334714
- postgres-start: **pass** (218ms) — postgres up on 127.0.0.1:54320, database untangle created
- migrations-apply: **pass** (1098ms) — drizzle migrations applied (frontend/node_modules/.bin/drizzle-kit) against postgres://postgres@127.0.0.1:54320/untangle
- db-roundtrip: **pass** (46ms) — probe row roundtrip-c8bf6856dcb0a0ea written and read back via DATABASE_URL (persistence gate satisfied)
- frontend-install: **pass** (2ms) — cached workspace install present (next + drizzle-kit)
- backend-start: **pass** (1650ms) — backend healthy on http://127.0.0.1:3950 under node/tsx (rmp-block preload via NODE_OPTIONS --require). bun --preload attempt failed: bun --preload backend: process exited early (code 1, signal none) — expected: the backend's better-sqlite3 addon crashes Bun at runtime (backend/README.md "Bun Notes")
- frontend-build: **pass** (50759ms) — mode: production-build (next build); fonts: pinned via NEXT_FONT_GOOGLE_MOCKED_RESPONSES (vercel/next.js#99114 workaround)
- frontend-start: **pass** (1452ms) — frontend serving http://localhost:3900 (DATABASE_URL set, BETTER_AUTH_URL aligned to origin, fresh random BETTER_AUTH_SECRET)
- playwright-launch: **pass** (1425ms) — chromium (headless) launched and rendered http://localhost:3900/ (body 6246 chars)

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
