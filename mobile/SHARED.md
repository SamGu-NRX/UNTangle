# Shared web code imported by the mobile app

The mobile app imports pure TypeScript modules from the web frontend in place,
through a three-config alias (`tsconfig.json` paths, Babel
`module-resolver`, Jest `moduleNameMapper` - all keyed `@/lib/*` to
`../frontend/src/lib/*`, and `@/schedule-builder/*` to
`../frontend/src/components/schedule-builder/*`). Nothing has been copied, so
this file lists the modules actually imported and the reasons none needed a
mobile-local copy.

`@/schedule-builder/*` exists for one function: Week's `describeAlternative`,
the line the web's Auto strip shows for an option. It lives beside the web
Week's components, not in `lib`, and moving it would mean moving the Week's
whole pure core. Only the pure `.ts` modules there may be imported; its
`.tsx` files are React DOM components.

## Imported in place (no copy)

| Module | Used by mobile for |
|---|---|
| `frontend/src/lib/types.ts` | Shared domain types: Course, PlannerState, ScheduleEvent, ClassDay, PlannerApiPayload |
| `frontend/src/lib/seed-data.ts` | The bundled course catalog and default planner state behind the Courses screen and the sample schedule |
| `frontend/src/lib/plan-library/week.ts` | The Week and Day screens' builders: eventsOf, weekBlocks, weekStats, clockText, toMinutes |
| `frontend/src/lib/leave-by.ts` | Day's hero and leave-by times (dayHero, leaveBy) |
| `frontend/src/lib/map-itinerary.ts`, `planner-walking.ts`, `campus-locations.ts` | Walk minutes between buildings and whether a walk is tight |
| `frontend/src/lib/optimizer/*` | Auto: optimize() on the planned courses' sample sections |
| `frontend/src/lib/planner-sections.ts` | planningTerm, sampleCatalog, and the SectionCatalog type the builders resolve against |
| `frontend/src/lib/course-colors.ts` | The Hue type and assignColors, given the plan's previous colors as the web Week gives it, so a course keeps its color as others come and go |
| `frontend/src/components/schedule-builder/answer.ts`, `week.ts` (and the pure `conflicts.ts`, `limits.ts`, `preferences.ts`, `finals.ts` they import) | Auto's option line: describeAlternative over the picked sections' meetings (eventsOf) and walks (walksOf, unknownWalksOf) |
| `frontend/src/lib/sections/model.ts` | The CourseSections/Section model for the sections proxy responses |

## Small mobile-local mirrors (not copies of web code)

- `mobile/src/data/sections.ts` mirrors the fetch of
  `frontend/src/lib/sections/client.ts` with an absolute base URL; the web
  version is bound to same-origin relative paths, so it cannot be imported.

## Excluded-module list honored

The research report's excluded modules (frontend-only React components and
hooks, server-only modules such as `auth-server.ts` and `db.ts`, and modules
importing Next.js or Node APIs) are not imported by any mobile file. No
module proved native-incompatible, so no copy with a source-path header was
needed.
