import { expect, test } from "bun:test";
import { meetingOccurrences } from "../../src/occurrences";

test("a Sunday 01:00 to 04:00 meeting splits at spring-forward with exact instants", () => {
  const pieces = meetingOccurrences(
    [{ day: "Sun", startMinutes: 60, endMinutes: 240, dates: { start: null, end: null }, async: false }],
    { first: "2027-03-14", last: "2027-03-14", noClass: [] },
    "America/Chicago",
  );

  expect(pieces).toEqual([
    {
      date: "2027-03-14",
      startMinutes: 60,
      endMinutes: 120,
      start: "2027-03-14T07:00:00.000Z",
      end: "2027-03-14T08:00:00.000Z",
      meetingIndex: 0,
    },
    {
      date: "2027-03-14",
      startMinutes: 180,
      endMinutes: 240,
      start: "2027-03-14T08:00:00.000Z",
      end: "2027-03-14T09:00:00.000Z",
      meetingIndex: 0,
    },
  ]);
});
