import type { Prerequisite } from "./types";

export function courseReferences(node: Prerequisite): string[] {
  switch (node.kind) {
    case "course": return [node.courseId];
    case "and": case "or": return [...new Set(node.children.flatMap(courseReferences))];
    case "minGrade": case "corequisite": return courseReferences(node.requirement);
    default: return [];
  }
}

/** Source-independent identity lets closure reuse the same catalog requirement. */
export function requirementKey(node: Prerequisite): string {
  switch (node.kind) {
    case "course": return JSON.stringify([node.kind, node.courseId]);
    case "and": case "or": return JSON.stringify([node.kind, node.children.map(requirementKey).sort()]);
    case "minGrade": return JSON.stringify([node.kind, node.grade, requirementKey(node.requirement)]);
    case "corequisite": return JSON.stringify([node.kind, requirementKey(node.requirement)]);
    case "standing": return JSON.stringify([node.kind, node.minimum]);
    case "consent": return JSON.stringify([node.kind, node.authority]);
    case "unknown": return JSON.stringify([node.kind, node.source]);
  }
}

export function requiresAdvisor(node: Prerequisite): boolean {
  switch (node.kind) {
    case "consent": case "unknown": return true;
    case "and": case "or": return node.children.some(requiresAdvisor);
    case "corequisite": case "minGrade": return requiresAdvisor(node.requirement);
    default: return false;
  }
}
