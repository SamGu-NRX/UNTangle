import { useCallback, useEffect, useRef, useState } from "react";
import type { Hue } from "@/lib/course-colors";
import {
  eventsOf,
  usesSampleSections,
  weekBlocks,
  weekColors,
  weekStats,
  type WeekBlock,
  type WeekStats,
} from "@/lib/plan-library/week";
import { findOption, planningTerm, sampleCatalog, type SectionCatalog } from "@/lib/planner-sections";
import type { CourseSections } from "@/lib/sections/model";
import type { ScheduleEvent } from "@/lib/types";

import { fetchPlannerState } from "@/data/planner";
import { fetchCourseSections } from "@/data/sections";
import type { FetchLike } from "@/data/http";

import { catalogFromSections } from "./remote-catalog";
import { sampleSchedule } from "./sample-schedule";

export type ScheduleView =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      events: ScheduleEvent[];
      blocks: WeekBlock[];
      colors: Map<string, Hue>;
      stats: WeekStats;
      labeledSample: boolean;
      source: "your-plan" | "sample";
      note: string | null;
      /** A saved section could not be loaded: the schedule may be missing classes. */
      incomplete: boolean;
      /** The sample shows because the student is signed out. */
      signInHint: boolean;
    };

/** Each planned course costs one sections request; cap a pathological plan. */
const MAX_SECTION_LOOKUPS = 8;

function sampleReadyView(note: string | null, signInHint = false): ScheduleView {
  const sample = sampleSchedule();
  return {
    status: "ready",
    events: sample.events,
    blocks: sample.blocks,
    colors: sample.colors,
    stats: weekStats(sample.events),
    labeledSample: true,
    source: "sample",
    note,
    incomplete: false,
    signInHint,
  };
}

function errorView(error: unknown): ScheduleView {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "Something went wrong loading the schedule.",
  };
}

/** An empty saved plan is still the student's plan: render it empty, not as a sample. */
function emptyPlanView(): ScheduleView {
  return {
    status: "ready",
    events: [],
    blocks: [],
    colors: new Map(),
    stats: weekStats([]),
    labeledSample: false,
    source: "your-plan",
    note: "No sections picked yet - pick them on the web planner.",
    incomplete: false,
    signInHint: false,
  };
}

/**
 * The Week and Day screens' data. Signed in with a saved plan: the plan's
 * sections are fetched for the term and built with the shared week builders;
 * a course whose sections cannot be fetched falls back to its bundled
 * samples, and a pick neither fetch nor samples resolve is reported as
 * incomplete instead of silently vanishing. Signed out or unauthorized: the
 * labeled sample schedule with a sign-in hint.
 */
export async function loadScheduleView(fetchLike: FetchLike): Promise<ScheduleView> {
  try {
    const planner = await fetchPlannerState(fetchLike);
    const saved = planner.ok ? planner.state : null;

    if (!saved) {
      const unauthorized = !planner.ok && planner.reason === "unauthorized";
      const unavailable = !planner.ok && planner.reason === "unavailable";
      return sampleReadyView(
        unauthorized
          ? "Sign in to see your saved plan. Showing a sample schedule."
          : unavailable
            ? "Couldn't reach UNTangle. Showing a sample schedule."
            : "No saved plan found. Showing a sample schedule.",
        unauthorized,
      );
    }

    const picks = Object.entries(saved.selectedSections);
    if (picks.length === 0) return emptyPlanView();

    const codes = picks.slice(0, MAX_SECTION_LOOKUPS).map(([code]) => code);
    const results = await Promise.allSettled(
      codes.map((code) => fetchCourseSections(planningTerm.id, code, fetchLike)),
    );
    const fetched: CourseSections[] = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );

    const remote = catalogFromSections(fetched);
    const catalog: SectionCatalog = (code) => {
      const option = remote(code);
      return option.status === "loading" ? sampleCatalog(code) : option;
    };

    const events = eventsOf(saved, catalog);
    const blocks = weekBlocks(events);

    // A saved pick that neither the fetched sections nor the bundled samples
    // resolve must not disappear silently: count it so the screen can warn.
    const unresolved = picks.filter(([code, optionId]) => findOption(catalog, code, optionId) === null).length;

    const sampleSections = usesSampleSections(events);
    return {
      status: "ready",
      events,
      blocks,
      colors: weekColors(blocks),
      stats: weekStats(events),
      labeledSample: sampleSections,
      source: "your-plan",
      note: unresolved
        ? "Some saved sections couldn't be loaded, so this schedule may be incomplete."
        : sampleSections
          ? "Some sections come from bundled samples."
          : null,
      incomplete: unresolved > 0,
      signInHint: false,
    };
  } catch (error) {
    return errorView(error);
  }
}

export type ScheduleViewController = {
  view: ScheduleView;
  /** Silent refetch (screen focus): keeps the current view until fresh data lands. */
  reload: () => void;
  /** Refetch with a loading state (the error view's Retry button). */
  retry: () => void;
};

export function useScheduleView(fetchLike: FetchLike = fetch): ScheduleViewController {
  const [view, setView] = useState<ScheduleView>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    let cancelled = false;
    if (first.current) {
      first.current = false;
      setView({ status: "loading" });
    }
    loadScheduleView(fetchLike).then((next) => {
      if (!cancelled) setView(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchLike, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const retry = useCallback(() => {
    setView({ status: "loading" });
    setTick((t) => t + 1);
  }, []);

  return { view, reload, retry };
}
