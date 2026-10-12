# Catalog consistency rules — RULES_VERSION 2

These rules audit the **internal consistency of committed records only**. They
judge the catalog against itself and against the repository's own committed
types, loader, and README claims. **No university policy is invented here**: a
rule exists only if some committed artifact in this repository asserts the
shape it enforces. Scheduling feasibility, room allocation, teaching loads,
and catalog completeness judgments are explicitly out of scope (the schedule
oracle lives in `docs/schedule-oracle-report.md`; this audit is not another
oracle).

**What changed in version 2** (audit method, not audit scope):

- **Exact totals, capped examples.** Every finding reports the exact total of
  matching records over the full inputs. `examples` arrays are capped displays
  (`EXAMPLE_LIMIT = 10`, deterministic input order) and are never used as
  totals. A report claiming "25 defects" while showing ten examples states
  both numbers.
- **Unresolved ≠ confirmed bad.** Duplicate identifiers and self-contradictory
  meeting bounds are violations by rule (R1, R3). Unresolved references
  (R2.1–R2.4) are reported as *unresolved*: each example carries whatever
  committed evidence exists (or none) and the audit never relabels them as
  intentional, external, or invalid — that judgment needs evidence the
  repository does not (yet) commit.
- **Evidence-based external-prerequisite classification.** R2.5 external
  prerequisite codes are classified per code by committed evidence
  (`inSourceCorpus` → `titleAnnotatedInBundle` → `unknown`), replacing the v1
  blanket "intentional external" label. Unknown intent is preserved: v2 counts
  and lists such codes but does not certify intent it cannot verify.
- **Bound inputs.** The receipt (`input-receipt.json`) binds every source the
  audit consumed — the generated catalog, the majors TS source, the
  rule-freeze sources, every `courses/*.json` corpus file (with an aggregate
  digest), and the section source `backend/data/compD.csv` with its submodule
  pin — as exact sha256 hashes of the bytes read. A stored report is only
  about the inputs it bound.
- **Independent verification.** `verify.mjs` (same directory) re-derives all
  counts, findings, violations, and provenance from the receipt-bound raw
  inputs with its own traversal, and byte-checks the stored evidence against
  the manifest and canonical serialization. It shares no code with
  `audit.mjs`. The v1 `--replay` flag (which re-ran producer logic and
  compared re-serialized JSON) is retired — byte-level verification is the
  verifier's job.
- **Section-source provenance.** The audit cross-matches the bundled sections
  to `backend/data/compD.csv` and reports the result as a finding, including
  the evidence for treating sections as generated rather than a real-term
  export. No data is repaired (R5).

## The record set

| Records | Source (committed) | Identity key |
| --- | --- | --- |
| Courses | `frontend/src/lib/generated/seed-data.json` → `courses[]` | `code` |
| Sections | `frontend/src/lib/generated/seed-data.json` → `sections[]` | `id` |
| Buildings | `frontend/src/lib/generated/seed-data.json` → `buildings[]` | `id` |
| Majors | `frontend/src/lib/seed-data.ts` → `export const majors` (the only committed majors records; the generated JSON carries none) | `id` |
| Course statuses | `frontend/src/lib/generated/seed-data.json` → `courseStatuses` (keyed map) | key = course code |
| Meetings | `section.meetings[]` | position (no identity key) |

Identity comparisons are **exact string matches**. Case or whitespace
normalization would merge distinct committed keys and hide real defects, so
e.g. `anth 1010` and `ANTH 1010` are different identities; if both appear,
that is reported, not silently merged. (The only normalizations v2 performs
are explicitly specified ones for cross-source code comparison — corpus and
compD `course_number` spelling — and they never touch record identities.)

## R1 — Duplicate identifiers (confirmed violations)

- **R1.1** `courses[].code` is unique. *Grounding:* `frontend/src/lib/planner.ts`
  resolves courses by exact code (`courses.find((course) => course.code === …)`,
  prerequisite edges in `frontend/src/lib/seed-data.ts`); duplicate codes make
  such lookups order-dependent.
- **R1.2** `sections[].id` is unique. *Grounding:* `PlannerState.selectedSections`
  keys sections by id (`frontend/src/lib/types.ts`).
- **R1.3** `buildings[].id` is unique. *Grounding:* `frontend/src/lib/seed-data.ts`
  builds `buildingNameById`/`buildingShortNameById` keyed by id and
  `frontend/src/lib/campus-locations.ts` aliases merge by id.

## R2 — References resolve (unresolved ≠ confirmed bad)

- **R2.1** `section.courseCode` → `courses[].code`.
- **R2.2** `section.meetings[].buildingId` → `buildings[].id`. *Grounding:* the
  loader (`frontend/src/lib/seed-data.ts`) derives each meeting's `location`
  from this id and falls back to the raw id or `"TBA"` — an unresolved id
  silently degrades the UI.
- **R2.3** `courseStatuses` keys → `courses[].code`.
- **R2.4** `majors[].coreCourseCodes[]` → `courses[].code`. *Grounding:*
  `frontend/src/lib/planner.ts` `getCoreCoursesForMajor` drops codes it cannot
  resolve (`.filter(Boolean)`), so an unresolved code silently shrinks major
  progress to nothing. Unresolved codes here are **unknown references**; when
  a bundled course's title annotates the same code — e.g. `PSCI 2305` titled
  `US Political Behavior and Policy  (GOVT 2305)` — the example records that
  string match as `titleAnnotatedEquivalent` evidence (factual, not a repair).
- **R2.5** `course.prerequisites[]` → `courses[].code` — classified
  **separately** as *external prerequisites* (R4 below). The in-product
  consequence is recorded, not judged: `getMissingPrerequisites`/
  `isCourseLocked` (`frontend/src/lib/planner.ts`) treat such a prerequisite as
  unsatisfiable by course status, so the course can only be unlocked via
  transcript evidence.

**Unknown references** = unresolved R2.1–R2.4 references (never R2.5). They
are reported as violations, with evidence per example; **external
prerequisites are never counted inside them**.

## R3 — Meeting bounds are not self-contradictory (confirmed violations)

- **R3.1** `start`/`end` are zero-padded 24-hour `HH:MM`. *Grounding:* every
  committed meeting uses this uniform form; anything else is flagged for
  inspection, not judged.
- **R3.2** `end > start`. A meeting whose end is at or before its start
  contradicts its own bounds. Bounds are compared only when both times are
  well-formed (R3.1); a malformed-time meeting is counted by R3.1 instead.
- **R3.3** `day` is one of the committed `weekDays`
  (`frontend/src/lib/types.ts`: `["Mon", "Tue", "Wed", "Thu", "Fri"]`). Note
  the committed type itself excludes `Sat`/`Sun`; if the data legitimately
  needed a weekend meeting, the type and the data would disagree — that is a
  repair-location decision for the generator owner, not audit policy.

Defect classes are independent: one meeting may violate R3.1 and R3.3
simultaneously and is counted in each.

## R4 — External prerequisites are classified by committed evidence

A prerequisite code that is not a bundled course code is an **external
prerequisite edge**. v2 classifies each distinct external code by the first
matching committed evidence (priority order):

1. **`inSourceCorpus`** — the code appears in the committed corpus
   `courses/*.json` (as a normalized `course_number` or a parenthesized title
   annotation). Evidence: the file paths. The code is real-university-course
   evidence the catalog text cites.
2. **`titleAnnotatedInBundle`** — the code appears as a parenthesized
   annotation in some bundled course or section title. Evidence: up to 3 of
   those titles.
3. **`unknown`** — no committed evidence found. The category carries a fixed
   note: *"no committed evidence of external intent; consistent with the
   subset-catalog claim (README) but unverified per code — intent
   unresolved."* v2 does **not** certify such codes as intentional; the
   README's subset claim remains the only (collection-level, not per-code)
   grounding, and is quoted rather than extended.

Category `codes` and `edges` counts are exact and must sum to the external
totals. Classification changes when evidence changes; it is never an
allowlist.

## R5 — Section-source provenance (reported, never repaired)

The bundled sections and their meetings are cross-matched against
`backend/data/compD.csv` (the section source, bound in the receipt with its
submodule pin): row count, matched/unmatched sections by
(normalized course code, section number), meeting agreement per section
(meetings as a multiset vs the day-pattern expansion), building short codes
resolved against bundle buildings, and the absence of any term/semester/
session/year column. The provenance block reports these numbers and an
assessment string; it is a finding about the data's nature (generated rather
than a recorded term), not a repair and not a violation.

If `backend/data/compD.csv` is absent (submodule not initialized), the receipt
records `present: false` and the provenance block states that provenance is
not established — the audit does not silently skip the source.

## Input binding and verification (method)

- The receipt binds every consumed input by exact sha256 and byte size, in a
  deterministic order (catalog, majors source, rule-freeze sources, corpus
  files sorted by path, section source). Unavailable optional inputs are
  bound as `present: false` rather than silently omitted.
- `results-manifest.json` binds the written evidence files' bytes.
- `verify.mjs` is the only supported replay path: it re-hashes bound inputs,
  recomputes all findings independently, and checks stored bytes (manifest
  and canonical-form equality), exiting nonzero on any drift without
  modifying the evidence.

## Explicit non-rules

The audit does **not** evaluate: schedule conflicts or feasibility (schedule
oracle territory), room/room-number validity, professor workloads,
course-description formatting, the `planned` flag's meaning, catalog
completeness against any external catalog, or which departments belong in the
bundle. Decisions in those areas belong to the generator owner.

## Versioning

`RULES_VERSION` (exported from `audit.mjs`) is stamped into the input receipt
and every report. Rule changes bump the version, which is visible in the
committed results — reports from different rule versions are never compared
silently. The v1 → v2 change history is summarized at the top of this file.
