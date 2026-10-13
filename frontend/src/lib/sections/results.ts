import { activeDataset } from "../data-provenance";
import type { CourseSections, Freshness, Provenance } from "./model";
import type { VsbTerm } from "./vsb";

export const sampleProvenance: Extract<Provenance, { kind: "sample" }> = {
  kind: "sample", source: activeDataset.source, term: null, updated_at: null, note: activeDataset.label,
};
export function realCourseResult(data: VsbTerm, freshness: Freshness, courseCode: string): CourseSections | null {
  const course = data.courses.get(courseCode);
  if (!course) return null;
  return { term: data.id, courseCode, status: freshness.status, freshness, provenance: data.provenance,
    availability: course.status === "no_classes" ? "no_classes" : "sections", sections: course.sections };
}
