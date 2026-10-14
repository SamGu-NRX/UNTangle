/**
 * The UNTangle planner client: the only code that reads or writes the
 * student's Main schedule. Every fetch carries credentials: "include" so the
 * browser attaches the existing Better Auth session cookie; the extension
 * never reads, stores, or sends credentials itself.
 *
 * Writes follow the server's contract (frontend/src/app/api/planner/route.ts
 * and frontend/src/lib/planner-save.ts): read the full state, merge one
 * entry, POST the whole state with X-Planner-Base-Revision, and retry a
 * bounded number of times when another writer won (409).
 */
import type { PlannerState } from "../shared/api-types";
import type { AddOutcome, ParsedSectionRow } from "../shared/messages";
import { TERM_PATTERN, UNTANGLE_ORIGIN } from "../config";
import type { ClassNumberMatch } from "../shared/api-types";

/** The planner GET payload. `state` is null when the student has no plan yet. */
export type PlannerSnapshot = { state: PlannerState | null; revision: number; persistent: boolean };

/** Minimal async key-value surface; chrome.storage.session in the worker, a Map in tests. */
export interface SessionCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const PLANNER_CACHE_KEY = "planner:snapshot";

/** Structural read of the planner payload; mirrors the route's own echo discipline. */
export function parseSnapshot(raw: unknown): PlannerSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const state = record.state;
  if (state !== null && (typeof state !== "object" || !isSectionMap((state as Record<string, unknown>).selectedSections))) {
    return null;
  }
  return {
    state: state as PlannerState | null,
    revision: typeof record.revision === "number" && Number.isInteger(record.revision) && record.revision >= 0 ? record.revision : 0,
    persistent: record.persistent !== false,
  };
}

function isSectionMap(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && Object.values(value).every(entry => typeof entry === "string");
}

async function readSnapshot(cache: SessionCache): Promise<PlannerSnapshot | null> {
  const cached = await cache.get(PLANNER_CACHE_KEY);
  return cached ? parseSnapshot(cached) : null;
}

export class PlannerClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly base: string = UNTANGLE_ORIGIN,
    private readonly cache: SessionCache,
  ) {}

  /** The student's planner snapshot, from cache when this session already loaded it. */
  async load(): Promise<{ ok: true; snapshot: PlannerSnapshot } | { ok: false; status: number; error?: string }> {
    const cached = await readSnapshot(this.cache);
    if (cached) return { ok: true, snapshot: cached };
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}/api/planner`, { credentials: "include" });
    } catch (error) {
      console.warn(`planner load failed:`, error);
      return { ok: false, status: 0, error: String(error) };
    }
    if (response.status === 401) return { ok: false, status: 401 };
    if (!response.ok) return { ok: false, status: response.status };
    const snapshot = parseSnapshot(await response.json());
    if (!snapshot) return { ok: false, status: response.status };
    await this.cache.set(PLANNER_CACHE_KEY, snapshot);
    return { ok: true, snapshot };
  }

  /**
   * Adds the row's section to the student's Main schedule: resolve the class
   * number, read-merge-write the full planner state, retry 409 a bounded
   * number of times. Every terminal outcome has visible row copy.
   */
  async addToMain(row: ParsedSectionRow): Promise<AddOutcome> {
    if (!TERM_PATTERN.test(row.term) || !/^\d{4,5}$/.test(row.classNumber)) return "not-found";
    const match = await this.resolveClassNumber(row.term, row.classNumber);
    if (match === "unavailable") return "failed";
    if (match === null) return "not-found";

    for (let attempt = 0; attempt < 3; attempt++) {
      const loaded = await this.load();
      if (!loaded.ok) return loaded.status === 401 ? "signed-out" : "failed";
      const current = loaded.snapshot;
      if (current.state?.selectedSections[match.courseCode] === match.sectionId) return "already-scheduled";

      const state: PlannerState = current.state ?? emptyState();
      const next: PlannerState = {
        ...state,
        selectedSections: { ...state.selectedSections, [match.courseCode]: match.sectionId },
      };
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.base}/api/planner`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Required, not defaulted: a save that does not say which revision
            // it was based on could silently overwrite a newer save (428).
            "X-Planner-Base-Revision": String(current.revision),
          },
          body: JSON.stringify(next),
          credentials: "include",
        });
      } catch {
        return "failed";
      }
      if (response.ok) {
        const saved = parseSnapshot(await response.json());
        if (saved) await this.cache.set(PLANNER_CACHE_KEY, saved);
        return "added";
      }
      // A failed write must not leave the losing snapshot cached: the retry
      // has to re-read the server's current state, not replay this one.
      await this.cache.set(PLANNER_CACHE_KEY, undefined);
      if (response.status === 409) continue; // another write won; re-read and re-merge
      if (response.status === 401) return "signed-out";
      return "failed";
    }
    return "conflict-write";
  }

  /** GET /api/sections/{term}/class/{classNumber}; "unavailable" covers 503 and other errors. */
  async resolveClassNumber(term: string, classNumber: string): Promise<ClassNumberMatch | null | "unavailable"> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.base}/api/sections/${encodeURIComponent(term)}/class/${encodeURIComponent(classNumber)}`,
        { credentials: "include", cache: "no-store" },
      );
    } catch {
      return "unavailable";
    }
    if (response.status === 404) return null;
    if (!response.ok) return "unavailable";
    const raw: unknown = await response.json();
    if (!isClassNumberMatch(raw)) return "unavailable";
    return raw;
  }
}

function isClassNumberMatch(raw: unknown): raw is ClassNumberMatch {
  if (typeof raw !== "object" || raw === null) return false;
  const record = raw as Record<string, unknown>;
  return (
    typeof record.term === "string" &&
    typeof record.classNumber === "string" &&
    typeof record.courseCode === "string" &&
    typeof record.sectionId === "string"
  );
}

function emptyState(): PlannerState {
  return {
    courseStatuses: {},
    selectedSections: {},
    optimization: "compact",
    activeDay: "Mon",
    selectedMajor: null,
    transcriptRecords: [],
    updatedAt: "",
  };
}
