import type { Prerequisite } from "./types";

export function courseReferences(node: Prerequisite): string[] {
  switch (node.kind) {
    case "course": return [node.courseId];
    case "and": case "or": return [...new Set(node.children.flatMap(courseReferences))];
    case "minGrade": case "corequisite": return courseReferences(node.requirement);
    default: return [];
  }
}

type Canonical = string | readonly Canonical[];

function compareCanonical(a: Canonical, b: Canonical): number {
  if (typeof a === "string") return typeof b === "string" ? a < b ? -1 : a > b ? 1 : 0 : -1;
  if (typeof b === "string") return 1;
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const order = compareCanonical(a[index], b[index]);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

function canonical(node: Prerequisite): Canonical {
  const escape = node.escape ?? "";
  switch (node.kind) {
    case "course": return [node.kind, escape, node.courseId];
    case "and": case "or": return [node.kind, escape, node.children.map(canonical).sort(compareCanonical)];
    case "minGrade": return [node.kind, escape, node.grade, canonical(node.requirement)];
    case "corequisite": return [node.kind, escape, canonical(node.requirement)];
    case "standing": return [node.kind, escape, node.minimum];
    case "consent": return [node.kind, escape, node.authority];
    case "unknown": return [node.kind, escape, node.source];
  }
}

/** Build a canonical tree and serialize once; child JSON strings would multiply escaping at every wrapper. */
export function requirementKey(node: Prerequisite): string {
  return JSON.stringify(canonical(node));
}

export function requiresAdvisor(node: Prerequisite): boolean {
  switch (node.kind) {
    case "consent": return true;
    case "unknown": return node.escape !== "equivalent";
    case "and": case "or": return node.children.some(requiresAdvisor);
    case "corequisite": case "minGrade": return requiresAdvisor(node.requirement);
    default: return false;
  }
}

/** Whether the complete expression can be witnessed, without selecting an escape branch. */
export function canSupplyClosure(node: Prerequisite): boolean {
  if (node.escape || node.kind === "consent" || node.kind === "unknown") return false;
  if (node.kind === "and" || node.kind === "or") return node.children.every(canSupplyClosure);
  if (node.kind === "corequisite" || node.kind === "minGrade") return canSupplyClosure(node.requirement);
  return true;
}

/** Only an explicitly attached escape bounds unparsed text; fallback OR prose may waive the whole rule. */
export function hasUnscopedEscape(node: Prerequisite): boolean {
  if (node.escape) return false;
  if (node.kind === "unknown") return true;
  if (node.kind === "and" || node.kind === "or") return node.children.some(hasUnscopedEscape);
  if (node.kind === "corequisite" || node.kind === "minGrade") return hasUnscopedEscape(node.requirement);
  return false;
}
