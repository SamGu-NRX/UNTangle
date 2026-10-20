# eval run — selfcheck, journey, honesty, a11y-polish, routing, optimizer, data, persistence-faults

- target: `5cfdc3c99f510518130a918810627e07cb1ca0fc` at /home/user/work/untangle-baseline-target (checkout HEAD: 5cfdc3c99f510518130a918810627e07cb1ca0fc)
- started: 2026-10-19T19:37:56.985Z · finished: 2026-10-19T20:34:57.062Z
- backend start mode: node-tsx (see stubs)
- blocked RateMyProfessors requests: 92
- hashes: CONTRACT.md `86072811b2c376b5fcc0cf25035bbeb0fb050d5e7e4c7ebab7aa55f579b9ae0a` · bars.json `c23e2119dec43debb2381a5aed70fabc3d0b173dc1e4a3923db3ffbc2aa0ae7a`

## suite selfcheck

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| preflight-all-green | pass | 15/15 steps green | every stack step reports pass | /home/user/work/untangle-baseline-pr4/preflight-logs |
| db-roundtrip-persists | pass | selfcheck-84e15daa5ac949f9 | read-back equals written value | — |
| frontend-renders | pass | HTTP 200, body 6029 chars | GET / returns 200 with a non-empty rendered body | /home/user/work/untangle-baseline-pr4/preflight-logs |
| rmp-block-active | pass | 1 | at least one outbound RateMyProfessors request blocked and counted | — |

## suite journey

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| journey/discover-guest-desktop | pass | discovered CSCE 1030 and read its detail page | every case passes for both personas at both viewports | — |
| journey/discover-guest-mobile | pass | discovered CSCE 1030 and read its detail page | every case passes for both personas at both viewports | — |
| journey/discover-registered-desktop | pass | discovered CSCE 1030 and read its detail page | every case passes for both personas at both viewports | — |
| journey/discover-registered-mobile | pass | discovered CSCE 1030 and read its detail page | every case passes for both personas at both viewports | — |
| journey/instructor-guest-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/instructor-guest-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/instructor-registered-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/instructor-registered-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/build-guest-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/build-guest-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/build-registered-desktop | fail | — | every case passes for both personas at both viewports | — |
| journey/build-registered-mobile | fail | — | every case passes for both personas at both viewports | — |
| journey/save-guest-desktop | fail | — | every case passes for both personas at both viewports | /home/user/work/untangle-baseline-pr4/preflight-logs/journey__journey_save-guest-desktop__persisted-diff.json |
| journey/save-guest-mobile | fail | — | every case passes for both personas at both viewports | /home/user/work/untangle-baseline-pr4/preflight-logs/journey__journey_save-guest-mobile__persisted-diff.json |
| journey/save-registered-desktop | fail | — | every case passes for both personas at both viewports | /home/user/work/untangle-baseline-pr4/preflight-logs/journey__journey_save-registered-desktop__persisted-diff.json |
| journey/save-registered-mobile | fail | — | every case passes for both personas at both viewports | /home/user/work/untangle-baseline-pr4/preflight-logs/journey__journey_save-registered-mobile__persisted-diff.json |
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

## suite honesty

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| honesty/rmp-labels-when-unavailable | fail | — | 0 violations | — |
| honesty/sample-data-notice | fail | — | 0 violations | — |
| honesty/stale-rating-notice | fail | — | 0 violations | — |
| honesty/unverified-savings-disclaimer | fail | — | 0 violations | — |
| honesty/no-fabricated-precision | pass | no fabricated precise numbers presented as verified on /schedule | 0 violations | — |

## suite a11y-polish

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| a11y/axe-home | fail | 1 serious+critical violations: color-contrast(seriousx5) | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-courses | fail | — | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-detail | fail | 1 serious+critical violations: color-contrast(seriousx18) | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-instructor | fail | 1 serious+critical violations: color-contrast(seriousx19) | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-schedule | fail | 1 serious+critical violations: color-contrast(seriousx37) | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-map | pass | 0 serious+critical; impact counts {} | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/axe-auth | fail | 2 serious+critical violations: aria-prohibited-attr(seriousx1), color-contrast(seriousx7) | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/keyboard-core-path | fail | — | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/focus-indicator | pass | outline none 3px; boxShadow rgba(0, 0, 0, 0) 0px 0px 0px 0px | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/reduced-motion | fail | — | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/no-horizontal-overflow-mobile | fail | /courses: scrollWidth 613 > clientWidth 390 | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |
| a11y/image-icon-labeling | pass | all images have alt; icons are labelled or hidden | 0 serious/critical axe issues, keyboard-only journey completes, no clipping, reduced motion honored | — |

## suite routing

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| building-coverage | pass | [object Object] | every bundled and compD building resolves to its building id; in-bounds resolve locally | — |
| route-geodesic-floor | pass | [object Object] | every 200 route response reports distanceMeters >= great-circle distance of its endpoints | evals/fixtures/campus-routes.json |
| route-latency | pass | [object Object] | p95 warm <= 200 ms for 12-stop routes | — |

## suite optimizer

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| violations-zero | not-applicable | — | 0 hard-constraint violations, optimality gap 0 on enumerable instances, p95 <=500ms at 8 courses | — |
| gap-zero | not-applicable | — | 0 hard-constraint violations, optimality gap 0 on enumerable instances, p95 <=500ms at 8 courses | — |
| p95-8courses | not-applicable | — | 0 hard-constraint violations, optimality gap 0 on enumerable instances, p95 <=500ms at 8 courses | — |

## suite data

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| catalog-certification-counts | not-applicable | — | exact certification counts, real-term bundle present | — |
| provenance-descriptor | not-applicable | — | exact certification counts, real-term bundle present | — |

## suite persistence-faults

| case | status | measured | bar | evidence |
| --- | --- | --- | --- | --- |
| acknowledged-saves-survive | fail | — | each durability rule holds in every injected case | /home/user/work/untangle-baseline-pr4/preflight-logs/persistence-faults__acknowledged-saves-survive.json |
| failed-saves-never-saved | fail | — | each durability rule holds in every injected case | /home/user/work/untangle-baseline-pr4/preflight-logs/persistence-faults__failed-saves-never-saved.json |
| denied-storage-degrades-honestly | fail | — | each durability rule holds in every injected case | /home/user/work/untangle-baseline-pr4/preflight-logs/persistence-faults__denied-storage-degrades-honestly.json |
| corrupt-bytes-quarantined | fail | — | each durability rule holds in every injected case | /home/user/work/untangle-baseline-pr4/preflight-logs/persistence-faults__corrupt-bytes-quarantined.json |
| cross-tab-conflict-visible | fail | — | each durability rule holds in every injected case | /home/user/work/untangle-baseline-pr4/preflight-logs/persistence-faults__cross-tab-conflict-visible.json |
| clean-tab-adopts-newer | fail | — | each durability rule holds in every injected case | /home/user/work/untangle-baseline-pr4/preflight-logs/persistence-faults__clean-tab-adopts-newer.json |

## preflight steps

- target-dir: **pass** (5ms) — /home/user/work/untangle-baseline-target
- contract-hash: **pass** (1ms) — harness evals/CONTRACT.md sha256 86072811b2c376b5fcc0cf25035bbeb0fb050d5e7e4c7ebab7aa55f579b9ae0a (/home/user/work/untangle-baselines/evals/CONTRACT.md); the target is not required to carry evals/
- submodule-backend: **pass** (945ms) — submodule fetched at pinned SHA 0a49d4d863161c3b568f6aa6d3da4b4e68637a44
- backend-install: **pass** (443ms) — bun install --frozen-lockfile; better-sqlite3 native binding present
- backend-sqlite-build: **pass** (2758ms) — native SQLite addon loads in node (memory-db roundtrip ok); backend tsc build emitted dist/
- backend-seed: **pass** (1458ms) — backend grade catalog seeded via the backend's own seed script (tsx src/db/seed.ts)
- postgres-init: **pass** (913ms) — fresh cluster at /home/user/work/pgdata-baseline-pr4/run-1792438683142-417561
- postgres-start: **pass** (170ms) — postgres up on 127.0.0.1:54321, database untangle created
- frontend-install: **pass** (728ms) — bun install --frozen-lockfile at workspace root
- migrations-apply: **pass** (633ms) — drizzle migrations applied (frontend/node_modules/.bin/drizzle-kit) against postgres://postgres@127.0.0.1:54321/untangle
- db-roundtrip: **pass** (17ms) — probe row roundtrip-e4e751388aa800ce written and read back via DATABASE_URL (persistence gate satisfied)
- backend-start: **pass** (1237ms) — backend healthy on http://127.0.0.1:3950 under node/tsx (rmp-block preload via NODE_OPTIONS --require). bun --preload attempt failed: bun --preload backend: process exited early (code 1, signal none) — expected: the backend's better-sqlite3 addon crashes Bun at runtime (backend/README.md "Bun Notes")
- frontend-build: **pass** (34121ms) — mode: production-build (next build); fonts: pinned via NEXT_FONT_GOOGLE_MOCKED_RESPONSES (vercel/next.js#99114 workaround)
- frontend-start: **pass** (1171ms) — frontend serving http://localhost:3901 (DATABASE_URL set, BETTER_AUTH_URL aligned to origin, fresh random BETTER_AUTH_SECRET)
- playwright-launch: **pass** (1551ms) — chromium (headless) launched and rendered http://localhost:3901/ (body 6029 chars)

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
