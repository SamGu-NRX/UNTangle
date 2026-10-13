import type { CourseStatus, WeekDay } from "@/lib/types";
import type { Lens } from "./routes";

/** A reading of the local clock, so the landing rule is pure. */
export type Clock = {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Local weekday; null on Saturday and Sunday, which hold no classes. */
  weekday: WeekDay | null;
  /** Minutes since local midnight. */
  minutes: number;
};

const WEEKDAYS: ReadonlyArray<WeekDay | null> = [null, "Mon", "Tue", "Wed", "Thu", "Fri", null];

export function readClock(now: Date): Clock {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    weekday: WEEKDAYS[now.getDay()],
    minutes: now.getHours() * 60 + now.getMinutes(),
  };
}

export type LandingInput = {
  /** Anything planned or imported yet (hasStartedPlan). */
  started: boolean;
  /** The phone layout; desktop sessions are planning sessions. */
  phone: boolean;
  /** The lens the student last had open, if any. */
  lastLens: Lens | null;
  clock: Clock;
  /** First and last day of classes of the active schedule's term. */
  term: { start: string; end: string };
  /** The active schedule's meetings; `end` is "HH:MM", 24-hour. */
  meetings: ReadonlyArray<{ day: WeekDay; end: string }>;
};

/**
 * Where opening the app lands (docs/design/untangle-v3.md, "Phone
 * landing"): a first visit goes to the import entry; on a phone, during the
 * term, Day when a class has not yet ended today; otherwise the last lens
 * used, and Courses when there is none. Deterministic, so a student can
 * learn it.
 */
export function landing(input: LandingInput): "import" | Lens {
  if (!input.started) return "import";
  if (input.phone && classStillAhead(input)) return "day";
  return input.lastLens ?? "courses";
}

function classStillAhead({ clock, term, meetings }: LandingInput): boolean {
  if (clock.weekday === null || clock.date < term.start || clock.date > term.end) return false;
  return meetings.some((meeting) => meeting.day === clock.weekday && toMinutes(meeting.end) > clock.minutes);
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** The persisted parts of PlannerState that a student changes by planning. */
export type PlanProgress = {
  selectedMajor: string | null;
  transcriptRecords: readonly unknown[] | undefined;
  courseStatuses: Record<string, CourseStatus>;
  selectedSections: Record<string, string>;
  lockedSections?: Record<string, string>;
  optimization: string;
};

function sameRecord(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

/**
 * Whether the student has started a plan: anything persisted that differs
 * from the seeded starting state. That covers a chosen major, an imported
 * transcript, a changed course status, a picked or locked section, and a
 * different optimization goal. The seed itself ships a few statuses (and
 * the sections normalisation derives from them), so "anything set" would
 * wrongly count a first visit; comparing against the seed does not.
 * Pass both states through the same normalisation.
 */
export function hasStartedPlan(state: PlanProgress, defaults: Omit<PlanProgress, "selectedMajor" | "transcriptRecords">): boolean {
  if (state.selectedMajor !== null) return true;
  if ((state.transcriptRecords ?? []).length > 0) return true;
  if (state.optimization !== defaults.optimization) return true;
  if (!sameRecord(state.selectedSections, defaults.selectedSections)) return true;
  if (!sameRecord(state.lockedSections, defaults.lockedSections)) return true;
  const codes = new Set([...Object.keys(state.courseStatuses), ...Object.keys(defaults.courseStatuses)]);
  for (const code of codes) {
    if ((state.courseStatuses[code] ?? "notTaken") !== (defaults.courseStatuses[code] ?? "notTaken")) return true;
  }
  return false;
}
