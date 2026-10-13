import { expect, test } from "bun:test";
import { courseReferences, inferStatuses, parseUntPrerequisite, untAdapter } from "../../src/lib/prereq";
import type { Evidence, Prerequisite, SchoolAdapter } from "../../src/lib/prereq";
import biology from "../../../courses/unt_biol_courses.json";

const assess = (text: string, evidence: Evidence = {}) => inferStatuses([
  { id: "target", credits: 3, prerequisite: parseUntPrerequisite(text).expression },
], evidence, untAdapter).statuses.get("target")!;
const credit = (courseId: string, grade = "C", credits?: number | null) => ({ courseId, grade, credits });

test("grade-qualified list retains every mandatory course and its threshold", () => {
  const text = "C or higher in: BIOL 1710, BIOL 1720, and BIOL 1750 or BIOL 1760 or BIOL 1761.";
  const transcript = [credit("BIOL 1710"), credit("BIOL 1720"), credit("BIOL 1760")];
  expect(assess(text, { transcript }).status).toBe("eligible");
  for (let index = 0; index < transcript.length; index++) {
    const failed = transcript.map((row, i) => i === index ? { ...row, grade: "D" } : row);
    expect(assess(text, { transcript: failed }).status).toBe("locked");
  }
  expect(assess(text, { transcript: transcript.slice(1) }).status).toBe("locked");
});

test("unsupported foundation conjunct retains grades on both lab pair and later chemistry course", () => {
  const text = biology.find(course => course.course_number === "BIOL4801")!.prerequisites;
  const parsed = parseUntPrerequisite(text);
  expect(parsed.coverage).toBe("partial");
  expect(courseReferences(parsed.expression)).toEqual(["BIOL 2041", "BIOL 2042", "CHEM 2380"]);
  const transcript = [credit("BIOL 2041"), credit("BIOL 2042"), credit("CHEM 2380", "D")];
  const result = assess(text, { transcript });
  expect(result.status).toBe("unknown");
  expect(JSON.stringify(result.reason)).toContain("CHEM 2380 requires C or better");
  expect(JSON.stringify(result.reason)).toContain('"outcome":"unmet"');
  expect(assess(text, { transcript: transcript.map(row => ({ ...row, grade: "A" })) }).status).toBe("unknown");
});

test("slash lecture/lab pair requires both passing courses", () => {
  const text = "C or higher in BIOL 2041 / BIOL 2042 and CHEM 2380";
  const transcript = [credit("BIOL 2041"), credit("BIOL 2042"), credit("CHEM 2380")];
  expect(assess(text, { transcript }).status).toBe("eligible");
  for (const row of transcript) expect(assess(text, { transcript: transcript.filter(other => other !== row) }).status).toBe("locked");
});

test("each repeated either group is mandatory and retains its grade minimum", () => {
  const text = "C or better in either BIOL 3451 / BIOL 3452 or BIOL 3350 and either CHEM 2380 or CHEM 3601";
  expect(assess(text, { transcript: [credit("CHEM 3601")] }).status).toBe("locked");
  expect(assess(text, { transcript: [credit("BIOL 3350")] }).status).toBe("locked");
  expect(assess(text, { transcript: [credit("BIOL 3350"), credit("CHEM 3601")] }).status).toBe("eligible");
  expect(assess(text, { transcript: [credit("BIOL 3451"), credit("CHEM 3601")] }).status).toBe("locked");
  expect(assess(text, { transcript: [credit("BIOL 3451"), credit("BIOL 3452"), credit("CHEM 3601")] }).status).toBe("eligible");
  const catalogText = biology.find(course => course.course_number === "BIOL4480")!.prerequisites;
  const catalogAssessment = assess(catalogText, { transcript: [credit("BIOL 3350"), credit("CHEM 3601", "D")] });
  expect(catalogAssessment.status).toBe("unknown");
  expect(JSON.stringify(catalogAssessment.reason)).toContain("CHEM 3601 requires C or better");
});

test("equivalence notes do not prevent the named course from satisfying the requirement", () => {
  const text = "JAPN 2050 or equivalent.";
  const parsed = parseUntPrerequisite(text);
  expect(parsed.annotations).toEqual(["Equivalent credit needs advisor confirmation: JAPN 2050 or equivalent"]);
  expect(assess(text, { transcript: [credit("JAPN 2050")] }).status).toBe("eligible");
  expect(assess(text, { transcript: [credit("OTHER 2050")] }).status).toBe("locked");
  expect(assess("CHEM 3220 or equivalent, and consent of directing professor", { transcript: [credit("CHEM 3220")] }).status).toBe("unknown");
});

test("planned or in-progress courses satisfy only plain corequisites", () => {
  const text = "BMEN 1300; BMEN 2210; BMEN 1400 or concurrent enrollment";
  const transcript = [credit("BMEN 1300"), credit("BMEN 2210")];
  for (const extra of [{ planned: ["BMEN 1400"] }, { inProgress: ["BMEN 1400"] }]) expect(assess(text, { transcript, ...extra }).status).toBe("eligible");
  expect(assess(text, { transcript }).status).toBe("locked");
  expect(assess("BMEN 1400", { planned: ["BMEN 1400"] }).status).toBe("locked");
  expect(assess("BMEN 1400 (may be taken concurrently)", { planned: ["BMEN 1400"] }).status).toBe("eligible");
  expect(assess("C or better in BMEN 1400 (may be taken concurrently)", { planned: ["BMEN 1400"] }).status).toBe("unknown");
});

test("explicit status override wins over a planned corequisite", () => {
  const result = assess("BMEN 1400 (may be taken concurrently)", { planned: ["BMEN 1400"], overrides: new Map([["BMEN 1400", { status: "locked", reason: "Plan was canceled" }]]) });
  expect(result.status).toBe("locked");
});

test("total hour thresholds honor exact boundaries and require known hours", () => {
  for (const threshold of [45, 60]) {
    const text = `Completion of at least ${threshold} hours of credit.`;
    expect(assess(text).status).toBe("unknown");
    expect(assess(text).reason.children?.[0].message).toContain("Check with advisor");
    expect(assess(text, { earnedHours: threshold - 1 }).status).toBe("locked");
    expect(assess(text, { earnedHours: threshold }).status).toBe("eligible");
  }
});

test("standing uses the adapter's documented hour mapping", () => {
  for (const [label, hours] of [["sophomore", 30], ["junior", 60], ["upper-level", 60], ["senior", 90]] as const) {
    expect(assess(`${label} standing`, { earnedHours: hours - 1 }).status).toBe("locked");
    expect(assess(`${label} standing`, { earnedHours: hours }).status).toBe("eligible");
    expect(assess(`${label} standing`, { standing: label }).status).toBe("unknown");
  }
  expect(assess("junior standing", { earnedHours: 90, standing: "freshman" }).status).toBe("locked");
});

test("hours sum passing accepted credits once per course, never plans or failed attempts", () => {
  const text = "Completion of at least 45 hours of credit.";
  const transcript = [credit("opaque:a", "C", 30), credit("opaque:a", "B", 30), credit("opaque:b", "B", 15), credit("opaque:c", "F", 50)];
  expect(assess(text, { transcript }).status).toBe("eligible");
  expect(assess(text, { transcript: transcript.filter(row => row.courseId !== "opaque:b"), planned: ["opaque:b"], inProgress: ["opaque:c"] }).status).toBe("locked");
  expect(assess(text, { transcript: [credit("opaque:a", "A", null)] }).status).toBe("unknown");
  expect(assess(text, { transcript: [credit("opaque:a", "A", 45)], needsReview: ["opaque:other"] }).status).toBe("unknown");
  expect(assess(text, { transcript: [credit("opaque:a", "A", 45)], overrides: new Map([["opaque:a", { status: "locked", reason: "Credit not accepted" }]]) }).status).toBe("locked");
});

test("closure never invents earned hours", () => {
  const requirement = parseUntPrerequisite("junior standing").expression;
  const catalog = [{ id: "passed", credits: 3, prerequisite: requirement }, { id: "target", credits: 3, prerequisite: requirement }];
  expect(inferStatuses(catalog, { transcript: [credit("passed", "A")] }, untAdapter).statuses.get("target")?.status).toBe("unknown");
  expect(inferStatuses(catalog, { transcript: [credit("passed", "A", 3)] }, untAdapter).statuses.get("target")?.status).toBe("locked");
});

test("scoped department hours and major restrictions remain mandatory advisor checks", () => {
  for (const text of ["ANTH major status, ANTH 2300, and have completed at least 60 hours", "ANTH 2300 and at least 15 hours of ANTH course work", "ANTH 2300 and minimum GPA of 3.00"]) {
    expect(parseUntPrerequisite(text).coverage).toBe("partial");
    expect(assess(text, { earnedHours: 150, transcript: [credit("ANTH 2300")] }).status).toBe("unknown");
  }
});

test("conditional major requirements do not infer courses for another major through closure", () => {
  for (const [text, code] of [
    ["Journalism major status: JOUR 1210, JOUR 2310. Journalism minor status: JOUR 2310", "JOUR 1210"],
    ["Computer science majors must complete CSCE 1030 and CSCE 1040; other majors must complete MATH 1710.", "CSCE 1040"],
  ]) {
    const prerequisite = parseUntPrerequisite(text).expression;
    const catalog = [{ id: "passed", credits: 3, prerequisite }, { id: "target", credits: 3, prerequisite: { kind: "course", courseId: code, source: code } satisfies Prerequisite }];
    expect(inferStatuses(catalog, { transcript: [credit("passed")] }, untAdapter).statuses.get("target")?.status).toBe("locked");
  }
});

test("optional hour mapping preserves existing adapter implementations", () => {
  const adapter: SchoolAdapter = { isPassingGrade: () => true, meetsMinimumGrade: () => true, meetsStanding: () => true };
  const catalog = [{ id: "target", credits: 3, prerequisite: { kind: "standing", minimum: "local", source: "local standing" } satisfies Prerequisite }];
  expect(inferStatuses(catalog, { standing: "local" }, adapter).statuses.get("target")?.status).toBe("eligible");
  expect(inferStatuses(catalog, { earnedHours: 200 }, adapter).statuses.get("target")?.status).toBe("unknown");
});

test("invalid hour evidence fails rather than guessing", () => {
  for (const hours of [NaN, Infinity, -1]) expect(() => assess("junior standing", { earnedHours: hours })).toThrow("earnedHours");
});
