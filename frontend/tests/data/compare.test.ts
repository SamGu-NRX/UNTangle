import { describe, expect, test } from "bun:test";
import {
  compareBundles,
  readCurrentBundle,
  renderReport,
  type CurrentBundle,
} from "../../../tools/catalog-ingest/lib/compare";
import type { CandidateBundle } from "../../../tools/catalog-ingest/lib/schema";

/**
 * 2x3 fixture pair (3 courses, 3 sections, 2 buildings on both sides) with
 * one added course, one missing course, one online section, and one
 * unresolved prerequisite edge — every number below is hand-computed.
 */
function currentFixture(): CurrentBundle {
  return {
    buildings: [
      { id: "art", name: "Art Building", shortName: "ART" },
      { id: "chem", name: "Chemistry Building", shortName: "CHEM" },
    ],
    courses: [
      { code: "ANTH 1010", prerequisites: [] },
      { code: "BIOL 2050", prerequisites: ["ANTH 1010"] },
      { code: "PHIL 1050", prerequisites: [] },
    ],
    sections: [
      { meetings: [{ buildingId: "art" }] },
      { meetings: [{ buildingId: "chem" }, { buildingId: "art" }] },
      { meetings: [] },
    ],
  };
}

function candidateFixture(): CandidateBundle {
  return {
    term: {
      id: "fall-2026",
      label: "Fall 2026",
      classesStart: "2026-08-24",
      classesEnd: "2026-12-11",
    },
    buildings: [
      { id: "art", name: "Art Building", shortName: "ART", lat: 33.2, lng: -97.1 },
      { id: "chem", name: "Chemistry Building", shortName: "CHEM", lat: 33.21, lng: -97.15 },
    ],
    courses: [
      {
        code: "ANTH 1010",
        title: "Introduction to Anthropology",
        department: "ANTH",
        creditHours: 3,
        description: "Surveys and explains the cultural and linguistic ...",
        prerequisites: [],
        planned: false,
      },
      {
        code: "BIOL 2050",
        title: "General Biology I",
        department: "BIOL",
        creditHours: 4,
        description: "Fundamentals of biology ...",
        prerequisites: ["ANTH 1010"],
        planned: false,
      },
      {
        code: "CHEM 3010",
        title: "Organic Chemistry I",
        department: "CHEM",
        creditHours: 3,
        description: "Structure and reactions of organic molecules ...",
        prerequisites: ["MATH 1650"],
        planned: false,
      },
    ],
    sections: [
      {
        id: "anth-1010-001",
        courseCode: "ANTH 1010",
        title: "Introduction to Anthropology",
        professor: "Jamie K. Johnson",
        rating: null,
        meetings: [{ day: "Mon", start: "16:00", end: "16:50", buildingId: "art" }],
      },
      {
        id: "biol-2050-001",
        courseCode: "BIOL 2050",
        title: "General Biology I",
        professor: "Robin Lee",
        rating: null,
        modality: "online",
        meetings: [],
      },
      {
        id: "chem-3010-001",
        courseCode: "CHEM 3010",
        title: "Organic Chemistry I",
        professor: "Maya Chen",
        rating: null,
        modality: "hybrid",
        meetings: [
          { day: "Fri", start: "09:00", end: "11:50", buildingId: "chem" },
          { day: "Wed", start: "10:00", end: "10:50", buildingId: "art" },
        ],
      },
    ],
  };
}

describe("catalog ingest comparison", () => {
  test("computes exact current vs candidate counts", () => {
    const report = compareBundles(currentFixture(), candidateFixture());
    expect(report.counts).toEqual({
      current: { courses: 3, sections: 3, buildings: 2 },
      candidate: { courses: 3, sections: 3, buildings: 2 },
    });
  });

  test("lists courses added and missing as sorted code lists", () => {
    const report = compareBundles(currentFixture(), candidateFixture());
    expect(report.coursesAdded).toEqual(["CHEM 3010"]);
    expect(report.coursesMissing).toEqual(["PHIL 1050"]);
  });

  test("computes candidate building usage with names and meeting counts", () => {
    const report = compareBundles(currentFixture(), candidateFixture());
    expect(report.buildingsUsed).toEqual([
      { id: "art", name: "Art Building", meetings: 2 },
      { id: "chem", name: "Chemistry Building", meetings: 1 },
    ]);
    expect(report.currentBuildingsUsed).toEqual(["art", "chem"]);
  });

  test("computes meetings per building sorted by code", () => {
    const report = compareBundles(currentFixture(), candidateFixture());
    expect(report.meetingsPerBuilding).toEqual([
      { id: "art", meetings: 2 },
      { id: "chem", meetings: 1 },
    ]);
  });

  test("computes the online share as 33.3 for 1 of 3 sections", () => {
    const report = compareBundles(currentFixture(), candidateFixture());
    expect(report.onlineShare).toEqual({ onlineSections: 1, unknownSections: 1, totalSections: 3, percent: 33.3 });
  });

  test("computes unresolved prerequisite edges with a current-bundle context count", () => {
    const report = compareBundles(currentFixture(), candidateFixture());
    expect(report.prereqUnresolved).toEqual([
      { course: "CHEM 3010", prerequisite: "MATH 1650" },
    ]);
    expect(report.prereqUnresolvedCurrentCount).toBe(0);
  });

  test("echoes the candidate term", () => {
    const report = compareBundles(currentFixture(), candidateFixture());
    expect(report.term).toEqual({
      id: "fall-2026",
      label: "Fall 2026",
      classesStart: "2026-08-24",
      classesEnd: "2026-12-11",
    });
  });

  test("sorts unresolved prerequisite edges by course then prerequisite", () => {
    const candidate = candidateFixture();
    candidate.courses[2].prerequisites = ["MATH 1650", "ANTH 0010"];
    const report = compareBundles(currentFixture(), candidate);
    expect(report.prereqUnresolved).toEqual([
      { course: "CHEM 3010", prerequisite: "ANTH 0010" },
      { course: "CHEM 3010", prerequisite: "MATH 1650" },
    ]);
  });

  test("reports a zero percent online share for a bundle with no sections", () => {
    const report = compareBundles(
      { buildings: [], courses: [], sections: [] },
      { ...candidateFixture(), sections: [] },
    );
    expect(report.onlineShare).toEqual({ onlineSections: 0, unknownSections: 0, totalSections: 0, percent: 0 });
    expect(report.buildingsUsed).toEqual([]);
    expect(report.currentBuildingsUsed).toEqual([]);
    expect(report.meetingsPerBuilding).toEqual([]);
    expect(report.coursesAdded).toEqual(["ANTH 1010", "BIOL 2050", "CHEM 3010"]);
  });

  test("renders a deterministic markdown report with the spec order", () => {
    const first = renderReport(compareBundles(currentFixture(), candidateFixture()));
    const second = renderReport(compareBundles(currentFixture(), candidateFixture()));
    expect(first).toBe(second);

    expect(first).toContain("| courses | 3 | 3 |");
    expect(first).toContain("| sections | 3 | 3 |");
    expect(first).toContain("| buildings | 2 | 2 |");
    expect(first).toContain("- CHEM 3010");
    expect(first).toContain("- PHIL 1050");
    expect(first).toContain("| art | Art Building | 2 |");
    expect(first).toContain("| chem | Chemistry Building | 1 |");
    expect(first).toContain("1 of 3 candidate sections (33.3%) are explicitly online; 1 have unknown modality.");
    expect(first).toContain("- CHEM 3010 requires MATH 1650 (no candidate course)");
    expect(first).toContain("Context: the current bundle has 0 unresolved prerequisite edge(s).");
    expect(first).toContain("- id: fall-2026");
    expect(first).toContain("- classesStart: 2026-08-24");

    const order = [
      "## Counts",
      "## Courses added (candidate only)",
      "## Courses missing (current only)",
      "## Buildings used by candidate sections",
      "## Building codes used by the current bundle",
      "## Meetings per building (candidate)",
      "## Online share",
      "## Unresolved prerequisite references (candidate)",
      "## Term",
    ];
    const indices = order.map((heading) => first.indexOf(heading));
    expect(indices.every((index) => index >= 0)).toBe(true);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });

  test("reads the current seed leniently (ignores courseStatuses and junk rows)", () => {
    const current = readCurrentBundle({
      courseStatuses: { "ANTH 1010": "notTaken" },
      buildings: [
        { id: "art", name: "Art Building", shortName: "ART", lat: 1, lng: 2 },
        { junk: true },
      ],
      courses: [{ code: "ANTH 1010", prerequisites: [], extra: 1 }],
      sections: [{ meetings: [{ buildingId: "art" }, { buildingId: null }] }],
    });
    const report = compareBundles(current, candidateFixture());
    expect(report.counts.current).toEqual({ courses: 1, sections: 1, buildings: 1 });
    expect(report.currentBuildingsUsed).toEqual(["art"]);
  });
});


test("missing meetings do not turn unknown modality into online", () => {
  const candidate = candidateFixture();
  candidate.sections[0].meetings = [];
  candidate.sections[0].modality = "unknown";
  expect(compareBundles(currentFixture(), candidate).onlineShare).toEqual({ onlineSections: 1, unknownSections: 1, totalSections: 3, percent: 33.3 });
});
