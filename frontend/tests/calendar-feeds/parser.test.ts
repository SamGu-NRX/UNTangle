import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";

const YEAR_2026 = { start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z" };
const FIXTURES = join(import.meta.dir, "fixtures");

function ics(...parts: string[]): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${parts.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
}

function event(...props: string[]): string {
  return ["BEGIN:VEVENT", ...props, "END:VEVENT"].join("\r\n");
}

/** The crafted America/Chicago fixture with the weekly MO WE FR club meeting. */
function chicagoFixture(): string {
  return readFileSync(join(FIXTURES, "recurring-chicago.ics"), "utf-8");
}

const clubEvent = (raw: string) =>
  parseCalendarFeed(raw, YEAR_2026).occurrences.filter((o) => o.summary.startsWith("Club Coordination"));

test("a daily zoned event keeps wall time across the spring 2026 DST gap in America/Chicago", () => {
  const result = parseCalendarFeed(
    ics(
      event(
        "UID:spring@t",
        "SUMMARY:Daily standup spring",
        "DTSTART;TZID=America/Chicago:20260307T120000",
        "DTEND;TZID=America/Chicago:20260307T130000",
        "RRULE:FREQ=DAILY;UNTIL=20260310T000000Z",
      ),
    ),
    YEAR_2026,
  );
  expect(result.occurrences.map((o) => o.start)).toEqual([
    "2026-03-07T18:00:00.000Z", // CST (UTC-6)
    "2026-03-08T17:00:00.000Z", // CDT (UTC-5), the transition day
    "2026-03-09T17:00:00.000Z", // CDT
  ]);
});

test("a daily zoned event keeps wall time across the fall 2026 return to CST", () => {
  const result = parseCalendarFeed(
    ics(
      event(
        "UID:fall@t",
        "SUMMARY:Daily standup fall",
        "DTSTART;TZID=America/Chicago:20261031T120000",
        "DTEND;TZID=America/Chicago:20261031T130000",
        "RRULE:FREQ=DAILY;UNTIL=20261103T000000Z",
      ),
    ),
    YEAR_2026,
  );
  expect(result.occurrences.map((o) => o.start)).toEqual([
    "2026-10-31T17:00:00.000Z", // CDT
    "2026-11-01T18:00:00.000Z", // CST from Nov 1 on
    "2026-11-02T18:00:00.000Z",
  ]);
});

test("a nonexistent spring-forward wall time resolves to just after the gap", () => {
  const result = parseCalendarFeed(
    ics(event("UID:gap@t", "SUMMARY:In the gap", "DTSTART;TZID=America/Chicago:20260308T023000")),
    YEAR_2026,
  );
  // 02:30 does not exist on 2026-03-08; 03:00 CDT is 08:00Z.
  expect(result.occurrences.map((o) => o.start)).toEqual(["2026-03-08T08:00:00.000Z"]);
});

test("an ambiguous fall-back wall time takes the earlier offset", () => {
  const result = parseCalendarFeed(
    ics(event("UID:fold@t", "SUMMARY:Ambiguous hour", "DTSTART;TZID=America/Chicago:20261101T013000")),
    YEAR_2026,
  );
  // 01:30 happens twice; the earlier pass (CDT, UTC-5) is 06:30Z.
  expect(result.occurrences.map((o) => o.start)).toEqual(["2026-11-01T06:30:00.000Z"]);
});

test("weekly BYDAY MO WE FR with COUNT 5 lands on exactly five weekdays and stops", () => {
  const club = clubEvent(chicagoFixture());
  expect(club.map((o) => o.start)).toEqual([
    "2026-10-07T15:00:00.000Z", // Wed
    "2026-10-09T15:00:00.000Z", // Fri
    "2026-10-12T15:00:00.000Z", // Mon
    "2026-10-14T15:00:00.000Z", // Wed
    "2026-10-16T15:00:00.000Z", // Fri
  ]);
});

test("UNTIL is an inclusive upper bound at the exact occurrence instant", () => {
  const makeEvent = (until: string) =>
    ics(
      event(
        "UID:until@t",
        "SUMMARY:Until test",
        "DTSTART;TZID=America/Chicago:20261005T100000",
        "DTEND;TZID=America/Chicago:20261005T110000",
        `RRULE:FREQ=DAILY;UNTIL=${until}`,
      ),
    );
  // The Oct 7 occurrence is 15:00Z; UNTIL at exactly that instant includes it.
  expect(parseCalendarFeed(makeEvent("20261007T150000Z"), YEAR_2026).occurrences).toHaveLength(3);
  // One second earlier excludes it.
  expect(parseCalendarFeed(makeEvent("20261007T145959Z"), YEAR_2026).occurrences).toHaveLength(2);
});

test("weekly INTERVAL 2 lands every other Monday", () => {
  const result = parseCalendarFeed(chicagoFixture(), YEAR_2026);
  const biweekly = result.occurrences.filter((o) => o.summary === "Biweekly lab");
  expect(biweekly.map((o) => o.start)).toEqual([
    "2026-11-02T16:00:00.000Z",
    "2026-11-16T16:00:00.000Z",
    "2026-11-30T16:00:00.000Z",
  ]);
});

test("DAILY with BYDAY filters expanded days to the listed weekdays", () => {
  const result = parseCalendarFeed(chicagoFixture(), YEAR_2026);
  const filtered = result.occurrences.filter((o) => o.summary === "Filtered daily");
  // DTSTART Fri Nov 6; only Mon Nov 9 and Wed Nov 11 survive the MO,WE filter.
  expect(filtered.map((o) => o.start)).toEqual(["2026-11-09T15:00:00.000Z", "2026-11-11T15:00:00.000Z"]);
});

test("a comma-separated EXDATE with TZID drops exactly the matching occurrences, including across DST", () => {
  const result = parseCalendarFeed(chicagoFixture(), YEAR_2026);
  const seminar = result.occurrences.filter((o) => o.summary === "Monday seminar");
  // COUNT=5 is Oct 5, 12, 19, 26, Nov 2; the EXDATE list removes Oct 26 (CDT) and
  // Nov 2 (CST, after the DST return), leaving three.
  expect(seminar.map((o) => o.start)).toEqual([
    "2026-10-05T15:00:00.000Z",
    "2026-10-12T15:00:00.000Z",
    "2026-10-19T15:00:00.000Z",
  ]);
});

test("a single TZID EXDATE removes exactly its occurrence", () => {
  const result = parseCalendarFeed(
    ics(
      event(
        "UID:exsingle@t",
        "SUMMARY:Single exdate",
        "DTSTART;TZID=America/Chicago:20261102T100000",
        "DTEND;TZID=America/Chicago:20261102T110000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "EXDATE;TZID=America/Chicago:20261102T100000",
      ),
    ),
    YEAR_2026,
  );
  expect(result.occurrences.map((o) => o.start)).toEqual([
    "2026-11-09T16:00:00.000Z",
    "2026-11-16T16:00:00.000Z",
  ]);
});

test("a date-form EXDATE removes exactly its all-day occurrence", () => {
  const result = parseCalendarFeed(
    ics(
      event(
        "UID:exallday@t",
        "SUMMARY:All-day exdate",
        "DTSTART;VALUE=DATE:20261014",
        "DTEND;VALUE=DATE:20261015",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "EXDATE;VALUE=DATE:20261021",
      ),
    ),
    YEAR_2026,
  );
  expect(result.occurrences.map((o) => o.start)).toEqual([
    "2026-10-14T00:00:00.000Z",
    "2026-10-28T00:00:00.000Z",
  ]);
});

test("an all-day event is all-day with an exclusive DTEND and one occurrence in range", () => {
  const result = parseCalendarFeed(chicagoFixture(), YEAR_2026);
  const workshops = result.occurrences.filter((o) => o.summary === "All-day workshops");
  expect(workshops).toHaveLength(1);
  expect(workshops[0]?.isAllDay).toBe(true);
  expect(workshops[0]?.start).toBe("2026-10-14T00:00:00.000Z");
  expect(workshops[0]?.end).toBe("2026-10-15T00:00:00.000Z"); // exclusive
});

test("a folded SUMMARY comes back as one unfolded string", () => {
  const club = clubEvent(chicagoFixture());
  expect(club).toHaveLength(5);
  expect(club[0]?.summary).toBe(
    "Club Coordination Meeting for the Department of Computer Science and Engineering Weekly Session",
  );
});

test("an event straddling rangeStart is included and events entirely outside are not", () => {
  const feed = chicagoFixture();
  // UTC sync runs 14:00-15:00Z on Oct 14.
  const straddling = parseCalendarFeed(feed, { start: "2026-10-14T14:30:00Z", end: "2026-10-14T23:00:00Z" });
  // Oct 14 holds: the all-day event (spans the whole day), UTC sync (14:00-15:00Z,
  // straddling rangeStart), and the Wednesday club meeting (15:00-16:00Z).
  expect(straddling.occurrences.map((o) => o.summary)).toEqual([
    "All-day workshops",
    "UTC sync",
    "Club Coordination Meeting for the Department of Computer Science and Engineering Weekly Session",
  ]);
  // A range that ends Oct 5 15:30Z still catches the Monday seminar start (15:00-16:00Z),
  // but nothing from the Oct 7 club meeting onward.
  const endsMidSeminar = parseCalendarFeed(feed, { start: "2026-10-01T00:00:00Z", end: "2026-10-05T15:30:00Z" });
  expect(endsMidSeminar.occurrences.map((o) => o.summary)).toEqual(["Monday seminar"]);
  const beforeEverything = parseCalendarFeed(feed, { start: "2026-01-01T00:00:00Z", end: "2026-03-01T00:00:00Z" });
  expect(beforeEverything.occurrences).toEqual([]);
});

test("the weekly MO WE FR event yields three busy blocks with weekday numbers and minutes", () => {
  const result = parseCalendarFeed(chicagoFixture(), YEAR_2026);
  const club = result.weeklyBusyBlocks.filter((b) => b.summary.startsWith("Club Coordination"));
  // Monday 10:00-11:00, Wednesday 10:00-11:00, Friday 10:00-11:00; weekday 0 is Sunday.
  expect(club.map((b) => [b.weekday, b.startMinutes, b.endMinutes])).toEqual([
    [1, 600, 660],
    [3, 600, 660],
    [5, 600, 660],
  ]);
});

test("the real Google US holidays fixture parses into the expected all-day holidays", () => {
  const result = parseCalendarFeed(readFileSync(join(FIXTURES, "us-holidays.ics"), "utf-8"), YEAR_2026);
  expect(result.skipped).toEqual([]);
  expect(result.occurrences.map((o) => `${o.summary} ${o.start}`)).toEqual([
    "Independence Day 2026-07-04T00:00:00.000Z",
    "Thanksgiving Day 2026-11-26T00:00:00.000Z",
  ]);
  expect(result.occurrences.every((o) => o.isAllDay)).toBe(true);
});

test("an unknown TZID and an unsupported FREQ land in skipped while the rest parses", () => {
  const result = parseCalendarFeed(
    ics(
      event("UID:mars@t", "SUMMARY:Mars time", "DTSTART;TZID=Mars/Olympus:20261014T090000"),
      event("UID:monthly@t", "SUMMARY:Monthly thing", "DTSTART;TZID=America/Chicago:20261014T090000", "RRULE:FREQ=MONTHLY;COUNT=3"),
      event("UID:fine@t", "SUMMARY:Fine event", "DTSTART;TZID=America/Chicago:20261014T090000"),
    ),
    YEAR_2026,
  );
  expect(result.occurrences.map((o) => o.summary)).toEqual(["Fine event"]);
  expect(result.skipped.map((s) => s.uid).sort()).toEqual(["mars@t", "monthly@t"]);
  expect(result.skipped.every((s) => s.reason.length > 0)).toBe(true);
});

test("a document without BEGIN:VCALENDAR is a feed-level error", () => {
  expect(() => parseCalendarFeed("BEGIN:VEVENT\r\nEND:VEVENT\r\n", YEAR_2026)).toThrow(/VCALENDAR/);
});
