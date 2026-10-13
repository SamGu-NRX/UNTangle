import { expect, test } from "bun:test";
import { PrepareBudgetExhausted } from "@/lib/optimizer/prepare";
import { weekSegments } from "@/lib/optimizer/weeks";
import { OPT_DAYS, type OptMeeting } from "@/lib/optimizer/types";
import { FULL_TERM } from "./generator";

const meeting = (day: OptMeeting["day"], start: string, end: string): OptMeeting => ({
  day, dates: { start, end }, start: 540, end: 590, buildingId: "X",
});

const disjoint = (count: number) => Array.from({ length: count }, (_, i) => {
  const date = new Date(Date.UTC(2027, 0, 12 + i * 7)).toISOString().slice(0, 10);
  return meeting("Tue", date, date);
});

test("all 32 segment bits work, including the sign bit; the next pattern is rejected", () => {
  const meetings = disjoint(32);
  const segments = weekSegments(meetings, FULL_TERM);
  expect(segments.count).toBe(32);
  expect(segments.maskOf(meetings[31])).toBe(-2147483648);
  for (let i = 0; i < meetings.length; i += 1) {
    for (let j = 0; j < meetings.length; j += 1) {
      expect((segments.maskOf(meetings[i]) & segments.maskOf(meetings[j])) !== 0).toBe(i === j);
    }
  }
  expect(() => weekSegments(disjoint(33), FULL_TERM)).toThrow(/33 distinct stretches/);
});

test("segmentation checks the deadline during collection and during the event sweep", () => {
  const meetings = disjoint(10_000);
  let collected = false;
  function* input() {
    yield* meetings;
    collected = true;
  }
  let checks = 0;
  expect(() => weekSegments(input(), FULL_TERM, () => {
    checks += 1;
    if (collected) throw new PrepareBudgetExhausted();
  })).toThrow(PrepareBudgetExhausted);
  expect(checks).toBeGreaterThan(1);
  expect(collected).toBe(true);

  let consumed = 0;
  function* bounded() {
    for (const m of meetings) {
      consumed += 1;
      yield m;
    }
  }
  expect(() => weekSegments(bounded(), FULL_TERM, () => { throw new PrepareBudgetExhausted(); }))
    .toThrow(PrepareBudgetExhausted);
  expect(consumed).toBe(1);

  let sweepChecks = 0;
  expect(() => weekSegments(disjoint(32), FULL_TERM, () => {
    if (++sweepChecks === 20) throw new PrepareBudgetExhausted();
  })).toThrow(PrepareBudgetExhausted);
  expect(sweepChecks).toBe(20);
});

test("mask intersections match enumerated weekday dates, including ranges before the epoch", () => {
  for (const year of [1969, 2027]) {
    const date = (offset: number) => new Date(Date.UTC(year, 0, 11 + offset)).toISOString().slice(0, 10);
    for (const day of OPT_DAYS) {
      for (let a = 0; a < 10; a += 1) {
        for (let b = 0; b < 10; b += 1) {
          const x = meeting(day, date(a), date(a + 3));
          const y = meeting(day, date(b), date(b + 5));
          const segments = weekSegments([x, y], { start: date(0), end: date(20) });
          let shared = false;
          for (let offset = Math.max(a, b); offset <= Math.min(a + 3, b + 5); offset += 1) {
            const weekday = new Date(`${date(offset)}T00:00:00Z`).getUTCDay();
            if ((weekday + 6) % 7 === OPT_DAYS.indexOf(day)) shared = true;
          }
          expect((segments.maskOf(x) & segments.maskOf(y)) !== 0).toBe(shared);
        }
      }
    }
  }
});
