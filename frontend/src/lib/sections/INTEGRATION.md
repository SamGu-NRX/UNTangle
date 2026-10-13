# Consume real section options

Browser consumers call `await loadBrowserSectionSource()` from `@/lib/sections`, then use the returned `SectionSource` for term metadata, course options, and freshness. Create one source per planner session and reuse it across course requests so subject fetches share their in-flight work. The loader reads `/api/sections/config`, so the browser and server use one runtime `SECTIONS_MODE` value. Server consumers import the fallback `sectionSource` from `@/lib/sections/server`. `spring-2027` is the only admitted term; add a verified published term to `supportedTerms` in `config.ts` when admitting another source file.

## Select direct or proxy delivery

Set the server process environment variable `SECTIONS_MODE=direct` or `SECTIONS_MODE=proxy`. The default is `proxy` until Dylan publishes subject files and permits UNTangle's origin through CORS. Restart the server and reload the browser source after changing the mode. No `NEXT_PUBLIC` value or separate client setting is required.

- In `direct` mode the browser fetches `https://vsb.untgrades.app/data/<term>/<SUBJECT>.json`, uses the existing v2 adapter, and slices the requested course from the normalized subject. Requests use CORS, omit credentials, and require HTTP cache revalidation after the source TTL. A CORS/network failure, missing file, invalid schema, oversized file, or missing course record falls back to `/api/sections/<term>/<SUBJECT>/<number>`. The returned real/sample provenance and section ids are unchanged. Direct failures appear in the result's freshness diagnostic, and failing subject requests wait one minute before retrying. If that proxy cannot supply real data after an earlier direct success, the source keeps the validated direct option with stale freshness rather than replacing it with a synthetic id.
- In `proxy` mode the browser calls only UNTangle's per-course endpoints. The fallback server tries vsb's subject file first, then the current `data/<term>.json` when the subject endpoint or requested course record is unavailable. Whole-term requests are shared per Node process. No term or subject file is stored on disk by UNTangle.

`config.ts` owns `vsbUrls`, the origin and both path templates. Its factory refuses `direct` with `fileLayout: term-only`, a subject path without a `{subject}` path placeholder, or a direct byte budget above 2 MiB. The browser never requests the whole-term URL, on phones or desktops. Whole-term fallback happens through the per-course proxy. This avoids user-agent guesses about whether a device is a phone.

Direct responses are limited to 2 MiB. A larger Content-Length cancels the response before reading the body; streaming byte counts enforce the same limit when the length is missing or compressed. Oversized responses use the per-course proxy. The limit is a mobile protection policy, not measured tuning of Dylan's unpublished subject files.

The proposed subject-file contract is the same schema-version-2 envelope as the term file, with `courses` restricted to the requested subject. It has not been verified against a published Dylan endpoint. Other envelopes and files containing other subjects are rejected with field-path diagnostics until that contract is confirmed. Term metadata in direct mode is lazy: `getTerms()` initially lists the admitted term with unloaded/unavailable freshness and no real source timestamp, then reflects the last subject or proxy response. Listing terms does not download a whole-term file. Observed metadata ages to stale after the TTL.

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

## Run the transient fallback proxy

The fallback cache holds parsed data only in memory, with a 15-minute TTL, ETag and Last-Modified validators, a one-minute failure backoff, and a 15-second request deadline. Missing subject endpoints are reprobed after the normal TTL while the proxy uses the whole-term file. These are policy defaults, not measured tuning. Each Node process shares its in-flight requests; Next.js `after` retains stale refresh work until it completes. A restarted process fetches from vsb again. Separate processes do not share an in-flight lock. The browser also holds successful normalized subjects in memory for the TTL; it revalidates vsb's HTTP cache rather than keeping its own file store.

Proxy upstream and schema failures return HTTP 200 with `unavailable` or `stale`, never an upstream 500. Invalid route parameters return HTTP 400. Normalized API responses use `Cache-Control: no-store` so browsers receive current provenance and failure state. The fallback server fetches vsb files with an identifying User-Agent and redirects disabled. Browser direct requests omit the User-Agent override because browsers own that header.

For a local coverage check, run `bun --no-env-file scripts/sections-coverage.ts /tmp/untangle-lead/vsb/spring-2027.json spring-2027` from `frontend/` under the heavy lease. The script makes no requests. `buildingMappingPercentAllSections` counts options with at least one physical room and every physical room mapped, divided by all options. `buildingMappingPercentPhysicalSections` uses only options with physical rooms as its denominator. Neither counts online or unassigned rooms as mapped buildings. Meetings and components count occurrences across options, not unique university classes.
