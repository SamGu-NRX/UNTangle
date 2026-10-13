/**
 * State of the Week view's optimizer runs, as a reducer with no React in
 * it, plus the checks that decide whether a shown result may still be used.
 *
 * A result is tied to the inputs it was computed from (`resultKey`). Once
 * the preferences, locks or courses change, the result is stale: it stays
 * on screen for reference, but nothing in it can be applied.
 */
import type { OptimizeReply } from "@/lib/optimizer/worker/protocol";
import type { OptimizeResult, RankedSchedule } from "@/lib/optimizer/types";
import type { OptimizationKey, SchedulePreferences } from "@/lib/types";

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

/**
 * Everything a run depends on. Lock order does not matter. `sectionsKey`
 * names the options the courses had loaded, so a course that loads after a
 * run makes its result stale.
 */
export function optimizerInputKey(
  preferences: SchedulePreferences,
  locks: Record<string, string>,
  courseCodes: readonly string[],
  sectionsKey = "",
): string {
  const sortedLocks = Object.entries(locks).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([preferences, sortedLocks, [...courseCodes], sectionsKey]);
}

export function locksKey(locks: Record<string, string>): string {
  return JSON.stringify(Object.entries(locks).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function isStale(state: RunState, currentKey: string): boolean {
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
): { ok: true } | { ok: false; reason: string } {
  if (state.result === null || isStale(state, currentKey)) {
    return { ok: false, reason: "Your settings changed after these were found. Optimize again to get options for them." };
  }
  for (const [code, sectionId] of Object.entries(locks)) {
    if (code in schedule.byCourse && schedule.byCourse[code] !== sectionId) {
      return { ok: false, reason: `This option moves your locked ${code}. Optimize again to keep it.` };
    }
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
};

/**
 * Undo is offered only while the plan is still the one the pick changed:
 * replacing the plan (a restore, a conflict resolution, a reset, another
 * tab's version) or changing a lock since then makes it unsafe to put the
 * old sections back.
 */
export function undoAvailable(undo: UndoSnapshot | null, epoch: number, currentLocks: string): undo is UndoSnapshot {
  return undo !== null && undo.epoch === epoch && undo.locks === currentLocks;
}
