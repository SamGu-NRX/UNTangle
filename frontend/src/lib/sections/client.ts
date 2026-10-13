import { createSectionsConfig, parseSectionsConfig, supportedTerms, vsbFileUrl, type SectionsConfig } from "./config";
import { readBoundedJson } from "./bounded-json";
import { realCourseResult, sampleProvenance } from "./results";
import { parseVsbSubject } from "./subject";
import { SectionSchemaError, type VsbTerm } from "./vsb";
import { parseProxyCourse, parseProxyTerms } from "./wire";
import type { CourseSections, Diagnostic, Freshness, SectionSource } from "./model";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Options = { config: SectionsConfig; fetcher?: Fetcher; now?: () => number; proxyBase?: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function proxySource(fetcher: Fetcher, base: string): SectionSource {
  const flights = new Map<string, Promise<CourseSections>>();
  async function request(path: string): Promise<unknown> {
    const response = await fetcher(`${base}${path}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Sections proxy ${path}: HTTP ${response.status}`);
    return response.json();
  }
  return {
    async getTerms() { return parseProxyTerms(await request("/terms")); },
    async freshness(term) {
      const terms = parseProxyTerms(await request("/terms"));
      return terms.find(t => t.id === term)?.freshness ?? unloaded(term);
    },
    async getCourseSections(term, code) {
      const [subject, number] = code.split(" ");
      const key = `${encodeURIComponent(term)}/${encodeURIComponent(subject)}/${encodeURIComponent(number)}`;
      let flight = flights.get(key);
      if (!flight) {
        flight = request(`/${key}`).then(raw => parseProxyCourse(raw, term, code)).finally(() => { flights.delete(key); });
        flights.set(key, flight);
      }
      return flight;
    },
  };
}
function unloaded(term: string): Freshness {
  return { status: "unavailable", checkedAt: null, updatedAt: null,
    diagnostic: { code: "upstream_error", message: `No subject data loaded for ${term}` } };
}

/** Client-safe SectionSource; direct mode only fetches bounded subject files. */
export function createBrowserSectionSource(options: Options): SectionSource {
  const config = createSectionsConfig(options.config);
  const fetcher = options.fetcher ?? fetch;
  const proxy = proxySource(fetcher, options.proxyBase ?? "/api/sections");
  if (config.mode === "proxy") return proxy;
  const now = options.now ?? Date.now;
  const subjects = new Map<string, { data: VsbTerm; checkedAt: number }>();
  const flights = new Map<string, Promise<{ data: VsbTerm; checkedAt: number }>>();
  const failures = new Map<string, { diagnostic: Diagnostic; retryAt: number }>();
  const termMetadata = new Map<string, { freshness: Freshness; provenance: CourseSections["provenance"] }>();
  function remember(result: CourseSections): CourseSections {
    termMetadata.set(result.term, { freshness: result.freshness, provenance: result.provenance });
    return result;
  }
  function termFreshness(term: string): Freshness {
    const fresh = termMetadata.get(term)?.freshness ?? unloaded(term);
    return fresh.status === "ok" && fresh.checkedAt && now() - Date.parse(fresh.checkedAt) >= 15 * 60_000
      ? { ...fresh, status: "stale" } : fresh;
  }
  async function subjectFile(term: string, subject: string) {
    const key = `${term}/${subject}`;
    const cached = subjects.get(key);
    if (cached && now() - cached.checkedAt < 15 * 60_000) return cached;
    let flight = flights.get(key);
    if (!flight) {
      flight = (async () => {
        const response = await fetcher(vsbFileUrl(config, term, subject), { mode: "cors", credentials: "omit", redirect: "error", cache: "no-cache", signal: AbortSignal.timeout(15_000) });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`Direct vsb ${term}/${subject}: HTTP ${response.status}`); }
        const data = parseVsbSubject(await readBoundedJson(response, config.maxDirectBytes), term, subject);
        const entry = { data, checkedAt: now() };
        subjects.set(key, entry);
        failures.delete(key);
        return entry;
      })().finally(() => { flights.delete(key); });
      flights.set(key, flight);
    }
    return flight;
  }
  return {
    async getTerms() {
      // Term listing uses the admitted config and already observed metadata;
      // it must not trigger a whole-term browser or server download.
      return supportedTerms.map(term => ({ ...term, freshness: termFreshness(term.id),
        provenance: termMetadata.get(term.id)?.provenance ?? sampleProvenance }));
    },
    async freshness(term) { return termFreshness(term); },
    async getCourseSections(term, courseCode) {
      if (!/^(spring|summer|fall)-\d{4}$/.test(term) || !/^[A-Z]+ \d{3,4}[A-Z]?$/.test(courseCode)) throw new Error(`Invalid sections request ${term}/${courseCode}`);
      const subject = courseCode.split(" ")[0];
      const key = `${term}/${subject}`;
      let diagnostic = failures.get(key)?.diagnostic ?? null;
      if (supportedTerms.some(t => t.id === term) && now() >= (failures.get(key)?.retryAt ?? 0)) {
        try {
          const entry = await subjectFile(term, subject);
          const fresh: Freshness = { status: "ok", checkedAt: new Date(entry.checkedAt).toISOString(), updatedAt: entry.data.provenance.updated_at, diagnostic: null };
          const real = realCourseResult(entry.data, fresh, courseCode);
          if (real) return remember(real);
          diagnostic = { code: "upstream_error", message: `Direct vsb ${term}/${subject} has no record for ${courseCode}; using proxy` };
        } catch (error) {
          diagnostic = { code: error instanceof SectionSchemaError ? "schema_error" : "upstream_error", message: `Direct vsb request failed; using proxy: ${errorMessage(error)}` };
          failures.set(key, { diagnostic, retryAt: now() + 60_000 });
        }
      }
      const cached = subjects.get(key);
      const priorReal = cached ? realCourseResult(cached.data, { status: "stale", checkedAt: new Date(cached.checkedAt).toISOString(),
        updatedAt: cached.data.provenance.updated_at, diagnostic }, courseCode) : null;
      let result: CourseSections;
      try { result = await proxy.getCourseSections(term, courseCode); }
      catch (error) {
        if (!priorReal) throw error;
        return remember({ ...priorReal, freshness: { ...priorReal.freshness, diagnostic: { code: "upstream_error",
          message: `${diagnostic?.message ?? "Direct data unavailable"}; proxy failed: ${errorMessage(error)}` } } });
      }
      // A failed fallback cannot replace a still usable real option with a
      // synthetic selection that has a different saved-plan identity.
      if (priorReal && result.provenance.kind === "sample") return remember({ ...priorReal,
        freshness: { ...priorReal.freshness, diagnostic: result.freshness.diagnostic ?? diagnostic } });
      return remember({ ...result, freshness: { ...result.freshness, diagnostic: result.freshness.diagnostic ?? diagnostic } });
    },
  };
}

export async function loadBrowserSectionSource(fetcher: Fetcher = fetch): Promise<SectionSource> {
  const response = await fetcher("/api/sections/config", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Sections configuration: HTTP ${response.status}`);
  return createBrowserSectionSource({ config: parseSectionsConfig(await response.json()), fetcher });
}
