import { inferStatuses, untAdapter } from "../../src/lib/prereq";
import type { CatalogCourse, Evidence, InferenceResult, Prerequisite } from "../../src/lib/prereq";

export const courseRef = (courseId: string): Prerequisite => ({ kind: "course", courseId, source: courseId });
export const and = (...children: Prerequisite[]): Prerequisite => ({ kind: "and", children, source: "all" });
export const consent = (authority = "instructor consent"): Prerequisite => ({ kind: "consent", authority, source: authority });
export const row = (id: string, prerequisite: Prerequisite = and(), credits = 3): CatalogCourse => ({ id, credits, prerequisite });
export const pass = (courseId: string, grade = "B") => ({ courseId, grade });
export const assess = (catalog: CatalogCourse[], evidence: Evidence = {}): InferenceResult =>
  inferStatuses(catalog, evidence, untAdapter);
