# Shared web code imported by the mobile app

The mobile app imports pure TypeScript modules from the web frontend in place,
through a three-config alias (`tsconfig.json` paths, Babel
`module-resolver`, Jest `moduleNameMapper` - all keyed `@/lib/*` to
`../frontend/src/lib/*`). Nothing from `frontend/src/lib` has been copied, so
this file lists the modules actually imported and the reasons none needed a
mobile-local copy.

## Imported in place (no copy)

| Module | Used by mobile for |
|---|---|
| `frontend/src/lib/types.ts` | Shared domain types: Course, PlannerState, ScheduleEvent, ClassDay, PlannerApiPayload |
| `frontend/src/lib/seed-data.ts` | The bundled course catalog and default planner state behind the Courses screen and the sample schedule |
| `frontend/src/lib/plan-library/week.ts` | The Week and Day screens' builders: eventsOf, weekBlocks, weekColors, weekStats, gridDays, clockText, toMinutes, usesSampleSections |
| `frontend/src/lib/planner-sections.ts` | planningTerm, sampleCatalog, and the SectionCatalog type the builders resolve against |
| `frontend/src/lib/course-colors.ts` | The Hue type and assignColors (via weekColors) for block coloring |
| `frontend/src/lib/sections/model.ts` | The CourseSections/Section model for the sections proxy responses |
| `frontend/src/lib/unt-auth.ts` | The UNT email gate on the sign-in screen (isUntEmail, untEmailRequirementMessage) |

## Small mobile-local mirrors (not copies of web code)

- `mobile/src/data/sections.ts` mirrors the fetch of
  `frontend/src/lib/sections/client.ts` with an absolute base URL; the web
  version is bound to same-origin relative paths, so it cannot be imported.
- `mobile/src/data/magic-link.ts` carries `tokenFromFragment`, a Hermes-safe
  fragment parser: the shared `magic-link-url.ts` helpers lean on
  `URL`/`URLSearchParams`, which the Hermes runtime does not provide. Only
  the `token` parameter is carried in the app's deep link.

## Excluded-module list honored

The research report's excluded modules (frontend-only React components and
hooks, server-only modules such as `auth-server.ts` and `db.ts`, and modules
importing Next.js or Node APIs) are not imported by any mobile file. No
module proved native-incompatible, so no copy with a source-path header was
needed.
