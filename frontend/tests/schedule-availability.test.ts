import { describe, expect, test } from "bun:test";
import { ScheduleBodySchema } from "../../packages/contracts/src/documents";
import { checkCourseAvailability, checkScheduleAvailability, seatAvailability } from "@/lib/schedule-availability";
import type { RealCourseSections } from "@/lib/sections/model";
import { SectionsProxy } from "@/lib/sections/proxy";
import fixture from "./sections/fixtures/spring-2027.json";
import { schedule } from "./document-sync/fixtures";

const courseCode = "MATH 1680";
const selectedId = "vsb:spring-2027:MATH 1680:6862+6863";
const planned = ScheduleBodySchema.parse({ ...schedule, courses: [courseCode], selectedSections: { [courseCode]: selectedId } });

async function realCourse(): Promise<RealCourseSections> {
  const proxy = new SectionsProxy({
    now: () => Date.parse("2026-10-22T06:00:00Z"),
    fetcher: async (url) => url.endsWith("/spring-2027.json") ? Response.json(fixture) : new Response(null, { status: 404 }),
  });
  const result = await proxy.getCourseSections("spring-2027", courseCode);
  if (result.status === "unavailable") throw new Error("Fixture must contain real course data.");
  return result;
}

describe("saved choice availability", () => {
  test("returns the exact saved choice, linked seats, and both source timestamps", async () => {
    const result = await realCourse();
    expect(checkCourseAvailability(courseCode, selectedId, result)).toEqual({
      courseCode, selectedSectionId: selectedId, state: "open",
      evidence: { checkedAt: "2026-10-22T06:00:00.000Z", provenance: {
        kind: "real", source: "vsb.untgrades.app", updatedAt: fixture.updated_at, note: fixture.note,
      } },
      section: { id: selectedId, sectionCode: "110 + 111", classNumbers: ["6862", "6863"], status: "open", seats: "open", components: [
        { classNumber: "6862", sectionCode: "110", role: "primary", seats: { open: 99, total: 99 } },
        { classNumber: "6863", sectionCode: "111", role: "required-linked", seats: { open: 33, total: 33 } },
      ] },
    });
  });

  test.each(["closed", "waitlist", "cancelled", "unknown"] as const)("preserves %s even with positive seat counts", async (status) => {
    const section = (await realCourse()).sections[0];
    expect(seatAvailability({ ...section, status })).toBe(status);
  });

  test("a full required component blocks an otherwise open choice", async () => {
    const section = (await realCourse()).sections[0];
    section.components[1].seats.open = 0;
    expect(seatAvailability(section)).toBe("full");
    section.components[1].seats.open = 1;
    expect(seatAvailability(section)).toBe("open");
    section.seats.open = 0;
    expect(seatAvailability(section)).toBe("full");
  });

  test("unknown seats do not become a positive result, and known fullness wins", async () => {
    const section = (await realCourse()).sections[0];
    section.components[1].seats.open = null;
    expect(seatAvailability(section)).toBe("unknown");
    section.components[0].seats.open = 0;
    expect(seatAvailability(section)).toBe("full");
    expect(seatAvailability({ ...section, components: [] })).toBe("unknown");
    expect(seatAvailability({ ...(await realCourse()).sections[0], seats: { open: null, total: 99 } })).toBe("unknown");
  });

  test("does not replace a missing choice by another with the same section label", async () => {
    const result = await realCourse();
    result.sections[0].id = "vsb:spring-2027:MATH 1680:6862+9999";
    expect(checkCourseAvailability(courseCode, selectedId, result)).toMatchObject({ state: "missing", section: null });
    result.sections[0].id = selectedId;
    expect(checkCourseAvailability(courseCode, selectedId, result)).toMatchObject({ state: "open", section: { id: selectedId } });
  });

  test("stale evidence claims neither current seats nor current removal", async () => {
    const result = await realCourse();
    const stale = { ...result, status: "stale" as const };
    expect(checkCourseAvailability(courseCode, selectedId, stale)).toMatchObject({ state: "stale", section: { seats: "open" } });
    expect(checkCourseAvailability(courseCode, "gone", stale)).toMatchObject({ state: "stale", section: null });
    expect(checkCourseAvailability(courseCode, "gone", { ...result, availability: "no_classes", sections: [] })).toMatchObject({ state: "missing", section: null });
  });

  test("synthetic options and outages cannot confirm real availability", async () => {
    const result = await realCourse();
    const sample = { term: "spring-2027", courseCode, status: "unavailable" as const, availability: "sample" as const,
      provenance: { kind: "sample" as const, source: "bundled", note: "Synthetic" }, diagnostic: null, sections: result.sections };
    expect(checkCourseAvailability(courseCode, selectedId, sample)).toMatchObject({ state: "sample", evidence: null, section: null });
    expect(checkCourseAvailability(courseCode, "gone", sample)).toMatchObject({ state: "unavailable", evidence: null, section: null });
  });
});

describe("whole schedule availability", () => {
  test("an empty schedule is not a successful open-seat check", async () => {
    const read = async () => realCourse();
    expect(await checkScheduleAvailability(ScheduleBodySchema.parse(schedule), read)).toEqual({ summary: "empty", courses: [] });
    expect(await checkScheduleAvailability(planned, read)).toMatchObject({ summary: "open", courses: [{ state: "open" }] });
  });

  test("unselected and malformed course codes need no section source", async () => {
    const value = ScheduleBodySchema.parse({ ...schedule, courses: [courseCode, "C S 312"], selectedSections: { "C S 312": "pick" } });
    let reads = 0;
    const result = await checkScheduleAvailability(value, async () => { reads++; return realCourse(); });
    expect(result).toEqual({ summary: "needs-attention", courses: [
      { courseCode, selectedSectionId: null, state: "unselected", evidence: null, section: null },
      { courseCode: "C S 312", selectedSectionId: "pick", state: "unsupported-course", evidence: null, section: null },
    ] });
    expect(reads).toBe(0);
  });

  test("an individual failure preserves the other course's result and never mutates picks", async () => {
    const value = ScheduleBodySchema.parse({ ...planned, courses: [courseCode, "ACCT 5120"], selectedSections: { ...planned.selectedSections, "ACCT 5120": "accounting-pick" } });
    const before = structuredClone(value);
    const result = await checkScheduleAvailability(value, async (_term, code) => {
      if (code === "ACCT 5120") throw new Error("private upstream details");
      return realCourse();
    });
    expect(result).toMatchObject({ summary: "unknown", courses: [{ state: "open" }, { state: "unavailable", evidence: null }] });
    expect(JSON.stringify(result)).not.toContain("private upstream details");
    expect(value).toEqual(before);
  });

  test.each(["courseCode", "term"] as const)("rejects evidence with a mismatched %s", async (field) => {
    const result = await checkScheduleAvailability(planned, async () => ({ ...await realCourse(), [field]: "wrong" }));
    expect(result).toMatchObject({ summary: "unknown", courses: [{ state: "unavailable", evidence: null, section: null }] });
  });

  test("a known blocker wins over another course's unknown availability", async () => {
    const value = ScheduleBodySchema.parse({ ...planned, courses: [courseCode, "ACCT 5120"], selectedSections: { ...planned.selectedSections, "ACCT 5120": "pick" } });
    const result = await checkScheduleAvailability(value, async (_term, code) => {
      if (code === "ACCT 5120") throw new Error("outage");
      const data = await realCourse();
      data.sections[0].components[1].seats.open = 0;
      return data;
    });
    expect(result).toMatchObject({ summary: "needs-attention", courses: [{ state: "full" }, { state: "unavailable" }] });
  });

  test("an aborted wait retains finished evidence and starts no further reads", async () => {
    const value = ScheduleBodySchema.parse({ ...planned, courses: [courseCode, "ACCT 5120", "BCIS 4740"],
      selectedSections: { ...planned.selectedSections, "ACCT 5120": "pick-acct", "BCIS 4740": "pick-bcis" } });
    const controller = new AbortController();
    const waiting = Promise.withResolvers<void>();
    const upstream = Promise.withResolvers<Awaited<ReturnType<typeof realCourse>>>();
    const reads: string[] = [];
    const pending = checkScheduleAvailability(value, async (_term, code) => {
      reads.push(code);
      if (code === courseCode) return realCourse();
      waiting.resolve();
      return upstream.promise;
    }, controller.signal);
    await waiting.promise;
    controller.abort();
    expect(await pending).toMatchObject({ summary: "unknown", courses: [{ state: "open" }, { state: "unavailable" }, { state: "unavailable" }] });
    expect(reads).toEqual(["MATH 1680", "ACCT 5120"]);
    // The shared read can fail after the caller stopped waiting; the race
    // must still consume its rejection rather than crash the server.
    upstream.reject(new Error("late source failure"));
    await Promise.resolve();
  });

  test("a request aborted before checking starts never reaches the source", async () => {
    const controller = new AbortController();
    controller.abort();
    let reads = 0;
    expect(await checkScheduleAvailability(planned, async () => { reads++; return realCourse(); }, controller.signal))
      .toMatchObject({ summary: "unknown", courses: [{ state: "unavailable" }] });
    expect(reads).toBe(0);
  });
});
