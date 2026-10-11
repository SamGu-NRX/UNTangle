/**
 * Hand-derived degree requirements tests.
 *
 * The fixture tree encodes the Computer Science, BS requirements as published
 * in the 2023-24 Undergraduate Catalog program page (catalog.unt.edu,
 * preview_program.php?catoid=32&poid=13823), read this session: 120 total
 * hours / 42 advanced, a 55-hour major, CSCE core choose-6 from 5 named
 * courses, CSCE breadth choose-6 from 8 named courses, lab science 16 hours
 * (PHYS 1710+1730 and PHYS 2220+2240 required, 8 more hours chosen from a
 * BIOL/CHEM list), and non-enumerable items ("plus 9 hours chosen from CSCE
 * Advanced Elective Courses", "Any 4000-level TECM course") that the model
 * must keep as advisor items, never as machine-satisfied requirements.
 */
import { describe, expect, test } from "bun:test";
import {
  evaluateDegreeRequirements,
  evaluateNode,
  type DegreeRequirementNode,
  type DegreeRequirements,
} from "../src/lib/degree-requirements";

// Hours as used by the app catalog for the CS foundation (the planner's
// seed-data carries these; the catalog page itself does not state hours on
// the requirement bullets, only in its four-year plan table).
const HOURS: Record<string, number> = {
  "CSCE 1030": 4,
  "CSCE 1040": 3,
  "CSCE 2100": 3,
  "CSCE 2110": 3,
  "CSCE 2610": 3,
  "CSCE 3110": 3,
  "CSCE 3444": 3,
  "CSCE 3600": 3,
  "CSCE 4010": 3,
  "CSCE 4110": 3,
  "CSCE 3530": 3,
  "CSCE 4430": 3,
  "CSCE 3550": 3,
  "PHYS 1710": 3,
  "PHYS 1730": 1,
  "PHYS 2220": 3,
  "PHYS 2240": 1,
  "BIOL 1710": 3,
  "BIOL 1760": 1,
  "CHEM 1410": 3,
  "CHEM 1430": 1,
  "MATH 1710": 4,
  "MATH 1720": 3,
  "MATH 1780": 3,
  "MATH 3680": 3,
  "MATH 2700": 3,
  "TECM 2700": 3,
  "EENG 2710": 3,
};
const hoursFor = (code: string) => HOURS[code] ?? null;

const course = (courseCode: string, title: string): DegreeRequirementNode => ({
  kind: "course",
  courseCode,
  title,
  creditHours: null,
});

const CS_FIXTURE: DegreeRequirements = {
  majorId: "cs",
  majorName: "Computer Science, BS",
  catalogYear: "2023-24",
  sourceUrl: "https://catalog.unt.edu/preview_program.php?catoid=32&poid=13823",
  fetchedAt: "2026-10-11T00:00:00.000Z",
  sourceSha256: "fixture",
  totalHours: 120,
  advancedHours: 42,
  majorHours: 55,
  sections: [
    {
      label: "Major requirements",
      hoursLabel: "A minimum of 55 semester hours",
      items: [
        course("CSCE 1030", "Computer Science I"),
        course("CSCE 1040", "Computer Science II"),
        course("CSCE 2100", "Foundations of Computing"),
        course("CSCE 2110", "Foundations of Data Structures"),
        course("CSCE 2610", "Assembly Language and Computer Organization"),
        course("CSCE 3110", "Data Structures and Algorithms"),
        course("CSCE 3444", "Software Engineering"),
        course("CSCE 3600", "Principles of Systems Programming"),
        course("CSCE 4010", "Social Issues in Computing"),
        course("CSCE 4110", "Algorithms"),
        course("CSCE 4901", "Software Development Capstone I"),
        course("CSCE 4902", "Software Development Capstone II"),
        {
          kind: "choose",
          label: "CSCE core",
          chooseHours: 6,
          options: [
            course("CSCE 3530", "Introduction to Computer Networks"),
            course("CSCE 4115", "Formal Languages, Automata and Computability"),
            course("CSCE 4430", "Programming Languages"),
            course("CSCE 4600", "Introduction to Operating Systems"),
            course("CSCE 4650", "Introduction to Compilation Techniques"),
          ],
        },
        {
          kind: "choose",
          label: "CSCE breadth courses",
          chooseHours: 6,
          options: [
            course("CSCE 3550", "Foundations of Cybersecurity"),
            course("CSCE 4201", "Introduction to Artificial Intelligence"),
            course("CSCE 4210", "Game Programming I"),
            course("CSCE 4230", "Introduction to Computer Graphics"),
            course("CSCE 4240", "Introduction to Digital Image Processing"),
            course("CSCE 4290", "Introduction to Natural Language Processing"),
            course("CSCE 4350", "Fundamentals of Database Systems"),
            course("CSCE 4460", "Software Testing and Empirical Methodologies"),
          ],
        },
        {
          kind: "advisor",
          label: "plus 9 hours chosen from CSCE Advanced Elective Courses",
          note: "the published page's list structure is ambiguous; requires advisor confirmation",
        },
        {
          kind: "advisor",
          label: "CSCE 4990/4999 Senior Thesis alternative",
          note: "the page presents this as an or-branch of the advanced elective hours",
        },
      ],
    },
    {
      label: "Other required courses",
      hoursLabel: null,
      items: [
        course("EENG 2710", "Digital Logic Design"),
        course("MATH 1710", "Calculus I"),
        course("MATH 1720", "Calculus II"),
        course("MATH 1780", "Probability Models"),
        course("MATH 3680", "Applied Statistics"),
        course("MATH 2700", "Linear Algebra and Vector Geometry"),
        course("TECM 2700", "Technical Writing"),
      ],
    },
    {
      label: "Laboratory science",
      hoursLabel: "16 hours",
      items: [
        {
          kind: "group",
          label: "Required courses",
          hoursLabel: "8 hours",
          items: [
            course("PHYS 1710", "Mechanics"),
            course("PHYS 1730", "Laboratory in Mechanics"),
            course("PHYS 2220", "Electricity and Magnetism"),
            course("PHYS 2240", "Electricity and Magnetism"),
          ],
        },
        {
          kind: "choose",
          label: "Choose 8 hours from the following courses",
          chooseHours: 8,
          options: [
            course("BIOL 1710", "Biology for Science Majors I"),
            course("BIOL 1720", "Biology for Science Majors II"),
            course("BIOL 1760", "Biology for Science Majors Laboratory"),
            course("CHEM 1410", "General Chemistry for Science Majors"),
            course("CHEM 1430", "Laboratory Sequence for General Chemistry"),
          ],
        },
      ],
    },
    {
      label: "Technical writing elective",
      hoursLabel: "3 hours selected from",
      items: [
        {
          kind: "advisor",
          label: "Any 4000-level TECM course",
          note: "a pattern, not an enumerable list",
        },
      ],
    },
  ],
  advisorNotes: [
    "plus 9 hours chosen from CSCE Advanced Elective Courses",
    "CSCE 4990/4999 Senior Thesis alternative",
    "Any 4000-level TECM course",
  ],
};

describe("evaluateNode — choose blocks", () => {
  const coreChoose = CS_FIXTURE.sections[0].items.find((i) => i.kind === "choose" && i.label === "CSCE core") as Extract<
    DegreeRequirementNode,
    { kind: "choose" }
  >;

  test("a choose block counts hours across options, not options picked", () => {
    // CSCE 3530 (3h) alone is not enough for a 6-hour choose.
    const half = evaluateNode(coreChoose, new Set(["CSCE 3530"]), new Set(), hoursFor);
    expect(half.status).toBe("unmet");
    expect(half.hoursDone).toBe(3);
    expect(half.hoursTarget).toBe(6);
    // adding CSCE 4430 (3h) reaches 6 and satisfies it
    const full = evaluateNode(coreChoose, new Set(["CSCE 3530", "CSCE 4430"]), new Set(), hoursFor);
    expect(full.status).toBe("satisfied");
    expect(full.hoursDone).toBe(6);
  });

  test("an in-progress option marks the choose block inProgress", () => {
    const progress = evaluateNode(coreChoose, new Set(), new Set(["CSCE 3530"]), hoursFor);
    expect(progress.status).toBe("inProgress");
    expect(progress.hoursDone).toBe(0);
  });

  test("unknown option hours are counted as 0 and flagged partial, not guessed", () => {
    const partial = evaluateNode(coreChoose, new Set(["CSCE 4600"]), new Set(), hoursFor); // CSCE 4600 not in HOURS
    expect(partial.hoursDone).toBe(0);
    expect(partial.status).toBe("unmet");
    expect(partial.partial).toBe(true);
  });
});

describe("evaluateDegreeRequirements — CS, BS fixture", () => {
  test("a first-semester transcript satisfies exactly the first-semester requirements", () => {
    // The published four-year plan's semester 1: CSCE 1030, MATH 1710, Communication Core, Lab Science.
    const progress = evaluateDegreeRequirements(
      CS_FIXTURE,
      ["CSCE 1030", "MATH 1710", "PHYS 1710", "PHYS 1730"].map((code) => ({ code })),
      [],
      hoursFor,
    );
    expect(progress.totalHoursDone).toBe(4 + 4 + 3 + 1);
    expect(progress.totalHoursTarget).toBe(120);

    const major = progress.sections[0];
    const csce1030 = major.items[0];
    expect(csce1030.status).toBe("satisfied");
    expect(csce1030.hoursDone).toBe(4);
    const csce1040 = major.items[1];
    expect(csce1040.status).toBe("unmet");
    // advisor items stay "info" and contribute zero hours
    const advisorItems = major.items.filter((i) => i.status === "info");
    expect(advisorItems).toHaveLength(2);
    expect(progress.sections[1].items[1].status).toBe("satisfied"); // MATH 1710
    // lab required group fully satisfied by the PHYS pair; the choose-8 is not started
    const lab = progress.sections[2];
    expect(lab.items[0].status).toBe("satisfied");
    expect(lab.items[1].status).toBe("unmet");
    expect(lab.hoursTarget).toBe(16);
  });

  test("advisor items never count toward progress", () => {
    const empty = evaluateDegreeRequirements(CS_FIXTURE, [], [], hoursFor);
    expect(empty.advisorNotes).toHaveLength(3);
    expect(empty.totalHoursDone).toBe(0);
  });

  test("in-progress courses surface as inProgress sections without hours", () => {
    const progress = evaluateDegreeRequirements(
      CS_FIXTURE,
      [],
      [{ code: "CSCE 2100" }],
      hoursFor,
    );
    const major = progress.sections[0];
    expect(major.items[2].status).toBe("inProgress");
    expect(major.status).toBe("inProgress");
  });
});
