import { inferStatuses, untAdapter } from "../../src/lib/prereq";
import type { CatalogCourse, Evidence, InferenceResult, Prerequisite } from "../../src/lib/prereq";
import type { Requirement, RequirementSet } from "../../src/lib/pathing";

export const courseRef = (courseId: string): Prerequisite => ({ kind: "course", courseId, source: courseId });
export const and = (...children: Prerequisite[]): Prerequisite => ({ kind: "and", children, source: "all" });
export const or = (...children: Prerequisite[]): Prerequisite => ({ kind: "or", children, source: "any" });
export const consent = (authority = "instructor consent"): Prerequisite => ({ kind: "consent", authority, source: authority });
export const equivalent = (): Prerequisite => ({ kind: "unknown", detail: "equivalent", source: "or equivalent", escape: "equivalent" });
export const corequisite = (requirement: Prerequisite): Prerequisite => ({ kind: "corequisite", requirement, source: "coreq" });
export const minGrade = (grade: string, requirement: Prerequisite): Prerequisite => ({ kind: "minGrade", grade, requirement, source: grade });
export const row = (id: string, prerequisite: Prerequisite = and(), credits = 3): CatalogCourse => ({ id, credits, prerequisite });
export const pass = (courseId: string, grade = "B") => ({ courseId, grade });
/** A plan whose only requirement is every listed course, named "Required". */
export const require = (...courses: string[]): RequirementSet => plan({ kind: "all", name: "Required", courses });
export const plan = (...requirements: Requirement[]): RequirementSet => ({ name: "Test plan", requirements });
export const assess = (catalog: CatalogCourse[], evidence: Evidence = {}): InferenceResult =>
  inferStatuses(catalog, evidence, untAdapter);
