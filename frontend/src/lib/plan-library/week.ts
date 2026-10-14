import { assignColors, type Hue } from "@/lib/course-colors";
import { transferFit } from "@/lib/map-itinerary";
import { buildScheduleEvents, normalizePlannerState, resolveSectionPlan } from "@/lib/planner";
import { backToBackPairs, type SectionCatalog } from "@/lib/planner-sections";
import { isShuttleLeg, plannerTravelTime, type WalkingTimeFn } from "@/lib/planner-walking";
import type { ClassDay, PlannerState, ScheduleEvent } from "@/lib/types";

/**
 * A schedule's week as the library draws and compares it: the timed
 * meetings of its planned courses, the figures the compare table shows,
 * and the sections that differ between two schedules. Pure, with one
 * correct answer each, so the comparison can be checked by hand.
 */

/** One meeting on the grid, in minutes after midnight. `key` is course plus occurrence, so a move can be animated. */
export type WeekBlock = { key: string; code: string; sectionId: string; day: ClassDay; start: number; end: number };

const DAY_ORDER: Record<ClassDay, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function toMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

/** "9:00", "4:50": a time inside one day, without AM or PM (DESIGN.md §9 rule 7). */
export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The meetings a saved state would show, with each unpicked course on the goal's recommended section. */
export function eventsOf(state: PlannerState, catalog: SectionCatalog): ScheduleEvent[] {
  return buildScheduleEvents(resolveSectionPlan(normalizePlannerState(state), catalog));
}

export function weekBlocks(events: readonly ScheduleEvent[]): WeekBlock[] {
  const sorted = [...events].sort((a, b) => DAY_ORDER[a.day] - DAY_ORDER[b.day] || toMinutes(a.start) - toMinutes(b.start));
  const seen = new Map<string, number>();
  return sorted.map((event) => {
    const n = seen.get(event.courseCode) ?? 0;
    seen.set(event.courseCode, n + 1);
    return {
      key: `${event.courseCode}-${n}`,
      code: event.courseCode,
      sectionId: event.sectionId,
      day: event.day,
      start: toMinutes(event.start),
      end: toMinutes(event.end),
    };
  });
}

/** How a block is drawn: its own schedule's class, another's differing class (dashed), or one that goes away (faded). */
export type BlockVariant = "solid" | "dashed" | "faded";
/** A block placed for drawing. `id` is its identity across layouts: the same id in two layouts glides between them. */
export type PlacedBlock = WeekBlock & { variant: BlockVariant; id: string };

/**
 * One week drawn over another: `base` solid, and with `other`, the meetings
 * only `other` has dashed and the ones only `base` has faded. Two meetings
 * are the same when course, day, start and end all match, so a class that
 * only runs longer still shows as a change.
 */
export function overlayBlocks(base: readonly WeekBlock[], other: readonly WeekBlock[] | null): PlacedBlock[] {
  const slot = (block: WeekBlock) => `${block.code}|${block.day}|${block.start}|${block.end}`;
  const otherSlots = new Set((other ?? []).map(slot));
  const baseSlots = new Set(base.map(slot));
  const placed: PlacedBlock[] = base.map((block) => ({
    ...block,
    id: block.key,
    variant: other && !otherSlots.has(slot(block)) ? "faded" : "solid",
  }));
  for (const block of other ?? []) {
    if (!baseSlots.has(slot(block))) placed.push({ ...block, id: `${block.key}-b`, variant: "dashed" });
  }
  return placed;
}

/** Hues for the courses on one or more weeks, clustered by department (lib/course-colors.ts). */
export function weekColors(...weeks: ReadonlyArray<readonly WeekBlock[]>): Map<string, Hue> {
  const codes = [...new Set(weeks.flat().map((block) => block.code))];
  return assignColors(codes.map((code) => ({ id: code, department: code.split(" ")[0] })));
}

export type WeekStats = {
  days: number;
  /** Earliest start and latest end, in minutes; null for a week with no timed class. */
  first: number | null;
  last: number | null;
  /** Minutes walking between back-to-back classes in a week; null when a building has no walking time. */
  walkMinutes: number | null;
  /** Back-to-back walks that are tight or late: under two minutes to spare (lib/map-itinerary.ts). */
  tightWalks: number | null;
};

/**
 * The figures in the compare table. Walks are counted the way the
 * optimizer counts them (backToBackPairs), with the campus walkway times
 * Week uses. A shuttle ride to Discovery Park is not walking, but it can
 * still be tight. Walk minutes round up, so a total never promises time
 * that isn't there.
 */
export function weekStats(events: readonly ScheduleEvent[], travel: WalkingTimeFn = plannerTravelTime): WeekStats {
  if (!events.length) return { days: 0, first: null, last: null, walkMinutes: 0, tightWalks: 0 };
  const timed = events.map((event) => ({ ...event, start: toMinutes(event.start), endMin: toMinutes(event.end) }));
  let walkMinutes: number | null = 0;
  let tightWalks: number | null = 0;
  for (const [from, to] of backToBackPairs(timed)) {
    const leg = travel(from.buildingId ?? "", to.buildingId ?? "");
    if (leg.seconds === null) {
      walkMinutes = null;
      tightWalks = null;
      break;
    }
    const minutes = Math.ceil(leg.seconds / 60);
    if (!isShuttleLeg(from.buildingId, to.buildingId)) walkMinutes += minutes;
    const fit = transferFit(minutes, to.start - from.endMin);
    if (fit === "tight" || fit === "late") tightWalks += 1;
  }
  return {
    days: new Set(timed.map((event) => event.day)).size,
    first: Math.min(...timed.map((event) => event.start)),
    last: Math.max(...timed.map((event) => event.endMin)),
    walkMinutes,
    tightWalks,
  };
}

export type Verdict = "better" | "worse" | "same";
export type CompareRow = { label: string; a: string; b: string; verdict: Verdict };

/**
 * B against A, row by row. Which way is better is a starting value with no
 * data behind it: fewer days, a later first class, an earlier last class,
 * less walking and fewer tight walks. A row with an unknown side says so
 * and judges nothing.
 */
export function compareRows(a: WeekStats, b: WeekStats): CompareRow[] {
  const judge = (x: number | null, y: number | null, lowerIsBetter: boolean): Verdict => {
    if (x === null || y === null || x === y) return "same";
    return (y < x) === lowerIsBetter ? "better" : "worse";
  };
  const clock = (n: number | null) => (n === null ? "None" : clockText(n));
  const known = (n: number | null, unit = "") => (n === null ? "Unknown" : `${n}${unit}`);
  return [
    { label: "Days on campus", a: String(a.days), b: String(b.days), verdict: judge(a.days, b.days, true) },
    { label: "First class", a: clock(a.first), b: clock(b.first), verdict: judge(a.first, b.first, false) },
    { label: "Last class ends", a: clock(a.last), b: clock(b.last), verdict: judge(a.last, b.last, true) },
    { label: "Walking a week", a: known(a.walkMinutes, " min"), b: known(b.walkMinutes, " min"), verdict: judge(a.walkMinutes, b.walkMinutes, true) },
    { label: "Tight walks", a: known(a.tightWalks), b: known(b.tightWalks), verdict: judge(a.tightWalks, b.tightWalks, true) },
  ];
}

const LETTER: Record<ClassDay, string> = { Mon: "M", Tue: "T", Wed: "W", Thu: "R", Fri: "F", Sat: "S", Sun: "U" };

/** "MWF 9:00": the days a section meets and when it starts, the way a registration list says it. */
function meetsText(blocks: readonly WeekBlock[]): string {
  const days = [...new Set(blocks.map((block) => block.day))].sort((x, y) => DAY_ORDER[x] - DAY_ORDER[y]);
  return `${days.map((day) => LETTER[day]).join("")} ${clockText(Math.min(...blocks.map((block) => block.start)))}`;
}

export type SectionChange = { code: string; from: string | null; to: string | null };

/** Courses whose section differs, or that only one schedule has; and the courses both share exactly. */
export function sectionChanges(a: readonly WeekBlock[], b: readonly WeekBlock[]): { changes: SectionChange[]; same: string[] } {
  const byCode = (blocks: readonly WeekBlock[]) => {
    const map = new Map<string, WeekBlock[]>();
    for (const block of blocks) map.set(block.code, [...(map.get(block.code) ?? []), block]);
    return map;
  };
  const left = byCode(a);
  const right = byCode(b);
  const codes = [...new Set([...left.keys(), ...right.keys()])].sort((x, y) => x.localeCompare(y));
  const changes: SectionChange[] = [];
  const same: string[] = [];
  for (const code of codes) {
    const x = left.get(code);
    const y = right.get(code);
    if (x && y && x[0].sectionId === y[0].sectionId) same.push(code);
    else changes.push({ code, from: x ? meetsText(x) : null, to: y ? meetsText(y) : null });
  }
  return { changes, same };
}
