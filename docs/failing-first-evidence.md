# Failing-first evidence: auth endpoint + planner ownership tests

Branch `obv/untangle-auth-endpoint-tests` introduces 14 endpoint tests in
`frontend/tests/auth-signup-unt-email.test.ts` and
`frontend/tests/api-planner-ownership.test.ts`.

## Run against parent commit `5f05111` (test harness setup)

Method: temporary `git worktree` of `5f05111` in `/tmp/untangle-failing-first`
(since removed), with `frontend/node_modules` symlinked to the working
checkout and the two new test files copied in. No history was rewritten and
nothing was committed in the worktree.

Command: `bun test tests/auth-signup-unt-email.test.ts tests/api-planner-ownership.test.ts`

Result: **7 fail, 7 pass** (14 tests, 26 expect() calls).

Failing on the parent — the new hardening the tests pin down:

- `POST /api/planner ownership > rejects non-object bodies with 400`
- `POST /api/planner ownership > rejects wrong-shape maps with 400`
- `POST /api/planner ownership > rejects invalid JSON bodies with 400`
- `POST /api/planner ownership > a spoofed identity field in the body never reaches persistence`
- `POST /api/auth/sign-up/email (UNT-email gate) > rejects a non-UNT email with 400 and the UNT requirement message`
- `POST /api/auth/sign-up/email (UNT-email gate) > rejects lookalike domains that merely contain unt.edu`
- `POST /api/auth/sign-up/email (UNT-email gate) > rejects emails with no recognizable UNT domain`

Passing on the parent — behaviors already present at `5f05111` (401s without
a session, session-derived persistence id on load, strict top-level field
stripping, and acceptance of `@unt.edu`/`@my.unt.edu`): the remaining 7 tests.

## Run on this branch

Command: `bun test tests/` (full suite, `frontend/`)

Result: **82 pass, 0 fail** across 7 files (216 expect() calls), including
all 14 new tests. `bunx tsc --noEmit`, `bun run lint`, and
`bun run build` (placeholder env) are clean; see the task report for details.
