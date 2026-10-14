# Task: section release

Build `buildSectionRelease` in `packages/ingest/src/section-release.ts`. It turns one fetched class-search response into a published release: a manifest plus one record per course, where every value says which JSON path it came from and a missing value is an explicit "unknown" with the source's own text.

This is steps 2 and 4 of "Reference data: published releases" in docs/architecture/README.md. Fetching, comparing with the last good release and uploading are later tasks.

## What to read first

- `packages/ingest/src/section-release.ts`: the types and doc comments are the spec. Keep every exported name and signature, and leave `SECTION_PARSER_VERSION` as it is.
- `frontend/src/lib/sections/vsb.ts`: the parser for this format today. Port its checks (time and date formats, one-ended time ranges, duplicate class numbers, meetings outside the option, a course status other than ok or no_classes). A course that fails them becomes an `invalid-data` record; it never becomes `no-classes`.
- `packages/contracts/src/section-release.ts`: the release's zod schema. The test validates your output with it.
- `packages/ingest/src/source-policies.ts`: the reviewed source table. Look a source up with `sourcePolicy`.

## The tests you make pass

`packages/ingest/tests/section-release.test.ts`, with the raw response in `packages/ingest/tests/fixtures/vsb-spring-2027.json`. The test pins the content hash to SHA-256 of canonical JSON (keys sorted, no whitespace), so build that exactly.

## Files you may change

- `packages/ingest/src/section-release.ts`, and new modules under `packages/ingest/src/`.
- `tests/pending-acceptance.txt`: delete the line `packages/ingest/tests/section-release.test.ts`, and nothing else.

## Constraints

- Don't change the test file or the fixture.
- `src/` may not import the frontend or `@untangle/contracts`; ingest has no dependency on contracts. The test does the contract check.
- No network, disk or clock in this function. `node:crypto` is fine; ingest runs in Bun.
- Don't edit `source-policies.ts`. It is a reviewed table; propose changes in your PR description.
- Add no dependencies, and touch no lead-owned path (`.github/lead-owned-paths.txt`). Propose contract changes in your PR description.
- The PR that listed this test is approved by Sam (`sam-approved`). Never add or remove that label, and never merge.

## Done means

- From the repo root, `bun install --frozen-lockfile` and `bunx turbo run typecheck lint test` pass, with your line gone from the pending list.
- A PR from an `obv/section-release` branch into `alpha`.
