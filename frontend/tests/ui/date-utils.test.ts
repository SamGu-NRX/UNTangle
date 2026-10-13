import { describe, expect, test } from "bun:test";
import {
  addDays,
  addMonths,
  formatDate,
  makeDate,
  monthGrid,
  parseDateText,
  weekday,
} from "@/components/ui/date-utils";

describe("parseDateText", () => {
  const cases: Array<[string, string | null]> = [
    ["1/20/27", "2027-01-20"],
    ["01/20/2027", "2027-01-20"],
    ["1-20-2027", "2027-01-20"],
    ["2027-01-20", "2027-01-20"],
    ["Jan 20, 2027", "2027-01-20"],
    ["january 20 2027", "2027-01-20"],
    ["Sept 3 2027", "2027-09-03"],
    ["20 Jan 2027", "2027-01-20"],
    ["Jan 20th", "2026-01-20"],
    ["1/20", "2026-01-20"],
    ["  Jan   20 ,  2027 ", "2027-01-20"],
    ["2/30/27", null],
    ["13/1/27", null],
    ["Janx 20 2027", null],
    ["ja 20 2027", null],
    ["tomorrow", null],
    ["", null],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(parseDateText(input, 2026)).toBe(expected);
    });
  }
});

describe("calendar arithmetic", () => {
  test("makeDate rejects days that do not exist", () => {
    expect(makeDate(2027, 2, 29)).toBeNull();
    expect(makeDate(2028, 2, 29)).toBe("2028-02-29");
    expect(makeDate(2027, 0, 1)).toBeNull();
  });

  test("addDays crosses months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  test("addDays is unaffected by daylight-saving changes", () => {
    // US DST starts 2027-03-14; civil-day arithmetic must not skip or repeat.
    expect(addDays("2027-03-13", 1)).toBe("2027-03-14");
    expect(addDays("2027-03-14", 1)).toBe("2027-03-15");
  });

  test("addMonths clamps to the last day of the target month", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2027-01-15", -1)).toBe("2026-12-15");
    expect(addMonths("2027-05-07", 12)).toBe("2028-05-07");
  });

  test("weekday and formatDate", () => {
    expect(weekday("2027-01-20")).toBe(3);
    expect(formatDate("2027-01-20")).toBe("Jan 20, 2027");
  });
});

describe("monthGrid", () => {
  test("January 2027 starts on the Sunday before the 1st and always has 42 days", () => {
    const grid = monthGrid(2027, 1);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ iso: "2026-12-27", inMonth: false });
    expect(grid[5]).toEqual({ iso: "2027-01-01", inMonth: true });
    expect(grid.filter((d) => d.inMonth)).toHaveLength(31);
    expect(grid[41]).toEqual({ iso: "2027-02-06", inMonth: false });
  });

  test("a month starting on Sunday has no leading days", () => {
    expect(monthGrid(2026, 2)[0]).toEqual({ iso: "2026-02-01", inMonth: true });
  });
});
