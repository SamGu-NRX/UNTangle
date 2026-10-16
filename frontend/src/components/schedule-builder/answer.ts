/**
 * Week's one answer (untangle-v3.md, rules 1, 5 and 6): either the one
 * thing to fix, with an action, or "This week fits your preferences"; and,
 * for an alternative, one sentence on how it differs from the current week.
 * Pure, so the wording has one tested answer.
 */
import type { Day } from "@/lib/sections";
import { examLongDay, type WeekFinal } from "./finals";
import type { SchedulePreferences } from "@/lib/types";
import { meetTogether } from "./conflicts";
import { leanOf } from "./limits";
import { andList, clashes, clock, clockWithSuffix, DAY_NAME, DAY_ORDER, shortDate, type GridEvent, type WalkLeg } from "./week";

const dayNames = (days: Iterable<Day>) => andList(DAY_ORDER.filter((day) => [...days].includes(day)).map((day) => DAY_NAME[day]));

export type Answer =
  /** A problem with a fix the builder can offer ("Show a fix" runs Auto). */
  | { tone: "danger" | "attention"; text: string; action: "fix" }
  /** A course that needs the student to pick a section; the action opens it. */
  | { tone: "attention"; text: string; action: "pick"; courseCode: string }
  /** `fits` marks the all-clear, which carries the planned glyph. */
  | { tone: "quiet"; text: string; action: null; fits?: true };

export type AnswerCourse = {
  code: string;
  credits: number;
  /** placed: on the week; loading; pick: needs the student to choose a section; none: nothing to place. */
  state: "placed" | "loading" | "pick" | "none";
  note?: string;
};

/**
 * The first that applies: loading, a clash, overlapping finals, a course
 * that needs a pick, a tight or late walk, a broken preference, or the
 * all-clear. Finals come before a pick because the overlap is between
 * sections already on the week, which the student can act on at once. Null when the week is empty (the grid shows its own empty
 * state).
 */
export function answerFor(input: {
  courses: readonly AnswerCourse[];
  events: readonly GridEvent[];
  walks: readonly WalkLeg[];
  preferences: SchedulePreferences;
  termLabel: string;
  /** The week's finals (finals.ts); absent when the host has none. */
  finals?: readonly WeekFinal[];
}): Answer | null {
  const { courses, events, walks, preferences } = input;
  if (courses.length === 0) return null;
  if (courses.some((course) => course.state === "loading")) {
    return { tone: "quiet", text: `Loading ${input.termLabel} sections.`, action: null };
  }

  for (const a of events) {
    const b = events.find((other) => clashes(a, other));
    if (!b) continue;
    const days = new Set(events.filter((x) => x.courseCode === a.courseCode && events.some((y) => y.courseCode === b.courseCode && clashes(x, y))).map((x) => x.day));
    return { tone: "danger", text: `${a.courseCode} overlaps ${b.courseCode} on ${dayNames(days)}.`, action: "fix" };
  }

  const final = input.finals?.find((entry) => entry.clashesWith.length > 0);
  if (final && final.exam.kind === "known") {
    // A projected time can still move when UNT publishes the term's finals, so it is a check, not a conflict.
    return {
      tone: final.exam.projected ? "attention" : "danger",
      text: `${final.courseCode} and ${final.clashesWith[0]} finals overlap on ${examLongDay(final.exam.exam)}.`,
      action: "fix",
    };
  }

  const pick = courses.find((course) => course.state === "pick");
  if (pick) return { tone: "attention", text: pick.note ?? `Pick a section for ${pick.code}.`, action: "pick", courseCode: pick.code };

  const bad = walks.find((walk) => walk.kind !== "ok");
  if (bad) {
    const same = walks.filter((walk) => walk.toCourse === bad.toCourse && walk.kind === bad.kind);
    const what = bad.shuttle ? "shuttle" : "walk";
    return {
      tone: "attention",
      text: `The ${what} to ${bad.toCourse} on ${dayNames(same.map((walk) => walk.day))} is ${bad.kind === "late" ? "longer than the break" : "tight"}.`,
      action: "fix",
    };
  }

  // The student's own spare-minutes setting, which Auto enforces, can be stricter than "tight".
  const buffer = preferences.constraints.walkingBufferMinutes;
  const short = buffer ? walks.find((walk) => !walk.shuttle && walk.seconds + buffer * 60 > (walk.to - walk.from) * 60) : undefined;
  if (short && buffer) {
    return {
      tone: "attention",
      text: `The walk to ${short.toCourse} on ${DAY_NAME[short.day]} leaves less than your ${buffer} spare minutes.`,
      action: "fix",
    };
  }

  const broken = brokenPreference(courses, events, preferences);
  if (broken) return { tone: "attention", text: broken, action: "fix" };
  return { tone: "quiet", text: "This week fits your preferences.", action: null, fits: true };
}

function brokenPreference(courses: readonly AnswerCourse[], events: readonly GridEvent[], p: SchedulePreferences): string | null {
  const c = p.constraints;
  const first = (test: (event: GridEvent) => boolean) => events.find(test) ?? null;
  const daysOf = (code: string, test: (event: GridEvent) => boolean) => dayNames(events.filter((e) => e.courseCode === code && test(e)).map((e) => e.day));

  const off = first((e) => (c.daysOff as readonly string[]).includes(e.day));
  if (off) return `${off.courseCode} meets on ${DAY_NAME[off.day]}, a day you keep off.`;
  const early = c.earliestStart;
  const tooEarly = early === null ? null : first((e) => e.start < early);
  if (tooEarly && early !== null) return `${tooEarly.courseCode} starts before ${clockWithSuffix(early)} on ${daysOf(tooEarly.courseCode, (e) => e.start < early)}.`;
  const late = c.latestEnd;
  const tooLate = late === null ? null : first((e) => e.end > late);
  if (tooLate && late !== null) return `${tooLate.courseCode} ends after ${clockWithSuffix(late)} on ${daysOf(tooLate.courseCode, (e) => e.end > late)}.`;
  for (const block of c.blocked) {
    // A dated busy time (a calendar's) only clashes with a class that meets on one of its dates.
    const onItsDates = (e: GridEvent) => !block.dates?.length || block.dates.some((range) => meetTogether(e.day, e.dates, range));
    const hit = first((e) => e.day === block.day && e.start < block.end && block.start < e.end && onItsDates(e));
    // Busy time from one date (a calendar event) names that date: the class only clashes then.
    const only = block.dates?.length === 1 && block.dates[0].start === block.dates[0].end ? block.dates[0].start : null;
    if (hit) return `${hit.courseCode} meets during ${block.label.toLowerCase()} on ${DAY_NAME[hit.day]}${only ? `, ${shortDate(only)}` : ""}.`;
  }
  const credits = courses.filter((course) => course.state === "placed").reduce((sum, course) => sum + course.credits, 0);
  if (c.maxCredits !== null && credits > c.maxCredits) return `This week is ${credits} credits, over your ${c.maxCredits}.`;
  return null;
}

/** The figures Details compares, from a week's events and walks. */
export type WeekFigures = {
  days: Day[];
  first: number | null;
  last: number | null;
  walkMinutes: number;
  badWalks: number;
  clashes: number;
  startOf: Map<Day, number>;
  endOf: Map<Day, number>;
};

export function figuresOf(events: readonly GridEvent[], walks: readonly WalkLeg[]): WeekFigures {
  const startOf = new Map<Day, number>();
  const endOf = new Map<Day, number>();
  for (const e of events) {
    startOf.set(e.day, Math.min(startOf.get(e.day) ?? Infinity, e.start));
    endOf.set(e.day, Math.max(endOf.get(e.day) ?? -Infinity, e.end));
  }
  return {
    days: DAY_ORDER.filter((day) => startOf.has(day)),
    first: events.length ? Math.min(...events.map((e) => e.start)) : null,
    last: events.length ? Math.max(...events.map((e) => e.end)) : null,
    walkMinutes: walks.filter((w) => !w.shuttle).reduce((sum, w) => sum + w.minutes, 0),
    badWalks: walks.filter((w) => w.kind !== "ok").length,
    clashes: events.filter((a) => events.some((b) => clashes(a, b))).length,
    startOf,
    endOf,
  };
}

/**
 * Which way the student leans on time of day (Set up Auto's first question,
 * Preferences' Time of day). Auto's lean terms (lib/optimizer/score.ts) pull
 * a morning lean's starts earlier and an afternoon lean's ends later, so for
 * that student those are gains, never costs.
 */
export type TimeLean = "mornings" | "afternoons" | null;

export function timeLeanOf(preferences: SchedulePreferences): TimeLean {
  const lean = leanOf(preferences.weights, "time");
  return lean < 0 ? "mornings" : lean > 0 ? "afternoons" : null;
}

/** Minutes `next`'s first class improves on `now`'s: later for most students, earlier for a morning lean. Negative is worse. */
export const startGain = (now: number, next: number, lean: TimeLean) => (lean === "mornings" ? now - next : next - now);
/** Minutes `next`'s last class improves on `now`'s: earlier for most students, later for an afternoon lean. Negative is worse. */
export const endGain = (now: number, next: number, lean: TimeLean) => (lean === "afternoons" ? next - now : now - next);

/** Under this many minutes, an earlier or later time isn't worth a sentence. */
const NOTICE_MIN = 30;

/** "1:00" when only the time changes; "Tuesday and Thursday at 9:30" when the days do. */
function whereTo(now: readonly GridEvent[], next: readonly GridEvent[]): string {
  const days = (list: readonly GridEvent[]) => DAY_ORDER.filter((day) => list.some((e) => e.day === day));
  const sameDays = days(now).join() === days(next).join();
  const at = clock(Math.min(...next.map((e) => e.start)));
  return sameDays ? at : `${dayNames(days(next))} at ${at}`;
}

/**
 * One sentence on how an alternative differs from the current week: its
 * best gain, then its worst cost ("Frees Friday, but Monday and Wednesday
 * end at 4:50."). When one course moves, the gain says which. Earlier
 * starts and later ends follow the student's time-of-day lean: what they
 * asked for is never named as a cost.
 */
export function describeAlternative(
  now: { events: readonly GridEvent[]; walks: readonly WalkLeg[]; finalsClashes?: number },
  next: { events: readonly GridEvent[]; walks: readonly WalkLeg[]; finalsClashes?: number },
  lean: TimeLean = null,
): string {
  const a = figuresOf(now.events, now.walks);
  const b = figuresOf(next.events, next.walks);
  const freed = a.days.filter((day) => !b.days.includes(day));
  const added = b.days.filter((day) => !a.days.includes(day));

  const gains: string[] = [];
  if (b.clashes < a.clashes) gains.push(b.clashes === 0 ? "Fixes the overlap" : "Has fewer overlaps");
  const finalsNow = now.finalsClashes ?? 0;
  const finalsNext = next.finalsClashes ?? 0;
  if (finalsNext < finalsNow) gains.push(finalsNext === 0 ? "Fixes the overlapping finals" : "Has fewer overlapping finals");
  if (freed.length > 0) gains.push(`Frees ${dayNames(freed)}`);
  // The walk to PHYS 2220 on Monday and Wednesday is one walk to the student, so count destinations.
  const badTo = (walks: readonly WalkLeg[]) => new Set(walks.filter((w) => w.kind !== "ok").map((w) => w.toCourse)).size;
  if (b.badWalks < a.badWalks) gains.push(b.badWalks === 0 ? (badTo(now.walks) === 1 ? "Removes the tight walk" : "Removes the tight walks") : "Has fewer tight walks");
  if (a.first !== null && b.first !== null && startGain(a.first, b.first, lean) >= NOTICE_MIN) gains.push(`Starts at ${clock(b.first)} instead of ${clock(a.first)}`);
  if (a.last !== null && b.last !== null && endGain(a.last, b.last, lean) >= NOTICE_MIN) {
    gains.push(lean === "afternoons" ? `Ends at ${clock(b.last)} instead of ${clock(a.last)}` : `Ends by ${clock(b.last)}`);
  }
  if (a.walkMinutes - b.walkMinutes >= 5) gains.push(`Walks ${a.walkMinutes - b.walkMinutes} minutes less a week`);

  const costs: string[] = [];
  if (b.clashes > a.clashes) costs.push("two classes overlap");
  if (finalsNext > finalsNow) costs.push("two finals overlap");
  if (added.length > 0) costs.push(`adds ${dayNames(added)}`);
  const later = DAY_ORDER.filter((day) => a.endOf.has(day) && (b.endOf.get(day) ?? -Infinity) - a.endOf.get(day)! >= NOTICE_MIN);
  if (later.length > 0 && lean !== "afternoons") {
    const latest = Math.max(...later.map((day) => b.endOf.get(day)!));
    const days = later.filter((day) => b.endOf.get(day) === latest);
    // "Wednesday ends", "Tuesday and Thursday end".
    costs.push(`${dayNames(days)} ${days.length === 1 ? "ends" : "end"} at ${clock(latest)}`);
  }
  const earlier = DAY_ORDER.filter((day) => a.startOf.has(day) && a.startOf.get(day)! - (b.startOf.get(day) ?? Infinity) >= NOTICE_MIN);
  if (earlier.length > 0 && lean !== "mornings") {
    const earliest = Math.min(...earlier.map((day) => b.startOf.get(day)!));
    const days = earlier.filter((day) => b.startOf.get(day) === earliest);
    costs.push(`${dayNames(days)} ${days.length === 1 ? "starts" : "start"} at ${clock(earliest)}`);
  }
  if (b.badWalks > a.badWalks) {
    // Name a walk that is new or newly worse; with only more of the same, any bad one will do.
    const isNew = (w: WalkLeg) => w.kind !== "ok" && !now.walks.some((x) => x.toCourse === w.toCourse && x.day === w.day && x.kind === w.kind);
    const walk = next.walks.find(isNew) ?? next.walks.find((w) => w.kind !== "ok");
    if (walk) costs.push(`the walk to ${walk.toCourse} is ${walk.kind === "late" ? "longer than the break" : "tight"}`);
  }

  const moved = [...new Set(next.events.map((e) => e.courseCode))].filter((code) => {
    const at = (list: readonly GridEvent[]) => list.filter((e) => e.courseCode === code).map((e) => `${e.day}${e.start}`).sort().join();
    return at(now.events) !== at(next.events);
  });

  if (gains.length === 0) {
    if (costs.length > 0) return `${costs[0][0].toUpperCase()}${costs[0].slice(1)}.`;
    if (moved.length === 1) {
      const code = moved[0];
      return `Moves ${code} to ${whereTo(now.events.filter((e) => e.courseCode === code), next.events.filter((e) => e.courseCode === code))}.`;
    }
    return "Same days and times, with different sections.";
  }
  const by =
    moved.length === 1
      ? ` by moving ${moved[0]} to ${whereTo(now.events.filter((e) => e.courseCode === moved[0]), next.events.filter((e) => e.courseCode === moved[0]))}`
      : "";
  return `${gains[0]}${costs.length > 0 ? `, but ${costs[0]}` : by}.`;
}
