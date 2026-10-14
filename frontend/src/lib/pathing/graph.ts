import { courseReferences } from "@/lib/prereq";
import type { CourseId, InferenceResult, Major } from "@/lib/prereq";

/** Sorts course ids the way the prerequisite engine does (code-point order). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Adjacency in the unlock direction: course id -> catalog courses that list it in
 * their prerequisite references. Edges are restricted to ids that exist in the
 * catalog, so references to courses the catalog does not carry create no edge.
 */
export function buildDependents(result: InferenceResult): Map<CourseId, Set<CourseId>> {
  const inCatalog = new Set(result.catalog.map((course) => course.id));
  const dependents = new Map<CourseId, Set<CourseId>>();
  for (const course of result.catalog) {
    for (const reference of courseReferences(course.prerequisite)) {
      if (!inCatalog.has(reference)) continue;
      const children = dependents.get(reference) ?? new Set<CourseId>();
      children.add(course.id);
      dependents.set(reference, children);
    }
  }
  return dependents;
}

/**
 * The major universe: union of the connected components (over prerequisite
 * references in either direction, catalog ids only) that contain a core course.
 * Core courses missing from the catalog are reported as warnings, not treated as nodes.
 */
export function majorUniverse(
  major: Major,
  result: InferenceResult,
  dependents: Map<CourseId, Set<CourseId>>,
): { universe: Set<CourseId>; warnings: string[] } {
  const inCatalog = new Set(result.catalog.map((course) => course.id));
  const undirected = new Map<CourseId, Set<CourseId>>();
  const link = (from: CourseId, to: CourseId) => {
    const neighbors = undirected.get(from) ?? new Set<CourseId>();
    neighbors.add(to);
    undirected.set(from, neighbors);
  };
  for (const [id, children] of dependents) for (const child of children) {
    link(id, child);
    link(child, id);
  }
  const universe = new Set<CourseId>();
  const warnings: string[] = [];
  for (const core of [...new Set(major.coreCourseCodes)].sort(compareIds)) {
    if (!inCatalog.has(core)) {
      warnings.push(`Core course ${core} is not in the catalog and is skipped.`);
      continue;
    }
    if (universe.has(core)) continue;
    universe.add(core);
    const queue = [core];
    for (let index = 0; index < queue.length; index++) {
      for (const neighbor of undirected.get(queue[index]) ?? new Set<CourseId>()) {
        if (universe.has(neighbor)) continue;
        universe.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return { universe, warnings };
}
