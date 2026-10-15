// Catalog loader for the multi-semester degree-plan experiment.
//
// READ-ONLY over the app's generated catalog
// (frontend/src/lib/generated/seed-data.json). Nothing here regenerates,
// patches, or "fixes" catalog data — policy §7: no catalog data is fabricated
// to close a gap. Gaps are surfaced in an explicit ledger instead.
//
// Status vocabulary (the app's own three-way model, D/P/CR):
//   D  = "completed"  (UI label "Done")
//   P  = "inProgress" (UI label "Taking" — planned into the current term)
//   CR = "notTaken"   (UI label "Not taken" — courses remaining)
// See lib/semantics.mjs for the behavioral contract these imply.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const GENERATED_SEED_DATA = path.join(
  REPO_ROOT,
  "frontend/src/lib/generated/seed-data.json",
);

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

// Data quirks in the generated catalog that the planner must not silently
// absorb. Recorded verbatim; the engine refuses credit hours outside 1..30.
const KNOWN_CREDIT_QUIRK_LIMIT = 30;

export function loadCatalog({ seedDataPath = GENERATED_SEED_DATA } = {}) {
  const raw = JSON.parse(readFileSync(seedDataPath, "utf8"));
  const coursesById = new Map(raw.courses.map((course) => [course.code, course]));

  const prerequisiteEdges = [];
  const uncatalogedPrereqRefs = []; // { courseCode, prerequisiteCode }
  const selfPrereqRefs = []; // { courseCode } — courses listing themselves
  const creditQuirks = [];

  for (const course of raw.courses) {
    for (const prerequisiteCode of course.prerequisites) {
      prerequisiteEdges.push({ courseCode: course.code, prerequisiteCode });
      if (!coursesById.has(prerequisiteCode)) {
        uncatalogedPrereqRefs.push({ courseCode: course.code, prerequisiteCode });
      } else if (prerequisiteCode === course.code) {
        selfPrereqRefs.push({ courseCode: course.code });
      }
    }
    if (course.creditHours < 1 || course.creditHours > KNOWN_CREDIT_QUIRK_LIMIT) {
      creditQuirks.push({
        code: course.code,
        creditHours: course.creditHours,
        title: course.title,
      });
    }
  }

  return {
    sourcePath: seedDataPath,
    sourceSha256: sha256File(seedDataPath),
    courses: raw.courses,
    sections: raw.sections,
    defaultCourseStatuses: raw.courseStatuses,
    coursesById,
    prerequisiteEdges,
    gaps: {
      uncatalogedPrereqRefs,
      // Unique uncataloged codes referenced by at least one catalog course.
      uncatalogedPrereqCodes: [...new Set(uncatalogedPrereqRefs.map((e) => e.prerequisiteCode))].sort(),
      selfPrereqRefs,
      creditQuirks,
    },
  };
}

// ---------------------------------------------------------------------------
// Offering ledger
//
// The generated catalog carries NO term-offering information (no fall/spring/
// summer patterns anywhere in courses/*.json or seed-data.json). Any offering
// rule used by the planner is therefore an ASSUMPTION, recorded here and
// stamped onto every plan the engine emits — never a hidden rule.
// ---------------------------------------------------------------------------

export const OFFERING_ASSUMPTIONS = {
  defaultPattern: "F,S", // assumed offered every Fall and Spring
  summerOffered: false, // assumed: no summer sections (summer excluded from horizons)
  overrides: {}, // per-course overrides; empty because none are known
  provenance:
    "Derived 2026-10-10 from frontend/src/lib/generated/seed-data.json, which contains no offering metadata. Every offering decision in this experiment is an assumption, listed here and flagged on emitted plans.",
};

export function offeringFor(catalog, courseCode) {
  return OFFERING_ASSUMPTIONS.overrides[courseCode] ?? OFFERING_ASSUMPTIONS.defaultPattern;
}

export function offeredIn(catalog, courseCode, termKind) {
  // termKind: "F" | "S" | "Su"
  if (termKind === "Su") return OFFERING_ASSUMPTIONS.summerOffered;
  return offeringFor(catalog, courseCode).includes(termKind);
}

// ---------------------------------------------------------------------------
// Major universes: a major's core list closed under catalog prerequisites.
//
// Catalog-only prereq edges are followed; uncataloged prereq refs stay in the
// ledger per-course (they cannot be scheduled, only assumed or witnessed).
// ---------------------------------------------------------------------------

// Grounded evidence for the cyclic-prereq assumption: the raw catalog prose
// for the known 2-cycle states the concurrency explicitly. The generated
// catalog flattened it into hard prerequisite edges on both sides.
export const CYCLIC_PREREQ_EVIDENCE = [
  {
    cycle: ["CSCE 2100", "CSCE 2110"],
    source: "courses/unt_csce_courses.json (catalog.unt.edu, catoid 37)",
    prose:
      "CSCE 2100: \"Can be taken concurrently with CSCE 2110.\" — CSCE 2110: \"This course can be taken concurrently with CSCE 2100.\"",
    encoding:
      "Edges inside a cyclic strongly-connected component impose NO ordering constraint in this planner; they are recorded as gap class 'cyclic' and treated as co-requisites, matching the catalog prose.",
  },
];

function stronglyConnectedComponents(nodes, edges) {
  // Tiny-graph Kosaraju; universes here have ≤ 20 nodes.
  const adjacency = new Map(nodes.map((n) => [n, []]));
  const reverse = new Map(nodes.map((n) => [n, []]));
  for (const [from, to] of edges) {
    adjacency.get(from)?.push(to);
    reverse.get(to)?.push(from);
  }
  const visited = new Set();
  const order = [];
  const dfs = (node) => {
    const stack = [[node, false]];
    while (stack.length > 0) {
      const [current, processed] = stack.pop();
      if (processed) {
        order.push(current);
        continue;
      }
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push([current, true]);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) stack.push([next, false]);
      }
    }
  };
  nodes.forEach((node) => {
    if (!visited.has(node)) dfs(node);
  });
  const assigned = new Map();
  const components = [];
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const root = order[i];
    if (assigned.has(root)) continue;
    const component = [];
    const stack = [root];
    assigned.set(root, true);
    while (stack.length > 0) {
      const current = stack.pop();
      component.push(current);
      for (const next of reverse.get(current) ?? []) {
        if (!assigned.has(next)) {
          assigned.set(next, true);
          stack.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

export function majorUniverse(catalog, majorId) {
  const MAJORS = {
    cs: ["CSCE 1030", "CSCE 1040", "CSCE 2100", "MATH 1710", "MATH 1720"],
    ce: ["CSCE 1030", "CSCE 1040", "MATH 1710", "MATH 1720", "PHYS 2220"],
    math: ["MATH 1710", "MATH 1720", "MATH 2700"],
  };
  const core = MAJORS[majorId];
  if (!core) throw new Error(`unknown major id: ${majorId}`);

  const universe = new Set();
  const missingCore = [];
  const grow = (code) => {
    if (universe.has(code)) return;
    const course = catalog.coursesById.get(code);
    if (!course) {
      missingCore.push(code);
      return;
    }
    universe.add(code);
    course.prerequisites.forEach(grow);
  };
  core.forEach(grow);

  // Classify edges among universe courses. Self-references and intra-SCC
  // edges are gap classes, not ordering constraints.
  const universeCodes = [...universe];
  const candidateEdges = [];
  for (const code of universeCodes) {
    for (const p of catalog.coursesById.get(code).prerequisites) {
      if (catalog.coursesById.has(p) && p !== code) candidateEdges.push([code, p]);
    }
  }
  const components = stronglyConnectedComponents(universeCodes, candidateEdges);
  const cyclicMembers = new Set(
    components.filter((component) => component.length > 1).flatMap((component) => component),
  );

  const courses = [...universe].sort().map((code) => {
    const course = catalog.coursesById.get(code);
    const gapPrereqRefs = course.prerequisites
      .filter((p) => !catalog.coursesById.has(p) || p === code || (cyclicMembers.has(p) && cyclicMembers.has(code) && p !== code))
      .map((p) => ({
        code: p,
        kind: p === code ? "self" : cyclicMembers.has(p) && cyclicMembers.has(code) ? "cyclic" : "uncataloged",
      }));
    return {
      code,
      title: course.title,
      creditHours: course.creditHours,
      // Every catalog-listed prereq code — the full app edge list; used to
      // reproduce the app's locked/unlocked display state exactly.
      prereqRefs: [...course.prerequisites],
      // Enforceable ordering constraints: catalog courses other than itself,
      // minus intra-SCC (cyclic/co-requisite) edges.
      prereqs: course.prerequisites.filter(
        (p) => catalog.coursesById.has(p) && p !== code && !(cyclicMembers.has(p) && cyclicMembers.has(code)),
      ),
      // Explicitly encoded gaps:
      //   uncataloged — permanently unsatisfiable in the app
      //     (normalizePlannerState drops statuses for non-catalog codes);
      //   self — satisfied the moment the course itself is completed
      //     (setCourseStatus has no lock gate);
      //   cyclic — catalog prose marks the pair concurrently-takeable;
      //     the generated catalog flattened it into mutual prereq edges.
      gapPrereqRefs,
    };
  });

  return { majorId, core, universe: courses, missingCore };
}

// Academic-term labels for a planning horizon. Uses the app's chronology
// (frontend/src/lib/term-chronology.ts): within a calendar year
// Spring < Summer < Fall. Horizon starts the term after the anchor.
export function termLabels(anchor, horizon) {
  // anchor: { year, kind } where kind "S" | "F" ("Su" never anchors a plan
  // because summer is assumed to offer nothing).
  const order = ["S", "F"];
  const out = [];
  let { year, kind } = anchor;
  while (out.length < horizon) {
    const next = order[(order.indexOf(kind) + 1) % order.length];
    if (order.indexOf(next) === 0) year += 1;
    kind = next;
    out.push({ label: `${year} ${kind === "S" ? "Spring" : "Fall"}`, kind, year });
  }
  return out;
}
