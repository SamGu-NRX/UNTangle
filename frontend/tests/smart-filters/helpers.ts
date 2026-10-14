import type { GradeData } from "@/lib/grades";
import { gradeGpa, sumCounts } from "@/lib/grades-history/normalize";
import type {
  CourseHistory,
  CourseIdentity,
  GradeCounts,
  HistorySection,
  HistoryTerm,
  InstructorIdentity,
} from "@/lib/grades-history/types";
import type { Meeting, Section } from "@/lib/sections/model";

const noDates = { start: null, end: null, raw: "" };

/** A real building meeting: Tuesday 10:00-11:00 in a campus building. */
export function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    room: "LOT 150",
    buildingCode: "LOT",
    buildingId: "lot",
    buildingName: "Logan Hall",
    kind: "building",
    offCampus: false,
    day: "Tue",
    startMinutes: 600,
    endMinutes: 660,
    dates: noDates,
    instructor: { display: null, raw: "Staff" },
    async: false,
    tba: false,
    ...overrides,
  };
}

/** An in-person open section with seats, meeting Tuesday 10:00-11:00, taught by Jane Smith. */
export function section(overrides: Partial<Section> = {}): Section {
  const meetings = overrides.meetings ?? [meeting()];
  return {
    id: "TEST-101-001",
    term: "spring-2027",
    courseCode: "TEST 101",
    sectionCode: "001",
    classNumbers: ["12345"],
    option: null,
    instructor: { display: "Jane Smith", raw: "Jane Smith" },
    seats: { open: 10, total: 30 },
    status: "open",
    rawStatus: "Open",
    session: { label: "Full Term", dates: noDates },
    components: [],
    meetings,
    online: false,
    async: false,
    tba: false,
    ...overrides,
  };
}

/** The identity id convention the grades-history parser uses: the JSON name pair. */
export function identity(firstName: string, lastName: string): InstructorIdentity {
  return { id: JSON.stringify([firstName, lastName]), name: `${firstName} ${lastName}`, firstName, lastName };
}

function gradeDataFor(counts: GradeCounts): GradeData {
  return {
    gradeA: counts.A ?? 0,
    gradeB: counts.B ?? 0,
    gradeC: counts.C ?? 0,
    gradeD: counts.D ?? 0,
    gradeF: counts.F ?? 0,
    gradeP: counts.P ?? 0,
    gradeNP: counts.NP ?? 0,
    gradeW: counts.W ?? 0,
    gradeWF: counts.WF ?? 0,
    gradeI: 0,
    gradePR: 0,
    gradeNPR: 0,
    gradeZ: 0,
    gradeSuppressed: 0,
    totalEnroll: (counts.A ?? 0) + (counts.B ?? 0) + (counts.C ?? 0) + (counts.D ?? 0) + (counts.F ?? 0),
  };
}

function sum(counts: GradeCounts): number {
  return Object.values(counts).reduce((total, n) => total + n, 0);
}

export function historySection(sectionNumber: string, instructor: InstructorIdentity, counts: GradeCounts): HistorySection {
  return { sectionNumber, instructor, counts, grades: gradeDataFor(counts), total: sum(counts) };
}

export function historyTerm(year: string, term: string, sections: HistorySection[]): HistoryTerm {
  const counts = sumCounts(sections.map((entry) => entry.counts));
  return { year, term, sections, counts, grades: gradeDataFor(counts), total: sum(counts) };
}

export function courseHistory(courseCode: string, terms: HistoryTerm[]): CourseHistory {
  const rows = terms.flatMap((term) => term.sections);
  const counts = sumCounts(rows.map((row) => row.counts));
  const [subject, number] = courseCode.split(" ");
  const course: CourseIdentity = { subject: subject ?? "", number: number ?? "", title: "Testing" };
  return {
    course,
    terms,
    sectionCount: rows.length,
    counts,
    grades: gradeDataFor(counts),
    gpa: gradeGpa(counts),
    total: sum(counts),
  };
}
