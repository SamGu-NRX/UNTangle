import { optimize } from "@/lib/optimizer/optimize";
import type { OptCourse, OptimizeRequest, OptSection, OptWeights } from "@/lib/optimizer/types";
import { planningTerm, termDates, toOptSection } from "@/lib/planner-sections";
import { plannerTravelTime } from "@/lib/planner-walking";

import { courseByCode, sectionsOf, type Picks } from "./guest-plan";
import { busyBlocks, DAY_OFF, gridDays, isDayOff, type Preferences } from "./preferences";

/**
 * Auto on the phone: the web's optimizer (lib/optimizer), run on the
 * planned courses' sample sections with the student's Preferences. It runs
 * on the JS thread inside a 300ms budget, the same budget the web worker
 * gets; five courses with a handful of sections each finish well inside it.
 */

/** Time of day is one control over two weights, as the r3 mockup maps it: leaning earlier weights mornings and zeroes evenings. */
export function weightsOf(prefs: Preferences): OptWeights {
  const time = Math.round(prefs.leanings.time);
  const lean = [0, 2, 4][Math.min(Math.abs(time), 2)];
  return {
    mornings: time < 0 ? lean : 0,
    evenings: time > 0 ? lean : 0,
    fewerDays: Math.round(prefs.leanings.fewerDays),
    compact: Math.round(prefs.leanings.compact),
    walking: Math.round(prefs.leanings.walking),
    rating: Math.round(prefs.leanings.rating),
  };
}

export function autoRequest(picks: Picks, prefs: Preferences): OptimizeRequest {
  const courses: OptCourse[] = Object.keys(picks).map((code) => ({
    code,
    credits: courseByCode(code)?.creditHours ?? 3,
    sections: sectionsOf(code)
      .map(toOptSection)
      .filter((section): section is OptSection => section !== null),
  }));
  const locks: Record<string, string> = {};
  for (const code of prefs.kept) if (picks[code]) locks[code] = picks[code];
  return {
    courses,
    term: termDates[planningTerm.id],
    locks,
    excluded: [],
    constraints: {
      earliestStart: prefs.startAfter,
      latestEnd: null,
      daysOff: gridDays.filter((day) => isDayOff(prefs, day)),
      blocked: busyBlocks(prefs)
        .filter((block) => block.label !== DAY_OFF)
        .map((block, index) => ({ id: `busy-${index}`, label: block.label, day: block.day, start: block.start, end: block.end })),
      maxCredits: prefs.maxCredits,
      walking: { bufferMinutes: 0 },
    },
    weights: weightsOf(prefs),
    walkingTime: plannerTravelTime,
    k: 3,
  };
}

export type AutoOption = {
  picks: Picks;
  /** Planned courses whose section differs from the current week, in pick order. */
  moves: string[];
  days: number;
};

export type AutoResult =
  | { kind: "options"; options: AutoOption[] }
  /** Nothing satisfies every hard limit; `why` is the optimizer's sentence naming what clashes. */
  | { kind: "none"; why: string | null };

export function runAuto(picks: Picks, prefs: Preferences): AutoResult {
  const result = optimize(autoRequest(picks, prefs));
  if (result.schedules.length === 0) {
    return { kind: "none", why: result.status === "infeasible" ? result.explanation.sentence : null };
  }
  return {
    kind: "options",
    options: result.schedules.map((schedule) => ({
      picks: { ...schedule.byCourse },
      moves: Object.keys(picks).filter((code) => schedule.byCourse[code] !== picks[code]),
      days: schedule.breakdown.daysOnCampus,
    })),
  };
}
