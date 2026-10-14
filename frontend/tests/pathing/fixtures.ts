import { inferStatuses, untAdapter } from "../../src/lib/prereq";
import type { CatalogCourse, Evidence, InferenceResult, Prerequisite } from "../../src/lib/prereq";
import type { RequirementSet } from "../../src/lib/pathing";

export const courseRef = (courseId: string): Prerequisite => ({ kind: "course", courseId, source: courseId });
export const and = (...children: Prerequisite[]): Prerequisite => ({ kind: "and", children, source: "all" });
export const or = (...children: Prerequisite[]): Prerequisite => ({ kind: "or", children, source: "any" });
export const consent = (authority = "instructor consent"): Prerequisite => ({ kind: "consent", authority, source: authority });
export const corequisite = (requirement: Prerequisite): Prerequisite => ({ kind: "corequisite", requirement, source: "coreq" });
export const minGrade = (grade: string, requirement: Prerequisite): Prerequisite => ({ kind: "minGrade", grade, requirement, source: grade });
export const row = (id: string, prerequisite: Prerequisite = and(), credits = 3): CatalogCourse => ({ id, credits, prerequisite });
export const pass = (courseId: string, grade = "B") => ({ courseId, grade });
/** A requirement set over course rows: every id listed here is required outright. */
export const require = (...requiredCourseIds: string[]): RequirementSet => ({ requiredCourseIds });
export const assess = (catalog: CatalogCourse[], evidence: Evidence = {}): InferenceResult =>
  inferStatuses(catalog, evidence, untAdapter);
