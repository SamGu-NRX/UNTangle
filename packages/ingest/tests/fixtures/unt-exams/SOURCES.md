# UNT final-exam fixture sources

Every fixture here is a saved copy of a public UNT Office of the Registrar
page, captured once and never re-fetched by tests. The parser that reads it
is `packages/ingest/src/exam-schedule.ts`; Week reads the parsed schedule
from `frontend/src/lib/generated/unt-final-exams.ts`, which
`packages/ingest/tests/exam-schedule.test.ts` keeps in step with this file.

| File | Source URL | Captured | How |
|---|---|---|---|
| `fall-2026.html` | https://registrar.unt.edu/exams/final-exam-schedule/fall.html | 2026-10-16 (06:36 UTC) | single plain HTTP GET, no login |

SHA-256 of `fall-2026.html`: `863bcabb69e488081833f304b27c0af327e0e85a46605b983cef08460bebe467`.

Capture details: fetched with `curl` under the agent string
`UNTangleIngest/0.1 (contact: sgu07966@gmail.com)`, a few seconds apart from
the other registrar requests that session. `registrar.unt.edu/robots.txt`
(read the same day) disallows only `/_archive/`, `/_migration/`,
`/_resources/`, `/ou-alerts/`, `/s/`, `/search.html`, `/dev/` and a few
draft paths, so `/exams/` is allowed. No login or CAPTCHA was met. Future
captures follow the `unt-registrar-exams` policy in
`packages/ingest/src/source-policies.ts`.

## Why the Fall 2026 page

UNTangle plans Spring 2027, and on 2026-10-16 the registrar had not
published Spring 2027 finals. Two pages were read that day:

- `fall.html` publishes Fall 2026 under a rule keyed by a class's first
  meeting day and earliest start time, with separate main-campus,
  Discovery Park and second eight-week tables. It is the newest rule.
- `spring.html` (https://registrar.unt.edu/exams/final-exam-schedule/spring.html)
  still shows Spring 2026, under an older grid keyed by Mo/We/Fr and Tu/Th
  patterns with different exam times (7:30 to 9:30 a.m. slots, for one).

The fixture is the newest rule. Week moves its dates into Spring 2027's
finals week by weekday and says the times are projected
(`frontend/src/lib/final-exams.ts`). Because UNT changed the grid between
Spring 2026 and Fall 2026, the projection can be wrong; recapture
`spring.html` once it shows Spring 2027.

## Errors in the page as published

The page has typos the parser reports rather than corrects
(`invalid` in `parseUntExamPage`):

- Main campus, first meeting on Saturday or Sunday: "11:00 a.m. and 1:59
  a.m." ends before it starts. The row is dropped, so a weekend class
  starting from 11:00 a.m. to 1:59 p.m. has no known final.
- Discovery Park, every first-day table: "9:30 a.m. and 10:20 a.m." leaves
  10:21 to 10:29 a.m. uncovered. Kept as printed.
- "Wedneday, Dec. 9 from from 1 – 3 p.m." (main campus, Monday table):
  the weekday is read by its first three letters and the doubled "from" is
  skipped. The date decides the day either way.
- The intro says finals run "through the last Thursday (December 11,
  2026)"; December 11, 2026 is a Friday. The parser doesn't read the intro.
