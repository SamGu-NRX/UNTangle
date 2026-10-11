# catalog-consistency

Internal-consistency audit for the committed UNTangle catalog records
(courses, sections, buildings, majors). Read `RULES.md` (v2) for the rule set
and its grounding; this audit is **not** a schedule oracle and invents no
university policy.

## Usage (from the repository root)

```sh
# audit the real generated catalog and write receipt + report + examples + manifest
node tools/catalog-consistency/audit.mjs \
  --input frontend/src/lib/generated/seed-data.json \
  --out   tools/catalog-consistency/results

# hand-built controls proving each rule reports exact totals
node --test tools/catalog-consistency/tests/*.test.mjs

# independent verification (separate tool, built from FORMAT-v2.md only):
# re-derive every finding from the raw inputs bound in the receipt and
# compare with the committed report byte-for-byte
node tools/catalog-consistency/verify.mjs --results tools/catalog-consistency/results
```

`--replay` is retired: replay reused the producer's own logic, so it could not
catch producer bugs. Verification is now an independent implementation that
reads the committed evidence and the raw inputs it binds.

## Outputs (`--out` directory, default `tools/catalog-consistency/results`)

| File | Contents |
| --- | --- |
| `input-receipt.json` | Versioned binding of every audited input: receipt/tool/rules versions, source commit, backend submodule pin, sha256 + byte size of the generated catalog, the majors source, each committed rule source, the prerequisite corpus (with an aggregate digest), and the section source — plus the record counts. |
| `report.json` | Full audit: counts, duplicate-id findings, meeting-bound findings, reference checks with exact totals and capped example lists, evidence-classified external prerequisites, section-source provenance, and violation totals. |
| `unresolved-examples.json` | Example records for every unresolved finding class (capped at 10 each; exact totals live in `report.json`) plus the external-prerequisite breakdown and the provenance summary. Nothing here is an allowlist; repair locations are decided in `REPAIR-LOCATIONS.md`. |
| `results-manifest.json` | sha256 + byte size of the three evidence files, binding the exact bytes that were certified. |

## External prerequisites are not unknown references

A prerequisite code that is not itself a bundle course is classified by
evidence, in priority order: committed in the `courses/*.json` source corpus
(`inSourceCorpus`, bound by an aggregate digest of the corpus bytes), or
annotated in a bundle title (`titleAnnotatedInBundle`). Without either, the
code is `unknown` — reported with a fixed note, and **never** counted as an
unknown reference. The same evidence chain surfaces on unresolved major-core
codes (`titleAnnotatedEquivalent`).

## Section provenance

When the section source (`backend/data/compD.csv` by default) is present, the
receipt binds its bytes and the report cross-matches every section against the
compD `(course_number, section_number)` lattice: meeting days/times/locations
must equal the compD day-pattern expansion exactly. An unbound section source
zeroes the provenance numbers and reports `provenance not established`; no
data is ever repaired. `REPAIR-LOCATIONS.md` documents why the section source
is treated as generated rather than a real-term export.

## Determinism

All four outputs are byte-stable: canonical JSON (fixed key order, sorted
where specified), sorted derived lists, no timestamps. Running the audit
twice over the same inputs produces identical bytes. The receipt stores repo
root-relative paths so verification is portable across checkouts of the same
source. `results-manifest.json` hashes the three evidence files so any
post-hoc edit is detectable.

## Inputs are read-only

The audit reads the generated seed data, the majors source, the committed
`courses/*.json` source corpus, the section source, and (via hash only) the
committed rule sources. It never writes to any of them, never edits generated
data, and never contacts the network.

## Test layout

- `tests/helpers.mjs` — fixture builders and hand-computed expected values
  (the controls are literals derived from `RULES.md` v2, not from the code).
- `tests/controls.test.mjs` — clean control (all zeros) and a one-defect-per-class
  negative control, deep-equal to the hand-computed expectations; receipt,
  manifest, and annex shapes; unbound-section-source behavior.
- `tests/detection.test.mjs` — exact totals with the 25-defect example cap
  regression; evidence classification (corpus file, bundle title, section
  title, major-core equivalent); CSV/day-token/code-normalization units;
  CLI determinism, byte-stability, input-drift binding, and failure exits.
