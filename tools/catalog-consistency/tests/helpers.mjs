/**
 * Test fixtures for the catalog-consistency v2 suite.
 *
 * Expected values in the controls are HAND-COMPUTED from
 * tools/catalog-consistency/RULES.md (v2) and FORMAT-v2.md — they are never
 * derived by running the code under test. If the producer drifts from the
 * rules, these literals fail.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Spec-fixed strings (copied from FORMAT-v2.md / RULES.md — deliberately not imported). */
export const UNKNOWN_PREREQ_NOTE =
  "no committed evidence of external intent; consistent with the subset-catalog claim (README) but unverified per code — intent unresolved";
export const ASSESSMENT_BOUND =
  "the committed sections and their meetings are fully derived from backend/data/compD.csv (bound in the receipt); compD.csv carries no term/semester/session/year column and its section-number lattice (every course carries section 001 and 002, with additional section numbers appearing in exact count pairs) is characteristic of generated rather than recorded offerings — treated as synthetic/generated, not a real-term export; no data repaired";
export const ASSESSMENT_UNBOUND =
  "section source not available — backend/data/compD.csv absent; provenance not established";
export const ANNEX_NOTE =
  "Every unresolved finding with example records, capped at 10 per class; exact totals live in report.json. Nothing here is an allowlist: entries document defects and their committed repair locations (REPAIR-LOCATIONS.md).";

/* ------------------------------- record builders ------------------------------ */

export function meeting(day, start, end, buildingId = null) {
  const m = { day, start, end };
  if (buildingId != null) m.buildingId = buildingId;
  return m;
}

export function course(code, title, prerequisites = []) {
  return {
    code,
    title,
    department: code.split(" ")[0],
    creditHours: 3,
    description: `Description for ${code}.`,
    prerequisites,
    planned: false,
  };
}

export function building(id, shortName, name = `Building ${shortName}`) {
  return { id, name, shortName, lat: 33.2, lng: -97.1 };
}

export function section(id, courseCode, meetings = []) {
  return { id, courseCode, title: `${courseCode} Section Sample`, professor: "Prof A", rating: 4, meetings };
}

export function majorsTs(majors) {
  return `import type { Major } from "./types";\n\nexport const majors: Major[] = ${JSON.stringify(majors, null, 2)};\n`;
}

export const COMPD_HEADER = "course_number,section_number,professor,start_time,end_time,days,location";

/* ------------------------------- fixture: clean ------------------------------- */

export function cleanSeedData() {
  return {
    buildings: [building("bld-chem", "CHEM", "Chemistry Building"), building("bld-aud", "AUD", "Auditorium Building")],
    courses: [course("ANTH 1010", "Introduction to Anthropology"), course("ANTH 2000", "Intermediate Anthropology", ["ANTH 1010"])],
    sections: [
      section("anth-1010-001", "ANTH 1010", [
        meeting("Mon", "08:00", "08:50", "bld-chem"),
        meeting("Wed", "08:00", "08:50", "bld-chem"),
      ]),
      section("anth-1010-002", "ANTH 1010", [
        meeting("Tue", "10:30", "11:50", "bld-aud"),
        meeting("Thu", "10:30", "11:50", "bld-aud"),
      ]),
    ],
    courseStatuses: { "ANTH 1010": "completed" },
  };
}

export const cleanMajors = [{ id: "anth-bs", name: "Anthropology BS", department: "ANTH", icon: "flame", coreCourseCodes: ["ANTH 1010"] }];

export const cleanCorpus = {
  "anth.json": [{ course_number: "ANTH3000", title: "Advanced Anthropology" }],
};

export const cleanCompd = `${COMPD_HEADER}
ANTH1010,001,Prof A,08:00,08:50,MW,Chemistry Building (CHEM) 162
ANTH1010,002,Prof A,10:30,11:50,TuTh,Auditorium Building (AUD) 100
`;

/* ------------------------------ fixture: negative ----------------------------- */

/** One defect for every finding class, on top of a clean base. */
export function negativeSeedData() {
  return {
    buildings: [
      building("bld-chem", "CHEM", "Chemistry Building"),
      building("bld-aud", "AUD", "Auditorium Building"),
      building("bld-aud", "AUD2", "Auditorium Building Annex"), // R1.3 duplicate
    ],
    courses: [
      course("ANTH 1010", "Introduction to Anthropology"),
      course("ANTH 1010", "Introduction to Anthropology II"), // R1.1 duplicate
      course("ANTH 2000", "Intermediate Anthropology", ["ANTH 1010", "CORP 3000", "BNDL 4000", "TYPO9999"]),
      course("BNDL 4001", "Survey Methods  (BNDL 4000)"), // title annotates BNDL 4000
    ],
    sections: [
      section("anth-1010-001", "ANTH 1010", [
        meeting("Mon", "08:00", "08:50", "bld-chem"),
        meeting("Wed", "08:00", "08:50", "bld-chem"),
      ]),
      section("anth-1010-001", "ANTH 1010", [meeting("Mon", "09:00", "09:50", "bld-chem")]), // R1.2 duplicate
      section("anth-1010-002", "ANTH 1010", [
        meeting("Tue", "10:30", "11:50", "bld-aud"),
        meeting("Thu", "10:30", "11:50", "bld-aud"),
      ]),
      section("anth-ghost-001", "GHOST 1010", [meeting("Sat", "12:00", "13:00", "bld-ghost")]), // R2.1 + R2.2 + R3.3
      section("anth-2000-001", "ANTH 2000", [meeting("Mon", "09:00", "08:50", "bld-chem")]), // R3.2 end <= start
      section("anth-2000-002", "ANTH 2000", [meeting("Mon", "9:00", "10:00", "bld-chem")]), // R3.1 malformed
    ],
    courseStatuses: { "ANTH 1010": "completed", "GHOST 1010": "inProgress" }, // R2.3
  };
}

export const negativeMajors = [
  { id: "anth-bs", name: "Anthropology BS", department: "ANTH", icon: "flame", coreCourseCodes: ["ANTH 1010", "GOVT 2305"] }, // R2.4 (GOVT 2305 unresolved, no annotation anywhere)
];

export const negativeCorpus = {
  "anth.json": [{ course_number: "ANTH3000", title: "Advanced Anthropology" }],
  "corp.json": [{ course_number: "CORP3000", title: "Corpus Course" }], // CORP 3000 is in the corpus
};

export const negativeCompd = cleanCompd;

/* ------------------------------ fixture: 25 defects --------------------------- */

/** 5 sections x 5 end<=start meetings (+1 good each): 25 defects, 30 meetings. */
export function meeting25SeedData() {
  const sections = [];
  for (let s = 0; s < 5; s += 1) {
    const meetings = [];
    for (let m = 0; m < 5; m += 1) meetings.push(meeting("Mon", "09:00", "08:30", "bld-chem"));
    meetings.push(meeting("Mon", "08:00", "08:50", "bld-chem"));
    sections.push(section(`anth-2000-00${s + 1}`, "ANTH 2000", meetings));
  }
  return {
    buildings: [building("bld-chem", "CHEM")],
    courses: [course("ANTH 2000", "Intermediate Anthropology")],
    sections,
    courseStatuses: {},
  };
}

/* --------------------------- hand-computed expectations ----------------------- */

export function expectedCleanFindings() {
  return {
    duplicateIds: {
      courseCodes: { total: 0, examples: [] },
      sectionIds: { total: 0, examples: [] },
      buildingIds: { total: 0, examples: [] },
    },
    meetingBounds: {
      meetingsChecked: 4,
      endTimeNotAfterStart: { total: 0, examples: [] },
      malformedTime: { total: 0, examples: [] },
      dayOutsideCommittedVocabulary: { total: 0, examples: [] },
    },
    references: {
      sectionToCourse: { checked: 2, unresolved: { total: 0, examples: [] } },
      meetingToBuilding: { checked: 4, unresolved: { total: 0, examples: [] } },
      courseStatusToCourse: { checked: 1, unresolved: { total: 0, examples: [] } },
      majorCoreToCourse: { checked: 1, unresolved: { total: 0, examples: [] } },
      prerequisites: {
        edgesTotal: 1,
        internalEdges: 1,
        external: {
          edges: 0,
          distinctCodes: 0,
          categories: {
            inSourceCorpus: { codes: 0, edges: 0, examples: [] },
            titleAnnotatedInBundle: { codes: 0, edges: 0, examples: [] },
            unknown: { codes: 0, edges: 0, examples: [], note: UNKNOWN_PREREQ_NOTE },
          },
        },
      },
    },
  };
}

export function expectedCleanCounts() {
  return {
    buildings: 2,
    courses: 2,
    sections: 2,
    majors: 1,
    courseStatusEntries: 1,
    sectionMeetings: 4,
    prerequisiteEdges: 1,
    corpusFiles: 1,
    compDRows: 2,
  };
}

export function expectedCleanProvenance() {
  return {
    bound: true,
    path: "backend/data/compD.csv",
    submoduleCommit: null,
    rows: 2,
    sectionsMatchedToRows: 2,
    sectionsUnmatchedToRows: 0,
    rowsMatchedToSections: 2,
    rowsUnmatchedToSections: 0,
    meetingsFromDayPatterns: 4,
    sectionsMeetingsAgree: 2,
    sectionsMeetingsDisagree: 0,
    buildingShortCodes: 2,
    buildingCodesInBundle: 2,
    termColumns: [],
    lattice: { ok: true, coursesChecked: 1, violations: 0, firstFailingCourse: null },
    assessment: ASSESSMENT_BOUND,
  };
}

export function expectedNegativeFindings() {
  return {
    duplicateIds: {
      courseCodes: { total: 1, examples: [{ key: "ANTH 1010", extraOccurrences: 1 }] },
      sectionIds: { total: 1, examples: [{ key: "anth-1010-001", extraOccurrences: 1 }] },
      buildingIds: { total: 1, examples: [{ key: "bld-aud", extraOccurrences: 1 }] },
    },
    meetingBounds: {
      meetingsChecked: 8,
      endTimeNotAfterStart: {
        total: 1,
        examples: [{ sectionId: "anth-2000-001", day: "Mon", start: "09:00", end: "08:50", buildingId: "bld-chem" }],
      },
      malformedTime: {
        total: 1,
        examples: [{ sectionId: "anth-2000-002", day: "Mon", start: "9:00", end: "10:00", buildingId: "bld-chem" }],
      },
      dayOutsideCommittedVocabulary: {
        total: 1,
        examples: [{ sectionId: "anth-ghost-001", day: "Sat" }],
      },
    },
    references: {
      sectionToCourse: {
        checked: 6,
        unresolved: { total: 1, examples: [{ sectionId: "anth-ghost-001", courseCode: "GHOST 1010" }] },
      },
      meetingToBuilding: {
        checked: 8,
        unresolved: { total: 1, examples: [{ sectionId: "anth-ghost-001", buildingId: "bld-ghost" }] },
      },
      courseStatusToCourse: {
        checked: 2,
        unresolved: { total: 1, examples: [{ courseCode: "GHOST 1010", status: "inProgress" }] },
      },
      majorCoreToCourse: {
        checked: 2,
        unresolved: {
          total: 1,
          examples: [{ majorId: "anth-bs", majorName: "Anthropology BS", code: "GOVT 2305", evidence: null }],
        },
      },
      prerequisites: {
        edgesTotal: 4,
        internalEdges: 1,
        external: {
          edges: 3,
          distinctCodes: 3,
          categories: {
            inSourceCorpus: {
              codes: 1,
              edges: 1,
              examples: [
                {
                  code: "CORP 3000",
                  edges: 1,
                  category: "inSourceCorpus",
                  evidence: { kind: "sourceCorpusFile", files: ["courses/corp.json"] },
                },
              ],
            },
            titleAnnotatedInBundle: {
              codes: 1,
              edges: 1,
              examples: [
                {
                  code: "BNDL 4000",
                  edges: 1,
                  category: "titleAnnotatedInBundle",
                  evidence: { kind: "titleAnnotationInBundle", titles: ["Survey Methods  (BNDL 4000)"] },
                },
              ],
            },
            unknown: {
              codes: 1,
              edges: 1,
              examples: [{ code: "TYPO9999", edges: 1, category: "unknown", evidence: null }],
              note: UNKNOWN_PREREQ_NOTE,
            },
          },
        },
      },
    },
  };
}

export function expectedNegativeCounts() {
  return {
    buildings: 3,
    courses: 4,
    sections: 6,
    majors: 1,
    courseStatusEntries: 2,
    sectionMeetings: 8,
    prerequisiteEdges: 4,
    corpusFiles: 2,
    compDRows: 2,
  };
}

export function expectedNegativeProvenance() {
  return {
    bound: true,
    path: "backend/data/compD.csv",
    submoduleCommit: null,
    rows: 2,
    sectionsMatchedToRows: 3,
    sectionsUnmatchedToRows: 3,
    rowsMatchedToSections: 2,
    rowsUnmatchedToSections: 0,
    meetingsFromDayPatterns: 6,
    sectionsMeetingsAgree: 2,
    sectionsMeetingsDisagree: 1,
    buildingShortCodes: 2,
    buildingCodesInBundle: 2,
    termColumns: [],
    lattice: { ok: false, coursesChecked: 3, violations: 1, firstFailingCourse: "GHOST1010" },
    assessment:
      "premises unmet — sections unmatched to compD rows: 3, compD rows unmatched to sections: 0, term/semester/session/year columns present: 0, section-number lattice violations: 1 courses (first: GHOST1010) — sections cannot be certified fully derived from compD.csv; no data repaired",
  };
}

/* --------------------------------- tree writer -------------------------------- */

/** Build the repo layout the producer expects under `root`; returns absolute root. */
export function writeTree(root, { seedData, majors, corpusFiles = {}, compdCsv = null }) {
  fs.mkdirSync(path.join(root, "frontend", "src", "lib", "generated"), { recursive: true });
  fs.mkdirSync(path.join(root, "courses"), { recursive: true });
  fs.mkdirSync(path.join(root, "tools", "catalog-consistency"), { recursive: true });
  fs.writeFileSync(path.join(root, "frontend", "src", "lib", "generated", "seed-data.json"), JSON.stringify(seedData, null, 2));
  fs.writeFileSync(path.join(root, "frontend", "src", "lib", "seed-data.ts"), majorsTs(majors));
  // Rule-freeze sources are hashed, never parsed — stubs suffice.
  fs.writeFileSync(path.join(root, "frontend", "src", "lib", "types.ts"), "// stub types\n");
  fs.writeFileSync(path.join(root, "frontend", "src", "lib", "planner.ts"), "// stub planner\n");
  fs.writeFileSync(path.join(root, "README.md"), "# stub readme\n");
  fs.writeFileSync(path.join(root, "tools", "catalog-consistency", "RULES.md"), "# stub rules\n");
  for (const [name, content] of Object.entries(corpusFiles)) {
    fs.writeFileSync(path.join(root, "courses", name), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  if (compdCsv != null) {
    fs.mkdirSync(path.join(root, "backend", "data"), { recursive: true });
    fs.writeFileSync(path.join(root, "backend", "data", "compD.csv"), compdCsv);
  }
  return root;
}

