# Consume real section options

The planner needs two things from `@/lib/sections`. `supportedTerms` lists the terms with a verified vsb file; today that is only `spring-2027`. `getCourseSections(term, courseCode)` returns one course's options for a term, for example `getCourseSections("spring-2027", "MATH 1680")`. It calls UNTangle's own route, `/api/sections/<term>/<SUBJECT>/<number>`, and throws on an HTTP error or a response for a different course. Server code that wants the same data without HTTP calls `sectionsProxy.getCourseSections` from `@/lib/sections/server`.

To admit another term, check its published file against schema v2 and add it to `supportedTerms` in `config.ts`.

## Read the result

`CourseSections` is a union, so TypeScript rules out mixed states:

- **Real** results have `status` `ok` or `stale`, `availability` `sections` or `no_classes`, `provenance.kind: "real"`, and `checkedAt`. `ok` means the proxy confirmed the file with vsb within the 15-minute TTL. `stale` means the TTL lapsed and a refresh is running or failed. Neither promises live seat counts. Show `provenance.updatedAt` as the data's date and `checkedAt` separately. `no_classes` is vsb saying the course has no options this term. It is an authoritative empty list, so don't replace it with samples.
- **Sample** results have `status: "unavailable"`, `availability` `sample` or `missing`, and `provenance.kind: "sample"`. vsb had no usable record, so the result carries the app's synthetic sample sections with their old ids, or nothing. Keep the sample label visible.

`diagnostic` explains a failure on either kind. `schema_error` means vsb's file or that one course did not match schema v2. `upstream_error` covers network, HTTP and unsupported-term failures.

`provenance.note` is vsb's note, verbatim. The Spring 2027 file reports complete coverage but its note still says "Partial scrape". Treat both as vsb's claims.

## Pass whole enrollment options to the optimizer

A `Section` is one enrollment option: `components[0]` is the primary component, and any others are required linked components. Samples have exactly one primary component. vsb does not say which component is a lecture or a lab, so don't infer it from a section number.

Use `section.meetings` once. It already flattens every component's meetings, with one entry per day of a multi-day row, so don't add `components[].meetings` again. Each component keeps its own seats and instructor. Option-level seats describe the primary row only, so an option is open only when every component with known seats has open seats. Exclude `closed`, `cancelled` and `waitlist` from open-only searches. A status vsb adds later arrives as `unknown`, with the text in `rawStatus`.

Times are minutes after midnight. A class ending at 12:00AM ends at 1440. `day`, `startMinutes` and `endMinutes` can be null. An online meeting with no day or time has `async: true`. A physical meeting without a time is `tba`, and a known day with no time keeps its day. Leave TBA meetings out of any claim that a plan has no conflicts. Compare meetings only where their date ranges overlap, because first and second eight-week sessions can share a weekly slot.

Rooms map to building ids only through exact campus-catalogue codes and one-word aliases. Anything else keeps its raw room and code with `buildingId: null` and "Unknown building". `MGV P124` stays unmapped, because the catalogue's `MGVP` code is not the room's `MGV` prefix. `NTDP` maps to Discovery Park with `offCampus: true`, and the Denton walking graph may not route it. Don't invent a building or a zero walking time.

The planner's older `CourseSection` type has no seats, session dates, weekends, null times or linked components. Keep the full `Section` in planner state and convert only for older displays.

## Keep ids stable across refreshes and saved plans

Real option ids are `vsb:<term>:<course>:<class numbers, sorted, joined with +>`. Component ids are `vsb-component:<term>:<course>:<class number>`. Option numbers, labels, instructors, rooms, seats and times do not affect ids. A different set of class numbers is a different option.

Save the term, option id, provenance kind and class numbers. On restore, look the id up in that term's current options and recheck its times, dates and availability. Show ids that no longer resolve as needing review; don't fall back to the first option or a matching label.

Old saved plans hold synthetic ids with no real enrollment identity. Keep them as labeled samples and ask the user to pick real options when they move the plan to a term. Don't map a synthetic id to a real class by title, professor or weekly time.

## Check a saved schedule

`GET /api/v1/documents/<id>/availability` checks every saved choice in an owned schedule against this proxy. It accepts a browser session or a mobile token with `documents:read`; extension tokens do not have that scope. The response carries `documentId`, `revision`, `institutionId`, `termId`, a `summary`, and `courses` in the saved order. A client must discard a response if its displayed schedule has moved to another revision.

Each course carries its saved `selectedSectionId`, a `state`, and either the exact matching `section` or null. A matching section includes all class numbers, component seat counts, and a `seats` assessment. The check never substitutes another option or writes the schedule.

- `open` requires an open status and known positive seats in every component. `full`, `closed`, `waitlist`, and `cancelled` need attention; `unknown` cannot confirm seats.
- `missing` means current real data no longer contains the saved option. `unselected` means the schedule has no pick for that course.
- `stale` retains the last matching section if present but makes no current availability claim. `sample`, `unavailable`, and `unsupported-course` also cannot confirm availability.
- Real results include `evidence.checkedAt` and `evidence.provenance`, including the source's `updatedAt`. These dates describe different things: when UNTangle checked the file and when the source updated it.

The summary is `empty` for no courses, `needs-attention` if any course has a known blocker or no selection, `open` if all courses are confirmed open in current cached data, and `unknown` otherwise. Open seats do not establish registration eligibility, resolve holds or prerequisites, reserve a place, or guarantee live availability. This endpoint uses the same 15-minute cache as course search; it does not force an upstream refresh.

The route returns 404 for a missing, deleted, or unowned document, 400 for a non-schedule, and 422 for an unsupported institution or term. It also rejects schedules over 30 courses before fetching anything, a protective work limit rather than a measured student maximum. The whole section check uses the existing 35-second section-client deadline. When the deadline or request cancellation ends the check, completed results remain and unfinished courses report `unavailable`; no further lookups start. Shared proxy reads already in flight can finish for other callers. Authentication, account-change checks, throttling, and `Cache-Control: no-store` follow the document routes. The current implementation supports UNT Spring 2027. The response schema is `@untangle/contracts/schedule-availability`.

## How the proxy works

`proxy.ts` holds vsb's files in memory only. Each Node process keeps one cache, with a 15-minute TTL, ETag and Last-Modified revalidation, a one-minute backoff after a failure, a 15-second request timeout and a 64 MiB size cap. These are policy defaults, not measured tuning. Requests for the same file share one fetch. A stale file is served at once while one background refresh runs; Next's `after()` keeps that refresh alive past the response. A failed refresh or a file with a new `schema_version` keeps the last good data and reports the failure in `diagnostic`. Separate processes do not share a cache.

The parser ignores fields it does not read. `schema_version` 2 is the compatibility gate for the whole file. A course that fails to parse becomes a `schema_error` for that course alone; the rest of the file still loads.

The term file, `data/<term>.json`, doubles as the subject index. The proxy requests a subject file, `data/<term>/<SUBJECT>.json`, only for a subject that the loaded term contains. It prefers that file and falls back to the term file for anything the subject file lacks. A subject absent from the term never reaches vsb. A 404 for a subject the term does have means vsb has not published subject files, so the proxy stops trying them for that term until the TTL passes. Requesting subject files only for subjects the term contains also caps the cache at one entry per real subject.

The route answers 400 for a malformed term, subject or number, and 200 for every data state, including upstream failure. Responses carry `Cache-Control: no-store` so the browser always sees current provenance. Requests to vsb send an identifying User-Agent and refuse redirects.

## Direct mode, later

Once vsb publishes per-subject files and allows `https://untangleapp.vercel.app` through CORS, the browser could fetch `data/<term>/<SUBJECT>.json` directly. That client would run the same `parseTerm(raw, term, subject)` and keep the proxy as its fallback for CORS, network and schema failures. Until vsb publishes a subject index, the browser cannot tell a missing subject from a typo without asking the proxy. No direct path exists in this code today.

## Check building coverage

`bun --no-env-file scripts/sections-coverage.ts /tmp/untangle-lead/vsb/spring-2027.json spring-2027` reads a local term file and makes no requests. `buildingMappingPercentPhysicalSections` counts options whose physical rooms all map to a building, out of options with any physical room. `buildingMappingPercentAllSections` uses all options as the denominator. Online and unassigned rooms never count as mapped.
