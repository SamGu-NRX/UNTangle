import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

/**
 * Hand-built minimal catalog fixture: the control every detection test starts
 * from. It is internally consistent by construction; each test mutates exactly
 * one thing and asserts the auditor flags it.
 */
export function baseFixture() {
  return {
    buildings: [{ id: "bld-art", name: "Art Building", shortName: "ART", lat: 33.2, lng: -97.1 }],
    courses: [
      {
        code: "ANTH 1010",
        title: "Introduction to Anthropology",
        department: "ANTH",
        creditHours: 3,
        description: "",
        prerequisites: [],
        planned: false,
      },
      {
        code: "ANTH 2300",
        title: "Intermediate Anthropology",
        department: "ANTH",
        creditHours: 3,
        description: "",
        prerequisites: ["ANTH 1010"],
        planned: false,
      },
    ],
    sections: [
      {
        id: "anth-1010-001",
        courseCode: "ANTH 1010",
        title: "Introduction to Anthropology",
        professor: "Jamie K. Johnson",
        rating: 4.6,
        meetings: [{ day: "Mon", start: "16:00", end: "16:50", buildingId: "bld-art" }],
      },
      {
        id: "anth-2300-001",
        courseCode: "ANTH 2300",
        title: "Intermediate Anthropology",
        professor: "Other Person",
        rating: 3.9,
        meetings: [
          { day: "Tue", start: "10:00", end: "11:15", buildingId: "bld-art" },
          { day: "Thu", start: "10:00", end: "11:15" }, // no buildingId: loader treats as TBA
        ],
      },
    ],
    courseStatuses: { "ANTH 1010": "notTaken", "ANTH 2300": "completed" },
    majors: [{ id: "anth", name: "Anthropology", department: "ANTH", icon: "A", coreCourseCodes: ["ANTH 1010", "ANTH 2300"] }],
  };
}

/** Run the core audit over a fixture (optionally supplying a corpus-code map). */
export function audit(fixture, corpusCodes = null) {
  return auditRecords({
    courses: fixture.courses,
    sections: fixture.sections,
    buildings: fixture.buildings,
    courseStatuses: fixture.courseStatuses,
    majors: fixture.majors,
    corpusCodes,
  });
}

import { auditRecords } from "../audit.mjs";

/**
 * Write the fixture as the CLI layout the audit expects:
 * `<dir>/generated/seed-data.json` with the majors source at `<dir>/seed-data.ts`
 * (the real repo has seed-data.ts one level above the generated dir). Returns
 * the directory and the input path as passed relative to it.
 */
export function writeFixtureTree(fixture, majorsTsText) {
  const dir = mkdtempSync(join(tmpdir(), "catalog-consistency-"));
  mkdirSync(join(dir, "generated"), { recursive: true });
  writeFileSync(join(dir, "generated", "seed-data.json"), JSON.stringify(fixture));
  writeFileSync(join(dir, "seed-data.ts"), majorsTsText ?? DEFAULT_MAJORS_TS);
  return { dir, inputPath: "generated/seed-data.json" };
}

export const DEFAULT_MAJORS_TS = `import type { Major } from "@/lib/types";

export const majors: Major[] = [
  {
    id: "anth",
    name: "Anthropology",
    department: "ANTH",
    icon: "A",
    coreCourseCodes: ["ANTH 1010", "ANTH 2300"],
  },
];
`;

/** Absolute path of the CLI, for integration tests that shell out. */
import { fileURLToPath } from "node:url";
export const AUDIT_CLI = fileURLToPath(new URL("../audit.mjs", import.meta.url));

export { readFileSync, dirname, join };
