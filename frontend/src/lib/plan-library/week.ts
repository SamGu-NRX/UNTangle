import { assignColors, type Hue } from "@/lib/course-colors";
import { buildScheduleEvents, normalizePlannerState, resolveSectionPlan, summarizeCredits } from "@/lib/planner";
import { optionIdLabel, optionLabel, scheduleEventsOf, sectionRef, type CandidateFilter, type SectionCatalog } from "@/lib/planner-sections";
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

/** "1:00 PM": a time with its half of the day, for a screen reader, which has no grid to place it on. */
export function spokenClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${clockText(minutes)} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * The meetings a saved state would show, with each unpicked course on the
 * goal's recommended section. `filter` is Main's (the planner's
 * candidateFilter): Use in Main keeps it, so the preview recommends what
 * Main would.
 */
export function eventsOf(state: PlannerState, catalog: SectionCatalog, filter: CandidateFilter): ScheduleEvent[] {
  return buildScheduleEvents(resolveSectionPlan(normalizePlannerState(state), catalog, filter));
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

/** Whether any of these meetings comes from the bundled synthetic samples, which the page must say once. */
export function usesSampleSections(events: readonly ScheduleEvent[]): boolean {
  return events.some((event) => event.provenance === "sample");
}

/**
 * Hues for the courses of one or more schedules, clustered by department
 * (lib/course-colors.ts). Courses are colored in the order given, so
 * passing Main's planned courses first, in the planner's order, gives them
 * the hues Week's own assignment gives them on a fresh visit.
 */
export function weekColors(...schedules: ReadonlyArray<readonly string[]>): Map<string, Hue> {
  const codes = [...new Set(schedules.flat())];
  return assignColors(codes.map((code) => ({ id: code, department: code.split(" ")[0] })));
}

export type WeekStats = {
  days: number;
  /** Earliest start and latest end, in minutes; null for a week with no timed class. */
  first: number | null;
  last: number | null;
};

/** Days on campus, the first class and the last class's end: the compare table's day figures. */
export function weekStats(events: readonly ScheduleEvent[]): WeekStats {
  if (!events.length) return { days: 0, first: null, last: null };
  return {
    days: new Set(events.map((event) => event.day)).size,
    first: Math.min(...events.map((event) => toMinutes(event.start))),
    last: Math.max(...events.map((event) => toMinutes(event.end))),
  };
}

/**
 * A plan's figures for the compare table: its days, its walking as Week's
 * Details counts it (components/schedules-library/view-model.ts,
 * weekWalking), and the credits it plans.
 */
export type PlanFigures = WeekStats & {
  walkMinutes: number;
  tightWalks: number;
  /** Walks with no known time, left out of the two totals above: more than 0 makes them lower bounds. */
  unknownWalks: number;
  credits: number;
};

/**
 * Credits a saved plan schedules this term: its planned courses, as Courses
 * counts them (summarizeCredits), whether or not a section is placed yet.
 */
export function plannedCredits(state: PlannerState): number {
  return summarizeCredits(normalizePlannerState(state));
}

/** "unjudged": a figure that is shown but has no better direction, such as credits. */
export type Verdict = "better" | "worse" | "same" | "unjudged";
export type CompareRow = { label: string; a: string; b: string; verdict: Verdict };

/**
 * B against A, row by row. Which way is better is a starting value with no
 * data behind it: fewer days, a later first class, an earlier last class,
 * less walking and fewer tight or late walks. A week with no timed class
 * has no first or last class and judges nothing there. A walk with no known
 * time makes that week's walking figures "At least" figures, and the two
 * walking rows are then shown without a verdict. Credits come first and
 * are never judged: more is not better or worse, only different.
 */
export function compareRows(a: PlanFigures, b: PlanFigures): CompareRow[] {
  const judge = (x: number | null, y: number | null, lowerIsBetter: boolean): Verdict => {
    if (x === null || y === null || x === y) return "same";
    return (y < x) === lowerIsBetter ? "better" : "worse";
  };
  const clock = (n: number | null) => (n === null ? "None" : clockText(n));
  const partial = a.unknownWalks > 0 || b.unknownWalks > 0;
  const walking = (x: number, y: number): Verdict => (partial ? "unjudged" : judge(x, y, true));
  const atLeast = (side: PlanFigures, text: string) => (side.unknownWalks > 0 ? `At least ${text}` : text);
  return [
    { label: "Credits", a: String(a.credits), b: String(b.credits), verdict: a.credits === b.credits ? "same" : "unjudged" },
    { label: "Days on campus", a: String(a.days), b: String(b.days), verdict: judge(a.days, b.days, true) },
    { label: "First class", a: clock(a.first), b: clock(b.first), verdict: judge(a.first, b.first, false) },
    { label: "Last class ends", a: clock(a.last), b: clock(b.last), verdict: judge(a.last, b.last, true) },
    { label: "Walking a week", a: atLeast(a, `${a.walkMinutes} min`), b: atLeast(b, `${b.walkMinutes} min`), verdict: walking(a.walkMinutes, b.walkMinutes) },
    // Week's Details names the same count the same way.
    { label: "Tight or late walks", a: atLeast(a, String(a.tightWalks)), b: atLeast(b, String(b.tightWalks)), verdict: walking(a.tightWalks, b.tightWalks) },
  ];
}

const LETTER: Record<ClassDay, string> = { Mon: "M", Tue: "T", Wed: "W", Thu: "R", Fri: "F", Sat: "S", Sun: "U" };

/** Days grouped by start time, in first-day order: "MWF 9:00" or "M 8:00, TR 9:35". */
function meetsText(blocks: readonly WeekBlock[]): string {
  const groups = new Map<number, Set<ClassDay>>();
  const ordered = [...blocks].sort((a, b) => DAY_ORDER[a.day] - DAY_ORDER[b.day] || a.start - b.start);
  for (const block of ordered) {
    const days = groups.get(block.start) ?? new Set<ClassDay>();
    days.add(block.day);
    groups.set(block.start, days);
  }
  return [...groups].map(([start, days]) => `${[...days].map((day) => LETTER[day]).join("")} ${clockText(start)}`).join(", ");
}

export type SectionChange = { code: string; from: string | null; to: string | null };

/** A planned course's chosen section and its timed meetings (none for an online or TBA section). */
export type PlannedSection = {
  code: string;
  sectionId: string;
  label: string;
  blocks: WeekBlock[];
  /** A saved pick with no section to draw: its options are still loading, or the catalog no longer has it. */
  unresolved?: "loading" | "gone";
};

/**
 * Every course a plan schedules, with the section it uses: saved picks, and
 * the goal's recommendation for the rest under Main's `filter`, as the
 * lenses would show it in Main. Sections with no set time are included, so
 * a change to one still counts.
 */
export function plannedSections(state: PlannerState, catalog: SectionCatalog, filter: CandidateFilter): PlannedSection[] {
  return resolveSectionPlan(normalizePlannerState(state), catalog, filter).courses.flatMap((course): PlannedSection[] => {
    if (course.section) return [{ code: course.code, sectionId: course.section.id, label: optionLabel(course.section), blocks: weekBlocks(scheduleEventsOf(course.section)) }];
    // A saved pick the loaded catalog can't place still differs from another pick.
    if (course.savedId) return [{ code: course.code, sectionId: course.savedId, label: optionIdLabel(course.savedId), blocks: [], unresolved: course.state === "loading" ? "loading" : "gone" }];
    return [];
  });
}

/** "MWF 9:00", "No set time" for an online or TBA section, or why a saved pick has no times. */
function sectionText(section: PlannedSection): string {
  if (section.unresolved === "loading") return "Still loading";
  if (section.unresolved === "gone") return "Not offered now";
  return section.blocks.length ? meetsText(section.blocks) : "No set time";
}

/** True when two cells in a row read the same for different sections. */
function readAlike(sections: ReadonlyArray<PlannedSection | undefined>, cells: ReadonlyArray<string | null>): boolean {
  return sections.some((section, i) => section && sections.some((other, j) => other && section.sectionId !== other.sectionId && cells[i] === cells[j]));
}

function withSection(cell: string | null, section: PlannedSection | undefined, name: (section: PlannedSection) => string): string | null {
  return section ? `${cell}, ${name(section)}` : cell;
}

/** What tells a section apart when its label doesn't: a real section's class numbers, which its id is built from, or that it is a made-up sample. */
function sectionIdentity(section: PlannedSection): string {
  return sectionRef(section.sectionId).provenance === "real" ? optionIdLabel(section.sectionId) : "sample";
}

/**
 * Sections across several plans, the first being the one the others are
 * read against: a row for each course whose section is not the same in
 * all of them (a cell is null where that plan doesn't have the course), and
 * the courses every plan shares exactly. When two different sections in a
 * row would read the same ("MWF 9:00" for both), every cell in that row
 * names its section too, so the student can see what changes. With two
 * plans it says what `sectionChanges` says, as cells.
 */
export function sectionGrid(plans: ReadonlyArray<readonly PlannedSection[]>): {
  /** `ids` says which plans' sections differ, whatever their `cells` say. */
  rows: Array<{ code: string; cells: Array<string | null>; ids: Array<string | null> }>;
  same: string[];
} {
  const maps = plans.map((plan) => new Map(plan.map((section) => [section.code, section])));
  const codes = [...new Set(maps.flatMap((map) => [...map.keys()]))].sort((x, y) => x.localeCompare(y));
  const rows: Array<{ code: string; cells: Array<string | null>; ids: Array<string | null> }> = [];
  const same: string[] = [];
  for (const code of codes) {
    const sections = maps.map((map) => map.get(code));
    const first = sections[0];
    if (first && sections.every((section) => section?.sectionId === first.sectionId)) same.push(code);
    else {
      let cells = sections.map((section) => (section ? sectionText(section) : null));
      // Different sections at the same times read alike, so each cell names its section.
      if (readAlike(sections, cells)) cells = cells.map((cell, i) => withSection(cell, sections[i], (section) => `section ${section.label}`));
      // A section code is not unique: a saved sample and a real section can both be "002".
      if (readAlike(sections, cells)) cells = cells.map((cell, i) => withSection(cell, sections[i], sectionIdentity));
      rows.push({ code, cells, ids: sections.map((section) => section?.sectionId ?? null) });
    }
  }
  return { rows, same };
}

/** Courses whose section differs, or that only one schedule has; and the courses both share exactly. */
export function sectionChanges(
  a: readonly PlannedSection[],
  b: readonly PlannedSection[],
): { changes: SectionChange[]; same: string[] } {
  const { rows, same } = sectionGrid([a, b]);
  return { changes: rows.map(({ code, cells: [from, to] }) => ({ code, from, to })), same };
}

const WEEKDAYS: readonly ClassDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** The columns a week needs: Monday to Friday, plus Saturday and Sunday when a class meets then. */
export function gridDays(blocks: readonly WeekBlock[]): ClassDay[] {
  const weekend = (["Sat", "Sun"] as const).filter((day) => blocks.some((block) => block.day === day));
  return [...WEEKDAYS, ...weekend];
}
