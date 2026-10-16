# Fixture provenance

## us-holidays.ics

- Source URL: https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics
  (Google public calendar: Holidays in United States)
- Terms / robots: https://calendar.google.com/robots.txt — checked 2026-10-15,
  it is `User-agent: * / Allow: /$ / Disallow: /`, i.e. the host disallows all
  crawling except its root page. The fixture was fetched on 2026-10-14 as a
  one-time parser sample of a public share URL (the kind calendar clients
  subscribe to), and it is stored, trimmed, and not re-fetched; nothing
  automated should crawl that host. If this fixture ever needs refreshing,
  prefer re-recording it from a source whose robots.txt permits it.
- Fetched: 2026-10-14 with plain curl from this repo's sandbox. The response
  began with BEGIN:VCALENDAR and carried 120685 bytes.
- What was trimmed: everything except the calendar header properties
  (PRODID, VERSION, CALSCALE, METHOD, X-WR-CALNAME, X-WR-TIMEZONE) and two
  complete VEVENTs, Thanksgiving Day 2026 (DTSTART;VALUE=DATE:20261126,
  UID 20261126_1g5us79unrs6ecmqdes63fqi30@google.com) and Independence Day
  2026 (DTSTART;VALUE=DATE:20260704,
  UID 20260704_uvohv1gi37r7f84ibel1s6tsvc@google.com). From each event the
  long folded DESCRIPTION property (and its continuation lines) was dropped.
  DTSTAMP, UID, CLASS, STATUS, SUMMARY, TRANSP, DTSTART, and DTEND lines are
  the untouched originals; line endings stay CRLF as served. Resulting size:
  723 bytes, still a structurally complete VCALENDAR.

## recurring-chicago.ics

- Crafted by hand for this task (not downloaded). It is a synthetic
  America/Chicago feed exercising: a VTIMEZONE block (tolerated and ignored),
  a weekly MO WE FR event with COUNT=5 and a folded SUMMARY, DAILY rules with
  UNTIL in Z form across both 2026 DST transitions, a BYDAY filter on DAILY,
  a WEEKLY INTERVAL=2 rule, an EXDATE line with TZID and a comma-separated
  list, an all-day VALUE=DATE event with an exclusive DTEND, and a UTC
  Z-form event. Dates and times are invented; they are not real events.
- Terms / robots: none — there is no source and no host.

## directory/ (one fixture per frontend/src/lib/calendar-feeds/directory.json entry)

Every fixture below has its own source URL, terms/robots record, and fetch
date. They also share trim mechanics: each full feed was parsed with
parseCalendarFeed before trimming; per-entry event counts in directory.json
are parser `events` totals over 2026-01-01 through 2027-01-01 UTC, and each
file keeps the calendar header properties (up to the first BEGIN:VEVENT,
including the platform's X-WR-CALNAME and X-WR-TIMEZONE lines) and the first
three complete VEVENTs of the feed (fewer when the feed had less). Line
endings stay CRLF as served; no property values were edited. Fixture files
are named after the feed URL's path slug (calendar.ics, or <slug>.ics for
group and department feeds), the same rule the test uses to find them.

### directory/calendar.ics — UNT Events Calendar (all events)

- Source URL: https://calendar.unt.edu/calendar.ics (the feed carried 1691 events over the verified 2026 range; category university-events).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/student_organizations.ics — Student Organizations Events

- Source URL: https://calendar.unt.edu/group/student_organizations/calendar/ics (the feed carried 755 events over the verified 2026 range; category student-organizations).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/recreational_sports.ics — Recreational Sports Events (Pohl Recreation Center)

- Source URL: https://calendar.unt.edu/group/recreational_sports/calendar/ics (the feed carried 24 events over the verified 2026 range; category recreation).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/libraries.ics — UNT Libraries Events

- Source URL: https://calendar.unt.edu/group/libraries/calendar/ics (the feed carried 43 events over the verified 2026 range; category library).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/athletics.ics — UNT Athletics Events (all sports)

- Source URL: https://calendar.unt.edu/department/athletics/calendar/ics (the feed carried 33 events over the verified 2026 range; category athletics).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/football.ics — UNT Football Events

- Source URL: https://calendar.unt.edu/group/football/calendar/ics (the feed carried 10 events over the verified 2026 range; category athletics).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/soccer.ics — UNT Soccer Events

- Source URL: https://calendar.unt.edu/group/soccer/calendar/ics (the feed carried 18 events over the verified 2026 range; category athletics).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/softball.ics — UNT Softball Events

- Source URL: https://calendar.unt.edu/group/softball/calendar/ics (the feed carried 6 events over the verified 2026 range; category athletics).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/tennis.ics — UNT Tennis Events

- Source URL: https://calendar.unt.edu/group/tennis/calendar/ics (the feed carried 32 events over the verified 2026 range; category athletics).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/swimming_diving.ics — UNT Swimming and Diving Events

- Source URL: https://calendar.unt.edu/group/swimming_diving/calendar/ics (the feed carried 11 events over the verified 2026 range; category athletics).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/mens_basketball.ics — UNT Men's Basketball Events

- Source URL: https://calendar.unt.edu/group/mens_basketball/calendar/ics (the feed carried 2 events over the verified 2026 range; category athletics).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/mens_golf.ics — UNT Men's Golf Events

- Source URL: https://calendar.unt.edu/group/mens_golf/calendar/ics (the feed carried 7 events over the verified 2026 range; category athletics).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/college_of_music.ics — College of Music Events

- Source URL: https://calendar.unt.edu/department/college_of_music/calendar/ics (the feed carried 243 events over the verified 2026 range; category academic-colleges).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/college_of_engineering.ics — College of Engineering Events

- Source URL: https://calendar.unt.edu/department/college_of_engineering/calendar/ics (the feed carried 22 events over the verified 2026 range; category academic-colleges).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/college_of_education.ics — College of Education Events

- Source URL: https://calendar.unt.edu/department/college_of_education/calendar/ics (the feed carried 1 events over the verified 2026 range; category academic-colleges).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/college_of_health_and_public_service.ics — College of Health and Public Service Events

- Source URL: https://calendar.unt.edu/department/college_of_health_and_public_service/calendar/ics (the feed carried 1 events over the verified 2026 range; category academic-colleges).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/college_of_information.ics — College of Information Events

- Source URL: https://calendar.unt.edu/department/college_of_information/calendar/ics (the feed carried 9 events over the verified 2026 range; category academic-colleges).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/college_of_liberal_arts_and_social_sciences.ics — College of Liberal Arts and Social Sciences Events

- Source URL: https://calendar.unt.edu/department/college_of_liberal_arts_and_social_sciences/calendar/ics (the feed carried 45 events over the verified 2026 range; category academic-colleges).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/college_of_merchandising_hospitality_and_tourism.ics — College of Merchandising, Hospitality and Tourism Events

- Source URL: https://calendar.unt.edu/department/college_of_merchandising_hospitality_and_tourism/calendar/ics (the feed carried 29 events over the verified 2026 range; category academic-colleges).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/college_of_science.ics — College of Science Events

- Source URL: https://calendar.unt.edu/department/college_of_science/calendar/ics (the feed carried 24 events over the verified 2026 range; category academic-colleges).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/college_of_visual_arts_and_design.ics — College of Visual Arts and Design Events

- Source URL: https://calendar.unt.edu/department/college_of_visual_arts_and_design/calendar/ics (the feed carried 66 events over the verified 2026 range; category academic-colleges).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/career_center.ics — Career Center Events

- Source URL: https://calendar.unt.edu/group/career_center/calendar/ics (the feed carried 40 events over the verified 2026 range; category student-services).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/dining_services.ics — Dining Services Events

- Source URL: https://calendar.unt.edu/group/dining_services/calendar/ics (the feed carried 16 events over the verified 2026 range; category student-services).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

### directory/admissions.ics — Admissions Events

- Source URL: https://calendar.unt.edu/group/admissions/calendar/ics (the feed carried 6 events over the verified 2026 range; category student-services).
- Terms / robots: https://calendar.unt.edu/robots.txt — checked 2026-10-15 — sets `User-agent: * / Crawl-Delay: 1` and explicitly `Allow`s `/calendar/ics`, `/*/calendar/ics`, `/search/events.ics`, and `/*/search/events.ics`; this fixture's URL matches one of the allowed ICS patterns.
- Fetched: 2026-10-14 with plain curl (a generic user agent) from this repo's sandbox, honoring the crawl delay.

## work-shifts-spring-2027.ics and robotics-club-spring-2027.ics

- Crafted by hand for the calendar busy-time lane (not downloaded); every
  name and time is invented. They stand in for a student's private work
  calendar and a public club calendar over the Spring 2027 term
  (2027-01-11 to 2027-05-07, lib/planner-sections.ts).
- Work: a weekly Tuesday and Thursday 3:00 to 6:00 PM shift for the whole
  term (America/Chicago), one Monday 9:00 to noon shift on 2027-02-08, one
  Tuesday 8:00 to 9:30 AM shift on 2027-02-16, which a class meeting
  Tuesdays at 8:00 overlaps on that date only, two busy all-day events (a
  one-day career fair on 2027-02-24 and a two-day conference on 2027-03-18
  and 19), and one shift on 2027-06-07, after the term, which busy time must leave out.
- Robotics Club: a Wednesday 6:00 to 7:30 PM meeting with COUNT=16, a
  Tuesday 11:00 to 12:30 demo on 2027-03-02, a Friday 5:00 to 8:00 PM
  kickoff on 2027-01-22, and a transparent social on 2027-02-05 that is
  never busy.
- CRLF line endings, as calendar servers send them.
