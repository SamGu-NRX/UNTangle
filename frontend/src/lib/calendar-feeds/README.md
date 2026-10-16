# calendar-feeds

Parses public iCalendar (RFC 5545) feeds into planner-shaped data: bounded
occurrence lists over a range, plus weekly recurring busy blocks for the
schedule grid. Designed for club and event calendars published as `.ics`
URLs. Nothing here persists anything; the preview route in
`frontend/src/app/api/calendar-feeds/preview/route.ts` fetches, parses, and
returns the result without storing it. Both routes answer guests too,
counted by address, because a guest connects calendars on the device.

## Connected calendars and the feed address

A private feed address is a password (a Google secret address reads the
whole calendar), and `docs/architecture/README.md` requires feed URLs to be
encrypted and never logged. So the address is never stored as written,
anywhere:

- `seal.ts`: AES-256-GCM under `CALENDAR_FEED_KEY` (32 random bytes in
  base64), with the owner as associated data, so a token opens for its owner
  only. A signed-in student's owner is the account (`user:<id>`). A guest's
  is the browser (`guest:<id>`): a random id in the `untangle-calendar-guest`
  cookie, HttpOnly, Secure, SameSite=Lax and sent only to these routes, which
  the busy route sets the first time a guest connects. A token copied out of
  a guest's localStorage opens nowhere without that cookie. A guest token
  stops opening 30 days after it was issued and 90 days after the first in
  its line; each guest refresh reseals it with the first issue time kept. A
  guest token sent with that cookie by a student who signed in on the same
  browser comes back sealed for the account, within the same limits. A
  token sealed under a key the server no longer has fails as `other-key`.
- The busy route seals on request (`seal: true` with a `url`) and refreshes
  from a token (`sealedUrl`). The preview route never takes a token: event
  titles leave the server only for someone holding the address itself.
- `client.ts` is the browser side: check a feed (preview route, over the
  planning term), connect it (busy route, sealed), refresh it, and turn one
  event into a named busy time on its date. The pasted address lives only in
  the Preferences form's state.
- What is kept is a `ConnectedCalendar` (packages/contracts, `CalendarSchema`):
  name, sealed address, term, when it was read, and title-free busy slots,
  each a start and end with the dates it falls on. A signed-in student's
  live in the preferences document, so every device sees them; a guest's
  live in the guest's preferences on the device. `lib/calendar-busy.ts`
  turns them into dated blocked times for Auto, the extension's clash rows
  and the week grid.

## Public API

- `parseCalendarFeed(raw, { start, end })`: parse raw iCal text into
  `{ events, occurrences, weeklyBusyBlocks, skipped }`. Throws
  `CalendarParseError` only when the text is not a calendar at all (no
  `BEGIN:VCALENDAR`); bad values inside `range` also throw. Individual
  broken events or series land in `skipped` with a reason and never abort
  the parse. Range values are ISO 8601 date-times; one without an offset
  reads as America/Chicago.
- `serializePreview(payload)`: the JSON text of a preview response, or null
  when it is over `MAX_PREVIEW_RESPONSE_BYTES` (1 MiB). The route answers
  null with 422 and "This calendar has too many events to preview"; it never
  cuts a response short.
- `busyFromFeed(parsed, termRange, timeZone?)`: the title-free dated busy
  pieces the planner consumes as dated blocked times. It runs the same
  occurrence pipeline as `occurrences` over the term's inclusive ISO-date
  range, then keeps only busy pieces and drops every free-text field: a
  piece is `{ eventId, date, startMinutes, endMinutes, start, end, allDay,
  busy }`, with weekday and minutes derivable from `date` and local
  midnight. Recurring series, canceled instances and transparent events
  behave exactly as in the events API, because it is the same pipeline.
  The busy route (`frontend/src/app/api/v1/calendar-feeds/busy/route.ts`)
  fetches, parses, and returns these pieces through a serializer that maps
  fields explicitly — occurrences carry only `{ date, startMinutes,
  endMinutes, allDay }` and skipped entries only `{ index, reason }`, the
  reason a fixed code because the parser's reasons quote feed values (no summary,
  UID, or feed URL: a Google secret-address URL carries a private token), so
  a future field on the internal types cannot leak event text into the
  response by accident; the planner converts them to dated blocked times in
  `busyOccurrencesToBlockedTime` (`src/lib/planner.ts`).
- `fetchCalendarIcs(url, deps?)`: fetch a feed over https with the SSRF
  guards below and return the raw text. Throws `CalendarFetchError` with a
  `kind` of `blocked` / `invalid` (the route answers 400) or `unreachable` /
  `timeout` (the route answers 502). All knobs are injectable through
  `FetchDeps` (`resolveDns`, `doFetch`, `timeoutMs`, `maxBytes`,
  `maxRedirects`); production uses the defaults.
- `isBlockedAddress(ip)`: pure check for addresses that must never be
  fetched. `validateCalendarUrl(raw)` applies the URL-level rules.

### Result shape

Event text appears once, however many times the event occurs, so a long
description repeated across a daily series cannot multiply the response.

- `events`: `{ id, uid, summary, location, description, isAllDay,
  transparent }`. `id` is the entry's index. Only events with at least one
  occurrence or busy block in the result are listed. A RECURRENCE-ID
  override is its own entry. `description` is capped at 2,000 characters
  (UTF-16 code units); a cut one ends in an ellipsis. `uid` is null when the
  feed gave none.
- `occurrences`: `{ eventId, start, end, status }`. `start` and `end` are
  ISO 8601 UTC instants; `status` is `tentative` for STATUS:TENTATIVE and
  `confirmed` otherwise.
- `weeklyBusyBlocks`: `{ eventId, weekday, startMinutes, endMinutes }`,
  with `weekday` 0 = Sunday and minutes counted from local midnight in the
  event's zone.
- `skipped`: `{ uid, summary, reason }` warnings for each event or series
  left out.

## Parser semantics

- **Line unfolding**: RFC 5545 folded lines (continuations starting with a
  single space or tab) are joined; `\n`, `\,`, `\;`, and `\\` escapes in
  TEXT values are unescaped. Property parameters, including quoted values
  that contain colons or semicolons, are parsed.
- **Date forms**: UTC (`20261014T140000Z`), zoned local
  (`DTSTART;TZID=America/Chicago:20261014T090000`), floating (no TZID and
  no Z: read as America/Chicago, the zone all UNT campuses schedule in,
  never the server's zone), and all-day (`DTSTART;VALUE=DATE:20261014`).
  Four-digit years are read literally (`0001` is year 1, not 1901). An event
  whose DTSTART, DTEND, or RECURRENCE-ID year falls outside 1900 to 2200 is
  skipped with a warning; UNTIL is not checked, so `UNTIL=99991231` still
  works. Zoned
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
- **RRULE subset**: part names and values are case-insensitive
  (`freq=weekly` works). `FREQ=DAILY` and `FREQ=WEEKLY` only. `INTERVAL` defaults
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
- **Recurrence overrides**: a VEVENT with `RECURRENCE-ID` and the UID of a
  series replaces the one instance it names, matched by instant (or by date
  for date-form values), so a UTC `RECURRENCE-ID` matches a zoned series.
  With `STATUS:CANCELLED` the instance is removed. Otherwise the override
  appears as its own event with its own time, status, and text; a missing
  SUMMARY, LOCATION, or DESCRIPTION falls back to the series, and a missing
  DTEND keeps the series' length. An override whose RECURRENCE-ID names no
  generated instance still appears. Forms this library cannot apply exactly
  skip the whole series with one warning naming it, so no stale instance is
  ever returned: a `RANGE` parameter (`RANGE=THISANDFUTURE`), an override
  with no matching series, a UID shared by several series that also has
  overrides, and an override with its own RRULE, RDATE, or DURATION.
- **Unsupported and cancelled events**: `DURATION` (with or without
  `DTEND`) and `RDATE` are not modeled; events carrying them are skipped
  with a reason rather than misparsed. An event or series with
  `STATUS:CANCELLED` is omitted entirely (no occurrences, no busy blocks,
  and its overrides are ignored) and is not reported as a skip anomaly.
- **Weekly busy blocks**: only `FREQ=WEEKLY` rules with `INTERVAL=1` and
  without `TRANSP:TRANSPARENT` produce blocks. A block carries only a
  weekday and minutes, so an every-other-week rule would read as busy in
  its off weeks; such rules still list their dated occurrences. Transparent
  events also still appear as occurrences. For each qualifying event, the DTSTART wall
  span in the event's zone, anchored at each distinct `BYDAY` weekday (or
  the DTSTART weekday when BYDAY is absent). Spans that cross midnight (or
  span multiple days) split into one block per local day, clamped to that
  day with an exclusive end at 1440, so `endMinutes` never reads as a
  reversed span; an end exactly at midnight adds no empty next-day block.
  Floating times read as America/Chicago. Blocks deliberately ignore `COUNT` and
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
  `203.0.113.0/24`, `224.0.0.0/4`, and `240.0.0.0/4`.
- **IPv6 is an allowlist**: only global unicast `2000::/3` passes, minus
  `2001::/23` (IETF protocol assignments, including Teredo `2001::/32`),
  `2001:db8::/32` and `3fff::/20` (documentation), and `2002::/16` (6to4).
  IPv4-mapped (`::ffff:0:0/96`), IPv4-compatible (`::/96`), and NAT64
  (`64:ff9b::/96`) addresses are judged by their embedded IPv4 address
  under the IPv4 rules. Everything else is blocked, including `fec0::/10`
  site-local, `fc00::/7`, `fe80::/10`, `ff00::/8`, `::`, and `::1`. A
  blocklist missed `fec0::/10`, which RFC 3879 deprecated but still lets a
  network route. Zone indexes (`fe80::1%eth0`) are stripped before parsing.
- **DNS**: every hostname resolves through `node:dns` `lookup(hostname,
  { all: true, verbatim: true })` before each fetch. If ANY resolved address
  is blocked the fetch is refused, and resolution failure fails closed. The
  resolver is injectable (`FetchDeps.resolveDns`); tests never touch the
  network. Each `node:https` request uses a fresh socket and a custom lookup
  that returns only the first validated address, without resolving again.
  The original hostname remains the TLS server name and HTTP Host header;
  certificate verification stays enabled.
- **Redirects**: followed manually, at most 3 hops; every
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
