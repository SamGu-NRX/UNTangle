import type { ClassDay } from "@/lib/types";

/**
 * Week preferences, modeled on the r3 preferences mockup: hard limits Auto
 * never breaks (busy hours, a start time, days off), leanings it weighs
 * (each 0 to 4, time of day -2 to 2, as the planner's PreferenceWeights),
 * and settings for specific classes (credit limit, kept sections).
 */

export const gridDays: readonly ClassDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
/** The painted grid covers 8 AM to 9 PM in one-hour cells. */
export const gridHours = { first: 8, last: 21 } as const;

export type LeaningKey = "time" | "fewerDays" | "compact" | "walking" | "rating";

export type Preferences = {
  /** Hour cells, keyed "Tue-15", to what the student called the time. */
  busy: Readonly<Record<string, string>>;
  /** No class before this minute of the day; null for any time. */
  startAfter: number | null;
  leanings: Readonly<Record<LeaningKey, number>>;
  maxCredits: number;
  /** Planned courses whose section Auto must keep. */
  kept: readonly string[];
};

/** The label for hours filled by taking a whole day off. */
export const DAY_OFF = "Day off";

export function cellKey(day: ClassDay, hour: number): string {
  return `${day}-${hour}`;
}

function busyHours(days: readonly ClassDay[], from: number, to: number, label: string) {
  return Object.fromEntries(days.flatMap((day) => Array.from({ length: to - from }, (_, i) => [cellKey(day, from + i), label])));
}

/** The sample student's settings, as the mockup starts them. */
export const samplePreferences: Preferences = {
  busy: busyHours(["Tue", "Thu"], 15, 17, "Work"),
  startAfter: 9 * 60,
  leanings: { time: -1, fewerDays: 2, compact: 1, walking: 3, rating: 2 },
  maxCredits: 15,
  kept: [],
};

/** Tapping an hour paints it busy, or clears it. */
export function toggleCell(prefs: Preferences, day: ClassDay, hour: number): Preferences {
  const key = cellKey(day, hour);
  const busy = { ...prefs.busy };
  if (key in busy) delete busy[key];
  else busy[key] = "Busy";
  return { ...prefs, busy };
}

/** A day is off when every hour of it is busy. Tapping the day header turns that on or off. */
export function isDayOff(prefs: Preferences, day: ClassDay): boolean {
  for (let hour = gridHours.first; hour < gridHours.last; hour += 1) {
    if (!(cellKey(day, hour) in prefs.busy)) return false;
  }
  return true;
}

/**
 * Taking a day off fills its free hours with "Day off"; giving it back
 * removes only those, so the busy times the student painted survive.
 */
export function toggleDayOff(prefs: Preferences, day: ClassDay): Preferences {
  const busy = { ...prefs.busy };
  const keys = Array.from({ length: gridHours.last - gridHours.first }, (_, i) => cellKey(day, gridHours.first + i));
  if (isDayOff(prefs, day)) {
    const filled = keys.filter((key) => busy[key] === DAY_OFF);
    // A day the student painted busy hour by hour has no "Day off" fill: clear it all.
    for (const key of filled.length ? filled : keys) delete busy[key];
  } else {
    for (const key of keys) busy[key] = busy[key] ?? DAY_OFF;
  }
  return { ...prefs, busy };
}

export type BusyBlock = { day: ClassDay; start: number; end: number; label: string };

/** Busy hours merged into blocks: consecutive hours with one label on one day become one block. */
export function busyBlocks(prefs: Preferences): BusyBlock[] {
  const blocks: BusyBlock[] = [];
  for (const day of gridDays) {
    let open: BusyBlock | null = null;
    for (let hour = gridHours.first; hour < gridHours.last; hour += 1) {
      const label = prefs.busy[cellKey(day, hour)];
      if (label !== undefined && open && open.label === label && open.end === hour * 60) {
        open.end += 60;
      } else if (label !== undefined) {
        open = { day, start: hour * 60, end: hour * 60 + 60, label };
        blocks.push(open);
      } else {
        open = null;
      }
    }
  }
  return blocks;
}

/** The busy rows under the grid: one per label and time, listing its days ("Tue and Thu"). */
export function busySummary(prefs: Preferences): Array<{ label: string; days: ClassDay[]; start: number; end: number }> {
  const rows = new Map<string, { label: string; days: ClassDay[]; start: number; end: number }>();
  for (const block of busyBlocks(prefs)) {
    if (block.label === DAY_OFF) continue;
    const key = `${block.label}|${block.start}|${block.end}`;
    const row = rows.get(key) ?? { label: block.label, days: [], start: block.start, end: block.end };
    row.days.push(block.day);
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** Removes every hour a summary row covers. */
export function clearBusy(prefs: Preferences, row: { label: string; days: readonly ClassDay[]; start: number; end: number }): Preferences {
  const busy = { ...prefs.busy };
  for (const day of row.days) {
    for (let minute = row.start; minute < row.end; minute += 60) {
      const key = cellKey(day, minute / 60);
      if (busy[key] === row.label) delete busy[key];
    }
  }
  return { ...prefs, busy };
}

/** "Mon", "Mon and Wed", "Mon, Wed and Fri": days in a sentence. */
export function daysText(days: readonly ClassDay[]): string {
  if (days.length <= 1) return days.join("");
  return `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
}

const LEVEL = ["Doesn't matter", "A little", "Some", "A lot", "Most"];

/** The leaning cards. Wording is the r3 mockup's, so the web and the phone say the same thing. */
export const leanings: Record<
  LeaningKey,
  { title: string; min: number; max: number; left: string; right: string; values: string[]; says: string[] }
> = {
  time: {
    title: "Time of day",
    min: -2,
    max: 2,
    left: "Earlier",
    right: "Later",
    values: ["As early as it can", "Earlier", "Any time", "Later", "As late as it can"],
    says: [
      "Puts classes as early in the day as it can.",
      "Leans toward morning sections.",
      "No preference. Classes go wherever they fit.",
      "Leans toward afternoon sections.",
      "Puts classes as late in the day as it can.",
    ],
  },
  fewerDays: {
    title: "Fewer days on campus",
    min: 0,
    max: 4,
    left: "Doesn't matter",
    right: "Matters most",
    values: LEVEL,
    says: [
      "Uses whichever days fit best.",
      "Breaks ties toward fewer days.",
      "Favors fewer days on campus.",
      "Strongly favors fewer days on campus.",
      "Fits classes into as few days as it can.",
    ],
  },
  compact: {
    title: "Short gaps",
    min: 0,
    max: 4,
    left: "Doesn't matter",
    right: "Back-to-back",
    values: LEVEL,
    says: [
      "Doesn't mind long gaps between classes.",
      "Breaks ties toward shorter gaps.",
      "Favors shorter gaps between classes.",
      "Strongly favors short gaps.",
      "Packs classes back-to-back wherever it can.",
    ],
  },
  walking: {
    title: "Short walks",
    min: 0,
    max: 4,
    left: "Doesn't matter",
    right: "Matters most",
    values: LEVEL,
    says: [
      "Doesn't weigh walking distance.",
      "Breaks ties toward shorter walks.",
      "Favors nearby buildings.",
      "Strongly favors nearby buildings.",
      "Counts short walks above everything else it leans on.",
    ],
  },
  rating: {
    title: "Well-rated instructors",
    min: 0,
    max: 4,
    left: "Doesn't matter",
    right: "Matters most",
    values: LEVEL,
    says: [
      "Doesn't look at instructor ratings.",
      "Breaks ties toward better-rated instructors.",
      "Favors instructors students rate highly.",
      "Strongly favors highly rated instructors.",
      "Counts instructor ratings above everything else it leans on.",
    ],
  },
};

export const leaningOrder: readonly LeaningKey[] = ["time", "fewerDays", "compact", "walking", "rating"];

/** The words for a leaning's value: the card's subtitle and the well's sentence. */
export function leaningText(key: LeaningKey, value: number): { value: string; says: string } {
  const lean = leanings[key];
  const step = Math.min(Math.max(Math.round(value), lean.min), lean.max) - lean.min;
  return { value: lean.values[step], says: lean.says[step] };
}
