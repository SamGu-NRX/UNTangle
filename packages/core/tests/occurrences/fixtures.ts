/**
 * Fixtures for occurrences.test.ts.
 *
 * `campusFeed` is what parseCalendarFeed (frontend/src/lib/calendar-feeds)
 * returned for campus-feed.ics beside this file, over the range
 * { start: "2026-10-01T00:00:00", end: "2027-04-01T00:00:00" }, on
 * 2026-10-14. The meetings are what parseTerm (frontend/src/lib/sections/vsb.ts)
 * returned for frontend/tests/sections/fixtures/spring-2027.json. The
 * calendars are the Spring 2027 and Fall 2026 sessions in
 * frontend/src/lib/terms/terms.ts, with each holiday's appliesTo applied.
 *
 * Everything is frozen, so a function that changes its input throws.
 */
import type { CalendarParseResult } from "../../../../frontend/src/lib/calendar-feeds/types";
import type { Meeting } from "../../../../frontend/src/lib/sections/model";
import type { ClassCalendar } from "../../src/occurrences";

function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

export const CHICAGO = "America/Chicago";

export const campusFeed: CalendarParseResult = frozen({
  events: [
    { id: 0, uid: "robotics-weekly@example.edu", summary: "Robotics club weekly meeting", location: "Discovery Park B142", description: "", url: null, categories: [], isAllDay: false, transparent: false },
    { id: 1, uid: "robotics-weekly@example.edu", summary: "Robotics club weekly meeting (moved)", location: "Discovery Park B142", description: "", url: null, categories: [], isAllDay: false, transparent: false },
    { id: 2, uid: "election-day@example.edu", summary: "Election Day: no club events", location: "", description: "", url: null, categories: [], isAllDay: true, transparent: false },
    { id: 3, uid: "thanksgiving@example.edu", summary: "Thanksgiving break", location: "", description: "", url: null, categories: [], isAllDay: true, transparent: false },
    { id: 4, uid: "halloween-social@example.edu", summary: "Halloween social", location: "", description: "", url: null, categories: [], isAllDay: false, transparent: false },
    { id: 5, uid: "late-study@example.edu", summary: "Late study session", location: "", description: "", url: null, categories: [], isAllDay: false, transparent: false },
    { id: 6, uid: "fall-back-lan@example.edu", summary: "Overnight LAN party (00:30 CDT to 02:30 CST)", location: "", description: "", url: null, categories: [], isAllDay: false, transparent: false },
    { id: 7, uid: "fall-back-repeat@example.edu", summary: "Stargazing (01:30 CDT to 01:15 CST)", location: "", description: "", url: null, categories: [], isAllDay: false, transparent: false },
    { id: 8, uid: "fall-back-all-day@example.edu", summary: "Daylight saving ends", location: "", description: "", url: null, categories: [], isAllDay: true, transparent: false },
    { id: 9, uid: "spring-forward@example.edu", summary: "Spring break hackathon (01:00 CST to 04:00 CDT)", location: "", description: "", url: null, categories: [], isAllDay: false, transparent: false },
    { id: 10, uid: "study-hall@example.edu", summary: "Open study hall", location: "", description: "", url: null, categories: [], isAllDay: false, transparent: true },
    { id: 11, uid: "maybe-lunch@example.edu", summary: "Officer lunch (tentative)", location: "", description: "", url: null, categories: [], isAllDay: false, transparent: false },
    { id: 12, uid: "instant-reminder@example.edu", summary: "Ballot deadline marker", location: "", description: "", url: null, categories: [], isAllDay: false, transparent: false },
    { id: 13, uid: "halloween@example.edu", summary: "Halloween", location: "", description: "", url: null, categories: [], isAllDay: true, transparent: false },
  ],
  occurrences: [
    { eventId: 0, start: "2026-10-21T00:00:00.000Z", end: "2026-10-21T01:30:00.000Z", status: "confirmed" },
    { eventId: 10, start: "2026-10-21T17:00:00.000Z", end: "2026-10-21T18:00:00.000Z", status: "confirmed" },
    { eventId: 11, start: "2026-10-22T17:00:00.000Z", end: "2026-10-22T18:00:00.000Z", status: "tentative" },
    { eventId: 12, start: "2026-10-23T17:00:00.000Z", end: "2026-10-23T17:00:00.000Z", status: "confirmed" },
    { eventId: 0, start: "2026-10-28T00:00:00.000Z", end: "2026-10-28T01:30:00.000Z", status: "confirmed" },
    { eventId: 5, start: "2026-10-30T04:00:00.000Z", end: "2026-10-30T05:00:00.000Z", status: "confirmed" },
    { eventId: 13, start: "2026-10-31T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z", status: "confirmed" },
    { eventId: 4, start: "2026-10-31T03:00:00.000Z", end: "2026-10-31T06:30:00.000Z", status: "confirmed" },
    { eventId: 8, start: "2026-11-01T00:00:00.000Z", end: "2026-11-02T00:00:00.000Z", status: "confirmed" },
    { eventId: 6, start: "2026-11-01T05:30:00.000Z", end: "2026-11-01T08:30:00.000Z", status: "confirmed" },
    { eventId: 7, start: "2026-11-01T06:30:00.000Z", end: "2026-11-01T07:15:00.000Z", status: "confirmed" },
    { eventId: 2, start: "2026-11-03T00:00:00.000Z", end: "2026-11-04T00:00:00.000Z", status: "confirmed" },
    { eventId: 0, start: "2026-11-04T01:00:00.000Z", end: "2026-11-04T02:30:00.000Z", status: "confirmed" },
    { eventId: 1, start: "2026-11-19T00:00:00.000Z", end: "2026-11-19T01:30:00.000Z", status: "confirmed" },
    { eventId: 3, start: "2026-11-26T00:00:00.000Z", end: "2026-11-29T00:00:00.000Z", status: "confirmed" },
    { eventId: 9, start: "2027-03-14T07:00:00.000Z", end: "2027-03-14T09:00:00.000Z", status: "confirmed" },
  ],
  weeklyBusyBlocks: [{ eventId: 0, weekday: 2, startMinutes: 1140, endMinutes: 1230 }],
  skipped: [],
});

/** MATH 1680, option 6862+6863: lecture Tue and Thu 9:35 to 10:55, lab Mon 8:00 to 8:50. */
export const math1680: Meeting[] = frozen([
  { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
  { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
  { room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
]);

/** ACCT 5120: online with no set day or time, in the second eight weeks. */
export const acct5120Async: Meeting[] = frozen([{ room: "UNT Internet Course", buildingCode: null, buildingId: null, offCampus: false, buildingName: "Online", kind: "online", day: null, startMinutes: null, endMinutes: null, dates: { raw: "03/15/2027 - 05/07/2027", start: "2027-03-15", end: "2027-05-07" }, instructor: { raw: "Lineros,Jose", display: "Jose Lineros" }, async: true, tba: false }]);

/** BCIS 4740: a Thursday line with no time (TBA), and a timed Thursday line. */
export const bcis4740: Meeting[] = frozen([
  { room: "SAGE 331", buildingCode: "SAGE", buildingId: "sage", buildingName: "Sage Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: null, endMinutes: null, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Kim,Dan J.", display: "Dan J. Kim" }, async: false, tba: true },
  { room: "SAGE 333", buildingCode: "SAGE", buildingId: "sage", buildingName: "Sage Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 1050, endMinutes: 1130, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Kim,Dan J.", display: "Dan J. Kim" }, async: false, tba: false },
]);

/** ADES 5510: no day, no time, no room. */
export const ades5510: Meeting[] = frozen([{ room: "None", buildingCode: null, buildingId: null, offCampus: false, buildingName: "Unassigned room", kind: "unassigned", day: null, startMinutes: null, endMinutes: null, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Closed", display: null }, async: false, tba: true }]);

/** DBAS 6003 at Frisco: Saturday and Sunday 11:30 to 14:20, listed four times over, as the source gives it. */
export const dbas6003: Meeting[] = frozen([
  {
    room: "FRLD 458",
    buildingCode: "FRLD",
    buildingId: null,
    buildingName: "Unknown building",
    kind: "unknown",
    offCampus: false,
    day: "Sat",
    startMinutes: 690,
    endMinutes: 860,
    dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" },
    instructor: { raw: "Giddens,Laurie Genette", display: "Laurie Genette Giddens" },
    async: false,
    tba: false,
  },
  {
    room: "FRLD 458",
    buildingCode: "FRLD",
    buildingId: null,
    buildingName: "Unknown building",
    kind: "unknown",
    offCampus: false,
    day: "Sun",
    startMinutes: 690,
    endMinutes: 860,
    dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" },
    instructor: { raw: "Giddens,Laurie Genette", display: "Laurie Genette Giddens" },
    async: false,
    tba: false,
  },
  { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sat", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sun", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sat", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sun", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sat", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sun", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
]);

/** Spring 2027 full semester: classes Jan 11 to Apr 29; MLK Day, spring break and the full-term reading day off. */
export const spring2027Full: ClassCalendar = frozen({
  first: "2027-01-11",
  last: "2027-04-29",
  noClass: [
    { begin: "2027-01-18", end: "2027-01-18" },
    { begin: "2027-03-08", end: "2027-03-14" },
    { begin: "2027-04-30", end: "2027-04-30" },
  ],
});

/** Spring 2027 second eight weeks: classes Mar 15 to May 6. The reading day doesn't apply to it. */
export const spring2027EightWeekII: ClassCalendar = frozen({
  first: "2027-03-15",
  last: "2027-05-06",
  noClass: [
    { begin: "2027-01-18", end: "2027-01-18" },
    { begin: "2027-03-08", end: "2027-03-14" },
  ],
});

/** Fall 2026 full term: classes Aug 17 to Dec 3; Labor Day, Thanksgiving week and the reading day off. */
export const fall2026Full: ClassCalendar = frozen({
  first: "2026-08-17",
  last: "2026-12-03",
  noClass: [
    { begin: "2026-09-07", end: "2026-09-07" },
    { begin: "2026-11-23", end: "2026-11-29" },
    { begin: "2026-12-04", end: "2026-12-04" },
  ],
});
