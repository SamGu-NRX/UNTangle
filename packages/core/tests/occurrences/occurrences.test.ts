import { describe, expect, test } from "bun:test";
import { feedOccurrences, meetingOccurrences, type FeedOccurrence, type ParsedFeed } from "../../src/occurrences";
import {
  CHICAGO,
  acct5120Async,
  ades5510,
  bcis4740,
  campusFeed,
  dbas6003,
  fall2026Full,
  math1680,
  spring2027EightWeekII,
  spring2027Full,
} from "./fixtures";

const [tuesdayLecture, thursdayLecture, mondayLab] = math1680;
const wholeFeed = { first: "2026-10-01", last: "2027-03-31" };

function piecesOf(eventId: number, range = wholeFeed): FeedOccurrence[] {
  return feedOccurrences(campusFeed, range, CHICAGO).filter((piece) => piece.eventId === eventId);
}

describe("meetingOccurrences", () => {
  test("a weekly meeting meets on every date with its weekday from the first to the last class day", () => {
    const dates = meetingOccurrences([mondayLab], spring2027Full, CHICAGO).map((piece) => piece.date);
    expect(dates).toEqual([
      "2027-01-11",
      "2027-01-25",
      "2027-02-01",
      "2027-02-08",
      "2027-02-15",
      "2027-02-22",
      "2027-03-01",
      "2027-03-15",
      "2027-03-22",
      "2027-03-29",
      "2027-04-05",
      "2027-04-12",
      "2027-04-19",
      "2027-04-26",
    ]);
  });

  test("no-class days are skipped: MLK Day and every day of spring break", () => {
    const dates = meetingOccurrences([tuesdayLecture, thursdayLecture, mondayLab], spring2027Full, CHICAGO).map(
      (piece) => piece.date,
    );
    expect(dates).not.toContain("2027-01-18");
    expect(dates.filter((date) => date >= "2027-03-08" && date <= "2027-03-14")).toEqual([]);
    expect(dates).toContain("2027-03-04");
    expect(dates).toContain("2027-03-16");
  });

  test("a meeting keeps its wall-clock time across the spring DST change while its instants move by an hour", () => {
    const pieces = meetingOccurrences([tuesdayLecture, thursdayLecture], spring2027Full, CHICAGO);
    expect(pieces.find((piece) => piece.date === "2027-03-04")).toEqual({
      date: "2027-03-04",
      startMinutes: 575,
      endMinutes: 655,
      start: "2027-03-04T15:35:00.000Z",
      end: "2027-03-04T16:55:00.000Z",
      meetingIndex: 1,
    });
    expect(pieces.find((piece) => piece.date === "2027-03-16")).toEqual({
      date: "2027-03-16",
      startMinutes: 575,
      endMinutes: 655,
      start: "2027-03-16T14:35:00.000Z",
      end: "2027-03-16T15:55:00.000Z",
      meetingIndex: 0,
    });
  });

  test("a meeting keeps its wall-clock time across the fall DST change", () => {
    const fallLab = { ...mondayLab, dates: { start: null, end: null } };
    const pieces = meetingOccurrences([fallLab], fall2026Full, CHICAGO);
    expect(pieces.find((piece) => piece.date === "2026-10-26")).toEqual({
      date: "2026-10-26",
      startMinutes: 480,
      endMinutes: 530,
      start: "2026-10-26T13:00:00.000Z",
      end: "2026-10-26T13:50:00.000Z",
      meetingIndex: 0,
    });
    expect(pieces.find((piece) => piece.date === "2026-11-02")).toEqual({
      date: "2026-11-02",
      startMinutes: 480,
      endMinutes: 530,
      start: "2026-11-02T14:00:00.000Z",
      end: "2026-11-02T14:50:00.000Z",
      meetingIndex: 0,
    });
    expect(pieces.map((piece) => piece.date)).not.toContain("2026-09-07");
    expect(pieces.map((piece) => piece.date)).not.toContain("2026-11-23");
  });

  test("a meeting's own dates narrow the session's, and the session's last class day cuts off finals week", () => {
    const secondEightWeeks = { ...tuesdayLecture, dates: { ...tuesdayLecture.dates, start: "2027-03-15", end: "2027-05-07" } };
    expect(meetingOccurrences([secondEightWeeks], spring2027EightWeekII, CHICAGO).map((piece) => piece.date)).toEqual([
      "2027-03-16",
      "2027-03-23",
      "2027-03-30",
      "2027-04-06",
      "2027-04-13",
      "2027-04-20",
      "2027-04-27",
      "2027-05-04",
    ]);
    const fullTerm = meetingOccurrences([tuesdayLecture], spring2027Full, CHICAGO).map((piece) => piece.date);
    expect(fullTerm.at(0)).toBe("2027-01-12");
    expect(fullTerm.at(-1)).toBe("2027-04-27");
  });

  test("a meeting without its own dates runs the whole calendar", () => {
    const undated = { ...thursdayLecture, dates: { start: null, end: null } };
    const dates = meetingOccurrences([undated], spring2027Full, CHICAGO).map((piece) => piece.date);
    expect(dates).toHaveLength(15);
    expect(dates.at(0)).toBe("2027-01-14");
    expect(dates.at(-1)).toBe("2027-04-29");
  });

  test("a meeting whose own dates miss the calendar meets nowhere", () => {
    const winterOnly = { ...mondayLab, dates: { ...mondayLab.dates, start: "2026-12-14", end: "2027-01-08" } };
    expect(meetingOccurrences([winterOnly], spring2027Full, CHICAGO)).toEqual([]);
  });

  test("async, TBA and dayless meetings yield no dates", () => {
    expect(meetingOccurrences(acct5120Async, spring2027Full, CHICAGO)).toEqual([]);
    expect(meetingOccurrences(ades5510, spring2027Full, CHICAGO)).toEqual([]);
    const [thursdayNoTime, thursdayTimed] = bcis4740;
    expect(meetingOccurrences([thursdayNoTime], spring2027Full, CHICAGO)).toEqual([]);
    expect(meetingOccurrences([thursdayNoTime, thursdayTimed], spring2027Full, CHICAGO).every((piece) => piece.meetingIndex === 1)).toBe(true);
  });

  test("no meetings yield no dates", () => {
    expect(meetingOccurrences([], spring2027Full, CHICAGO)).toEqual([]);
  });

  test("occurrences come in start order, then meeting order", () => {
    const pieces = meetingOccurrences([tuesdayLecture, thursdayLecture, mondayLab], spring2027Full, CHICAGO);
    expect(pieces.slice(0, 4).map((piece) => [piece.date, piece.meetingIndex])).toEqual([
      ["2027-01-11", 2],
      ["2027-01-12", 0],
      ["2027-01-14", 1],
      ["2027-01-19", 0],
    ]);
    // DBAS 6003 lists the same weekend times four times; each line is its own meeting.
    const weekend = meetingOccurrences(dbas6003, spring2027Full, CHICAGO);
    expect(weekend.slice(0, 8).map((piece) => [piece.date, piece.meetingIndex])).toEqual([
      ["2027-01-16", 0],
      ["2027-01-16", 2],
      ["2027-01-16", 4],
      ["2027-01-16", 6],
      ["2027-01-17", 1],
      ["2027-01-17", 3],
      ["2027-01-17", 5],
      ["2027-01-17", 7],
    ]);
  });

  test("the order of the no-class ranges doesn't change the answer", () => {
    const reversed = { ...spring2027Full, noClass: [...spring2027Full.noClass].reverse() };
    expect(meetingOccurrences(math1680, reversed, CHICAGO)).toEqual(meetingOccurrences(math1680, spring2027Full, CHICAGO));
  });

  test("bad input throws instead of guessing", () => {
    expect(meetingOccurrences(math1680, spring2027Full, CHICAGO).length).toBeGreaterThan(0);
    expect(() => meetingOccurrences(math1680, spring2027Full, "America/Denton")).toThrow();
    expect(() => meetingOccurrences(math1680, { ...spring2027Full, first: "2027-05-01" }, CHICAGO)).toThrow();
    expect(() => meetingOccurrences(math1680, { ...spring2027Full, last: "2027-02-30" }, CHICAGO)).toThrow();
    expect(() => meetingOccurrences([{ ...mondayLab, startMinutes: 530, endMinutes: 480 }], spring2027Full, CHICAGO)).toThrow();
  });
});

describe("feedOccurrences", () => {
  test("a timed occurrence lands on its local date at its wall-clock minutes", () => {
    expect(piecesOf(0)[0]).toEqual({
      date: "2026-10-20",
      startMinutes: 1140,
      endMinutes: 1230,
      start: "2026-10-21T00:00:00.000Z",
      end: "2026-10-21T01:30:00.000Z",
      eventId: 0,
      allDay: false,
      busy: true,
    });
  });

  test("a weekly event keeps its wall-clock time across the fall DST change", () => {
    expect(piecesOf(0).map((piece) => [piece.date, piece.startMinutes, piece.endMinutes, piece.start])).toEqual([
      ["2026-10-20", 1140, 1230, "2026-10-21T00:00:00.000Z"],
      ["2026-10-27", 1140, 1230, "2026-10-28T00:00:00.000Z"],
      ["2026-11-03", 1140, 1230, "2026-11-04T01:00:00.000Z"],
    ]);
  });

  test("the parser's exceptions carry through: the EXDATE is gone and the moved instance is its own event", () => {
    expect(piecesOf(0).map((piece) => piece.date)).not.toContain("2026-11-10");
    expect(piecesOf(0).map((piece) => piece.date)).not.toContain("2026-11-17");
    expect(piecesOf(1)).toEqual([
      {
        date: "2026-11-18",
        startMinutes: 1080,
        endMinutes: 1170,
        start: "2026-11-19T00:00:00.000Z",
        end: "2026-11-19T01:30:00.000Z",
        eventId: 1,
        allDay: false,
        busy: true,
      },
    ]);
  });

  test("an all-day event covers its calendar date from local midnight to local midnight, never shifted by the offset", () => {
    expect(piecesOf(2)).toEqual([
      {
        date: "2026-11-03",
        startMinutes: 0,
        endMinutes: 1440,
        start: "2026-11-03T06:00:00.000Z",
        end: "2026-11-04T06:00:00.000Z",
        eventId: 2,
        allDay: true,
        busy: true,
      },
    ]);
  });

  test("a multi-day all-day event gives one piece per date, its end date exclusive", () => {
    expect(piecesOf(3).map((piece) => [piece.date, piece.startMinutes, piece.endMinutes, piece.start, piece.end])).toEqual([
      ["2026-11-26", 0, 1440, "2026-11-26T06:00:00.000Z", "2026-11-27T06:00:00.000Z"],
      ["2026-11-27", 0, 1440, "2026-11-27T06:00:00.000Z", "2026-11-28T06:00:00.000Z"],
      ["2026-11-28", 0, 1440, "2026-11-28T06:00:00.000Z", "2026-11-29T06:00:00.000Z"],
    ]);
  });

  test("an all-day event on the fall-back day is 25 hours long and still reads 0 to 1440", () => {
    expect(piecesOf(8).map((piece) => [piece.date, piece.startMinutes, piece.endMinutes, piece.start, piece.end])).toEqual([
      ["2026-11-01", 0, 1440, "2026-11-01T05:00:00.000Z", "2026-11-02T06:00:00.000Z"],
    ]);
  });

  test("an event spanning midnight splits into one piece per local day", () => {
    expect(piecesOf(4).map((piece) => [piece.date, piece.startMinutes, piece.endMinutes, piece.start, piece.end])).toEqual([
      ["2026-10-30", 1320, 1440, "2026-10-31T03:00:00.000Z", "2026-10-31T05:00:00.000Z"],
      ["2026-10-31", 0, 90, "2026-10-31T05:00:00.000Z", "2026-10-31T06:30:00.000Z"],
    ]);
  });

  test("an event ending exactly at midnight adds no empty piece", () => {
    expect(piecesOf(5).map((piece) => [piece.date, piece.startMinutes, piece.endMinutes])).toEqual([["2026-10-29", 1380, 1440]]);
  });

  test("an event across the spring-forward gap splits where the clock jumps: 01:00 to 02:00 CST, then 03:00 to 04:00 CDT", () => {
    expect(piecesOf(9).map((piece) => [piece.date, piece.startMinutes, piece.endMinutes, piece.start, piece.end])).toEqual([
      ["2027-03-14", 60, 120, "2027-03-14T07:00:00.000Z", "2027-03-14T08:00:00.000Z"],
      ["2027-03-14", 180, 240, "2027-03-14T08:00:00.000Z", "2027-03-14T09:00:00.000Z"],
    ]);
  });

  test("an event across the fall-back hour splits where the clock falls back: 00:30 to 02:00 CDT, then 01:00 to 02:30 CST", () => {
    expect(piecesOf(6).map((piece) => [piece.date, piece.startMinutes, piece.endMinutes, piece.start, piece.end])).toEqual([
      ["2026-11-01", 30, 120, "2026-11-01T05:30:00.000Z", "2026-11-01T07:00:00.000Z"],
      ["2026-11-01", 60, 150, "2026-11-01T07:00:00.000Z", "2026-11-01T08:30:00.000Z"],
    ]);
  });

  test("inside the repeated hour, 01:30 CDT to 01:15 CST is two pieces whose instants end at 07:15Z", () => {
    const pieces = piecesOf(7);
    expect(pieces.map((piece) => [piece.date, piece.startMinutes, piece.endMinutes, piece.start, piece.end])).toEqual([
      ["2026-11-01", 90, 120, "2026-11-01T06:30:00.000Z", "2026-11-01T07:00:00.000Z"],
      ["2026-11-01", 60, 75, "2026-11-01T07:00:00.000Z", "2026-11-01T07:15:00.000Z"],
    ]);
    // A commitment from 02:00 to 02:10 CST (08:00Z to 08:10Z) starts after every piece ends.
    expect(pieces.every((piece) => piece.end <= "2026-11-01T08:00:00.000Z")).toBe(true);
  });

  test("every timed piece's minutes span exactly the time between its instants", () => {
    for (const piece of feedOccurrences(campusFeed, wholeFeed, CHICAGO).filter((entry) => !entry.allDay)) {
      expect(piece.endMinutes - piece.startMinutes).toBe((Date.parse(piece.end) - Date.parse(piece.start)) / 60_000);
    }
  });

  test("pieces dated outside the range are dropped, even half of a midnight-spanning event", () => {
    expect(piecesOf(4, { first: "2026-10-01", last: "2026-10-30" }).map((piece) => piece.date)).toEqual(["2026-10-30"]);
    expect(piecesOf(4, { first: "2026-10-31", last: "2026-12-31" }).map((piece) => piece.date)).toEqual(["2026-10-31"]);
    expect(feedOccurrences(campusFeed, { first: "2026-11-05", last: "2026-11-17" }, CHICAGO)).toEqual([]);
  });

  test("a transparent event is listed but not busy; a tentative one is busy", () => {
    expect(piecesOf(10).map((piece) => piece.busy)).toEqual([false]);
    expect(piecesOf(11).map((piece) => piece.busy)).toEqual([true]);
  });

  test("an occurrence with no duration gives no piece", () => {
    expect(piecesOf(12)).toEqual([]);
  });

  test("pieces come in start order, then event order", () => {
    const pieces = feedOccurrences(campusFeed, wholeFeed, CHICAGO);
    expect(pieces.map((piece) => piece.eventId)).toEqual([0, 10, 11, 0, 5, 4, 4, 13, 8, 6, 7, 6, 7, 2, 0, 1, 3, 3, 3, 9, 9]);
    // The LAN party's second piece and the stargazing's second piece both start when the clock falls back.
    expect(pieces[11].start).toBe(pieces[12].start);
    // Halloween's all-day piece starts at the same local midnight as the second half of the social.
    expect(pieces[6].start).toBe(pieces[7].start);
  });

  test("an empty feed gives nothing", () => {
    expect(feedOccurrences({ events: [], occurrences: [] }, wholeFeed, CHICAGO)).toEqual([]);
  });

  test("bad input throws instead of guessing", () => {
    const orphan: ParsedFeed = {
      events: [],
      occurrences: [{ eventId: 99, start: "2026-10-21T00:00:00.000Z", end: "2026-10-21T01:30:00.000Z", status: "confirmed" }],
    };
    expect(feedOccurrences(campusFeed, wholeFeed, CHICAGO).length).toBeGreaterThan(0);
    expect(() => feedOccurrences(orphan, wholeFeed, CHICAGO)).toThrow();
    expect(() => feedOccurrences(campusFeed, { first: "2026-12-01", last: "2026-11-01" }, CHICAGO)).toThrow();
    expect(() => feedOccurrences(campusFeed, wholeFeed, "Central")).toThrow();
  });
});
