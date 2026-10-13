/**
 * Courses a student no longer needs because a course they passed required them.
 *
 * The engine already uses this closure for eligibility (a pass in CSCE 1040
 * satisfies "CSCE 1030" wherever it is required), but it leaves CSCE 1030's
 * own status as eligible or unknown, since closure proves no credit. The list
 * still has to say CSCE 1030 is covered, and Auto must not plan it, so this
 * walks the same mandatory edges the engine propagates: AND children and
 * grade-wrapped requirements. OR alternatives name no single course, and
 * co-requisites may have been taken alongside and failed, so neither implies
 * a specific course.
 */
import type { CatalogCourse, Prerequisite } from "@/lib/prereq";

function mandatoryCourses(node: Prerequisite): string[] {
  switch (node.kind) {
    case "course":
      return [node.courseId];
    case "and":
      return node.children.flatMap(mandatoryCourses);
    case "minGrade":
      return mandatoryCourses(node.requirement);
    default:
      return [];
  }
}

/**
 * @param done course ids with credit (transcript or a "done" override)
 * @param blocked ids with contrary evidence (a failing or unreviewed grade, a
 *   non-done override); closure neither marks nor walks through them
 * @returns covered course id -> the passed course that covers it
 */
export function coveredByCompletion(
  catalog: readonly CatalogCourse[],
  done: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
): Map<string, string> {
  const byId = new Map(catalog.map((course) => [course.id, course]));
  const covered = new Map<string, string>();
  for (const root of [...done].sort()) {
    const queue = mandatoryCourses(byId.get(root)?.prerequisite ?? { kind: "and", children: [], source: "" });
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      if (done.has(id) || blocked.has(id) || covered.has(id)) continue;
      covered.set(id, root);
      const prerequisite = byId.get(id)?.prerequisite;
      if (prerequisite) queue.push(...mandatoryCourses(prerequisite));
    }
  }
  return covered;
}
