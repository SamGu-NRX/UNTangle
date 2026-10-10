# REPAIR-LOCATIONS — catalog-consistency, run 1

Audit: `node tools/catalog-consistency/audit.mjs --input frontend/src/lib/generated/seed-data.json --out tools/catalog-consistency/results`
Committed inputs: `input-receipt.json` (sha256s of `frontend/src/lib/generated/seed-data.json` and `frontend/src/lib/seed-data.ts`), `report.json`, `unresolved-examples.json`.
Replay: `node tools/catalog-consistency/audit.mjs --replay tools/catalog-consistency/results` → `match` (counts, references, meeting bounds, duplicates rechecked independently; report byte-identical).

Verdict: the committed records are internally consistent apart from **6 unresolved major core-course references in `frontend/src/lib/seed-data.ts`** (0 duplicate ids, 0 contradictory meeting bounds, 0 unresolved section→course / meeting→building / courseStatus→course references; 222 prerequisite edges to 123 codes outside the bundle, counted and classified — see "External prerequisites" below).

## R1. `GOVT 2305` referenced by `busi` and `psyc` majors — course code absent from the bundle

- **Evidence**: 2 unresolved references; the bundle contains `PSCI 2305` whose title is `US Political Behavior and Policy  (GOVT 2305)` (note the double space before the parenthetical). The committed source corpus `courses/unt_psci_courses.json` lists the course under code `PSCI 2305` with `GOVT 2305` recorded in its title annotation (auditor's `titleAnnotatedEquivalent`).
- **Repair location**: `frontend/src/lib/seed-data.ts:71` (`busi` major, `coreCourseCodes: ["GOVT 2305", "MATH 1710"]`) and `frontend/src/lib/seed-data.ts:78` (`psyc` major, third core code).
- **Suggested repair**: replace `GOVT 2305` with `PSCI 2305` in both `coreCourseCodes` arrays. Only the maintainer can decide which code is canonical — if `GOVT 2305` is intentional and the bundle should carry it, the repair belongs in `courses/unt_psci_courses.json` / the bundle generator instead.

## R2. `HIST 2610` referenced by `psyc` and `engl` majors — no bundle course, no annotated equivalent

- **Evidence**: 2 unresolved references; no course in the generated bundle and no `courses/*.json` annotation matches this code.
- **Repair location**: `frontend/src/lib/seed-data.ts:78` (`psyc` major, first core code) and `frontend/src/lib/seed-data.ts:85` (`engl` major, first core code).
- **Suggested repair**: either add the real course record to the committed source corpus (the bundle's README says it is generated from `courses/*.json`; the generator itself is not committed under `scripts/`) or repoint the majors to a course that exists. This cannot be resolved mechanically without knowing which course the majors intend.

## R3. `HIST 2620` referenced by `psyc` and `engl` majors — no bundle course, no annotated equivalent

- **Evidence**: 2 unresolved references; same situation as R2.
- **Repair location**: `frontend/src/lib/seed-data.ts:78` (`psyc` major, second core code) and `frontend/src/lib/seed-data.ts:85` (`engl` major, second core code).
- **Suggested repair**: same options as R2.

## External prerequisites (counted, not failed — no violation)

222 prerequisite edges point to 123 distinct codes that have no course record in the generated bundle, and **none** of the 123 appear in the committed source corpus `courses/*.json` (`inSourceCorpus.codes = 0`, per-record classifications in `report.json`). This is consistent with the bundle README's statement that the catalog is a subset of the university catalog: courses taken before transfer or offered outside the subset are legitimately unresolvable. The auditor counts and classifies these rather than failing them (RULES.md R4); a future rules version may want a curated allowlist if external codes are ever known-good.

## Suggested follow-up (out of scope for the auditor)

The audit deliberately did not evaluate: cross-field coherence (e.g., a major whose core course belongs to a different department than the major), section counts per course, or schedule overlap checks — those need product decisions, not consistency rules, and remain unimplemented.
