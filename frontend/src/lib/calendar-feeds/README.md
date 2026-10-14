# calendar-feeds

Parses public iCalendar (RFC 5545) feeds into planner-shaped data: bounded
occurrence lists over a range, plus weekly recurring busy blocks for the
schedule grid. Designed for club and event calendars published as `.ics`
URLs. Nothing here persists anything; the preview route in
`frontend/src/app/api/calendar-feeds/preview/route.ts` fetches, parses, and
returns the result without storing it.

## Public API

- `parseCalendarFeed(raw, { start, end })`: parse raw iCal text into
  `{ occurrences, weeklyBusyBlocks, skipped }`. Throws `CalendarParseError`
  only when the text is not a calendar at all (no `BEGIN:VCALENDAR`); bad
  values inside `range` also throw. Individual broken events land in
  `skipped` with a reason and never abort the parse.
- `fetchCalendarIcs(url, deps?)`: fetch a feed over https with the SSRF
  guards below and return the raw text. Throws `CalendarFetchError` with a
  `kind` of `blocked` / `invalid` (the route answers 400) or `unreachable` /
  `timeout` (the route answers 502). All knobs are injectable through
  `FetchDeps` (`resolveDns`, `doFetch`, `timeoutMs`, `maxBytes`,
  `maxRedirects`); production uses the defaults.
- `isBlockedAddress(ip)`: pure check for addresses that must never be
  fetched. `validateCalendarUrl(raw)` applies the URL-level rules.

`CalendarOccurrence` carries `uid`, `summary`, `start`, `end` (ISO 8601 UTC
instants), `isAllDay`, `location`, and `description`. `WeeklyBusyBlock`
carries `uid`, `summary`, `weekday` (0 = Sunday) and `startMinutes` /
`endMinutes` counted from local midnight in the event's zone.

## Parser semantics

- **Line unfolding**: RFC 5545 folded lines (continuations starting with a
  single space or tab) are joined; `\n`, `\,`, `\;`, and `\\` escapes in
  TEXT values are unescaped. Property parameters, including quoted values
  that contain colons or semicolons, are parsed.
- **Date forms**: UTC (`20261014T140000Z`), zoned local
  (`DTSTART;TZID=America/Chicago:20261014T090000`), floating (no TZID, judge
  as local wall time), and all-day (`DTSTART;VALUE=DATE:20261014`). Zoned
  wall times convert to UTC instants with `Intl.DateTimeFormat` using the
  IANA zone; VTIMEZONE blocks are tolerated and ignored. Unknown TZIDs skip
  the event.
- **DST choices** (both deliberate, and stable across platforms because they
  come from `Intl`): a wall time inside a spring-forward gap resolves to
  just after the gap (the transition instant, 2026-03-08 02:00 America/Chicago
  becomes 08:00 UTC, the same instant as 03:00 local). A fall-back ambiguous
  wall time takes the earlier offset (the first, pre-transition pass of the
  clock). Conversion works in both directions: the wall time is mapped
  through candidate zone offsets (probed across the surrounding days, so
  zones east of UTC are covered too), each candidate is mapped back through
  the zone, and the earliest self-consistent instant wins. When no offset
  is self-consistent (a spring-forward gap), a bisection between two probes
  that disagree finds the transition instant itself. This replaces a
  fixpoint loop, which oscillates for zones east of UTC.
- **All-day events**: `DTEND;VALUE=DATE` is exclusive (RFC 5545); a missing
  DTEND means exactly one day. All-day occurrences compare by calendar date,
  not instant.
- **RRULE subset**: `FREQ=DAILY` and `FREQ=WEEKLY` only. `INTERVAL` defaults
  to 1. `BYDAY` is a comma list of `MO TU WE TH FR SA SU`; for WEEKLY it
  selects the weekdays of each week (default: the DTSTART weekday), for
  DAILY it filters expanded days. `UNTIL` is inclusive and accepts Z-form
  UTC, floating, and date forms. `COUNT` is the total expanded occurrence
  count including DTSTART. `WKST` is honored for WEEKLY with `INTERVAL > 1`
  (default `MO`). Unknown weekday codes in `BYDAY` or `WKST`, and `INTERVAL`
  values above 1000 (which would overflow date arithmetic before any
  meaningful range cutoff), reject the rule and skip the event. Anything
  else (`MONTHLY`, `BYMONTH`, `BYSETPOS`, and friends) rejects the rule and
  skips the event.
- **EXDATE**: may appear multiple times, each value may be comma-separated,
  and each value may carry its own `TZID` or `VALUE=DATE`. Matching timed
  occurrences drop by exact zone-aware instant; all-day occurrences drop by
  calendar date. A date-form EXDATE excludes the whole local day for timed
  events too.
- **Range**: an occurrence is included iff it overlaps
  `[rangeStart, rangeEnd)`; a straddling start is inside, an end exactly at
  `rangeStart` is not. Expansion stops at `UNTIL`, `COUNT`, the range end,
  or the shared work budget below, whichever comes first. For recurring
  events whose DTSTART sits far before the range, the candidate walk starts
  near the range start (minus the event's length plus slack) and the
  skipped count is bridged with integer arithmetic, so `COUNT` still
  reflects every occurrence including the pre-range ones.
- **Budgets**: recurrence expansion examines at most 100000 candidate dates
  across the whole parse (one shared budget, not per event), and the parse
  materializes at most 20000 occurrences. When a budget trips, the affected
  events land in `skipped` with a budget reason instead of growing without
  bound. Recurring events with a DTSTART outside any plausible range are
  bounded by the range stop, not the budget, so normal feeds never see it.
- **Unsupported and cancelled events**: `DURATION` (with or without
  `DTEND`), `RDATE`, and `RECURRENCE-ID` overrides are not modeled; events
  carrying them are skipped with a reason rather than misparsed. An event
  with `STATUS:CANCELLED` is omitted entirely (no occurrences, no busy
  blocks) and is not reported as a skip anomaly.
- **Weekly busy blocks**: for each `FREQ=WEEKLY` event, the DTSTART wall
  span in the event's zone, anchored at each distinct `BYDAY` weekday (or
  the DTSTART weekday when BYDAY is absent). Spans that cross midnight (or
  span multiple days) split into one block per local day, clamped to that
  day with an exclusive end at 1440, so `endMinutes` never reads as a
  reversed span; an end exactly at midnight adds no empty next-day block.
  Floating times count as local. Blocks deliberately ignore `COUNT` and
  `UNTIL` (they model the weekly rhythm; `occurrences` is the precise
  view). UTC-timed weekly events produce no block (their zone has no local
  midnight that maps to the schedule grid), but their occurrences still
  appear. All-day weekly events block the whole day (0 to 1440 minutes).

## SSRF guards

The fetcher assumes the URL comes from an untrusted user and the network it
might reach includes the server's own intranet.

- **URL validation**: must parse, `https` only, no credentials, at most 2048
  characters. Rejected hostnames (case-insensitive): `localhost`,
  `*.localhost`, `*.internal`, `*.local`, and any IP literal that
  `isBlockedAddress` rejects.
- **Blocked IPv4**: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT),
  `127.0.0.0/8`, `169.254.0.0/16` (link-local, including the
  `169.254.169.254` metadata address), `172.16.0.0/12`, `192.168.0.0/16`,
  `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`,
  `203.0.113.0/24`, `224.0.0.0/4`, and `240.0.0.0/4`. Also blocked after
  decoding `::ffff:0:0/96` v4-mapped and `64:ff9b::/96` NAT64 forms.
- **Blocked IPv6**: `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`,
  `2001:db8::/32`, and anything whose embedded IPv4 address maps into a
  blocked v4 range (v4-mapped, NAT64, IPv4-compatible, 6to4). Zone indexes
  (`fe80::1%eth0`) are stripped before parsing.
- **DNS**: every hostname resolves through `node:dns` `lookup(hostname,
  { all: true, verbatim: true })` before each fetch. If ANY resolved address
  is blocked the fetch is refused, and resolution failure fails closed. The
  resolver is injectable (`FetchDeps.resolveDns`); tests never touch the
  network.
- **Redirects**: fetched with `redirect: "manual"`, at most 3 hops; every
  hop URL passes the full validation and DNS check before it is fetched. A
  3xx without a usable `Location` is an error; so is a fourth redirect.
- **Limits**: one overall 10-second deadline shared across the whole chain
  (`AbortSignal.timeout` plus per-read deadline checks); body capped at
  1 MiB with both a `Content-Length` pre-check and a cumulative stream cap,
  so a lying server cannot bypass the cap by omitting the header; content
  type must be `text/calendar`, `application/calendar`, `application/ics`,
  `text/plain`, or `application/octet-stream`; and the body must begin with
  `BEGIN:VCALENDAR` (a leading BOM or whitespace is allowed). Every problem
  during the fetch or the body read maps onto `CalendarFetchError` with a
  `kind`, including a server that drops the connection mid-read (reported
  as `unreachable`); none of them surface as a raw exception the route
  would answer with a 500. A rejected response cancels its body, so the
  transfer actually stops instead of draining until the deadline.

### Known limitation: DNS-rebinding TOCTOU

The fetcher resolves the hostname, checks the addresses, and only then
fetches - so there is a window between check and use. A DNS rebinding
attack rotates the name to an internal address between this check and the
connection the HTTP client actually opens. The per-hop revalidation narrows
the window but cannot close it, because the transport layer does its own
DNS lookup that this code never sees. Closing it for good requires pinning
the connection to the validated addresses (a custom `Agent` /
`undici.Dispatcher` with `connect.lookup` overridden to return the already
validated set), which is the natural next hardening step if this route ever
faces untrusted traffic at scale.
