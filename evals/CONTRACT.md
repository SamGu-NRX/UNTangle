# UNTangle UI contract for eval journeys

**Version 0.1.0** — 2026-10-11
Owner: `untangle-evals-f1` (this directory, `evals/**`). Consumers: the eval journeys (journey,
persistence-faults, honesty, a11y-polish suites) and every UI task whose surfaces the journeys drive,
including the integrated app scored on `alpha`.

This contract lists, per page, the roles and accessible-name templates the journeys use. It is based on
what the current heads already expose wherever that exists (marked **exposed**, with evidence), and names
the additional elements the journeys require that no current head exposes yet (marked **required** — these
are additive asks; baseline scorecards honestly record the corresponding cases as failing or
not-applicable until the integrated app exposes them).

## How to read this contract

- **Role vocabulary** is the ARIA role set Playwright's `getByRole` accepts (`button`, `link`, `textbox`,
  `combobox`, `radio`, `tab`, `tablist`, `status`, `alert`, `alertdialog`, `dialog`, `group`,
  `radiogroup`, `progressbar`).
- **Accessible name** follows the HTML Accessibility Name Computation: `aria-label` if present, otherwise
  the element's text content. Templates below are exact-name templates unless prefixed with ~
  (`~` = name *starts with* or *contains* the template).
- Journeys must scope ambiguous names to a container (e.g. the course row containing `{COURSE}`); the
  contract names the container where that applies.
- Elements marked **required** do not exist on every (or any) baseline head. UI tasks building to this
  contract must expose them exactly as written (including `aria-pressed` / `aria-selected` state where
  shown).

## Placeholders

| Token | Meaning | Example |
|---|---|---|
| `{COURSE}` | The course code exactly as displayed: uppercase subject, single space, number | `CSCE 2100` |
| `{NNN}` | The section number: the last dash-separated token of the section id | section id `csce-2100-002` → `002` |
| `{DAY}` | A day token from `weekDays` | `Mon`, `Tue`, `Wed`, `Thu`, `Fri` |
| `{PROFESSOR}` | The section's instructor name as displayed | `Jamie K. Johnson` |
| `{PLAN}` | A saved-plan name chosen by the user | `Fall finals week` |
| `{START}` / `{END}` | Meeting times as displayed by `formatTime` | `10:00 AM`, `10:50 AM` |

## Global chrome — `NavShell`, present on every planner page

| Element | Role | Accessible name | Status |
|---|---|---|---|
| Brand home link | `link` | `UNTangle` | exposed @ all four heads |
| Primary nav links | `link` | `Courses`, `Schedule`, `Map` | exposed @ all four heads |
| Account entry (signed out) | `link` | `Sign in` (→ `/auth`) | exposed @ all four heads |
| Account exit (signed in) | `button` | `Sign out` | exposed @ all four heads |
| Step back / step forward | `link` | `← {label}` / `{label} →` (e.g. `← Courses`, `Generate map →`) | exposed @ all four heads |

## `/` (landing — journey entry)

| Element | Role | Accessible name | Status |
|---|---|---|---|
| Guest entry | `link` | `Continue as guest` | exposed @ all four heads |
| Account entry | `link` | `Sign in or create account` | exposed @ all four heads |

## `/courses`

| Element | Role | Accessible name | Status |
|---|---|---|---|
| Search input | `textbox` | `Search courses` | exposed @ all four heads |
| Department filter | `combobox` | `Filter by department` | exposed @ all four heads |
| Import entry | `link` | `Import PDF` | exposed @ all four heads |
| Course row container | `article` | contains `{COURSE}` (class `course-row`; journeys scope inside this row) | exposed @ all four heads |
| Open one course | `link` | `Details` — **scoped**: the `link` inside the `article.course-row` containing `{COURSE}` | exposed @ all four heads |
| Row status buttons | `button` | `Not taken`, `Taking`, `Done` — scoped to the course row containing `{COURSE}`, state via active styling → **required:** `aria-pressed` | exposed (names) @ all four heads; `aria-pressed` required |
| Row done toggle | `switch`-like `button` | `Mark {COURSE} as done` | exposed @ all four heads |
| Prerequisite lock notice | text in row | `🔒 Requires: {LIST}` when locked | exposed @ all four heads |
| Sample-data notice | `status` | name `Sample data notice`; ~text contains `sample` (synthetic sections are labeled as samples wherever sections are listed) | **required** (no head exposes it) |

## `/courses/[subject]/[number]`

| Element | Role | Accessible name | Status |
|---|---|---|---|
| Grade summary region | `region`-like `div` | `Course grade summary` | exposed @ all four heads |
| Grade data unavailable state | `div` + `status` | `Grade data unavailable` (+ inline `status` notice) | exposed @ #7 (`1fa6bb7`) |
| Catalog details region | `region`-like `section` | `Catalog details` | exposed @ #7 |
| Grade records / unavailable | `region`-like `section` | `Grade records` / `Grade records unavailable` | exposed @ #7 |
| Instructor outcomes region | `region`-like `section` | `Instructor outcomes` | exposed @ #7 |
| Instructor ratings unavailable | `region`-like `section` + `status` | `Instructor ratings unavailable` (+ inline `status` notice) | exposed @ #7 |
| Not-found state | `section` | `Course not found` (branded, with recovery actions — never a bare 404) | exposed @ #7 |
| Plan-this-course actions | `section` | `Planner actions for {COURSE}`; heading `Plan this course`; current status shown as `Planner status: {LABEL}` | exposed @ #7 |
| Status setter group | `group` | `Planner status for {COURSE}` — buttons `Not taken` / `Taking` / `Done`, state via `aria-pressed` | exposed @ #7 (aria-pressed present) |
| Section chooser | `radiogroup` | `Section choice for {COURSE}` — radios ~`{SECTION TITLE} · {PROFESSOR}` and `No section yet`, inside fieldset legend `Bundled section options` | exposed @ #7 |
| Add a section to the working schedule | `button` | `Add {COURSE} section {NNN}` | **required** |
| Lock a section (pin it) | `button` | `Lock {COURSE} section {NNN}`, state via `aria-pressed` (`true` = locked). Unlock reuses the same button. | **required** |

## `/instructors/[id]`

| Element | Role | Accessible name | Status |
|---|---|---|---|
| Grade summary region | `region`-like `div` | `Instructor grade summary` | exposed @ all four heads |
| Ratings unavailable state | `status` + section | ~`unavailable` notice naming the instructor (pattern of #7's unavailable states) | **required** (aligned with #7's course-detail pattern) |

## `/schedule`

| Element | Role | Accessible name | Status |
|---|---|---|---|
| Optimization options | `button` ×5 | `Cluster mornings`, `Cluster nights`, `Compact days`, `Minimize walking`, `Strong professors` — active option **required:** `aria-pressed` (today: `data-active` only) | exposed (names) @ all four heads; `aria-pressed` required |
| Conflict banner | `alert` | ~`Time conflict detected:` | exposed @ all four heads |
| Unscheduled-course banner | `alert` | ~`No section data yet for` | exposed @ all four heads |
| Calendar event | `button` | `{COURSE} {START} – {END} {PROFESSOR}` (text content, in that order) — scoped: the event for `{COURSE}` | exposed @ all four heads |
| Swap-section modal | `dialog` | heading `Swap section` + `{COURSE}`; section option `button`s ~`{PROFESSOR}`; `button` `Close` | exposed @ all four heads |
| Section-updated toast | `status` | ~`✓ Section updated · {COURSE}` | exposed @ all four heads |
| Re-optimized toast | `status` | ~`Re-optimized: {LABEL}` | exposed @ all four heads |
| Run the optimizer explicitly | `button` | `Optimize schedule` | **required** |
| Save-state region | `status` | name `Save state` — semantics below (Save-state region contract) | **required** |
| Print | `button` | `Print schedule` | **required** |
| Calendar export | `button` | `Download .ics` | **required** |
| Retry after failed save | `button` | `Retry save` — present only while the save-state shows a failure | **required** |
| Export without storage | `button` | `Export schedule` — present whenever storage is denied and edits are memory-only | **required** |

## `/plans` (saved-plan library)

| Element | Role | Accessible name | Status |
|---|---|---|---|
| Save form | `textbox` + `button` | input labelled `Plan name (optional)`; `button` `Save current schedule` | exposed @ #8 (`a46b0b4`) |
| Import | `button` + `textbox`-like file input | `Import a plan file`; file input `Import a saved-plan JSON file` | exposed @ #8 |
| Per-plan actions | `button`s | `Export`; rename input `Rename {PLAN}`; `Archive` / `Reopen` | exposed @ #8 |
| Comparison toggle | `button` | `Compare with working schedule` / `Hide comparison` | exposed @ #8 |
| Restore confirm | `dialog` with `button`s | `Restore this plan`, `Cancel` — the preview lists exactly what will change | exposed @ #8 |
| Storage-unavailable alert | `alert` | ~`Saved plans are unavailable because browser storage is disabled` | exposed @ #8 |
| Quarantine notice | `status` | ~text contains `kept at` and the quarantine location; **must not** claim the plan was recovered | exposed @ #8 (wording rule binding) |
| Cross-tab conflict dialog | `alertdialog` | name `Unsaved changes conflict`; shows both versions (this tab's unsaved edits and the other tab's newer save); `button` `Keep my edits`, `button` `Use the newer version` | **required** |
| Taken-newer notice | `status` | ~`Loaded newer version from another tab` (when this tab had **no** unsaved edits and took the newer version silently-but-explicitly) | **required** |

## `/map`

| Element | Role | Accessible name | Status |
|---|---|---|---|
| Day tabs | `tablist` of `tab` | `Mon`, `Tue`, `Wed`, `Thu`, `Fri` with `aria-selected`; arrow-key navigation between day tabs | exposed @ all four heads (arrow keys @ #11) |
| Route legs | `region`-like `div` | `Route legs` | exposed @ all four heads |
| Unavailable stop reason | text on the stop entry | ~reason label explaining why an unavailable building (e.g. Discovery Park) has no path — exact wording not pinned in v0.1.0 | exposed (test-pinned) @ #11 |
| Walking times | text | every walking time shown is a walkway-path estimate; a straight-line distance is never displayed as a walking time (asserted by the honesty suite) | binding honesty rule; no DOM hook pinned in v0.1.0 |

## `/auth`

| Element | Role | Accessible name | Status |
|---|---|---|---|
| Heading | `h1` | ~`Sign in with your UNT email` | exposed @ all four heads |
| Email field | `textbox` | labelled `UNT email`, placeholder `eagleid@unt.edu` | exposed @ all four heads |
| Password fields | `textbox` | labelled `Password` | exposed @ all four heads |
| Mode toggle | `button` | `Use password instead` / `Hide password sign-in` | exposed @ all four heads |
| Submit | `button` | `Log in` (sign-in mode) / `Sign up` (sign-up mode); `Create account` sign-up affordance | exposed @ all four heads |
| Password reset entry | `link` | `Forgot password?` | exposed @ all four heads |

Sign-up is better-auth email+password with automatic sign-in, gated to UNT addresses. Journeys use
synthetic addresses (`eval-<n>@my.unt.edu`). No sign-up email is sent; password reset requires an external
provider and is never exercised.

## Save-state region contract (durability-critical)

A `role="status"` region named `Save state` on `/schedule` (and any page acknowledging saves) carries the
save lifecycle. Its text is one of:

- `Saving…` — a save is in flight;
- `Saved` — the UI acknowledges this save as durable (it survived the write path: acknowledged only after
  the persistence layer confirms; the harness treats this text as the durability claim under test);
- `Not saved…` — storage denied/unavailable: edits stay in memory; this warning is persistent and an
  `Export schedule` button is offered;
- `Saving failed…` — a failed save (server 500, dropped connection, expired session) is **never** shown as
  `Saved`; a `Retry save` button is offered.

Binding rules the harness asserts (planner implements, evals verify):

1. A save acknowledged as `Saved` survives a reload; for a registered user, also sign-out and sign-in.
2. A failed save is never shown as `Saved` and can be retried.
3. When storage is denied, edits stay in memory with the persistent `Not saved…` warning and an export option.
4. Corrupt stored bytes are moved to quarantine intact and the notice never claims recovery (it names the
   quarantine location, `kept at …`).
5. When another tab saves a newer version while this tab has unsaved edits, the user sees both and chooses
   (`Unsaved changes conflict`). Nothing is overwritten silently; with no unsaved edits the tab takes the
   newer version and says so (`Loaded newer version from another tab`).

## Exposure evidence

Verified by grep over the four baseline heads on 2026-10-11 (roles/labels read from
`frontend/src/components/*` and `frontend/src/app/*` at each SHA):

| Head | PR | What it exposes beyond the base |
|---|---|---|
| `5cfdc3c` | #4 | global chrome, `/courses` rows, `/schedule` options+modal, `/map` tabs, `/auth`, planner toasts |
| `1fa6bb7` | #7 | course-detail unavailable states, not-found, `Planner actions for {COURSE}` (status group + section radios) |
| `a46b0b4` | #8 | `/plans` full save/import/export/archive/compare/restore surface + quarantine wording |
| `148622a` | #11 | `/map` day-tab arrow-key navigation, unavailable-stop reason labels, route data layer |

Items marked **required** exist on none of these heads; baseline runs record those cases as failing (or
not-applicable where the page itself is absent, e.g. `/plans` before #8).

## Versioning and change policy

- Version line at the top (`MAJOR.MINOR.PATCH`). `MINOR` bumps for additive rows/regions; `PATCH` for
  wording/clarifications that change no binding name; `MAJOR` only for a breaking rename (requires
  agreement from the UI tasks consuming the name).
- After the first push this contract changes **additively only**: rows may be added or marked required;
  existing role/name templates are never renamed or removed. Every change appends a row here and is
  committed with the reason in the commit message.
- If a UI task needs a name this contract does not cover, it asks `untangle-evals-f1` (this thread)
  rather than inventing a name; the addition lands here first.

### Change log

| Version | Change | Reason |
|---|---|---|
| 0.1.0 | Initial version | First push; journeys and integrated app build to this |
