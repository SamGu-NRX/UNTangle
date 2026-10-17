/**
 * Which planning courses may fetch and carry instructor evidence: only those
 * whose loaded sections are real. The section store falls back to synthetic
 * sample sections when vsb has no usable record, and those fabricate
 * instructors — real grade history mapped onto a fabricated name could win
 * the instructor tie-break for a section that is not a real enrollment
 * option.
 */

import { describe, expect, test } from "bun:test";
import { evidenceFetchable } from "@/lib/sections/instructor-evidence";
import { sampleCatalog, type CourseOptions } from "@/lib/planner-sections";
import type { CourseSections, Meeting, RealProvenance, Section } from "@/lib/sections/model";

function meeting(day: Meeting["day"], start: number, end: number): Meeting {
  return {
    room: "204", buildingCode: "NTDP", buildingId: "ntdp", buildingName: "Discovery Park", kind: "building", offCampus: false,
    day, startMinutes: start, endMinutes: end, dates: { start: null, end: null, raw: "" },
    instructor: { display: "Jane Doe", raw: "Doe,Jane" }, async: false, tba: false,
  };
}

function section(id: string, courseCode: string): Section {
  return {
    id, term: "spring-2027", courseCode, sectionCode: "001", classNumbers: ["12345"], option: "1",
    instructor: { display: "Jane Doe", raw: "Doe,Jane" }, seats: { open: 25, total: 40 }, status: "open", rawStatus: "Open",
    session: { label: "Full Term", dates: { start: null, end: null, raw: "" } }, components: [],
    meetings: [meeting("Mon", 540, 600)],
    online: false, async: false, tba: false,
  };
}

const realProvenance: RealProvenance = {
  kind: "real", source: "vsb.untgrades.app", updatedAt: "2026-10-15T12:00:00Z", note: "",
};

function realResult(courseCode: string, sections: Section[]): CourseSections {
  return {
    term: "202710", courseCode, status: "ok", availability: "sections", diagnostic: null,
    provenance: realProvenance, checkedAt: "2026-10-15T12:00:00Z", sections,
  };
}

function ready(result: CourseSections): CourseOptions {
  return { status: "ready", result };
}

describe("evidenceFetchable", () => {
  test("allows a course whose loaded sections are real", () => {
    expect(evidenceFetchable("ANTH 1010", ready(realResult("ANTH 1010", [section("anth-1010-001", "ANTH 1010")])))).toBe(true);
  });

  test("rejects a synthetic sample result even with populated sections", () => {
    // sampleCatalog always answers ready with seed sections: the store's
    // fallback shape, with fabricated instructors.
    expect(evidenceFetchable("ANTH 1010", sampleCatalog("ANTH 1010"))).toBe(false);
  });

  test("rejects a real result with no sections", () => {
    expect(evidenceFetchable("ANTH 1010", ready(realResult("ANTH 1010", [])))).toBe(false);
  });

  test("rejects a course that is still loading", () => {
    expect(evidenceFetchable("ANTH 1010", { status: "loading" })).toBe(false);
  });

  test("rejects a code that is not a subject-number pair", () => {
    expect(evidenceFetchable("ANTH1010", ready(realResult("ANTH1010", [section("anth-1010-001", "ANTH1010")])))).toBe(false);
  });
});
