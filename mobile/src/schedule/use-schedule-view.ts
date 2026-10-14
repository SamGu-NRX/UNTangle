import { useEffect, useState } from "react";
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
import { planningTerm, sampleCatalog, type SectionCatalog } from "@/lib/planner-sections";
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
    };

/** Each planned course costs one sections request; cap a pathological plan. */
const MAX_SECTION_LOOKUPS = 8;

function sampleReadyView(note: string | null): ScheduleView {
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
  };
}

function errorView(error: unknown): ScheduleView {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "Something went wrong loading the schedule.",
  };
}

/**
 * The Week and Day screens' data. Signed in with a saved plan: the plan's
 * sections are fetched for the term and built with the shared week builders;
 * a course whose sections cannot be fetched falls back to its bundled
 * samples, which keeps the schedule labeled. Signed out, unauthorized, or
 * nothing saved: the labeled sample schedule.
 */
export async function loadScheduleView(fetchLike: FetchLike): Promise<ScheduleView> {
  try {
    const planner = await fetchPlannerState(fetchLike);
    const saved = planner.ok ? planner.state : null;

    if (!saved || Object.keys(saved.selectedSections).length === 0) {
      const unauthorized = !planner.ok && planner.reason === "unauthorized";
      const unavailable = !planner.ok && planner.reason === "unavailable";
      return sampleReadyView(
        unauthorized
          ? "Sign in to see your saved plan. Showing a sample schedule."
          : unavailable
            ? "Couldn't reach UNTangle. Showing a sample schedule."
            : "No saved plan found. Showing a sample schedule.",
      );
    }

    const state = saved;
    const codes = Object.keys(state.selectedSections).slice(0, MAX_SECTION_LOOKUPS);
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

    const events = eventsOf(state, catalog);
    const blocks = weekBlocks(events);
    return {
      status: "ready",
      events,
      blocks,
      colors: weekColors(blocks),
      stats: weekStats(events),
      labeledSample: usesSampleSections(events),
      source: "your-plan",
      note: usesSampleSections(events) ? "Some sections come from bundled samples." : null,
    };
  } catch (error) {
    return errorView(error);
  }
}

export function useScheduleView(fetchLike: FetchLike = fetch): ScheduleView {
  const [view, setView] = useState<ScheduleView>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadScheduleView(fetchLike).then((next) => {
      if (!cancelled) setView(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchLike]);

  return view;
}
