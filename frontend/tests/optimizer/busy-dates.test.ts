/**
 * Dated blocked times: calendar busy time enters the optimizer as a blocked
 * time with real date ranges. A dated block only excludes meetings whose
 * weeks overlap the range; weekly blocks behave exactly as before.
 */

import { describe, expect, test } from "bun:test";

import { optimize } from "@/lib/optimizer/optimize";
import { OptimizerInputError, type OptBlockedTime, type OptimizeRequest, type OptMeeting } from "@/lib/optimizer/types";
import { toPlainRequest, fromPlainRequest } from "@/lib/optimizer/worker/protocol";
import { FIRST_HALF, FULL_TERM, SECOND_HALF } from "./generator";

const zero = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
const none = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [] as OptBlockedTime[], maxCredits: null, walking: null };

const request = (meetings: OptMeeting[][], blocked: OptBlockedTime[] = [], overrides: Partial<OptimizeRequest> = {}): OptimizeRequest => ({
  term: FULL_TERM,
  courses: [
    {
      code: "SPAN 2040",
      credits: 3,
      sections: meetings.map((m, i) => ({ id: `s${i}`, courseCode: "SPAN 2040", rating: 4, meetings: m })),
    },
  ],
  locks: {},
  excluded: [],
  constraints: { ...none, blocked },
  weights: zero,
  walkingTime: () => ({ seconds: 60, source: "campus-network" }),
  ...overrides,
});

const slot = (dates: OptMeeting["dates"], start = 570, end = 680): OptMeeting[] => [
  { day: "Tue", start, end, buildingId: "LANG", dates },
];

/** One Tuesday 09:00-12:00 commitment on 2027-02-09, a real dated busy window. */
const tuesdayBusy: OptBlockedTime = {
  id: "cal-0-1",
  label: "Calendar busy",
  day: "Tue",
  start: 540,
  end: 720,
  dates: [{ start: "2027-02-09", end: "2027-02-09" }],
};

describe("dated blocked times", () => {
  test("a dated block excludes only the weeks it covers; the other section wins", () => {
    const result = optimize(request([slot(null), slot(null, 780, 870)], [tuesdayBusy]));
    expect(result.schedules.map((s) => s.byCourse["SPAN 2040"])).toEqual(["s1"]);
  });

  test("a section meeting only in the first half ignores a block dated in the second half", () => {
    const secondHalfBusy: OptBlockedTime = {
      id: "cal-0-2",
      label: "Calendar busy",
      day: "Tue",
      start: 540,
      end: 720,
      dates: [SECOND_HALF],
    };
    const result = optimize(request([slot(FIRST_HALF)], [secondHalfBusy]));
    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    expect(result.schedules.map((s) => s.byCourse["SPAN 2040"])).toEqual(["s0"]);
  });

  test("an undated meeting inside a dated term is blocked by any dated range over its weekday", () => {
    // The meeting runs every week, so the one dated window hits it.
    const result = optimize(request([slot(null)], [tuesdayBusy]));
    expect(result.status).toBe("infeasible");
  });

  test("a weekly block behaves exactly as before", () => {
    const weekly: OptBlockedTime = { id: "job", label: "Work shift", day: "Tue", start: 540, end: 720 };
    const result = optimize(request([slot(null)], [weekly]));
    expect(result.status).toBe("infeasible");
  });

  test("an infeasible dated block is offered as a relaxation under its own label", () => {
    const result = optimize(request([slot(null)], [tuesdayBusy]));
    expect(result.status).toBe("infeasible");
    if (result.status !== "infeasible") return;
    expect(result.explanation.suggestions.map((s) => s.label)).toContain("Allow classes during Calendar busy");
  });

  test("blocked-time dates are validated like every other date range", () => {
    for (const dates of [
      [{ start: "2027-1-09", end: "2027-02-09" }],
      [{ start: "2027-02-09", end: "2027-02-08" }],
      [{ start: "2027-02-30", end: "2027-02-30" }],
      "2027-02-09",
    ]) {
      expect(() => optimize(request([slot(null)], [{ ...tuesdayBusy, dates: dates as OptBlockedTime["dates"] }])))
        .toThrow(OptimizerInputError);
    }
    // Absent, null and empty dates mean every week.
    for (const dates of [undefined, null, []]) {
      expect(optimize(request([slot(null, 780, 870)], [{ ...tuesdayBusy, dates }])).status).toBe("optimal");
    }
  });

  test("dated blocked times survive the worker protocol round trip", () => {
    const plain = toPlainRequest(request([slot(null)], [tuesdayBusy]));
    const back = fromPlainRequest(plain, 1000);
    expect(back.constraints.blocked).toEqual([tuesdayBusy]);
  });
});

describe("acceptance: a work shift holds the slot only in its own weeks", () => {
  const addDays = (date: string, days: number): string =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  // Week n begins term start + (n-1)*7 days; weeks a to b span term start
  // + (a-1)*7 through term start + b*7 - 1.
  const weeks = (from: number, to: number) => ({
    start: addDays(FULL_TERM.start, (from - 1) * 7),
    end: addDays(FULL_TERM.start, to * 7 - 1),
  });
  // The shift: Tuesdays 14:00-18:00, weeks 1 to 8 only.
  const shift: OptBlockedTime = {
    id: "cal-0",
    label: "Calendar busy",
    day: "Tue",
    start: 840,
    end: 1080,
    dates: [weeks(1, 8)],
  };

  test("auto avoids the blocked slot in weeks 1 to 8 and takes the free section", () => {
    const result = optimize(request([slot(weeks(1, 8), 840, 1080), slot(weeks(9, 16), 780, 870)], [shift]));
    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    expect(result.schedules.map((s) => s.byCourse["SPAN 2040"])).toEqual(["s1"]);
  });

  test("a section meeting the blocked slot only in weeks 9 to 16 stays eligible", () => {
    const result = optimize(request([slot(weeks(9, 16), 840, 1080)], [shift]));
    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    expect(result.schedules.map((s) => s.byCourse["SPAN 2040"])).toEqual(["s0"]);
  });
});
