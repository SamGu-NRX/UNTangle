import { expect, test } from "bun:test";
import { unlockAnalysis } from "../../src/lib/pathing";
import { listCourses } from "../../src/lib/pathing/requirements";
import type { Requirement, RequirementSet } from "../../src/lib/pathing/types";
import type { CatalogCourse, CourseId } from "../../src/lib/prereq";
import { and, assess, pass, row } from "./fixtures";
import { accountingBba2026 } from "../../src/lib/pathing/plans/accounting-bba-2026-27";
import { bioBsBio2026 } from "../../src/lib/pathing/plans/biology-bsbio-2026-27";
import { communicationStudiesBa2026 } from "../../src/lib/pathing/plans/communication-studies-ba-2026-27";
import { computerEngineeringBs2026 } from "../../src/lib/pathing/plans/computer-engineering-bs-2026-27";
import { criminalJusticeBs2026 } from "../../src/lib/pathing/plans/criminal-justice-bs-2026-27";
import { csBs2026 } from "../../src/lib/pathing/plans/cs-bs-2026-27";
import { electricalEngineeringBs2026 } from "../../src/lib/pathing/plans/electrical-engineering-bs-2026-27";
import { englishBa2026 } from "../../src/lib/pathing/plans/english-ba-literature-2026-27";
import { financeBba2026 } from "../../src/lib/pathing/plans/finance-bba-2026-27";
import { integrativeStudiesBa2026 } from "../../src/lib/pathing/plans/integrative-studies-ba-2026-27";
import { kinesiologyBs2026 } from "../../src/lib/pathing/plans/kinesiology-bs-2026-27";
import { managementBba2026 } from "../../src/lib/pathing/plans/management-bba-2026-27";
import { marketingBba2026 } from "../../src/lib/pathing/plans/marketing-bba-2026-27";
import { mechanicalEnergyBs2026 } from "../../src/lib/pathing/plans/mechanical-energy-bs-2026-27";
import { psychBs2026 } from "../../src/lib/pathing/plans/psychology-bs-2026-27";
import { supplyChainBs2026 } from "../../src/lib/pathing/plans/supply-chain-bs-2026-27";

const plans: readonly RequirementSet[] = [
  accountingBba2026,
  bioBsBio2026,
  communicationStudiesBa2026,
  computerEngineeringBs2026,
  criminalJusticeBs2026,
  csBs2026,
  electricalEngineeringBs2026,
  englishBa2026,
  financeBba2026,
  integrativeStudiesBa2026,
  kinesiologyBs2026,
  managementBba2026,
  marketingBba2026,
  mechanicalEnergyBs2026,
  psychBs2026,
  supplyChainBs2026,
];

/** Every course id the plan names anywhere in its tree, in listing order. */
function collectCourses(requirement: Requirement): CourseId[] {
  switch (requirement.kind) {
    case "all":
      return [...requirement.courses];
    case "choose":
      return [...requirement.options];
    case "hours":
      return [...requirement.options];
    case "choice":
      return requirement.branches.flatMap((branch) => branch.requirements.flatMap(collectCourses));
    case "pool":
      return [];
  }
}

function collectAll(plan: RequirementSet): CourseId[] {
  return plan.requirements.flatMap(collectCourses);
}

/** Every requirement in the tree, depth-first, including choice branch requirements. */
function collectRequirements(requirement: Requirement): Requirement[] {
  if (requirement.kind === "choice") {
    return [
      requirement,
      ...requirement.branches.flatMap((branch) => branch.requirements.flatMap(collectRequirements)),
    ];
  }
  return [requirement];
}

test("every plan records a name, source, unchecked rules, and requirements", () => {
  for (const plan of plans) {
    expect(plan.name.trim().length).toBeGreaterThan(0);
    expect(plan.source).toBeDefined();
    expect(plan.source!.trim().length).toBeGreaterThan(0);
    expect(plan.notChecked).toBeDefined();
    expect(plan.notChecked!.length).toBeGreaterThan(0);
    expect(plan.requirements.length).toBeGreaterThan(0);
  }
});

test("every plan names its catalog source with the copied date", () => {
  for (const plan of plans) {
    // The 15 new plans copy the 2026-2027 catalog at catoid=40; the CS plan keeps
    // its original catoid=37 citation, which was correct when captured.
    expect(plan.source).toMatch(/catalog\.unt\.edu\/.*catoid=\d+/);
    expect(plan.source).toMatch(/copied 20\d\d-\d\d-\d\d/);
  }
});

test("every plan passes the engine's own validation (no course counts twice)", () => {
  for (const plan of plans) {
    const catalog: CatalogCourse[] = [...new Set(collectAll(plan))].map((id) => row(id, and()));
    expect(() => listCourses(plan, catalog)).not.toThrow();
  }
});

test("every plan carries the nine UCC component areas totaling 42 hours", () => {
  // Per-area hour totals from the UCC page; each listed component course is 3 hours,
  // so a selection group's hour target is its own course count times 3.
  const areas: ReadonlyArray<[string, number]> = [
    ["UCC Communication, Group 1", 3],
    ["UCC Communication, Group 2", 3],
    ["UCC Mathematics", 3],
    ["UCC Life and Physical Sciences, 6 hours", 6],
    ["UCC Language, Philosophy and Culture", 3],
    ["UCC Creative Arts", 3],
    ["UCC American History, 6 hours", 6],
    ["UCC Government/Political Science: US Political Behavior, 3 hours", 3],
    ["UCC Government/Political Science: Constitutions of the United States and Texas, 3 hours", 3],
    ["UCC Social and Behavioral Sciences", 3],
  ];
  // The CS plan predates the shared-requirement convention (PR #70) and does not
  // carry UCC groups; the 15 plans copied from hyperlinked catalog pages do.
  for (const plan of plans.filter((candidate) => candidate !== csBs2026)) {
    const byName = new Map(plan.requirements.map((requirement) => [requirement.name, requirement]));
    let total = 0;
    for (const [name, hours] of areas) {
      const requirement = byName.get(name);
      expect(requirement?.kind, `${plan.name} misses ${name}`).toBe("choose");
      if (requirement?.kind === "choose") {
        expect(requirement.count * 3, `${plan.name}: ${name} hour target`).toBe(hours);
      }
      total += hours;
    }
    const componentOption = byName.get("UCC Component Area Option, 6 hours");
    expect(componentOption?.kind, `${plan.name} misses the Component Area Option`).toBe("choice");
    if (componentOption?.kind === "choice") {
      expect(componentOption.branches.length).toBe(2);
      // Each catalog alternative must itself reach 6 hours, read from the plan's own
      // branch requirements rather than from the choice's display name.
      for (const branch of componentOption.branches) {
        const branchHours = branch.requirements.reduce(
          (sum, requirement) => sum + (requirement.kind === "hours" ? requirement.hours : 0),
          0,
        );
        expect(branchHours, `${plan.name}: ${branch.name}`).toBe(6);
      }
    }
    total += 6;
    expect(total).toBe(42);
  }
});

test("two-level rule pools stay advisor-checked instead of matching one level band", () => {
  // The engine's pool pattern covers a single 1000-band; catalog rules spanning
  // 3000 and 4000 levels cannot be expressed as a half-match, so these pools carry
  // no match and rely on advisor confirmation (encoding-notes.md).
  const advisorChecked: ReadonlyArray<[RequirementSet, string]> = [
    [managementBba2026, "Supporting field courses, 12 hours"],
    [marketingBba2026, "Approved supporting field courses, 9 hours"],
    [kinesiologyBs2026, "General interest area, 15 hours"],
    [communicationStudiesBa2026, "COMM 3000-4000 level courses, 12 hours"],
    [communicationStudiesBa2026, "COMM 3000-4000 level courses, 6 hours"],
  ];
  for (const [plan, name] of advisorChecked) {
    const requirement = plan.requirements.flatMap(collectRequirements).find((candidate) => candidate.name === name);
    expect(requirement?.kind, `${plan.name} misses ${name}`).toBe("pool");
    if (requirement?.kind === "pool") {
      expect(requirement.match, `${plan.name}: ${name} should stay advisor-checked`).toBeUndefined();
    }
  }
});

test("a completed international course meets accounting's one-of in the engine's analysis", () => {
  // FINA 4500 is one of the four catalog options for the international block;
  // passing it alone satisfies that requirement and nothing else.
  const international = ["BCIS 4730", "FINA 4500", "MGMT 4660", "MKTG 4280"];
  const communication = ["ENGL 1310", "ENGL 1320", "TECM 2700", "COMM 1010"];
  const catalog: CatalogCourse[] = [...international, ...communication].map((id) => row(id, and()));
  const analysis = unlockAnalysis(accountingBba2026, assess(catalog, { transcript: [pass("FINA 4500")] }));
  const internationalProgress = analysis.requirements.find(
    (requirement) => requirement.name === "International business course, 3 hours",
  );
  expect(internationalProgress?.met).toBe(true);
  const communicationProgress = analysis.requirements.find(
    (requirement) => requirement.name === "BBA communication requirements, 9 hours",
  );
  expect(communicationProgress?.met).toBe(false);
});

test("the BBA communication choice is met through Combination B", () => {
  const communication = ["ENGL 1310", "ENGL 1320", "TECM 2700", "COMM 1010"];
  const catalog: CatalogCourse[] = communication.map((id) => row(id, and()));
  const analysis = unlockAnalysis(
    accountingBba2026,
    assess(catalog, { transcript: [pass("ENGL 1310"), pass("ENGL 1320"), pass("TECM 2700")] }),
  );
  const communicationProgress = analysis.requirements.find(
    (requirement) => requirement.name === "BBA communication requirements, 9 hours",
  );
  expect(communicationProgress?.met).toBe(true);
});

test("integrative studies encodes three student-chosen 12-hour fields as pools", () => {
  const fields = integrativeStudiesBa2026.requirements.filter((requirement) => /^Field [123], 12 hours$/.test(requirement.name));
  expect(fields.length).toBe(3);
  for (const field of fields) {
    expect(field.kind).toBe("pool");
    if (field.kind === "pool") expect(field.hours).toBe(12);
  }
});

test("the government area requires one course from each pair, per the statute", () => {
  // PSCI 2305 and PSCI 2315 are both US Political Behavior courses; the statutory
  // constitutions condition is unmet, so this pair must not complete the area.
  const government = ["PSCI 2305", "PSCI 2315", "PSCI 2306", "PSCI 2316"];
  const catalog: CatalogCourse[] = government.map((id) => row(id, and()));
  const behaviorName = "UCC Government/Political Science: US Political Behavior, 3 hours";
  const constitutionsName = "UCC Government/Political Science: Constitutions of the United States and Texas, 3 hours";

  const samePair = unlockAnalysis(
    accountingBba2026,
    assess(catalog, { transcript: [pass("PSCI 2305"), pass("PSCI 2315")] }),
  );
  const behavior = samePair.requirements.find((requirement) => requirement.name === behaviorName);
  const constitutions = samePair.requirements.find((requirement) => requirement.name === constitutionsName);
  expect(behavior?.met).toBe(true);
  expect(constitutions?.met).toBe(false);

  const split = unlockAnalysis(
    accountingBba2026,
    assess(catalog, { transcript: [pass("PSCI 2305"), pass("PSCI 2306")] }),
  );
  const governmentParts = split.requirements.filter(
    (requirement) => requirement.name === behaviorName || requirement.name === constitutionsName,
  );
  expect(governmentParts).toHaveLength(2);
  expect(governmentParts.every((requirement) => requirement.met)).toBe(true);
});
