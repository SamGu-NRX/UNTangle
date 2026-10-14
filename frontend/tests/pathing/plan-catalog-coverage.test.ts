import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { buildPrerequisiteTable, renderPrerequisiteTable } from "../../src/lib/course-catalog/build";
import type { Requirement, RequirementSet } from "../../src/lib/pathing/types";

/**
 * Every plan must reference only courses the bundled catalog actually carries,
 * and the shipped prerequisite text must be exactly what the catalog copy
 * renders. A plan listing a course that never landed in `courses/*.json` (the
 * gap this guards: 13 courses the first CS plan referenced were missing) or a
 * stale prerequisites.json would otherwise fail silently at runtime.
 */

const normalize = (courseId: string) => courseId.replace(/\s+/g, "").toUpperCase();

/** The bundled catalog copy: every course code in `courses/*.json`. */
const catalogCodes = new Set(buildPrerequisiteTable().map(([code]) => code));

const courseIds = (requirement: Requirement): readonly string[] => {
  switch (requirement.kind) {
    case "all":
      return requirement.courses;
    case "choose":
      return [...requirement.options, ...Object.values(requirement.companions ?? {}).flat()];
    case "hours":
      return requirement.options;
    case "pool":
      // Rule-defined, so no course list to check; a matched pool still only
      // matches courses that exist in the catalog.
      return [];
    case "choice":
      return requirement.branches.flatMap((branch) => branch.requirements.flatMap(courseIds));
  }
};

const plans = readdirSync(resolve(import.meta.dir, "../../src/lib/pathing/plans"))
  .filter((name) => name.endsWith(".ts"))
  .map(async (name) => {
    const planModule = await import(`../../src/lib/pathing/plans/${name}`);
    return { name, sets: Object.values(planModule).filter((value): value is RequirementSet => (
      typeof value === "object" && value !== null && "requirements" in value
    )) };
  });

describe("plan-to-catalog coverage", () => {
  test("every course referenced by every plan exists in the bundled catalog", async () => {
    for (const plan of await Promise.all(plans)) {
      for (const set of plan.sets) {
        const missing = [...new Set(set.requirements.flatMap(courseIds).map(normalize))]
          .filter((code) => !catalogCodes.has(code));
        expect(missing, `${plan.name} (${set.name}) references courses missing from the catalog`).toEqual([]);
      }
    }
  });

  test("the shipped prerequisite text is exactly what the catalog copy renders", () => {
    const shipped = JSON.parse(
      readFileSync(new URL("../../src/lib/course-catalog/prerequisites.json", import.meta.url), "utf8"),
    ) as unknown;
    expect(shipped).toEqual(buildPrerequisiteTable());
    expect(shipped).toEqual(JSON.parse(renderPrerequisiteTable()));
  });
});
