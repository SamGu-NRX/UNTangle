# Grade-history API

The next course and instructor UI can import `gradesHistory` from `@/lib/grades-history` in server code, or call these GET routes:

- `/api/grades/courses/{subject}/{number}`
- `/api/grades/instructors/{id}`, where `id` is the URL-encoded JSON pair `[firstName,lastName]` returned by search
- `/api/grades/instructors?firstName=Pradhumna%20Lal&lastName=Shrestha`
- `/api/grades/search?q=CSCE%201030`

`gradesHistory` exports `getCourseHistory(subject, number)`, `getInstructorHistory(firstName, lastName)`, and `searchGrades(query)`. There are no numeric instructor IDs in this source. Exact first and last names preserve multiword names without guessing how to split a display name.

`HistoryResult<T>` always credits `source: "untgrades.app"`. HTTP 200 responses distinguish `ok` with data, `no-history` with null data when the source confirms absence, and `unavailable` with null data and a specific error when history cannot be read. Invalid caller input returns HTTP 400 with `unavailable` and reason `invalid-request`. Upstream 429/503 responses and local throttling include `error.retryAfterSeconds` and a `Retry-After` header. The client accepts only integer delta-seconds or valid HTTP-date Retry-After values, otherwise it applies a 60-second cooldown. It reads SSE events incrementally, skips notifications and responses for other request IDs, and cancels the stream and HTTP request after the matching result. The client makes no automatic retries and bounds each upstream request at 15 seconds.

`CourseHistory` groups complete section history into `terms`, each with `year`, `term`, and `sections`. Each section identifies its instructor. Course, term, section, and instructor totals retain all source labels in `counts`, their sum in `total`, and recognized labels in `grades: GradeData`. Existing `toChartData(history.grades)` works. Unknown labels remain in `counts` and the denominator but have no legacy chart category. Instructor history contains only that instructor's sections within each course; its GPA uses A through F.

The server fetches all pages with a requested limit of 50 and rejects gaps, duplicates, inconsistent identities, changing totals, or counts that disagree with the aggregate. It never returns partial history as complete. GPA must agree with the A-F weighted mean rounded to two decimals on every page. Instructor history first lists courses, then reads and filters each course's sections. Cold requests for instructors with many courses can take longer because every upstream call is paced.

One shared in-process limiter paces calls at 20/minute and enforces 300 per rolling hour. Calls wait at most 15 seconds for a permit, then return unavailable. Server cooldowns apply to all concurrent callers. These bounds are task constraints, not measured source capacity. Separate workers or hosts do not share the budget; a multi-process deployment needs a shared limiter before increasing traffic.

Complete validated course histories, instructor course lists, and confirmed absence are stored under the server working directory's git-ignored `.grades-history-cache/`. Each course history or instructor course list gets one atomic write and one expiry after one day. Concurrent misses share the entire lookup and load. Old v1 page cache entries are ignored. The TTL is a freshness policy for historical records, not a measurement. Unavailable responses are never cached. A missing directory is created; an unwritable or malformed cache returns `unavailable` with reason `storage`. The host needs writable disk. Expired entries are overwritten on demand; there is no disk-size eviction policy.

Offline tests use a local replay server and small captured fixtures documented under `tests/grades-history/fixtures`. Run `bun --no-env-file test tests/grades-history`. A standalone replay starts with `bun --no-env-file run tests/grades-history/fake-mcp.ts`. The opt-in smoke test is `GRADES_LIVE=1 bun --no-env-file test tests/grades-history/live.test.ts`; it makes at most three calls with no pagination or retries.
