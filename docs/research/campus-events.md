# Campus events: public UNT feeds, one normalized list, and schedule gap fitting

Status: implemented on `obv/untangle-w1-20261015-campus-events`. Evidence for
each saved source lives in `frontend/tests/calendar-feeds/fixtures/PROVENANCE.md`;
the decisions recorded here were made while implementing
`frontend/src/lib/campus-events/` and `GET /api/v1/events`.

## Source inventory

One entry per platform, plus the two UNT instances. "Checked" dates are the
date the cited robots.txt or page was fetched for this document.

### Localist (Modern Campus) — the platform behind calendar.unt.edu

- **How to get it:** ICS (and XML) export paths generated from the host's
  live Localist database: `/calendar/ics` for everything, `/group/<slug>/calendar/ics`
  per group, `/department/<slug>/calendar/ics` per department, and
  `/search/events.ics` for filtered sets.
- **Terms / robots:** robots.txt is per client domain. For UNT,
  https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets
  `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s the ICS and XML
  paths above while disallowing search, year/month/week views, attendee
  endpoints, and auth pages. Every feed this repo uses matches an allowed
  pattern.
- **Update cadence:** the export is rendered on request from the live
  database, so new and edited events appear on the next fetch; this repo's
  cache re-fetches each feed at most once every 30 minutes and honors the
  one-second crawl delay.
- **Fields observed in the saved feeds (PR #75, fetched 2026-10-14):** UID,
  SUMMARY, LOCATION, DESCRIPTION, URL (the event's Localist page), CATEGORIES,
  GEO coordinates on some feeds, DTSTART/DTEND with TZID or VALUE=DATE,
  STATUS, TRANSP, plus X-WR-CALNAME / X-WR-TIMEZONE header properties.

### calendar.unt.edu — UNT's Localist instance (the source in use)

The 24 verified directory feeds (PR #75) all live on this host and are the
only sources `GET /api/v1/events` reads. See the Localist entry above for
access, robots, cadence, and fields; fixture-level evidence, including each
fixture's trim, is in `fixtures/PROVENANCE.md`.

### CampusGroups (Ready Education)

- **How to get it:** per-campus ICS subscription through the platform's ICS
  helper (https://www.campusgroups.com/ics_helper — checked 2026-10-15): two
  feed types, group calendar feeds containing all public events of a group,
  and personal feeds. Partner schools also get a Data Export API with events
  endpoints (docs at docs-prod-us-east-1.service.campusgroups.com).
- **Terms / robots:** robots.txt is per campus subdomain, and UNT has no
  CampusGroups instance, so there is no host to check; any future adoption
  must fetch that school's robots.txt first. The ICS helper page documents
  the export mechanism, not a crawl permission.
- **Update cadence:** the ICS helper page states feeds are "updated every
  time an event is added or updated".
- **Fields:** public-event ICS — title, start/end, description, location,
  and event links. Member-only events stay out of public feeds.
- **Status for UNTangle:** not usable (no UNT instance).

### Anthology Engage (formerly Campus Labs Involve)

- **How to get it:** Anthology's support portal documents a Webcal/iCal feed
  of a campus's events — "the start and end date/time, location, description,
  and a link to the event page" — plus JSON Events APIs
  (involve-support.moderncampus.com articles, checked 2026-10-15). Both are
  provisioned through the campus's IT department or Customer Success Manager,
  not self-serve.
- **Terms / robots:** robots.txt is per campus subdomain. For UNT's instance,
  https://unt.campuslabs.com/robots.txt — checked 2026-10-15 — disallows
  `/api/` and `/engage/api/` (it allows only the sitemap and error pages'
  complements), so the event-data APIs are off limits to crawlers.
- **Update cadence:** not established for UNT; without a supported public
  export there is no cadence to observe.
- **Fields (per the support docs):** event start/end, location, description,
  and the event page link.
- **Status for UNTangle:** excluded — the APIs are robots-disallowed and no
  supported public export was established.

### Eagle Engage — UNT's Anthology Engage instance

- **How to get it:** unt.campuslabs.com/engage hosts most UNT club events,
  but no supported public export was identified: the JSON APIs under `/api/`
  and `/engage/api/` are disallowed by that host's robots.txt (checked
  2026-10-15), and no public ICS path was found on the instance.
- **Terms / robots:** https://unt.campuslabs.com/robots.txt (above).
- **Update cadence / fields:** unknown without access; not observed.
- **Status for UNTangle:** excluded. Adding it would require a supported
  export path and a re-review of the crawl policy.

### Presence (Modern Campus)

- **How to get it:** a documented External API
  (developer portal: https://external-api.presence.io — checked 2026-10-15)
  serving structured JSON events; campuses run their own sites at
  `*.presence.io`.
- **Terms / robots:** robots.txt is per campus subdomain, and UNT has no
  Presence site, so nothing was evaluated; any future adoption starts with
  that host's robots.txt and the API portal's terms.
- **Update cadence:** not established (no UNT instance to observe).
- **Fields:** structured JSON event objects via the API portal.
- **Status for UNTangle:** not usable (no UNT instance).

### Corq (Anthology)

- **How to get it:** there is no third-party export. Corq is Anthology's
  mobile discovery app — "Powered by Campus Labs® Engage" (App Store listing
  and support.anthology.com "Using Corq", both checked 2026-10-15) — surfacing
  the Engage events of 250+ campuses (130k+ events/year per corq.app) inside
  a native app.
- **Terms / robots:** none applies — there is no public host to crawl; data
  access is the app's own, backed by the same Engage APIs that are
  robots-disallowed at the host level.
- **Update cadence / fields:** whatever the underlying Engage instance
  exposes; not observable from outside.
- **Status for UNTangle:** excluded; for UNT it would mirror Eagle Engage,
  which is already excluded on its own record.

## What the API therefore serves

A **fixed, code-reviewed source directory** (`sources.ts`, generated from the
verified calendar.unt.edu fixtures) and never caller-supplied URLs: the SSRF
boundary established by the calendar-feed preview route stays intact, and the
rate limiter bounds only legitimate directory refreshes. Politeness: refreshes
are concurrency-capped (4 parallel fetches), each feed refreshes at most once
per `refreshIntervalMs` (30 minutes), and a single feed failure never fails a
request.

## One event shape, from many feeds

Every feed's entries normalize into one `NormalizedEvent`:

- `sourceId`, `url` (the event's Localist page), `title`, `start`, `end`,
  `isAllDay`, `location`, `buildingId`, `tags`.
- Recurring series materialize **one entry per occurrence**, which is what a
  "what's happening" list shows; the calendar-feeds parser owns this.
- Tags are the union of the feed's `CATEGORIES` (feed casing preserved) and
  the source's category; deduplicated case-insensitively.

Two parser fixes were required to make this real, both covered by the
saved directory fixtures: the parser now collects `URL` and `CATEGORIES`
properties (the first of each wins, like SUMMARY and LOCATION; RFC 5545
comma-list for CATEGORIES), and the parsed event model carries them as
**optional** fields — absent means no URL and no categories, which keeps
existing consumers and the core occurrences fixtures compiling unchanged. An
override without its own `CATEGORIES` inherits the series'.

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

- No attendance/persistence layer: the cache is in-memory per process (see
  the PR description for the proposed Postgres table when persistence is
  wanted; the migration is lead-owned and out of this PR's scope).
- No Eagle Engage or per-club events beyond the verified directory feeds.
- No fuzzy location matching; the catalogue is the only building oracle.
