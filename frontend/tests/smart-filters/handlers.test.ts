import { describe, expect, test } from "bun:test";
import { createTermFilterHandler } from "@/lib/smart-filters/handlers";
import type { SmartFiltersResponse } from "@/lib/smart-filters/handlers";
import type { CourseHistory, HistoryResult } from "@/lib/grades-history/types";
import type { TermSections } from "@/lib/sections/proxy";
import { courseHistory, historySection, historyTerm, identity, meeting, section } from "./helpers";

const jane = identity("Jane", "Smith");
const bob = identity("Bob", "Lee");

const s1 = section({ id: "TEST-101-001" });
const s2 = section({ id: "TEST-101-002", sectionCode: "002", seats: { open: 0, total: 30 }, status: "closed", instructor: { display: "Bob Lee", raw: "Bob Lee" } });
const s3 = section({
  id: "TEST-202-001",
  courseCode: "TEST 202",
  online: true,
  meetings: [meeting({ kind: "online", day: null, startMinutes: null, endMinutes: null })],
});

const okTerm: TermSections = {
  status: "ok",
  checkedAt: "2026-10-14T12:00:00Z",
  provenance: { kind: "real", source: "vsb.untgrades.app", updatedAt: "2026-10-14T12:00:00Z", note: "" },
  diagnostic: null,
  courses: [
    { courseCode: "TEST 101", sections: [s1, s2] },
    { courseCode: "TEST 202", sections: [s3] },
  ],
};

const history101 = courseHistory("TEST 101", [
  historyTerm("2025", "spring", [
    historySection("1001", jane, { A: 3, B: 1 }),
    historySection("1002", jane, { B: 2, C: 2 }),
    historySection("1003", jane, { A: 1, B: 1, C: 1, D: 1 }),
    historySection("1004", jane, { A: 2, B: 2 }),
    historySection("1005", bob, { A: 1, B: 1 }),
    historySection("1006", bob, { A: 1 }),
    historySection("1007", bob, { B: 1 }),
  ]),
]);

const ok101: HistoryResult<CourseHistory> = { status: "ok", source: "untgrades.app", data: history101 };
const none202: HistoryResult<CourseHistory> = { status: "no-history", source: "untgrades.app", data: null };

type HistoryRecord = Record<string, HistoryResult<CourseHistory>>;

function deps(record: HistoryRecord, calls: string[], termSections: TermSections = okTerm, maxCourseHistory?: number) {
  return {
    termSections: async (term: string) => {
      calls.push(`sections:${term}`);
      return termSections;
    },
    courseHistory: async (subject: string, number: string) => {
      const code = `${subject} ${number}`;
      calls.push(`history:${code}`);
      const result = record[code];
      if (!result) throw new Error(`unexpected history read for ${code}`);
      return result;
    },
    ...(maxCourseHistory === undefined ? {} : { maxCourseHistory }),
  };
}

const url = "https://app.test/api/terms/spring-2027/smart-filters";

describe("createTermFilterHandler", () => {
  test("with no filters every section appears with joined grade facts", async () => {
    const calls: string[] = [];
    const handler = createTermFilterHandler(deps({ "TEST 101": ok101, "TEST 202": none202 }, calls));
    const response = await handler(new Request(url), "spring-2027");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as SmartFiltersResponse;
    expect(body.term).toBe("spring-2027");
    expect(body.results.map((row) => row.sectionId)).toEqual([s1.id, s2.id, s3.id]);
    expect(body.filters).toEqual([]);
    expect(body.courseHistory).toEqual({ total: 2, attempted: 2 });
    // Each distinct course's history is read once, in first-appearance order.
    expect(calls).toEqual(["sections:spring-2027", "history:TEST 101", "history:TEST 202"]);
    expect(body.results[0]?.gradeFacts).toEqual({
      kind: "matched",
      instructorId: jane.id,
      gradedSections: 4,
      gradedEnrollments: 16,
      avgGpa: 3.06,
      abShare: 0.75,
    });
    expect(body.results[1]?.gradeFacts).toEqual({
      kind: "matched",
      instructorId: bob.id,
      gradedSections: 3,
      gradedEnrollments: 4,
      avgGpa: 3.5,
      abShare: 1,
    });
    expect(body.results[2]?.gradeFacts).toEqual({ kind: "no-history", reason: "the course has no grade history" });
    expect(body.results[0]?.sectionFacts.days).toEqual(["Tue"]);
    expect(body.results[0]?.seats).toEqual({ open: 10, total: 30 });
  });

  test("filters select the sections that pass", async () => {
    const handler = createTermFilterHandler(deps({ "TEST 101": ok101, "TEST 202": none202 }, []));
    const response = await handler(new Request(`${url}?minSeats=1`), "spring-2027");
    const body = (await response.json()) as SmartFiltersResponse;
    expect(body.filters).toEqual([{ kind: "open-seats", minimum: 1 }]);
    expect(body.results.map((row) => row.sectionId)).toEqual([s1.id, s3.id]);
  });

  test("unavailable history is reported per section, not hidden", async () => {
    const throttled: HistoryResult<CourseHistory> = {
      status: "unavailable",
      source: "untgrades.app",
      data: null,
      error: { reason: "throttled", message: "slow down", retryAfterSeconds: 30 },
    };
    const handler = createTermFilterHandler(deps({ "TEST 101": throttled, "TEST 202": none202 }, []));
    const response = await handler(new Request(url), "spring-2027");
    const body = (await response.json()) as SmartFiltersResponse;
    expect(body.results[0]?.gradeFacts).toEqual({ kind: "unavailable", reason: "throttled", message: "slow down", retryAfterSeconds: 30 });
  });

  test("courses beyond the per-request cap are reported as not attempted", async () => {
    const handler = createTermFilterHandler(deps({ "TEST 101": ok101, "TEST 202": none202 }, [], okTerm, 1));
    const response = await handler(new Request(url), "spring-2027");
    const body = (await response.json()) as SmartFiltersResponse;
    expect(body.courseHistory).toEqual({ total: 2, attempted: 1 });
    expect(body.results[0]?.gradeFacts).toMatchObject({ kind: "matched" });
    expect(body.results[2]?.gradeFacts).toMatchObject({ kind: "unavailable", reason: "not-attempted" });
  });

  test("a stale term source still answers 200 with its status echoed", async () => {
    const stale: TermSections = { ...okTerm, status: "stale" };
    const handler = createTermFilterHandler(deps({ "TEST 101": ok101, "TEST 202": none202 }, [], stale));
    const response = await handler(new Request(url), "spring-2027");
    expect(response.status).toBe(200);
    const body = (await response.json()) as SmartFiltersResponse;
    expect(body.sectionsSource.status).toBe("stale");
  });

  test("malformed terms are 400, unsupported terms 404, bad filters 400, a down source 503", async () => {
    const handler = createTermFilterHandler(deps({}, []));
    expect((await handler(new Request("https://app.test/api/terms/fall-20x5/smart-filters"), "fall-20x5")).status).toBe(400);
    expect((await handler(new Request("https://app.test/api/terms/summer-2020/smart-filters"), "summer-2020")).status).toBe(404);
    expect((await handler(new Request(`${url}?minSeats=lots`), "spring-2027")).status).toBe(400);
    const down: TermSections = { status: "unavailable", diagnostic: { code: "upstream_error", message: "vsb is down" } };
    const broken = createTermFilterHandler(deps({}, [], down));
    expect((await broken(new Request(url), "spring-2027")).status).toBe(503);
  });
});
