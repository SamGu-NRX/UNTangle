# Catalog consistency rules — RULES_VERSION 1

These rules audit the **internal consistency of committed records only**. They
judge the catalog against itself and against the repository's own committed
types, loader, and README claims. **No university policy is invented here**: a
rule exists only if some committed artifact in this repository asserts the
shape it enforces. Scheduling feasibility, room allocation, teaching loads,
and catalog completeness judgments are explicitly out of scope (the schedule
oracle lives in `docs/schedule-oracle-report.md`; this audit is not another
oracle).

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
that is reported, not silently merged.

## R1 — Duplicate identifiers

- **R1.1** `courses[].code` is unique. *Grounding:* `frontend/src/lib/planner.ts`
  resolves courses by exact code (`courses.find((course) => course.code === …)`,
  prerequisite edges in `frontend/src/lib/seed-data.ts`); duplicate codes make
  such lookups order-dependent.
- **R1.2** `sections[].id` is unique. *Grounding:* `PlannerState.selectedSections`
  keys sections by id (`frontend/src/lib/types.ts`).
- **R1.3** `buildings[].id` is unique. *Grounding:* `frontend/src/lib/seed-data.ts`
  builds `buildingNameById`/`buildingShortNameById` keyed by id and
  `frontend/src/lib/campus-locations.ts` aliases merge by id.

## R2 — References resolve

- **R2.1** `section.courseCode` → `courses[].code`.
- **R2.2** `section.meetings[].buildingId` → `buildings[].id`. *Grounding:* the
  loader (`frontend/src/lib/seed-data.ts`) derives each meeting's `location`
  from this id and falls back to the raw id or `"TBA"` — an unresolved id
  silently degrades the UI.
- **R2.3** `courseStatuses` keys → `courses[].code`.
- **R2.4** `majors[].coreCourseCodes[]` → `courses[].code`. *Grounding:*
  `frontend/src/lib/planner.ts` `getCoreCoursesForMajor` drops codes it cannot
  resolve (`.filter(Boolean)`), so an unresolved code silently shrinks major
  progress to nothing. Unresolved codes here are **unknown references**.
- **R2.5** `course.prerequisites[]` → `courses[].code` — classified **separately**
  as *external prerequisites*. *Grounding:* the README commits the catalog as
  a subset: "A bundled UNT catalog (656 courses …) built from `courses/*.json`"
  (`README.md`). A prerequisite code outside the bundle is therefore expected
  until the catalog owner decides otherwise; the audit **counts and reports**
  these edges (per code, and whether the code exists in the committed source
  corpus `courses/*.json`) but does **not** fail them as unknown references.
  The in-product consequence is recorded, not judged:
  `getMissingPrerequisites`/`isCourseLocked` (`frontend/src/lib/planner.ts`)
  treat such a prerequisite as unsatisfiable by course status, so the course
  can only be unlocked via transcript evidence.

**Unknown references** = unresolved R2.1–R2.4 references (never R2.5). They are
violations. External prerequisites are never allowlisted — they are reported
with counts and examples in `results/unresolved-examples.json`.

## R3 — Meeting bounds are not self-contradictory

- **R3.1** `start`/`end` are zero-padded 24-hour `HH:MM`. *Grounding:* every
  committed meeting uses this uniform form; anything else is flagged for
  inspection, not judged.
- **R3.2** `end > start`. A meeting whose end is at or before its start
  contradicts its own bounds.
- **R3.3** `day` is one of the committed `weekDays`
  (`frontend/src/lib/types.ts`: `["Mon", "Tue", "Wed", "Thu", "Fri"]`). Note
  the committed type itself excludes `Sat`/`Sun`; if the data legitimately
  needed a weekend meeting, the type and the data would disagree — that is a
  repair-location decision for the generator owner, not audit policy.

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
silently.
