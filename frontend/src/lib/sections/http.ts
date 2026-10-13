import type { SectionSource } from "./model";

const headers = { "Cache-Control": "no-store" };
export function createSectionsHandlers(source: SectionSource) {
  return {
    async terms() { return Response.json({ terms: await source.getTerms() }, { headers }); },
    async course(term: string, subject: string, number: string) {
      if (!/^(spring|summer|fall)-\d{4}$/.test(term) || !/^[a-z]+$/i.test(subject) || !/^\d{3,4}[a-z]?$/i.test(number)) {
        return Response.json({ error: "Expected term season-YYYY, alphabetic subject and three- or four-digit course number with optional letter suffix" }, { status: 400, headers });
      }
      // Upstream failures are data states. 200 lets clients consume labeled samples
      // or an empty unavailable result, without an opaque upstream 500.
      return Response.json(await source.getCourseSections(term, `${subject.toUpperCase()} ${number.toUpperCase()}`), { headers });
    },
  };
}
