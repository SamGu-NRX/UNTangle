import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import type { OptimizeRequest, OptSection } from "@/lib/optimizer/types";
import { scheduleReasons } from "@/lib/reasons";

const optionName = (index: number) => `option ${index + 1}`;
const weights = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
const section = (id: string, courseCode: string, day: "Mon" | "Tue" | "Wed", exam: OptSection["exam"]): OptSection => ({
  id,
  courseCode,
  rating: null,
  meetings: [{ day, start: 540, end: 590, buildingId: null }],
  exam,
});
const request = (sections: OptSection[]): OptimizeRequest => ({
  courses: sections.map((s) => ({ code: s.courseCode, credits: 3, sections: [s] })),
  locks: {},
  excluded: [],
  constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null },
  weights,
  walkingTime: () => ({ seconds: null, source: "unknown" }),
});
const finalsLines = (req: OptimizeRequest) => {
  const result = optimize(req);
  if (result.status !== "optimal") throw new Error(result.status);
  return scheduleReasons({ alternatives: result.schedules, index: 0, request: req, optionName }).filter((reason) => reason.kind === "finals");
};
const MON = { date: "2027-05-03", start: 480, end: 600 };

describe("the unchecked-finals line", () => {
  test("names each chosen course whose final isn't known, with the count as evidence", () => {
    const [line] = finalsLines(request([section("a", "CSCE 2110", "Mon", MON), section("b", "MATH 1710", "Tue", null), section("c", "ENGL 1310", "Wed", undefined)]));
    expect(line.sentence).toBe("Finals for MATH 1710 and ENGL 1310 aren't known, so they weren't checked for clashes.");
    expect(line.evidence.numbers[0]).toEqual({ label: "courses without a known final", value: 2 });
  });

  test("one course reads as one", () => {
    expect(finalsLines(request([section("a", "CSCE 2110", "Mon", MON), section("b", "MATH 1710", "Tue", null)]))[0].sentence).toBe(
      "MATH 1710's final isn't known, so it wasn't checked for a clash.",
    );
  });

  test("says nothing when every final is known, or when the request carries no finals at all", () => {
    expect(finalsLines(request([section("a", "CSCE 2110", "Mon", MON), section("b", "MATH 1710", "Tue", { ...MON, date: "2027-05-04" })]))).toEqual([]);
    expect(finalsLines(request([section("a", "CSCE 2110", "Mon", null), section("b", "MATH 1710", "Tue", null)]))).toEqual([]);
  });
});
