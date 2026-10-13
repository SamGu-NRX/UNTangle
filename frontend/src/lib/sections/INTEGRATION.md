# Consume real section options

The planner and optimizer can import the client-safe types from `@/lib/sections`. Server code imports `sectionSource` from `@/lib/sections/server`, which implements `SectionSource`. Browser code requests `GET /api/sections/terms` and `GET /api/sections/spring-2027/MATH/1680`. Each course response contains only that course's options. `spring-2027` is the only configured term; add a verified published term to `supportedTerms` when admitting another source file.

Read `status`, `availability`, and `provenance` before displaying or optimizing options:

- `ok` means the cached file passed schema validation and its last successful upstream check is within the TTL. It does not promise live seat counts. Display `provenance.updated_at` as the source timestamp and `freshness.checkedAt` separately.
- `stale` serves the last validated real file while one shared fetch revalidates it. A failed refresh keeps that file and exposes `freshness.diagnostic`.
- `unavailable` means the term or course has no usable real record. `availability: sample` carries the existing synthetic ids and `provenance.kind: sample`; `missing` has no sections. Keep the sample label visible. A real `no_classes` record is an authoritative empty list and does not receive sample replacements.

The source note is preserved verbatim. The supplied Spring 2027 file reports completed coverage but retains a note saying it is a partial scrape. Treat these as source claims; neither the adapter nor a recent cache check verifies their accuracy. Strict schema failures include the source field path in `freshness.diagnostic`, with code `schema_error`.

## Pass whole enrollment options to the optimizer

A `Section` is one enrollment option, with one primary component and zero or more required linked components. Schema v2's `linked_sections` includes the primary component. `components[0].role` is `primary`; the rest are `required-linked`. The source does not identify lecture, lab, or recitation types, so `componentType` is `unspecified`. Do not infer a lab type from a section number.

Use `section.meetings` once. It already flattens the component schedules, including each day in a multi-day row. Do not append `components[].meetings` again or combine linked components across different options. Multi-meeting rows remain separate, including repeated rows from the source. Each component retains its own seats and instructor; option seats describe the primary summary and cannot prove that every required component has a seat. Require each component's known open seats to be positive before claiming the whole option is available. Unknown seats remain unknown. Exclude `closed`, `cancelled`, and `waitlist` from open-only searches.

Meeting times are minutes after midnight, with Monday through Sunday supported. `day`, `startMinutes`, and `endMinutes` can be null. An online meeting with no day or time has `async: true`; a physical meeting with missing time is TBA, not asynchronous. Show uncertain meetings and exclude them from claims of a conflict-free plan. A known day with unknown time still carries that day. Online meetings can also have a scheduled time. Evaluate conflicts only where the date ranges overlap; the first and second eight-week sessions can share weekly time slots without conflicting. Preserve per-meeting dates instead of assigning every option the full-term summary dates.

Only exact campus-catalogue codes and aliases map to building ids. Unknown rooms retain their raw name, code, and `Unknown building` label. Do not supply a default building or a zero walking time. `NTDP` maps to Discovery Park with `offCampus: true`; a known building does not imply that the Denton walking graph can route it. Frisco codes remain unknown until the catalogue identifies them.

The existing planner `CourseSection` type lacks seats, session dates, weekends, null times, linked components, and provenance. Keep these fields in planner state before converting any timed weekday entries into the older display type. Do not invent professor ratings from this feed.

## Preserve ids when refreshing or restoring plans

Real option ids have the form `vsb:<term-id>:<course-code>:<sorted-class-numbers-joined-with-+>`. Component ids use `vsb-component:<term-id>:<course-code>:<class-number>`. Identity does not depend on option ordering, instructor, room, seats, or times. Class numbers are scoped to the term and course; changes to the required class-number set produce a new option id.

Save the term, option id, provenance kind, and selected class numbers. On restore, resolve the id against that term's current options and revalidate times, dates, components, and availability. Keep unresolved ids visible as needing review; do not silently choose the first available option or match only the section label.

Synthetic ids remain unchanged in fallback responses. Old saved plans have no real enrollment identity. Retain those plans as labeled samples, then ask the user to select real options for each course when migrating to a term. Clear synthetic selections and locks only as part of that explicit migration. Do not translate a synthetic id to a real class number by course title, professor, or matching weekly times. The data layer does not edit stored plans.

## Run the cache on a Node server

The disk cache is `.sections-cache/` relative to the frontend working directory and is git-ignored. Each process shares a term cache and one in-flight request per term. It uses a 15-minute TTL, ETag and Last-Modified validators, a one-minute failure backoff, and a 15-second request deadline. These are policy defaults, not measured tuning. Next.js `after` retains stale refresh work until it completes. A writable persistent directory preserves successful checks across restarts. Ephemeral or read-only hosts can serve memory data, but cold processes fetch again and expose disk-write diagnostics. Separate server processes do not share an in-flight lock.

HTTP upstream and schema failures return HTTP 200 with `unavailable` or `stale`, never an upstream 500. Invalid route parameters return HTTP 400. API responses use `Cache-Control: no-store` so browsers receive current provenance and failure state. The term file is fetched only on the server, with an identifying User-Agent and redirects disabled.

For a local coverage check, run `bun --no-env-file scripts/sections-coverage.ts /tmp/untangle-lead/vsb/spring-2027.json spring-2027` from `frontend/` under the heavy lease. The script makes no requests. `buildingMappingPercentAllSections` counts options with at least one physical room and every physical room mapped, divided by all options. `buildingMappingPercentPhysicalSections` uses only options with physical rooms as its denominator. Neither counts online or unassigned rooms as mapped buildings. Meetings and components count occurrences across options, not unique university classes.
