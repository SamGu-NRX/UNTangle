import type { VsbTermCache } from "./cache";
import { getSampleSections, sampleProvenance } from "./sample";
import type { CourseSections, SectionSource } from "./model";

export const supportedTerms = [{ id: "spring-2027", label: "2027 Spring" }] as const;
export function createSectionSource(cache: VsbTermCache, terms: readonly { id: string; label: string }[] = supportedTerms): SectionSource {
  return {
    async getTerms() {
      return Promise.all(terms.map(async term => {
        const cached = await cache.get(term.id);
        return { ...term, freshness: cached.freshness, provenance: cached.data?.provenance ?? sampleProvenance };
      }));
    },
    async freshness(term) { return (await cache.get(term)).freshness; },
    async getCourseSections(term, courseCode): Promise<CourseSections> {
      const cached = await cache.get(term);
      const course = cached.data?.courses.get(courseCode);
      if (cached.data && course) return { term, courseCode, status: cached.freshness.status, freshness: cached.freshness,
        provenance: cached.data.provenance, availability: course.status === "no_classes" ? "no_classes" : "sections", sections: course.sections };
      const sections = getSampleSections(courseCode);
      return { term, courseCode, status: "unavailable", freshness: { ...cached.freshness, status: "unavailable" },
        provenance: sampleProvenance, availability: sections.length ? "sample" : "missing", sections };
    },
  };
}
