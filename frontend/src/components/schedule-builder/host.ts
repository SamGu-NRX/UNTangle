/**
 * Everything the schedule builder needs from the product it runs in
 * (DESIGN.md §8.4). UNTangle supplies one backed by the student's plan;
 * the standalone UNT Schedule Builder supplies its own. Nothing in this
 * folder reads a store, the prerequisite engine or the app shell: if the
 * builder needs something, it comes through here.
 */
import type { CheckedFeed, FeedTerm, Outcome } from "@/lib/calendar-busy";
import type { Section } from "@/lib/sections";
import type { ConnectedCalendar, SchedulePreferences } from "@/lib/types";
import type { WalkFn } from "./week";

export type BuilderBrand = {
  id: "untangle" | "vsb";
  primaryLabel: string;
  primaryShort: string;
  /** Search opens on the host's suggestions ("You can take") rather than examples. */
  suggestions: boolean;
};

export type BuilderTerm = {
  /** Term id in section data, such as "spring-2027". */
  id: string;
  /** "Spring 2027" */
  label: string;
};

/** A course on the week, as the host resolves it. */
export type WeekCourse = {
  code: string;
  title: string;
  credits: number;
  /** The section on the week, or null when none is placed yet. */
  section: Section | null;
  /**
   * placed: on the week (picked or suggested); loading: options still on
   * their way; pick: the student has to choose (`note` says why); none: the
   * course has nothing to place this term (`note` says why).
   */
  state: "placed" | "loading" | "pick" | "none";
  note?: string;
  /** Kept: Auto won't move it. */
  locked: boolean;
};

export type SearchHit = {
  code: string;
  title: string;
  /** UNTangle only: where the course stands for this student. */
  status?: "available" | "planned" | "check" | "locked" | "taking" | "done";
};

export type BuilderSearch = {
  /** Courses matching a query, best first. */
  find: (query: string) => SearchHit[];
  /** What search shows before anything is typed; empty for the standalone builder. */
  suggestions: () => SearchHit[];
  /** A course's options once loaded, else null. Pure: safe to call while rendering. */
  options: (courseCode: string) => readonly Section[] | null;
  /** Starts loading these courses' options (from an effect or a handler, never while rendering). */
  load: (courseCodes: readonly string[]) => void;
  /** The course and section a myUNT class number names; null for no match. Rejects when it can't look. */
  classNumber: (number: string) => Promise<{ courseCode: string; sectionId: string } | null>;
};

/** Changes to the week. Each is one undoable step. */
export type BuilderEdits = {
  /**
   * Puts `sectionId` on the week, adding the course when it isn't there.
   * Returns why it refused, changing nothing; null when it placed the section.
   */
  place: (courseCode: string, sectionId: string) => string | null;
  remove: (courseCode: string) => void;
  keep: (courseCode: string, kept: boolean) => void;
  /**
   * Replaces the week's sections with an alternative's. Returns why each
   * course it left out was refused, one sentence each; empty when none was.
   */
  use: (byCourse: Record<string, string>) => string[];
  clear: () => void;
  undo: () => void;
  canUndo: boolean;
};

/** One fix the optimizer suggests when nothing fits, such as "Allow classes on Mondays". */
export type BuilderFix = { label: string; apply: () => void };

/** The optimizer's best-so-far stream, as the options strip reads it. */
export type OptionsFeed = {
  /** Which run the options belong to; a later answer to the same run is an upgrade, a new run is a new answer. */
  runId: number | null;
  status: "idle" | "running" | "refining" | "done" | "error";
  /** Ranked alternatives, best first: course code -> section id. */
  options: ReadonlyArray<Record<string, string>>;
  /** Settings changed since these were found: shown, never applied. */
  stale: boolean;
  /** When nothing fits: why, and the fixes that would make something fit. */
  infeasible: { sentence: string; fixes: BuilderFix[] } | null;
  error: string | null;
  /**
   * Why an alternative is a good fit, one line each, seat warnings first.
   * Empty when the host can't say (the standalone builder, or a result that
   * no longer matches what's shown).
   */
  explain: (byCourse: Record<string, string>) => ReadonlyArray<{ sentence: string; warning: boolean }>;
  run: () => void;
  close: () => void;
};

/**
 * Connecting calendar feeds as busy time. The address the student pastes is
 * passed straight through and never kept; what comes back is the calendar
 * with its address sealed, for the builder to add to the preferences.
 */
export type BuilderCalendars = {
  /** The term busy time is read for, with its first and last day. */
  term: FeedTerm;
  /** Reads a feed over the term: its busy count and its events. */
  check: (url: string) => Promise<Outcome<CheckedFeed>>;
  /** Reads a feed's busy time and seals its address. Nothing is saved until the builder adds it. */
  connect: (url: string, name: string, options: { countAllDay: boolean }) => Promise<Outcome<ConnectedCalendar>>;
  /** Why a connected calendar couldn't be refreshed, by calendar id; absent when it's current. */
  problems: Readonly<Record<string, string>>;
};

/** One row of Browse all: a whole week, with the figures its row shows. */
export type BrowseRow = {
  /** Course code -> section id, every course the search placed. */
  byCourse: Record<string, string>;
  daysOnCampus: number;
  /** Earliest start and latest end of the week, in minutes; null when nothing is timed. */
  earliestStart: number | null;
  latestEnd: number | null;
};

/**
 * Every week that fits, best first by Auto's ranking (lib/optimizer/enumerate.ts),
 * as Browse all reads it. The same inputs as Auto's run: pins, kept
 * sections, blocked times and preferences.
 */
export type BrowseFeed = {
  status: "idle" | "running" | "done" | "error";
  /** At most the first 500, best first. */
  rows: readonly BrowseRow[];
  /** Weeks that fit; a lower bound unless `totalExact`. */
  total: number;
  totalExact: boolean;
  /** False when the search ran out of time before proving these are the best ones. */
  proven: boolean;
  /** Settings changed since this list was found: shown, never applied. */
  stale: boolean;
  /** When nothing fits: why, and the fixes that would make something fit (Auto's explanation). */
  infeasible: { sentence: string; fixes: BuilderFix[] } | null;
  /** The search ran out before it found a week or ruled them all out. */
  timedOut: boolean;
  error: string | null;
  run: () => void;
  close: () => void;
};

/** "Set up Auto": the short first-run setup over Week (r3 mockup, onboarding.html). */
export type BuilderSetup = {
  /**
   * Open it on this visit: the student has never skipped or finished it on
   * this browser and has no saved preferences. Read once per identity when
   * its preferences load, so it describes the student's arrival, not the
   * preferences the setup's own answers then save.
   */
  due: boolean;
  /** Skipping or finishing it: it never opens on its own again for this identity. */
  markSeen: () => void;
};

/** One exam sitting: an ISO date and minutes after midnight, half-open [start, end). */
export type ExamSlot = { date: string; start: number; end: number };

/**
 * A section's final as Week shows it: when it is, and whether that time is
 * projected from another term; or one sentence on why it isn't known.
 */
export type FinalExam = { kind: "known"; exam: ExamSlot; projected: boolean } | { kind: "unknown"; note: string };

/** Each section's final exam, for the Finals line under the week and the section rows. */
export type BuilderFinals = {
  examOf: (section: Section) => FinalExam;
  /**
   * Where projected times come from, said once on the Finals line
   * ("Projected"), or null when they are the term's own published finals.
   */
  projected: { label: string; source: string } | null;
};

export type BuilderHost = {
  brand: BuilderBrand;
  term: BuilderTerm;
  courses: readonly WeekCourse[];
  /** "sample" when any section on the week is a made-up sample (said once, under the grid). */
  provenance: "real" | "sample";
  preferences: SchedulePreferences;
  /** What the Preferences line compares against, and Back to defaults restores. */
  defaults: SchedulePreferences;
  setPreferences: (update: (current: SchedulePreferences) => SchedulePreferences) => void;
  /** False until saved preferences have loaded; the panel waits rather than overwrite them. */
  preferencesReady: boolean;
  /**
   * The first-run setup, or null for a host without one: the standalone
   * builder, whose build button isn't named Auto.
   */
  setup: BuilderSetup | null;
  walk: WalkFn;
  search: BuilderSearch;
  edits: BuilderEdits;
  optimizer: OptionsFeed;
  /** Browse all, or null for a host that can't list every week; Week then leaves the button out. */
  browse: BrowseFeed | null;
  /** Final exams, or absent for a host that doesn't know them: Week then shows no Finals line. */
  finals?: BuilderFinals | null;
  /** Section lookup for an alternative's ids, across every loaded option. */
  find: (courseCode: string, sectionId: string) => Section | undefined;
  /** Where Export's Print goes, and the address a share link opens. */
  printHref: string;
  shareUrl: (encoded: string) => string;
  /** Calendar feeds as busy time; null where the host can't connect them. */
  calendars: BuilderCalendars | null;
};
