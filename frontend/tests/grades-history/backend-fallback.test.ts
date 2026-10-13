import { afterEach, expect, test } from "bun:test";
import { toGradeData } from "@/lib/grades-history/normalize";
import { getCourseGradeDetail } from "@/lib/backend-api";
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

test("a frontend history envelope is skipped before accepting a legacy backend detail", async () => {
  const detail = { aggregate: { gpa: 3, grades: toGradeData({ B: 4 }) }, course: { id: 1, credits: 3, description: null, title: "Computer Science I", subject: "CSCE", number: "1030" }, sections: [], instructors: [], terms: [] };
  let requests = 0;
  globalThis.fetch = Object.assign(async () => Response.json(++requests === 1
    ? { status: "ok", source: "untgrades.app", data: { gpa: 3 } }
    : detail), { preconnect: original.preconnect });
  expect(await getCourseGradeDetail("CSCE", "1030")).toEqual(detail);
  expect(requests).toBe(2);
});
