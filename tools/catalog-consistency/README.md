# catalog-consistency

Internal-consistency audit for the committed UNTangle catalog records
(courses, sections, buildings, majors). Read `RULES.md` for the rule set and
its grounding; this audit is **not** a schedule oracle and invents no
university policy.

## Usage (from the repository root)

```sh
# audit the real generated catalog and write the receipt + report + examples
node tools/catalog-consistency/audit.mjs \
  --input frontend/src/lib/generated/seed-data.json \
  --out   tools/catalog-consistency/results

# independent recheck: recompute from the input bound in the receipt and
# compare byte-for-byte with the committed report (exit 1 on any drift)
node tools/catalog-consistency/audit.mjs --replay tools/catalog-consistency/results

# hand-built controls proving each violation class is detected
node --test tools/catalog-consistency/tests/*.test.mjs
```

## Outputs (`--out` directory, default `tools/catalog-consistency/results`)

| File | Contents |
| --- | --- |
| `input-receipt.json` | Versioned binding of the audited inputs: receipt/tool/rules versions, source commit, sha256 + byte size of the generated seed data and the majors source, and the record counts (buildings, courses, sections, majors, course statuses, meetings, prerequisite edges). |
| `report.json` | Full audit: counts, duplicate-id findings, meeting-bound findings, reference checks (including the external-prerequisite vs unknown-reference distinction), and violation totals. |
| `unresolved-examples.json` | Concrete example records for every unresolved finding plus the external-prerequisite breakdown by source-corpus presence. Nothing here is an allowlist; repair locations are decided in `REPAIR-LOCATIONS.md`. |
| `replay.json` | Written by `--replay`: whether the input still matches the receipt, whether recomputed counts/report/examples match the committed ones, and the overall `match`/`mismatch` verdict. |

## Determinism

Reports are byte-stable: fixed key order, sorted derived lists, no
timestamps. Running the audit twice over the same inputs produces identical
bytes, which is what `--replay` verifies (it compares recomputed output
against the committed report byte-for-byte). The receipt stores paths exactly
as passed (repo-relative when run from the repository root) so replay is
portable across checkouts of the same source.

## Inputs are read-only

The audit reads the generated seed data, the majors source, and (for
repair-location hints) the committed `courses/*.json` source corpus. It never
writes to any of them, never edits generated data, and never contacts the
network.

## Test layout

- `tests/helpers.mjs` — hand-built minimal catalog fixtures (the controls).
- `tests/duplicates.test.mjs` — duplicate course codes / section ids / building ids detected; clean catalogs pass; exact-match semantics documented.
- `tests/references.test.mjs` — every unresolved reference class detected; external prerequisites counted separately from unknown references.
- `tests/meetingBounds.test.mjs` — contradictory bounds, malformed times, out-of-vocabulary days detected.
- `tests/replay.test.mjs` — CLI integration: byte-stable reports across runs, receipt binding catches input drift, replay detects tampered reports (exit 1 on mismatch).
