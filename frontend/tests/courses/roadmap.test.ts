import { describe, expect, test } from "bun:test";
import { auditProgram, type AuditCourse, type ClaimedCourse } from "@untangle/core/degree/audit";
import { planRoadmap, type Roadmap } from "@untangle/core/degree/roadmap";
import type { ProgramData } from "@untangle/core/degree/types";
import { auditCourses } from "@/components/courses/model/degree";
import { buildRoadmap, CREDIT_LIMITS, parseTerm, planCatalog, plannedFact, requiresOf, roadmapNote, roadmapSummary, unplacedFact } from "@/components/courses/model/roadmap";
import { sampleTranscript } from "@/components/courses/model/sample-transcript";
import { untProfile } from "@/components/courses/school";
import { DEGREE_DATA } from "@/lib/degree/programs.generated";
import { untAdapter, type Prerequisite } from "@/lib/prereq";
import type { TranscriptCourseRecord } from "@/lib/types";

/**
 * The roadmap on the real UNT data: every program the degree data holds,
 * with the University Core, through the same catalog Courses reads. Every
 * placement is checked against the prerequisite engine's own tree by an
 * evaluator written here, not the planner's, and the audit confirms the
 * roadmap's courses meet every requirement it doesn't report as open.
 */

const profile = untProfile();
const core = DEGREE_DATA.programs.find((program) => program.id === "core")!;
const majors = DEGREE_DATA.programs.filter((program) => program.id !== "core");
const START = parseTerm(profile.planningTerm);

function snapshot(transcript: readonly TranscriptCourseRecord[], planned: string[] = []) {
  const statuses = Object.fromEntries(transcript.map((record) => [record.code, record.appliedStatus === "completed" ? ("completed" as const) : ("inProgress" as const)]));
  return { statuses, transcript, manualCredit: new Set<string>(), planned: new Set(planned) };
}

const RECORDS = { empty: auditCourses(profile, snapshot([])), sample: auditCourses(profile, snapshot(sampleTranscript)) };

/** The engine's rule for a course, met by courses done before the term (and, inside a corequisite, in it). */
function holds(node: Prerequisite, before: ReadonlySet<string>, sameTerm: ReadonlySet<string>, earned: number, concurrent = false): boolean {
  switch (node.kind) {
    case "course":
      return before.has(node.courseId) || (concurrent && sameTerm.has(node.courseId));
    case "and":
      return node.children.every((child) => holds(child, before, sameTerm, earned, concurrent));
    case "or":
      return node.children.some((child) => holds(child, before, sameTerm, earned, concurrent));
    case "minGrade":
      return holds(node.requirement, before, sameTerm, earned, concurrent);
    case "corequisite":
      return holds(node.requirement, before, sameTerm, earned, true);
    case "standing": {
      const hours = untAdapter.minimumHours?.(node.minimum);
      return hours === undefined || earned >= hours;
    }
    case "consent":
    case "unknown":
      return true;
  }
}

function onRecord(record: readonly (AuditCourse | ClaimedCourse)[]): { codes: Set<string>; earned: number } {
  const credits = new Map<string, number>();
  for (const course of record) {
    const counts = course.sourceKind === "claimed" || course.inProgress || !["F", "W", "I", "NP", "Z"].includes(course.grade ?? "");
    if (counts) credits.set(course.code, Math.max(credits.get(course.code) ?? 0, course.credits ?? 0));
  }
  return { codes: new Set(credits.keys()), earned: [...credits.values()].reduce((sum, value) => sum + value, 0) };
}

const ruleOf = (code: string) => profile.catalog.find((course) => course.id === code)!.prerequisite;

/** Every way a roadmap can be wrong for its input, as readable lines; an empty list is a valid roadmap. */
function violations(roadmap: Roadmap, programs: readonly ProgramData[], record: readonly (AuditCourse | ClaimedCourse)[], limit: number): string[] {
  const problems: string[] = [];
  const { codes: done, earned: earnedOnRecord } = onRecord(record);
  const before = new Set(done);
  let earned = earnedOnRecord;
  const seen = new Set<string>();
  for (const entry of roadmap.terms) {
    const label = `${entry.term.season} ${entry.term.year}`;
    const sum = entry.courses.reduce((total, course) => total + course.credits, 0);
    if (sum !== entry.credits) problems.push(`${label} says ${entry.credits} credits but holds ${sum}`);
    if (entry.credits > limit) problems.push(`${label} holds ${entry.credits} credits, over ${limit}`);
    const sameTerm = new Set(entry.courses.map((course) => course.code));
    for (const course of entry.courses) {
      if (seen.has(course.code)) problems.push(`${course.code} is placed twice`);
      if (done.has(course.code)) problems.push(`${course.code} is on the record but placed in ${label}`);
      seen.add(course.code);
      if (!holds(ruleOf(course.code), before, sameTerm, earned)) problems.push(`${course.code} is in ${label} before its prerequisites`);
    }
    for (const code of sameTerm) before.add(code);
    earned += entry.credits;
  }
  for (const course of roadmap.unplaced) if (seen.has(course.code)) problems.push(`${course.code} is both placed and unplaced`);
  const accounted = [...seen, ...roadmap.unplaced.map((course) => course.code)].sort();
  const left = roadmap.left.map((course) => course.code);
  if (JSON.stringify(accounted) !== JSON.stringify(left)) problems.push(`left lists ${left.length} courses; terms and unplaced hold ${accounted.length}`);

  // The degree with every course the roadmap still takes: what stays unmet must be an open item.
  const planned = left.map((code): AuditCourse => ({ code, grade: null, credits: profile.entries.get(code)?.credits ?? null, sourceKind: "current", inProgress: true, term: 99 }));
  for (const program of programs) {
    const result = auditProgram(program, [...record, ...planned], { gradeHistoryComplete: false });
    result.requirements.forEach((outcome, index) => {
      if (outcome.status !== "unsatisfied") return;
      const key = `${program.id}.${index}`;
      if (!roadmap.open.some((item) => item.key === key || item.key.startsWith(`${key}.`))) problems.push(`${program.id} "${outcome.name}" is still unmet and not reported open`);
    });
  }
  return problems;
}

describe("every major on alpha", () => {
  test("the degree data holds the five majors the roadmap covers", () => {
    expect(majors.map((program) => program.id)).toEqual(["cs-bs", "ce-bs", "it-bs", "cybersecurity-bs", "ee-bs"]);
  });

  for (const program of majors) {
    for (const [recordName, record] of Object.entries(RECORDS)) {
      for (const limit of CREDIT_LIMITS) {
        test(`${program.id}, ${recordName} record, ${limit} credits: a valid roadmap`, () => {
          const input = { programs: [program, core], record, catalog: planCatalog(profile), start: START, creditLimit: limit };
          const roadmap = planRoadmap(input);
          expect(violations(roadmap, input.programs, record, limit)).toEqual([]);
          // Most of each degree is placeable from UNTangle's catalog.
          expect(roadmap.terms.flatMap((entry) => entry.courses).length).toBeGreaterThan(20);
          expect(planRoadmap(input)).toEqual(roadmap);
        });
      }
    }
  }

  test("the check above catches a roadmap out of order, over its limit, or hiding an open requirement", () => {
    const programs = [majors[0]!, core];
    const roadmap = planRoadmap({ programs, record: RECORDS.empty, catalog: planCatalog(profile), start: START, creditLimit: 15 });
    expect(violations({ ...roadmap, terms: [...roadmap.terms].reverse() }, programs, RECORDS.empty, 15).some((line) => line.includes("before its prerequisites"))).toBe(true);
    expect(violations(roadmap, programs, RECORDS.empty, 12).some((line) => line.includes("over 12"))).toBe(true);
    expect(roadmap.open.length).toBeGreaterThan(0);
    expect(violations({ ...roadmap, open: [] }, programs, RECORDS.empty, 15).some((line) => line.includes("not reported open"))).toBe(true);
  });

  test("a lower limit never finishes sooner", () => {
    for (const program of majors) {
      const lengths = CREDIT_LIMITS.map((limit) => planRoadmap({ programs: [program, core], record: RECORDS.empty, catalog: planCatalog(profile), start: START, creditLimit: limit }).terms.length);
      expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    }
  });
});

describe("buildRoadmap", () => {
  test("a major the degree audit doesn't cover has no roadmap", () => {
    expect(buildRoadmap(profile, snapshot([]), { id: "math" }, 15)).toBeNull();
  });

  test("courses in the tray stay in the planning term, and the sample's courses aren't planned again", () => {
    const roadmap = buildRoadmap(profile, snapshot(sampleTranscript, ["CSCE 2100", "CSCE 2110"]), { id: "cs" }, 15)!;
    expect(roadmap.terms[0]!.term).toEqual({ season: "spring", year: 2027 });
    const first = roadmap.terms[0]!.courses.filter((course) => course.why.kind === "pinned").map((course) => course.code);
    expect(first).toEqual(["CSCE 2100", "CSCE 2110"]);
    const placed = roadmap.terms.flatMap((entry) => entry.courses.map((course) => course.code));
    for (const code of ["MATH 1710", "ENGL 1310", "CSCE 1040", "ENGL 1320"]) expect(placed).not.toContain(code);
  });

  test("a term label the roadmap can't read fails loudly", () => {
    expect(() => parseTerm("Spring27")).toThrow('"Spring27" isn\'t a term the roadmap can start from, such as "Spring 2027".');
  });
});

describe("the catalog the roadmap reads", () => {
  const node = (source: string, rest: object) => ({ source, ...rest }) as Prerequisite;

  test("grade minimums become their course, corequisites become this term or earlier, standing becomes credits", () => {
    const rule = node("CSCE 2100 rule", {
      kind: "and",
      children: [
        node("C or better in CSCE 1040", { kind: "minGrade", grade: "C", requirement: node("CSCE 1040", { kind: "course", courseId: "CSCE 1040" }) }),
        node("MATH 1710 (may be taken concurrently)", { kind: "corequisite", requirement: node("MATH 1710", { kind: "course", courseId: "MATH 1710" }) }),
        node("Senior standing", { kind: "standing", minimum: "senior" }),
        node("consent of department", { kind: "consent", authority: "department" }),
        node(" for CSE majors only ", { kind: "unknown", detail: "", scope: "clause" }),
      ],
    });
    expect(requiresOf(rule, untAdapter)).toEqual({
      kind: "and",
      children: [
        { kind: "course", code: "CSCE 1040" },
        { kind: "concurrent", requirement: { kind: "course", code: "MATH 1710" } },
        { kind: "credits", min: 90 },
        { kind: "check", text: "consent of department" },
        { kind: "check", text: "for CSE majors only" },
      ],
    });
  });

  test("a standing the school has no hours for becomes an advisor check", () => {
    expect(requiresOf(node("Graduate standing", { kind: "standing", minimum: "graduate" }), untAdapter)).toEqual({ kind: "check", text: "Graduate standing" });
  });

  test("every catalog course is there, with its catalog credits", () => {
    const catalog = planCatalog(profile);
    expect(catalog.size).toBe(profile.catalog.length);
    expect(catalog.get("CSCE 4901")?.credits).toBe(3);
    expect(planCatalog(profile)).toBe(catalog);
  });
});

describe("the roadmap's sentences", () => {
  const catalog = new Map([
    ["A 1000", { code: "A 1000", credits: 3, requires: { kind: "and" as const, children: [] } }],
    ["B 2000", { code: "B 2000", credits: 3, requires: { kind: "course" as const, code: "A 1000" } }],
    ["C 2000", { code: "C 2000", credits: 3, requires: { kind: "course" as const, code: "GONE 1000" } }],
  ]);
  const citation = { page: "p.html", url: "https://example.test", anchor: null, heading: "Major" };
  const program: ProgramData = {
    id: "major",
    name: "Major",
    catalogId: "unt-test",
    sourceUrl: citation.url,
    coreSharedCourses: [],
    courseSharing: "forbidden",
    requirements: [{ kind: "all", name: "Major", citation, items: ["B 2000", "C 2000"].map((code) => ({ alternatives: [{ must: [code] }] })) }],
  };
  const roadmap = planRoadmap({ programs: [program], record: [], catalog, start: { season: "spring", year: 2027 }, creditLimit: 15 });

  test("a placed course names the term and what it follows", () => {
    expect(roadmapNote("B 2000", roadmap, catalog)).toBe("The roadmap puts it in Fall 2027, after A 1000 in Spring 2027.");
    expect(roadmapNote("A 1000", roadmap, catalog)).toBe("The roadmap puts it in Spring 2027. Its catalog entry lists no prerequisites. It's on the roadmap because B 2000 needs it first.");
    expect(roadmapNote("NOT 1000", roadmap, catalog)).toBeNull();
  });

  test("an unplaced course says why, in the row and in the detail", () => {
    const gone = roadmap.unplaced.find((course) => course.code === "GONE 1000")!;
    const blocked = roadmap.unplaced.find((course) => course.code === "C 2000")!;
    expect(unplacedFact(gone)).toBe("Not in UNTangle's catalog");
    expect(unplacedFact(blocked)).toBe("Needs GONE 1000 first");
    expect(roadmapNote("C 2000", roadmap, catalog)).toBe("It isn't in a term yet. It needs GONE 1000 first, and the roadmap can't place that course either.");
  });

  test("a row shows a fact only for a course no requirement names", () => {
    const placed = roadmap.terms.flatMap((entry) => entry.courses);
    expect(placed.map((course) => [course.code, plannedFact(course)])).toEqual([
      ["A 1000", "For B 2000"],
      ["B 2000", null],
    ]);
  });

  test("the summary counts the terms and names the last", () => {
    expect(roadmapSummary(roadmap)).toBe("2 terms, through Fall 2027");
    expect(roadmapSummary({ ...roadmap, terms: [], unplaced: [], open: [] })).toBe("Nothing left");
  });
});
