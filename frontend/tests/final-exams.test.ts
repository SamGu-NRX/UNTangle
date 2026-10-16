/**
 * Each real section's final under UNT's Fall 2026 rule, moved into Spring
 * 2027's finals week (lib/final-exams.ts). Sections come from the committed
 * vsb fixture; the rule from lib/generated/unt-final-exams.ts.
 */
import { describe, expect, test } from "bun:test";
import { examOf, FINALS_SOURCE, unknownExamSentence } from "@/lib/final-exams";
import { buildOptimizeRequest, defaultSchedulePreferences, recommendSections, resolveSectionPlan } from "@/lib/planner";
import type { SectionCatalog } from "@/lib/planner-sections";
import type { Section } from "@/lib/sections";
import { defaultPlannerState } from "@/lib/seed-data";
import { meeting, section } from "./schedule-builder/fixtures";
import { courseAs, fixtureCatalog, fixtureInput, optionsOf, setDates } from "./sections/real-term";

const known = (date: string, start: number, end: number) => ({ kind: "known" as const, exam: { date, start, end }, projected: true });
const first = (catalog: ReturnType<typeof fixtureCatalog>, code: string) => optionsOf(catalog, code)[0];

describe("examOf on real Spring 2027 sections", () => {
  const catalog = fixtureCatalog();

  test("the projection is said, with its source", () => {
    expect(FINALS_SOURCE).toMatchObject({ term: "Fall 2026", planningTerm: "Spring 2027", projected: true });
  });

  test("a lecture with a linked lab goes by the lecture: TR 9:35 is Thursday 8 to 10", () => {
    // Fall's Thursday, Dec. 10 is Spring's Thursday, May 6. The Monday 8:00 lab would have made it Saturday.
    expect(examOf(first(catalog, "MATH 1680"))).toEqual(known("2027-05-06", 480, 600));
  });

  test("an evening class: Thursday 5:30 PM is Saturday 6 to 8 PM", () => {
    expect(examOf(first(catalog, "BCIS 4740"))).toEqual(known("2027-05-01", 1080, 1200));
  });

  test("Discovery Park has its own table", () => {
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "CSCE 2110", (row) => {
      row.linked_sections[0].room = "NTDP K150";
      row.meetings.forEach((line) => (line.room = line.room === "Cury 203" ? "NTDP K150" : line.room));
    });
    // Discovery Park, first meeting Tuesday, 9:30 to 10:20: Tuesday, Dec. 8, 10:30 to 12:30.
    expect(examOf(first(fixtureCatalog(input), "CSCE 2110"))).toEqual(known("2027-05-04", 630, 750));
  });

  test("a departmental final beats the grid", () => {
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "ACCT 2010");
    expect(examOf(first(fixtureCatalog(input), "ACCT 2010"))).toEqual(known("2027-05-05", 930, 1050));
  });

  test("unknown finals say why", () => {
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "SPAN 2040", (row) => setDates(row, "01/11/2027 - 03/05/2027"));
    const eightWeek = fixtureCatalog(input);
    const cases = [
      [first(catalog, "ACCT 5120"), "no-set-time", "It has no set meeting time, so the syllabus sets the final."],
      [first(catalog, "ADES 5510"), "no-set-time", "It has no set meeting time, so the syllabus sets the final."],
      [first(catalog, "DBAS 6003"), "other-site", "Frisco lists its own finals, and UNTangle doesn't read that list yet."],
      // Its dates are the first eight weeks even though vsb's label says the full term.
      [first(eightWeek, "SPAN 2040"), "unpublished", "First eight-week finals go by subject, and UNT hasn't set Spring 2027's times yet."],
      [first(catalog, "CSCE 1030"), "sample", "This sample section is made up, so it has no final."],
    ] as const;
    for (const [section, reason, sentence] of cases) {
      expect({ code: section.courseCode, exam: examOf(section) }).toEqual({ code: section.courseCode, exam: { kind: "unknown", reason } });
      expect(unknownExamSentence(section, reason)).toBe(sentence);
    }
  });
});

test("Auto's request carries each known final and leaves unknown ones off", () => {
  const input = fixtureInput();
  courseAs(input, "MATH 1680", "CSCE 2110", (row) => {
    row.linked_sections[0].room = "NTDP K150";
    row.meetings.forEach((line) => (line.room = line.room === "Cury 203" ? "NTDP K150" : line.room));
  });
  const state = {
    ...defaultPlannerState,
    courseStatuses: { "MATH 1680": "inProgress", "CSCE 2110": "inProgress", "CSCE 1030": "inProgress" },
    selectedSections: {},
  } as const;
  const request = buildOptimizeRequest(state, defaultSchedulePreferences("compact"), { catalog: fixtureCatalog(input) });
  const exams = Object.fromEntries(request.courses.map((course) => [course.code, course.sections.map((section) => section.exam ?? null)]));
  expect(exams).toEqual({
    "MATH 1680": [{ date: "2027-05-06", start: 480, end: 600 }],
    "CSCE 2110": [{ date: "2027-05-04", start: 630, end: 750 }],
    // Samples are made up: no final, so Auto checks nothing for them.
    "CSCE 1030": expect.arrayContaining([null]),
  });
  expect(exams["CSCE 1030"].every((exam) => exam === null)).toBe(true);
});

describe("the planner with finals", () => {
  // Monday 3:00 and Wednesday 3:00 classes both take Monday, Dec. 7, 1 to 3 under the Fall 2026 rule: May 3 in Spring.
  const csce = section({ courseCode: "CSCE 2110", meetings: [meeting({ day: "Mon", at: "15:00", until: "15:50" })] });
  const csceOther = section({ courseCode: "CSCE 2110", sectionCode: "002", meetings: [meeting({ day: "Tue", at: "8:00", until: "9:20" })] });
  const math = section({ courseCode: "MATH 1710", meetings: [meeting({ day: "Wed", at: "15:00", until: "15:50" })] });
  const engl = section({ courseCode: "ENGL 1310", meetings: (["Tue", "Thu"] as const).map((day) => meeting({ day, at: "11:00", until: "12:20" })) });
  // Two ENGL options, so the planner can't fall back on a lone option: ENGL is placed only if it is suggested.
  const englLate = section({ courseCode: "ENGL 1310", sectionCode: "002", meetings: (["Tue", "Thu"] as const).map((day) => meeting({ day, at: "17:30", until: "18:50" })) });
  const options: Record<string, Section[]> = { "CSCE 2110": [csce, csceOther], "MATH 1710": [math], "ENGL 1310": [engl, englLate] };
  const catalog: SectionCatalog = (code) => ({
    status: "ready",
    result: {
      term: "spring-2027",
      courseCode: code,
      diagnostic: null,
      sections: options[code] ?? [],
      status: "ok",
      availability: "sections",
      provenance: { kind: "real", source: "vsb.untgrades.app", updatedAt: "2026-10-04T00:00:00Z", note: "" },
      checkedAt: "2026-10-16T00:00:00Z",
    },
  });
  const plan = (selectedSections: Record<string, string>) =>
    ({
      ...defaultPlannerState,
      courseStatuses: { "CSCE 2110": "inProgress", "MATH 1710": "inProgress", "ENGL 1310": "inProgress" },
      selectedSections,
    }) as const;

  test("the current term's finals week is where projected finals land", () => {
    expect(FINALS_SOURCE.weekStart).toBe("2027-05-01");
    expect(examOf(csce)).toEqual(known("2027-05-03", 780, 900));
    expect(examOf(math)).toEqual(known("2027-05-03", 780, 900));
  });

  test("two picks whose finals overlap still leave the other courses a suggestion", () => {
    const sections = resolveSectionPlan(plan({ "CSCE 2110": csce.id, "MATH 1710": math.id }), catalog);
    const byCode = Object.fromEntries(sections.courses.map((course) => [course.code, [course.state, course.section?.id ?? null]]));
    expect(byCode).toEqual({
      "CSCE 2110": ["chosen", csce.id],
      "ENGL 1310": ["recommended", engl.id],
      "MATH 1710": ["chosen", math.id],
    });
  });

  test("a suggestion still steers clear of a pick's final when it can", () => {
    // CSCE 2110 001 would put its final on MATH 1710's; 002 doesn't.
    expect(recommendSections("compact", ["CSCE 2110", "MATH 1710"], { "MATH 1710": math.id }, catalog)).toEqual({
      "CSCE 2110": csceOther.id,
      "MATH 1710": math.id,
    });
  });

  test("Auto's request keeps the finals, so Auto itself never pairs them", () => {
    const request = buildOptimizeRequest(plan({ "CSCE 2110": csce.id, "MATH 1710": math.id }), defaultSchedulePreferences("compact"), { catalog });
    expect(request.courses.find((course) => course.code === "MATH 1710")!.sections[0].exam).toEqual({ date: "2027-05-03", start: 780, end: 900 });
  });
});
