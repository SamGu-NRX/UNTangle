/**
 * Core's section filters, mapped onto parsed UNT sections: the three-valued
 * judge, the site directory (catalogue buildings are Denton; Frisco codes
 * map to Frisco; unknown places never satisfy a site filter) and credit
 * hours from the bundled catalogue.
 */

import { describe, expect, test } from "bun:test";
import type { SectionFilter } from "@untangle/core/filters";
import { filterContextForCourse, filterableSection, evaluateSectionFilters } from "@/lib/sections/filterable";
import type { Meeting, Section } from "@/lib/sections/model";

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    room: "204",
    buildingCode: "NTDP",
    buildingId: "ntdp",
    buildingName: "Discovery Park",
    kind: "building",
    offCampus: false,
    day: "Mon",
    startMinutes: 600,
    endMinutes: 660,
    dates: { start: null, end: null, raw: "" },
    instructor: { display: "Jane Doe", raw: "Doe,Jane" },
    async: false,
    tba: false,
    ...overrides,
  };
}

function section(overrides: Partial<Section> = {}, meetings: Meeting[] = [meeting()]): Section {
  return {
    id: "csce-1045-001",
    term: "spring-2027",
    courseCode: "CSCE 1045",
    sectionCode: "001",
    classNumbers: ["12345"],
    option: "1",
    instructor: { display: "Jane Doe", raw: "Doe,Jane" },
    seats: { open: 25, total: 40 },
    status: "open",
    rawStatus: "Open",
    session: { label: "Full Term", dates: { start: null, end: null, raw: "" } },
    components: [],
    meetings,
    online: false,
    async: false,
    tba: false,
    ...overrides,
  };
}

describe("filterableSection", () => {
  test("flattens components' seats and every meeting", () => {
    const mapped = filterableSection(section({}, [meeting(), meeting({ async: true, kind: "online", buildingId: null, buildingCode: null, day: null, startMinutes: null, endMinutes: null })]));
    expect(mapped.status).toBe("open");
    expect(mapped.components).toHaveLength(1);
    expect(mapped.meetings).toHaveLength(2);
    expect(mapped.meetings[1].async).toBe(true);
  });
});

describe("the site directory", () => {
  test("catalogue buildings and Denton room codes are UNT Denton", () => {
    expect(filterContextForCourse("ANTH 1010").sites?.byBuildingId.ntdp).toBe("unt-denton");
    expect(filterContextForCourse("ANTH 1010").sites?.byRoomCode.MGV).toBe("unt-denton");
  });

  test("the Frisco codes are Frisco, and a place the directory does not name is absent", () => {
    expect(filterContextForCourse("ANTH 1010").sites?.byRoomCode.FRLD).toBe("unt-frisco");
    expect(filterContextForCourse("ANTH 1010").sites?.byRoomCode.ZZZ).toBeUndefined();
  });

  test("credit hours come from the bundled catalogue, null when it does not list the course", () => {
    expect(filterContextForCourse("ANTH 1010").creditHours).toBe(3);
    expect(filterContextForCourse("NOPE 9999").creditHours).toBeNull();
  });
});

describe("evaluateSectionFilters", () => {
  test("an empty list passes", () => {
    expect(evaluateSectionFilters(section(), [])).toBe("pass");
  });

  test("an open-seats filter fails a closed section and passes a full one", () => {
    const open: SectionFilter = { kind: "open-seats", minimum: 10 };
    expect(evaluateSectionFilters(section(), [open])).toBe("pass");
    expect(evaluateSectionFilters(section({ seats: { open: 0, total: 40 }, status: "closed" }), [open])).toBe("fail");
    expect(evaluateSectionFilters(section({ seats: { open: null, total: null }, status: "unknown" }), [open])).toBe("unknown");
  });

  test("a site filter is unknown for a meeting in a place the directory does not name", () => {
    const denton: SectionFilter = { kind: "site", allowed: ["unt-denton"] };
    expect(evaluateSectionFilters(section({}, [meeting()]), [denton])).toBe("pass");
    expect(evaluateSectionFilters(section({}, [meeting({ buildingId: "mars", buildingCode: "MARS", kind: "unknown" })]), [denton])).toBe("unknown");
  });

  test("a days filter judges the meetings' days", () => {
    const days: SectionFilter = { kind: "days", allowed: ["Tue", "Thu"] };
    expect(evaluateSectionFilters(section({}, [meeting({ day: "Mon" })]), [days])).toBe("fail");
  });

  test("an instructor filter matches the display name", () => {
    const only: SectionFilter = { kind: "instructor", match: "only", names: ["Jane Doe"] };
    expect(evaluateSectionFilters(section(), [only])).toBe("pass");
    expect(evaluateSectionFilters(section({ instructor: { display: "Ray Khan", raw: "Khan,Ray" } }), [only])).toBe("fail");
  });
});
