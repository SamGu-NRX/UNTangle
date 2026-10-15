# Campus events: public UNT feeds, one normalized list, and schedule gap fitting

Status: implemented on `obv/untangle-w1-20261015-campus-events`. Evidence for
each source lives in `frontend/tests/calendar-feeds/fixtures/PROVENANCE.md`;
the decisions recorded here were made while implementing
`frontend/src/lib/campus-events/` and `GET /api/v1/events`.

## Sources: what is allowed, and why

UNT's public event surfaces split into two families:

- **`calendar.unt.edu` (Localist)** — its `robots.txt` explicitly permits the
  ICS export paths (`/calendar.ics`, `/group/<slug>/calendar/ics`,
  `/department/<slug>/calendar/ics`) with `Crawl-Delay: 1`. The 24 verified
  directory feeds (PR #75) are saved fixtures with fetched-at dates.
- **Eagle Engage (`unt.campuslabs.com/engage`)** — hosts most club events, but
  its `robots.txt` disallows `/api/` and no supported public export was
  established, so it is excluded. Adding it would require an supported
  export path plus a re-review of the crawl policy.

The API therefore serves a **fixed, code-reviewed source directory**
(`sources.ts`, generated from the verified fixtures) and never accepts
arbitrary URLs from callers: the SSRF boundary already established by the
calendar-feed preview route stays intact, and the rate limiter bounds only
legitimate directory refreshes.

Politeness: refreshes are concurrency-capped (4 parallel fetches), each feed
refreshes at most once per `refreshIntervalMs` (30 minutes, the architecture
default), and a single feed failure never fails a request.

## One event shape, from many feeds

Every feed's entries normalize into one `NormalizedEvent`:

- `sourceId`, `url` (the event's Localist page), `title`, `start`, `end`,
  `isAllDay`, `location`, `buildingId`, `tags`.
- Recurring series materialize **one entry per occurrence**, which is what a
  "what's happening" list shows; the calendar-feeds parser owns this.
- Tags are the union of the feed's `CATEGORIES` (feed casing preserved) and
  the source's category; deduplicated case-insensitively.

Two parser fixes were required to make this real, both covered by the
saved directory fixtures: the parsed event model now carries `url` and
`categories` (`draftFor` previously dropped them, so they were `undefined`
at runtime despite the declared type), and an override without its own
`CATEGORIES` inherits the series'.

## Buildings: exact matching, no guesses

Event locations are Localist free text ("Business Leadership Building, 070",
"Pohl Recreation Center, Soccer Gym"). The policy:

- Match the **leading segment before the first comma** against the campus
  building catalogue (name + aliases), case-insensitively with collapsed
  whitespace. A room qualifier after a comma rides along without being
  interpreted.
- No comma, no exact match → `buildingId: null` and the raw text survives.
  "Pohl Recreation Center" is a real Localist venue that is **not** in the
  catalogue, and it stays raw text rather than being guessed onto a building.
- This keeps map links honest: an event only pins to a building when the
  catalogue says so.

## Deduplication

The same event reaches the directory through multiple feeds. Two events are
the same when their **normalized title matches, starts fall within five
minutes, and the place matches** (building id when both resolve, else the
normalized location text). The representative prefers the copy with an event
URL; tags union. The five-minute window is directional over sorted starts, so
a chain of events one minute apart collapses — the tests pin both edge cases.

## Gap fitting

`eventsInGaps(schedule, events, walkingTime)` answers "what can I attend
between my classes": an event fits a gap when it lies entirely between two
classes. Walking time is counted **only when both endpoint buildings are
known** — unknown means no requirement, never a guessed zero seconds. The
walking-time function is injected, so the module carries no campus data and
the tests exercise both the tight-fit and unknown-building paths.

## The API

`GET /api/v1/events` — public, rate-limited (60/min per user and IP), Node
runtime (the cache resolves DNS for SSRF safety). Query:

- `from`, `to` (required ISO date-times, at most 14 days apart);
- `building` (optional catalogue id, exact, validated → 400 when unknown);
- `q` (optional case-insensitive substring over title and location).

Response: `{ range, building, q, events, sources, truncated }`. `sources`
reports per-feed status (`ok` / `stale` — serving last-good data after a
failed refresh / `error` — never fetched), so a degraded feed is visible in
the response instead of taking the endpoint down. Bounds: 500 events and
1 MiB per response; the serializer halves the event list until it fits and
flags `truncated`.

## What is deliberately not here

- No attendance/persistence layer: the cache is in-memory per process.
- No Eagle Engage or per-club events beyond the verified directory feeds.
- No fuzzy location matching; the catalogue is the only building oracle.
