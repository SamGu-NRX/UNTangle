import {
  classNumberPattern,
  coursePattern,
  diagnose,
  maxBytes,
  retryMs,
  supportedTerms,
  termPattern,
  timeoutMs,
  ttlMs,
  vsbUrl,
} from "./config";
import type { CourseSections, Diagnostic, Section } from "./model";
import { sampleResult } from "./sample";
import { courseResult, parseTerm, type VsbFile, type VsbTerm } from "./vsb";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type ProxyOptions = {
  fetcher?: Fetcher;
  now?: () => number;
  /** Keeps a background refresh alive after the response has been sent. */
  retain?: (work: Promise<void>) => void;
};

/** What is cached for one vsb file. */
type Slot = {
  data: VsbTerm | null;
  checkedAt: number;
  etag: string | null;
  lastModified: string | null;
  diagnostic: Diagnostic | null;
  retryAt: number;
  flight: Promise<void> | null;
};

type Loaded = VsbFile | { data: null; diagnostic: Diagnostic | null };

export type ClassNumberMatch = { term: string; classNumber: string; courseCode: string; sectionId: string };

const userAgent = "UNTangle/1.0 (section proxy; https://github.com/SamGu-NRX/UNTangle)";
const noStore = { "Cache-Control": "no-store" };

async function readJson(response: Response): Promise<unknown> {
  const tooLarge = new Error(`vsb file exceeds ${maxBytes} bytes`);
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("vsb file has no body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge;
    }
    chunks.push(next.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Serves per-course slices of vsb's files from memory, with stale-while-revalidate.
 * The term file doubles as the subject index: a subject file is requested only for a
 * subject the loaded term contains, which also bounds the slots to real subjects.
 */
export class SectionsProxy {
  private readonly slots = new Map<string, Slot>();
  /** Per term: when to try subject files again after vsb had none for a real subject. */
  private readonly subjectFilesOffUntil = new Map<string, number>();
  /** Class number -> section, built once per parsed term file and dropped with it. */
  private readonly classIndex = new WeakMap<VsbTerm, Map<string, { courseCode: string; sectionId: string; primary: boolean }>>();
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly retain: (work: Promise<void>) => void;

  constructor(options: ProxyOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.retain = options.retain ?? (work => void work);
  }

  /** Handles GET /api/sections/[term]/[subject]/[number]. */
  async respond(term: string, subject: string, number: string): Promise<Response> {
    const courseCode = `${subject.toUpperCase()} ${number.toUpperCase()}`;
    if (!termPattern.test(term) || !coursePattern.test(courseCode)) {
      const error = "Expected a term like spring-2027, a 3-4 letter subject and a number like 1680";
      return Response.json({ error }, { status: 400, headers: noStore });
    }
    // Upstream failures are data states (stale or unavailable), so they still answer 200.
    return Response.json(await this.getCourseSections(term, courseCode), { headers: noStore });
  }

  /** Handles GET /api/sections/[term]/class/[number]: which section a myUNT class number belongs to. */
  async respondClassNumber(term: string, number: string): Promise<Response> {
    if (!termPattern.test(term) || !classNumberPattern.test(number)) {
      const error = "Expected a term like spring-2027 and a class number like 21843";
      return Response.json({ error }, { status: 400, headers: noStore });
    }
    const found = await this.findClassNumber(term, number);
    if (found === "unavailable") {
      return Response.json({ error: `${term} sections are unavailable right now` }, { status: 503, headers: noStore });
    }
    if (!found) return Response.json({ error: `No ${term} section has class number ${number}` }, { status: 404, headers: noStore });
    return Response.json(found, { headers: noStore });
  }

  /**
   * The section a class number names, from the term file. A number shared by
   * several options (a lab linked to more than one lecture) names the option
   * whose primary component it is, else the first that lists it. "unavailable"
   * when the term file could not be read, so a miss is never claimed blind.
   */
  async findClassNumber(term: string, number: string): Promise<ClassNumberMatch | null | "unavailable"> {
    if (!supportedTerms.some(supported => supported.id === term)) return null;
    const whole = await this.load(term);
    if (!whole.data) return "unavailable";
    let index = this.classIndex.get(whole.data);
    if (!index) {
      index = new Map();
      for (const [courseCode, record] of whole.data.courses) {
        if (!Array.isArray(record)) continue;
        for (const section of record) {
          for (const component of section.components) {
            if (!component.classNumber) continue;
            const primary = component.role === "primary";
            const known = index.get(component.classNumber);
            if (!known || (primary && !known.primary)) index.set(component.classNumber, { courseCode, sectionId: section.id, primary });
          }
        }
      }
      this.classIndex.set(whole.data, index);
    }
    const hit = index.get(number);
    return hit ? { term, classNumber: number, courseCode: hit.courseCode, sectionId: hit.sectionId } : null;
  }

  async getCourseSections(term: string, courseCode: string): Promise<CourseSections> {
    const subject = coursePattern.exec(courseCode)?.[1];
    if (!subject) throw new Error(`Invalid course code ${JSON.stringify(courseCode)}`);
    if (!supportedTerms.some(supported => supported.id === term)) {
      const diagnostic = { code: "upstream_error", message: `No vsb source for ${term}` } as const;
      return sampleResult(term, courseCode, diagnostic);
    }
    let diagnostic: Diagnostic | null = null;
    for (const file of await this.files(term, subject)) {
      const result = file.data ? courseResult(file, courseCode) : null;
      if (result && "sections" in result) return result;
      diagnostic ??= result ?? file.diagnostic;
    }
    return sampleResult(term, courseCode, diagnostic);
  }

  /** Every real section of one term, from the whole term file, for the
   * class-number lookups the extension preview makes before it knows a course
   * code. Null while the term file is unavailable; synthetic samples carry no
   * class numbers to look up. */
  async termSections(term: string): Promise<Section[] | null> {
    if (!termPattern.test(term)) return null;
    const whole = await this.load(term);
    if (!whole.data) return null;
    const sections: Section[] = [];
    for (const value of whole.data.courses.values()) {
      if (Array.isArray(value)) sections.push(...value);
    }
    return sections;
  }

  /** The subject file (when vsb has one) ahead of the term file. */
  private async files(term: string, subject: string): Promise<Loaded[]> {
    const whole = await this.load(term);
    const subjectFilesOff = this.now() < (this.subjectFilesOffUntil.get(term) ?? 0);
    if (!whole.data?.subjects.has(subject) || subjectFilesOff) return [whole];
    return [await this.load(term, subject), whole];
  }

  private async load(term: string, subject?: string): Promise<Loaded> {
    const key = subject ? `${term}/${subject}` : term;
    const slot = this.slots.get(key) ?? this.addSlot(key);
    const expired = !slot.data || this.now() - slot.checkedAt >= ttlMs;
    if (expired && !slot.flight && this.now() >= slot.retryAt) {
      slot.flight = this.refresh(slot, term, subject).finally(() => {
        slot.flight = null;
      });
      if (slot.data) this.retain(slot.flight);
    }
    if (!slot.data && slot.flight) await slot.flight;
    if (!slot.data) return { data: null, diagnostic: slot.diagnostic };
    return {
      data: slot.data,
      status: this.now() - slot.checkedAt >= ttlMs ? "stale" : "ok",
      checkedAt: new Date(slot.checkedAt).toISOString(),
      diagnostic: slot.diagnostic,
    };
  }

  private addSlot(key: string): Slot {
    const slot: Slot = {
      data: null,
      checkedAt: 0,
      etag: null,
      lastModified: null,
      diagnostic: null,
      retryAt: 0,
      flight: null,
    };
    this.slots.set(key, slot);
    return slot;
  }

  /** Never rejects: a failure is recorded on the slot and retried after `retryMs`. */
  private async refresh(slot: Slot, term: string, subject?: string): Promise<void> {
    const url = vsbUrl(term, subject);
    try {
      const headers = new Headers({ "User-Agent": userAgent, Accept: "application/json" });
      if (slot.etag) headers.set("If-None-Match", slot.etag);
      if (slot.lastModified) headers.set("If-Modified-Since", slot.lastModified);
      const response = await this.fetcher(url, {
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        slot.data = parseTerm(await readJson(response), term, subject);
        slot.etag = response.headers.get("etag");
        slot.lastModified = response.headers.get("last-modified");
      } else if (response.status !== 304 || !slot.data) {
        await response.body?.cancel();
        if (subject && response.status === 404) {
          // The term lists this subject, so a 404 means vsb has not published subject files.
          this.subjectFilesOffUntil.set(term, this.now() + ttlMs);
          return;
        }
        throw new Error(`vsb ${url}: HTTP ${response.status}`);
      }
      slot.checkedAt = this.now();
      slot.diagnostic = null;
      slot.retryAt = 0;
    } catch (error) {
      slot.diagnostic = diagnose(error);
      slot.retryAt = this.now() + retryMs;
    }
  }
}
