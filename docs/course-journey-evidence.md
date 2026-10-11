# Course journey evidence: witnesses, milestones, and check results

Branch `obv/products-l4-untangle-course-journey-20261010`, based on
`obv/products-untangle-hardening-20261009` at `5cfdc3c99f510518130a918810627e07cb1ca0fc`.
Follows the failing-first pattern of `docs/failing-first-evidence.md`.

## Reproduced defects (all observed on the base commit)

1. **Broken catalog deep links.** `frontend/src/app/courses/[subject]/[number]/page.tsx`
   fetches grade detail through `getCourseGradeDetail`
   (`frontend/src/lib/backend-api.ts`); when no grade service answers, the
   fetch returns `null` and the page calls `notFound()`, rendering Next's
   default 404 with no recovery UI. This 404s even for codes that exist in
   the bundled catalog (`frontend/src/lib/generated/seed-data.json`, 656
   courses), and an unknown code like `CSCE 9999` gets the same bare 404
   with no indication whether the code or the service is at fault.
2. **Missing catalog fields in the detail view.** The detail page renders
   only backend grade data (GPA, distribution, sections, instructor
   outcomes). The catalog's own `description`, `creditHours`, and
   `prerequisites` (`frontend/src/lib/types.ts` `Course`) are never shown —
   the backend's response carries a separate `course` block that the page
   ignores.
3. **Unresolvable prerequisite links.** The catalog contains 222
   prerequisite edges that reference codes absent from the catalog (node
   inspection of `seed-data.json` on the base commit; e.g. `BIOL 2302 →
   BIOL 2311`, `BIOL 2302 → BIOL 2312`, `BIOL 3800 → PHYS 1430/1530/1730`).
   Rendering prerequisites as unconditional links would produce 222 broken
   deep links. Generated catalog data is out of scope for this task, so the
   fix is presentation-level: unresolvable codes render as unresolved text
   guidance, never as links, and never fabricated into courses.
4. **Malformed text import wipes the user's input.** The text-import panel
   `frontend/src/components/course-import-panel.tsx` clears
   `importText` unconditionally after a review
   (`setImportText("")` in `handleReview`), so pasting malformed text,
   pressing review, and seeing "No UNT-style course codes were found."
   leaves the textarea empty — the user cannot correct what they pasted.
5. **The text-import panel is unreachable.** `CourseImportPanel` is
   imported by no page or component; `/courses/import` renders
   `TranscriptImportClient` only. The user-reviewed text import flow the
   component implements is dead code as of the base commit.
6. **MEEN 4920 has `creditHours: 0`** in the generated catalog (node
   inspection of `seed-data.json`). Recorded as a catalog-data note; the
   detail view must not invent a value for it.

## Milestone 1 — witnesses (failing by design)

New files: `frontend/tests/course-detail-witness.test.ts`,
`frontend/tests/course-import-witness.test.ts`.

Baseline at `5cfdc3c` before the witnesses: `bun test` → **109 pass, 0 fail**
(600 expect() calls), `bunx tsc --noEmit` clean, `bun run lint` clean.

Run against the base plus the two witness files
(`bun test tests/course-detail-witness.test.ts tests/course-import-witness.test.ts`):
**0 pass, 2 fail** — both as module-resolution errors, because the contract
modules under test do not exist yet:

- `error: Cannot find module '@/lib/course-detail'`
- `error: Cannot find module '@/lib/course-import-state'`

The witnesses pin the contract the implementation must satisfy:

- `@/lib/course-catalog` — `resolveCourseLocator(subject, number)` returns
  `{ kind: "found", course }` normalized case-insensitively against the
  catalog, or `{ kind: "unknown-code", code }`; never fabricates a course.
- `@/lib/course-detail` — `buildCourseDetailModel({ catalogCourse,
  gradeDetail })` keeps catalog description/credit hours/prerequisites
  present when the grade service is unreachable (`availability:
  "catalog-only"`, grades and ratings explicitly `"unavailable"`),
  attributes grade data and external ratings to their sources, and marks
  unresolvable prerequisites as `resolved: false` with `title: null`.
- `@/lib/course-import-state` — `beginReview` keeps the user's text and
  sets an explicit error when nothing is found; `unresolvedCodes` returns
  `{ code, status: "unresolved" }` entries for unknown codes;
  `computeImportApply` diffs against current planner statuses so applying
  a review twice yields no second diff.

Milestones 2–3 make these witnesses pass; milestone 4 adds Playwright and
axe evidence. Check results at each milestone are appended below.

## Milestone 2 — journey usability (detail route, catalog reference, planner actions)

Implemented on top of the milestone 1 witnesses; all three detail witnesses
now pass. The import-state witness passed after milestone 3's module landed.

New files: `frontend/src/lib/course-catalog.ts` (case-insensitive
`resolveCourseLocator` + `courseDetailHref`), `frontend/src/lib/course-detail.ts`
(`buildCourseDetailModel` presenter: catalog facts, source-attributed grades and
external ratings, `availability: "catalog-only"`, unresolved prerequisite
guidance), `frontend/src/components/course-plan-actions.tsx` (reuses the
planner's `setCourseStatus`/`setSection` — no second store), and
`frontend/src/app/courses/[subject]/[number]/not-found.tsx` (branded
not-found state with recovery link).

Rewritten: `frontend/src/app/courses/[subject]/[number]/page.tsx` — an unknown
code renders the branded not-found state; a known code with an unreachable
grade service renders the catalog block plus a visible "grade data
unavailable" state instead of a bare 404. `frontend/src/components/courses-client.tsx`
now uses the shared href helper.

New tests: `frontend/tests/course-catalog.test.ts` (locator normalization,
href shape) and the detail-witness assertions over
`buildCourseDetailModel`.

## Milestone 3 — import boundary (text import reachable, unresolved codes explicit)

New files: `frontend/src/lib/course-import-state.ts` (`beginReview`,
`unresolvedCodes`, `computeImportApply`, `ImportReadGuard`),
`frontend/src/components/course-import-switch.tsx` (hosts the text panel and
the PDF transcript client as two switched modes — the transcript client owns
its own NavShell, so nesting them would double-render the shell; the panel
reuses the planner provider's public actions).

Rewritten: `frontend/src/components/course-import-panel.tsx` — the review no
longer wipes the pasted text (the milestone 1 defect), unknown codes render
as explicit "Unresolved" chips sourced from `unresolvedCodes`, per-row
planner statuses are chosen with radios and applied through
`computeImportApply`, and an `ImportReadGuard` token discards superseded
async file reads. Wired into `frontend/src/app/courses/import/page.tsx`.

New tests: `frontend/tests/course-import-boundary.test.ts` (guard staleness,
unknown codes never entering `matched`, duplicate reporting, malformed digit
groups not matching).

## Check results after milestones 2–3 (working tree, pre-commit)

- `bun test`: **136 pass, 0 fail** (5,257 expect() calls, 14 files).
- `./node_modules/.bin/tsc --noEmit`: clean.
- `bun run lint`: clean.
- `bun run build` (next build): success — `/courses/[subject]/[number]`
  server-rendered on demand, `/courses/import` prerendered static.

Witness contract refinement note: the milestone 1 import witness originally
assumed `matched[].course.code`; the parser's real `ImportedCourse` is flat
(`code`, `title`, `department` — `frontend/src/lib/course-import.ts`), and
`computeImportApply` takes requested per-row statuses explicitly. The witness
was corrected to the verified contracts during implementation; the pinned
behaviors (text preserved, unknown codes unresolved, idempotent apply) are
unchanged.


## Milestone 4 — accessibility and evidence (Playwright, axe, both viewports)

New tooling: `playwright` and `@axe-core/playwright` dev dependencies and
`frontend/evidence/course-journey.mjs` — a Playwright suite against the
production build (`next build` + `next start` on :3100) that walks the course
journey at 1440x900 and 390x844, audits five states with axe
(wcag2a/wcag2aa/wcag21a/wcag21aa), and writes
`frontend/evidence/screenshots/` (14 PNGs + `results.json`, all committed).

First run: **17/24 checks passed** — two failure classes.

1. `color-contrast` (serious) on every audited state (9-13 nodes each).
   Root cause: the shared `--copy` token `#6b826b` measured 3.63-4.17:1
   across the four surface backgrounds (`#ffffff`, `#f8faf8`, `#f4f6f4`,
   `#edf0ed`) — below the 4.5:1 AA threshold for normal text. Fix
   (`frontend/src/app/globals.css`): `--copy` darkened to `#586e58`, same
   muted-sage family, computed 4.83-5.55:1 on the same four backgrounds.
2. 223px horizontal overflow on mobile `/courses`. Browser diagnostics showed
   every block from `header` to `.course-row` at a uniform 592.688px computed
   width inside a 350px grid column: flex/grid children with implicit
   `min-width: auto` let the department select's intrinsic option width and
   the no-wrap title+actions cluster inflate the page column. Fix: the filter
   grid uses `minmax(0, ...)` columns with `min-width: 0` children, and
   `.course-row` plus its action cluster get `min-width: 0` and
   `flex-wrap: wrap`.

Final run: **24/24 checks passed** (`frontend/evidence/screenshots/results.json`):

- Catalog at real size: 656 `.course-row`s render; keyboard search narrows to
  1 row; explicit "No courses match that search." empty state; department
  filter narrows to 23 rows.
- Deep links: Details reachable by keyboard (Tab order, visible focus);
  Enter deep-links to `/courses/ANTH/1010`; unknown code returns HTTP 404
  with the branded not-found state.
- Detail separation: catalog description present (1393 chars for ANTH 1010);
  "Grade data is unavailable." and instructor-ratings unavailable states
  render visibly when no service responds — no silent fallback.
- Import boundary: review keeps the pasted text (CSCE 3444 matched, CSCE 9999
  rendered as unresolved); applying the diff shows the success toast.
- Long content: the longest description (MTSE 4120, 1739 chars) shows no
  horizontal overflow at 1440x900.
- Reduced motion: with `prefers-reduced-motion: reduce` emulated, all content
  is visible after load — the existing global reduced-motion rules verified
  live (no change was needed to them).
- Mobile (390x844): zero horizontal overflow on courses, detail, not-found,
  and import review; the first-visit major modal fits the viewport.
- axe: **zero serious/critical violations** on all five audited states
  (courses list, catalog-only detail, long-content detail, not-found, import
  review — desktop and mobile).

## Full check suite after milestone 4 (pre-commit)

- `bun test`: pass (no regressions; the CSS changes have no unit-test
  surface).
- `./node_modules/.bin/tsc --noEmit`: clean.
- `bun run lint`: clean.
- `bun run build` (next build): success; production server re-verified with
  the evidence run above.

No `prep-for-prod` script exists in `frontend/package.json`; the established
validation flow is lint + `tsc --noEmit` + `bun test` + `next build`, all
green above.

