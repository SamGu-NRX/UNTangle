import type { VsbTermCache } from "./cache";
import { getSampleSections } from "./sample";
import { realCourseResult, sampleProvenance } from "./results";
import { supportedTerms } from "./config";
import type { CourseSections, SectionSource } from "./model";

export { supportedTerms } from "./config";
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
      let cached = await cache.get(term, courseCode.split(" ")[0]);
      let real = cached.data ? realCourseResult(cached.data, cached.freshness, courseCode) : null;
      if (!real && cached.data) {
        cached = await cache.get(term);
        real = cached.data ? realCourseResult(cached.data, cached.freshness, courseCode) : null;
      }
      if (real) return real;
      const sections = getSampleSections(courseCode);
      return { term, courseCode, status: "unavailable", freshness: { ...cached.freshness, status: "unavailable" },
        provenance: sampleProvenance, availability: sections.length ? "sample" : "missing", sections };
    },
  };
}
