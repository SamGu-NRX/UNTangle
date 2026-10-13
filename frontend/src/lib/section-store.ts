/**
 * The browser's copy of loaded course options. Each course is requested once
 * however many views ask for it, and kept for the life of the page. A request
 * that fails (UNTangle's own route unreachable, say) falls back to the
 * labeled samples, so nothing throws into the page; a later ask for that
 * course tries again once `retryMs` has passed. Cancelled options are
 * dropped here, so no view offers one and a saved pick of one needs review.
 */
import { sampleCatalog, type CourseOptions, type SectionCatalog } from "@/lib/planner-sections";
import { getCourseSections, type CourseSections } from "@/lib/sections";
import { diagnose, retryMs } from "@/lib/sections/config";
import { sampleResult } from "@/lib/sections/sample";

export type SectionStore = {
  catalog: SectionCatalog;
  /** Starts loading the courses that are neither loaded nor loading. */
  ensure: (courseCodes: readonly string[]) => void;
  /** Changes whenever a course finishes loading (for useSyncExternalStore). */
  version: () => number;
  subscribe: (listener: () => void) => () => void;
};

type Load = (term: string, courseCode: string) => Promise<CourseSections>;

const loading: CourseOptions = { status: "loading" };

export function createSectionStore(term: string, load: Load = getCourseSections, now: () => number = Date.now): SectionStore {
  const loaded = new Map<string, CourseOptions>();
  const inFlight = new Set<string>();
  /** Fallback results, by when to ask the route again. */
  const retryAt = new Map<string, number>();
  const listeners = new Set<() => void>();
  let version = 0;

  const settle = (courseCode: string, result: CourseSections) => {
    const offered = result.sections.filter((section) => section.status !== "cancelled");
    loaded.set(courseCode, { status: "ready", result: { ...result, sections: offered } });
    inFlight.delete(courseCode);
    version += 1;
    listeners.forEach((listener) => listener());
  };

  return {
    catalog: (courseCode) => loaded.get(courseCode) ?? loading,
    ensure(courseCodes) {
      for (const courseCode of new Set(courseCodes)) {
        const retry = retryAt.get(courseCode);
        if (inFlight.has(courseCode) || (loaded.has(courseCode) && (retry === undefined || now() < retry))) continue;
        inFlight.add(courseCode);
        load(term, courseCode).then(
          (result) => {
            retryAt.delete(courseCode);
            settle(courseCode, result);
          },
          (error: unknown) => {
            retryAt.set(courseCode, now() + retryMs);
            settle(courseCode, sampleResult(term, courseCode, diagnose(error)));
          },
        );
      }
    },
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Every course answered at once from the bundled samples: for tests, and for pages that must not fetch. */
export const sampleSectionStore: SectionStore = {
  catalog: sampleCatalog,
  ensure: () => {},
  version: () => 0,
  subscribe: () => () => {},
};
