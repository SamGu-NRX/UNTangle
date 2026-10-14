# Fixture provenance

## us-holidays.ics

- Source URL: https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics
  (Google public calendar: Holidays in United States)
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
