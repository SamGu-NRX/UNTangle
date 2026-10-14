import { describe, expect, test } from "bun:test";
import { dayHero, isTight, leaveBy, type HeroClass } from "@/lib/leave-by";

const at = (hours: number, minutes = 0) => hours * 60 + minutes;

// The mockup's Monday: a 9-minute walk from the starting point, then 4 and 8 minutes between classes.
const monday: HeroClass[] = [
  { start: at(9), end: at(9, 50), walkMin: 9 },
  { start: at(10), end: at(10, 50), walkMin: 4 },
  { start: at(11), end: at(11, 50), walkMin: 8 },
];

describe("leaveBy", () => {
  test("start minus the walk minus the two-minute buffer, exactly", () => {
    expect(leaveBy(at(9), 9)).toBe(at(8, 49));
    expect(leaveBy(at(9), 9, 0)).toBe(at(8, 51));
    expect(leaveBy(at(0, 5), 9)).toBe(-6);
  });

  test("refuses fractional or negative minutes", () => {
    expect(() => leaveBy(9 + 0.5, 9)).toThrow(RangeError);
    expect(() => leaveBy(at(9), 8.999)).toThrow(RangeError);
    expect(() => leaveBy(at(9), -1)).toThrow(RangeError);
  });
});

describe("isTight", () => {
  test("leaving when the previous class ends is tight; a minute later is not", () => {
    expect(isTight(at(10, 50), at(10, 50))).toBe(true);
    expect(isTight(at(10, 49), at(10, 50))).toBe(true);
    expect(isTight(at(10, 51), at(10, 50))).toBe(false);
  });
});

describe("dayHero", () => {
  test("before the first class: leave the starting point at 8:49, in 12 minutes", () => {
    expect(dayHero(monday, at(8, 37))).toEqual({ kind: "leave", index: 0, leave: at(8, 49), minutesUntil: 12, tight: false });
  });

  test("within a minute of leaving, or past it, says leave now", () => {
    expect(dayHero(monday, at(8, 47))).toEqual({ kind: "leave", index: 0, leave: at(8, 49), minutesUntil: 2, tight: false });
    expect(dayHero(monday, at(8, 48))).toEqual({ kind: "leave-now", index: 0, tight: false });
    expect(dayHero(monday, at(8, 49))).toEqual({ kind: "leave-now", index: 0, tight: false });
    expect(dayHero(monday, at(8, 55))).toEqual({ kind: "leave-now", index: 0, tight: false });
  });

  test("between classes: the next class's leave time, from the room you're in", () => {
    expect(dayHero(monday, at(9, 30))).toEqual({ kind: "leave", index: 1, leave: at(9, 54), minutesUntil: 24, tight: false });
  });

  test("tight: leave right as the previous class ends", () => {
    expect(dayHero(monday, at(10, 20))).toEqual({ kind: "leave", index: 2, leave: at(10, 50), minutesUntil: 30, tight: true });
  });

  test("late: a walk longer than the break still leaves at the previous end, flagged", () => {
    const late = [monday[0], { start: at(10), end: at(10, 50), walkMin: 12 }];
    expect(dayHero(late, at(9, 30))).toEqual({ kind: "leave", index: 1, leave: at(9, 50), minutesUntil: 20, tight: true });
  });

  test("after the last class starts it's the last one; once it ends the day is done", () => {
    expect(dayHero(monday, at(11, 30))).toEqual({ kind: "last-class", index: 2 });
    expect(dayHero(monday, at(11, 50))).toEqual({ kind: "done" });
    expect(dayHero(monday, at(23, 59))).toEqual({ kind: "done" });
  });

  test("a class that starts before the previous one ends has no departure time", () => {
    const overlap = [
      { start: at(9), end: at(12), walkMin: 5 },
      { start: at(10), end: at(10, 50), walkMin: 4 },
    ];
    expect(dayHero(overlap, at(9, 30))).toEqual({ kind: "overlap", index: 1 });
  });

  test("the same building needs no departure: the hero names the class", () => {
    const sameBuilding = [monday[0], { start: at(10), end: at(10, 50), walkMin: 0 }];
    expect(dayHero(sameBuilding, at(9, 30))).toEqual({ kind: "next-class", index: 1, minutesUntil: 30 });
  });

  test("overlapping classes: the day isn't done while the longer one runs", () => {
    const overlap = [
      { start: at(9), end: at(12), walkMin: 5 },
      { start: at(10), end: at(10, 50), walkMin: 0 },
    ];
    expect(dayHero(overlap, at(11))).toEqual({ kind: "last-class", index: 0 });
    expect(dayHero(overlap, at(12))).toEqual({ kind: "done" });
  });

  test("no classes", () => {
    expect(dayHero([], at(9))).toEqual({ kind: "no-classes" });
    expect(dayHero([], null)).toEqual({ kind: "no-classes" });
  });

  test("another day answers for its first class, with no countdown", () => {
    expect(dayHero(monday, null)).toEqual({ kind: "leave", index: 0, leave: at(8, 49), minutesUntil: null, tight: false });
  });

  test("an unknown walk time names the class instead of a leave time", () => {
    const unknown = [{ ...monday[0], walkMin: null }, monday[1]];
    expect(dayHero(unknown, at(8, 30))).toEqual({ kind: "next-class", index: 0, minutesUntil: 30 });
    expect(dayHero(unknown, null)).toEqual({ kind: "next-class", index: 0, minutesUntil: null });
  });

  test("refuses a fractional now", () => {
    expect(() => dayHero(monday, 8.6)).toThrow(RangeError);
  });
});
