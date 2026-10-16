import { describe, expect, test } from "bun:test";
import { revealRow, visibleRows } from "@/components/schedule-builder/virtual-rows";

const at = (scrollTop: number, extra: Partial<Parameters<typeof visibleRows>[0]> = {}) =>
  visibleRows({ scrollTop, viewport: 400, listTop: 0, rowHeight: 100, count: 500, overscan: 2, ...extra });

describe("visibleRows", () => {
  test("the rows in view, widened by the overscan and clamped at the top", () => {
    expect(at(0)).toEqual({ first: 0, last: 6 });
    expect(at(1000)).toEqual({ first: 8, last: 16 });
    // A partly shown row at each edge counts.
    expect(at(1050)).toEqual({ first: 8, last: 17 });
  });

  test("clamped at the bottom", () => {
    expect(at(49_600)).toEqual({ first: 494, last: 500 });
    expect(at(60_000)).toEqual({ first: 500, last: 500 });
  });

  test("the list's own offset in the scroller is subtracted", () => {
    expect(at(150, { listTop: 150 })).toEqual(at(0));
    // Scrolled above the list: only its first rows can show.
    expect(at(0, { listTop: 300 })).toEqual({ first: 0, last: 3 });
  });

  test("nothing to render for an empty list or a zero height", () => {
    expect(at(0, { count: 0 })).toEqual({ first: 0, last: 0 });
    expect(at(0, { rowHeight: 0 })).toEqual({ first: 0, last: 0 });
  });
});

describe("revealRow", () => {
  const base = { scrollTop: 1000, viewport: 400, listTop: 40, rowHeight: 100 };
  test("a row in view needs no scroll", () => {
    expect(revealRow({ ...base, index: 10 })).toBeNull();
    expect(revealRow({ ...base, index: 12 })).toBeNull();
  });
  test("a row above aligns its top; a row below aligns its bottom", () => {
    expect(revealRow({ ...base, index: 9 })).toBe(940);
    expect(revealRow({ ...base, index: 13 })).toBe(1040);
    expect(revealRow({ ...base, index: 20 })).toBe(1740);
  });
  test("a row taller than the view aligns its top", () => {
    expect(revealRow({ ...base, viewport: 50, index: 13 })).toBe(1340);
  });
});
