/**
 * State of the Week view's optimizer runs, as a reducer with no React in
 * it, plus the checks that decide whether a shown result may still be used.
 *
 * A result is tied to the inputs it was computed from (`resultKey`). Once
 * the preferences, locks or courses change, the result is stale: it stays
 * on screen for reference, but nothing in it can be applied.
 */
import type { BrowseReply, OptimizeReply } from "@/lib/optimizer/worker/protocol";
import type { EnumerateResult } from "@/lib/optimizer/enumerate";
import type { OptimizeRequest, OptimizeResult, RankedSchedule } from "@/lib/optimizer/types";
import type { OptimizationKey } from "@/lib/types";

export type RunState = {
  /** Newest job; replies to any other id are ignored. null after Close. */
  id: number | null;
  /** Inputs of the newest job. */
  inputKey: string | null;
  /** running: no answer yet. refining: first answer shown, a longer search is on. */
  status: "idle" | "running" | "refining" | "done" | "error";
  result: OptimizeResult | null;
  /** Inputs the shown result was computed from. */
  resultKey: string | null;
  error: string | null;
};

export const IDLE: RunState = { id: null, inputKey: null, status: "idle", result: null, resultKey: null, error: null };

export type RunAction =
  | { type: "start"; id: number; inputKey: string }
  | { type: "reply"; reply: OptimizeReply }
  | { type: "close" };

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "start":
      return { id: action.id, inputKey: action.inputKey, status: "running", result: null, resultKey: null, error: null };
    case "close":
      return IDLE;
    case "reply": {
      const { reply } = action;
      if (state.id === null || reply.id !== state.id) return state;
      if (reply.phase === "error") return { ...state, status: "error", error: reply.message };
      // The final answer replaces the first in place.
      return { ...state, status: reply.settled ? "done" : "refining", result: reply.result, resultKey: state.inputKey, error: null };
    }
  }
}

/** Browse all's run: one reply per job, so no refining phase. Stale like Auto's (`isStale` reads both). */
export type BrowseState = {
  id: number | null;
  inputKey: string | null;
  status: "idle" | "running" | "done" | "error";
  result: EnumerateResult | null;
  resultKey: string | null;
  error: string | null;
};

export const BROWSE_IDLE: BrowseState = { id: null, inputKey: null, status: "idle", result: null, resultKey: null, error: null };

export type BrowseAction =
  | { type: "start"; id: number; inputKey: string }
  | { type: "reply"; reply: BrowseReply }
  | { type: "close" };

export function browseReducer(state: BrowseState, action: BrowseAction): BrowseState {
  switch (action.type) {
    case "start":
      // The previous list stays on screen, disabled as stale, until the new one arrives.
      return { ...state, id: action.id, inputKey: action.inputKey, status: "running", error: null };
    case "close":
      return BROWSE_IDLE;
    case "reply": {
      const { reply } = action;
      if (state.id === null || reply.id !== state.id) return state;
      if (reply.phase === "error") return { ...state, status: "error", error: reply.message };
      return { ...state, status: "done", result: reply.result, resultKey: state.inputKey, error: null };
    }
  }
}

const byKey = <T>(entries: Array<[string, T]>) => entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * What a run depends on: the request the optimizer receives, without its
 * walking function and budgets. Keyed on the request rather than the
 * settings, so anything that changes the search (a pick that moves a course
 * in or out of it, options that load, a lock, a preference) makes a shown
 * result stale. Lock order does not matter.
 */
export function requestKey(request: OptimizeRequest): string {
  return JSON.stringify([
    request.courses.map((course) => [course.code, course.credits, course.sections.map((section) => section.id)]),
    byKey(Object.entries(request.locks)),
    [...request.excluded].sort(),
    request.constraints,
    request.weights,
    request.k ?? 3,
    request.term ?? null,
    request.fixedCredits ?? 0,
  ]);
}

export function locksKey(locks: Record<string, string>): string {
  return JSON.stringify(Object.entries(locks).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** A section map as a string that ignores key order, for comparing two plans' picks. */
export const sectionsKey = locksKey;

export function isStale(state: Pick<RunState | BrowseState, "result" | "resultKey">, currentKey: string): boolean {
  return state.result !== null && state.resultKey !== currentKey;
}

/**
 * Whether a schedule from the shown result can replace the plan's picks.
 * Checked again at the moment of applying, not only when the button drew.
 */
export function canApply(
  state: RunState,
  currentKey: string,
  schedule: RankedSchedule,
  locks: Record<string, string>,
  /**
   * The plan's picks after applying the option, checked once more for a
   * clash (two course codes that would overlap), in case the search could
   * not see a section. Null when nothing clashes.
   */
  clashAfter: (merged: Record<string, string>) => [string, string] | null = () => null,
  current: Record<string, string> = {},
): { ok: true } | { ok: false; reason: string } {
  if (state.result === null || isStale(state, currentKey)) {
    return { ok: false, reason: "Your settings changed after these were found. Optimize again to get options for them." };
  }
  for (const [code, sectionId] of Object.entries(locks)) {
    if (code in schedule.byCourse && schedule.byCourse[code] !== sectionId) {
      return { ok: false, reason: `This option moves your locked ${code}. Optimize again to keep it.` };
    }
  }
  const clash = clashAfter({ ...current, ...schedule.byCourse });
  if (clash) {
    return { ok: false, reason: `This option would make ${clash[0]} and ${clash[1]} overlap. Optimize again, or pick a section by hand.` };
  }
  return { ok: true };
}

/**
 * One line under the alternatives saying how far the result is proven.
 * `optimal` and `infeasible` are proofs; anything else is a best effort.
 */
export function resultStanding(state: RunState): string | null {
  const result = state.result;
  if (!result) return null;
  const refining = state.status === "refining";
  switch (result.status) {
    case "optimal":
      return result.schedules.length < 3
        ? "Best possible; no other schedule differs enough to show."
        : "Ranked by your preferences; each is the best of its kind.";
    case "feasible":
      return refining ? "Best so far. Still searching for better ones." : "Best found within the time limit; a better one may exist.";
    case "timeout":
      return refining
        ? "Nothing found yet. Still searching."
        : "No schedule turned up within the time limit, and none was ruled out. Loosen a setting or lock a section, then try again.";
    case "infeasible":
      return null;
  }
}

/**
 * True when the alternatives may differ in only one course. The diversity
 * rule asks for two courses at different times, falling back to one when
 * only one course has a choice of times left (prepare.ts
 * minDifferentCourses). With two or more courses that fallback surprises
 * people, so the page says so.
 */
export function differsInOneCourse(result: OptimizeResult, courseCount: number): boolean {
  return result.stats.minDifferentCourses === 1 && courseCount >= 2 && result.schedules.length >= 2;
}

/** What Undo puts back: the sections and the goal from before a pick. */
export type UndoSnapshot = {
  sections: Record<string, string>;
  goal: OptimizationKey;
  letter: string;
  /** The plan's replacement count when the pick happened. */
  epoch: number;
  /** The locks right after the pick. */
  locks: string;
  /** `sectionsKey` of the plan's picks right after the pick. */
  after: string;
};

export function undoSnapshotForPick(before: Omit<UndoSnapshot, "after">, byCourse: Record<string, string>): UndoSnapshot {
  return {
    ...before,
    sections: { ...before.sections },
    after: sectionsKey({ ...before.sections, ...byCourse }),
  };
}

/**
 * Undo is offered only while the plan is still the one the pick changed:
 * replacing the plan (a restore, a conflict resolution, a reset, another
 * tab's version), changing a lock, or picking a section by hand since then
 * makes it unsafe to put the old sections back, because restoring replaces
 * the whole section map and would silently drop the later edit.
 */
export function undoAvailable(
  undo: UndoSnapshot | null,
  epoch: number,
  currentLocks: string,
  currentSections: string,
): undo is UndoSnapshot {
  return undo !== null && undo.epoch === epoch && undo.locks === currentLocks && undo.after === currentSections;
}
