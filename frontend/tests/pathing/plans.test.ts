import { expect, test } from "bun:test";
import { listCourses } from "../../src/lib/pathing/requirements";
import type { Requirement, RequirementSet } from "../../src/lib/pathing/types";
import type { CatalogCourse, CourseId } from "../../src/lib/prereq";
import { and, row } from "./fixtures";
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
  // The UCC page's own per-area hour totals, keyed by the plans' top-level names.
  const areas: ReadonlyArray<[string, number, number]> = [
    ["UCC Communication, Group 1", 1, 3],
    ["UCC Communication, Group 2", 1, 3],
    ["UCC Mathematics", 1, 3],
    ["UCC Life and Physical Sciences, 6 hours", 2, 6],
    ["UCC Language, Philosophy and Culture", 1, 3],
    ["UCC Creative Arts", 1, 3],
    ["UCC American History, 6 hours", 2, 6],
    ["UCC Government/Political Science, 6 hours", 2, 6],
    ["UCC Social and Behavioral Sciences", 1, 3],
  ];
  // The CS plan predates the shared-requirement convention (PR #70) and does not
  // carry UCC groups; the 15 plans copied from hyperlinked catalog pages do.
  for (const plan of plans.filter((candidate) => candidate !== csBs2026)) {
    const byName = new Map(plan.requirements.map((requirement) => [requirement.name, requirement]));
    let total = 0;
    for (const [name, count, hours] of areas) {
      const requirement = byName.get(name);
      expect(requirement?.kind).toBe("choose");
      expect(requirement, `${plan.name} misses ${name}`).toBeDefined();
      if (requirement?.kind === "choose") expect(requirement.count, `${plan.name}: ${name}`).toBe(count);
      total += hours;
    }
    const componentOption = byName.get("UCC Component Area Option, 6 hours");
    expect(componentOption?.kind, `${plan.name} misses the Component Area Option`).toBe("choice");
    total += 6;
    expect(total).toBe(42);
  }
});

test("integrative studies encodes three student-chosen 12-hour fields as pools", () => {
  const fields = integrativeStudiesBa2026.requirements.filter((requirement) => /^Field [123], 12 hours$/.test(requirement.name));
  expect(fields.length).toBe(3);
  for (const field of fields) {
    expect(field.kind).toBe("pool");
    if (field.kind === "pool") expect(field.hours).toBe(12);
  }
});
