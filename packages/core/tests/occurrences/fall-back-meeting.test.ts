import { expect, test } from "bun:test";
import { meetingOccurrences } from "../../src/occurrences";

test("a Sunday 01:30 to 02:30 meeting splits at fall-back with exact instants", () => {
  const pieces = meetingOccurrences(
    [{ day: "Sun", startMinutes: 90, endMinutes: 150, dates: { start: null, end: null }, async: false }],
    { first: "2026-10-25", last: "2026-11-08", noClass: [] },
    "America/Chicago",
  );

  expect(pieces).toEqual([
    {
      date: "2026-10-25",
      startMinutes: 90,
      endMinutes: 150,
      start: "2026-10-25T06:30:00.000Z",
      end: "2026-10-25T07:30:00.000Z",
      meetingIndex: 0,
    },
    {
      date: "2026-11-01",
      startMinutes: 90,
      endMinutes: 120,
      start: "2026-11-01T06:30:00.000Z",
      end: "2026-11-01T07:00:00.000Z",
      meetingIndex: 0,
    },
    {
      date: "2026-11-01",
      startMinutes: 60,
      endMinutes: 150,
      start: "2026-11-01T07:00:00.000Z",
      end: "2026-11-01T08:30:00.000Z",
      meetingIndex: 0,
    },
    {
      date: "2026-11-08",
      startMinutes: 90,
      endMinutes: 150,
      start: "2026-11-08T07:30:00.000Z",
      end: "2026-11-08T08:30:00.000Z",
      meetingIndex: 0,
    },
  ]);
});
