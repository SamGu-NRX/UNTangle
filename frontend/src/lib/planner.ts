import {
  buildings,
  courses,
  defaultPlannerState,
  majors,
  prerequisiteEdges,
} from "@/lib/seed-data";
import {
  buildCampusGeocodeQuery,
  resolveCampusBuilding,
  resolveCampusLocation,
} from "@/lib/campus-locations";
import {
  classNumbersOf,
  findOption,
  hasOpenSeats,
  isCandidate,
  otherSiteOf,
  optionLabel,
  planningTerm,
  sampleCatalog,
  sampleOption,
  scheduleEventsOf,
  sectionRef,
  termDates,
  toOptSection,
  type CandidateFilter,
  type SectionCatalog,
} from "@/lib/planner-sections";
import type { CourseSections, Section } from "@/lib/sections";
import {
  isValidCourseStatus,
  isValidOptimization,
  isValidClassDay,
  sanitizeCoursePlan,
  sanitizeTranscriptRecords,
} from "@/lib/planner-validation";
import { compareAcademicTerms } from "@/lib/term-chronology";
import { plannerTravelTime, type WalkingTimeFn } from "@/lib/planner-walking";
import { optimize } from "@/lib/optimizer/optimize";
import { GOAL_WEIGHTS, NO_CONSTRAINTS } from "@/lib/optimizer/presets";
import type { SerializedBusyOccurrence } from "@/lib/calendar-feeds/busy-serialize";
import { calendarBlockedTimes } from "@/lib/calendar-busy";
import { PreferencesBodySchema } from "../../../packages/contracts/src/documents";
import type { OptBlockedTime, OptCourse, OptDay, OptimizeRequest, OptSection } from "@/lib/optimizer/types";
import {
  classDays,
  type ClassDay,
  type CoursePlan,
  type Course,
  type CourseStatus,
  type MajorId,
  type MapStop,
  type OptimizationKey,
  type PlannerApiPayload,
  type PlannerState,
  type ScheduleConstraints,
  type ScheduleEvent,
  type SchedulePreferences,
  type WeekDay,
} from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Blocked-time dates are optional; when present they must be real inclusive ISO date ranges. */
function blockedDatesValid(dates: unknown): boolean {
  if (dates === undefined || dates === null) return true;
  if (!Array.isArray(dates)) return false;
  return dates.every((range) => {
    if (!isPlainRecord(range)) return false;
    if (typeof range.start !== "string" || typeof range.end !== "string") return false;
    if (!ISO_DATE.test(range.start) || !ISO_DATE.test(range.end)) return false;
    return parseIsoDate(range.start) !== null && parseIsoDate(range.end) !== null && range.start <= range.end;
  });
}

function parseIsoDate(date: string): string | null {
  if (!ISO_DATE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === date ? date : null;
}

const CALENDAR_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function calendarWeekday(date: string): OptDay | null {
  const parsed = parseIsoDate(date);
  if (parsed === null) return null;
  return CALENDAR_WEEKDAYS[new Date(Date.parse(`${parsed}T00:00:00Z`)).getUTCDay()] ?? null;
}

/**
 * Calendar busy pieces become generic dated blocked times: weekday and
 * minutes from the piece, grouped by slot with one date entry per piece, and
 * no event title anywhere — the id carries only a slot index, so an
 * infeasibility explanation names the block, never the event.
 *
 * Accepts exactly the busy route's serialized occurrence shape. Pieces dated
 * outside `term` are dropped: an empty `dates` list means every week, so a
 * wholly out-of-term piece must not survive into a block.
 */
export function busyOccurrencesToBlockedTime(
  pieces: readonly SerializedBusyOccurrence[],
  term?: { start: string; end: string },
): OptBlockedTime[] {
  const groups = new Map<string, { day: OptDay; start: number; end: number; dates: { start: string; end: string }[] }>();
  for (const piece of pieces) {
    if (term && (piece.date < term.start || piece.date > term.end)) continue;
    const day = calendarWeekday(piece.date);
    if (day === null) continue;
    const key = `${day}/${piece.startMinutes}/${piece.endMinutes}`;
    const group = groups.get(key);
    if (group) {
      group.dates.push({ start: piece.date, end: piece.date });
    } else {
      groups.set(key, { day, start: piece.startMinutes, end: piece.endMinutes, dates: [{ start: piece.date, end: piece.date }] });
    }
  }
  return [...groups.values()].map((group, index) => ({
    id: `cal-${index}`,
    label: "Calendar busy",
    day: group.day,
    start: group.start,
    end: group.end,
    dates: group.dates,
  }));
}


const validMajorIds = new Set<MajorId>(majors.map((m) => m.id));

const catalogCourseCodes = new Set(courses.map((course) => course.code));

const plannerStorageKey = "untangle-planner-state";

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function getBuilding(buildingId: string | null | undefined) {
  if (!buildingId) {
    return undefined;
  }

  return buildings.find((building) => building.id === buildingId);
}

/**
 * Courses in the plan for the planning term: `inProgress` with no current
 * transcript row. `inProgress` with an in-progress transcript row is a
 * course the student is taking this term; it is not scheduled, mapped or
 * counted in the plan's credits.
 */
export function getPlanningTermCourseCodes(state: PlannerState) {
  const courseStatuses = {
    ...defaultPlannerState.courseStatuses,
    ...(state.courseStatuses ?? {}),
  };
  const takingNow = new Set(
    (state.transcriptRecords ?? [])
      .filter((record) => !record.duplicateExcluded && record.appliedStatus === "inProgress")
      .map((record) => record.code),
  );

  return courses
    .filter((course) => courseStatuses[course.code] === "inProgress" && !takingNow.has(course.code))
    .map((course) => course.code);
}

/** @deprecated Same as getPlanningTermCourseCodes; kept so existing callers compile. */
export function getActiveCourseCodes(state: PlannerState) {
  return getPlanningTermCourseCodes(state);
}

/** The planning term's first and last day: the optimizer's boundary for meetings without dates. */
const planningTermDates = termDates[planningTerm.id];

/** Denton only (Discovery Park included), closed sections allowed: what the optimizer suggests until the student widens it. */
export const DEFAULT_CANDIDATE_FILTER: CandidateFilter = { openSeatsOnly: false, otherSites: false };

/**
 * Each course's options that have a set time and pass `filter`, in the
 * optimizer's shape. Courses still loading, and courses with no such option,
 * are left out.
 */
export function toOptimizerCourses(
  courseCodes: readonly string[],
  catalog: SectionCatalog = sampleCatalog,
  filter: CandidateFilter = DEFAULT_CANDIDATE_FILTER,
): OptCourse[] {
  return [...new Set(courseCodes)].flatMap((code) => {
    const course = getCourseByCode(code);
    const options = catalog(code);
    if (!course || options.status !== "ready") return [];
    const sections = options.result.sections
      .filter((section) => isCandidate(section, filter))
      .map(toOptSection)
      .filter((section): section is OptSection => section !== null);
    if (sections.length === 0) return [];
    return [{ code, credits: Number.isFinite(course.creditHours) && course.creditHours >= 0 ? course.creditHours : 0, sections }];
  });
}

/**
 * Node budget for `recommendSections`. It runs whenever the plan or its
 * loaded sections change, and must give the same answer on every render and
 * every machine, so it is bounded by work done, not by the clock. Most calls
 * fix every course but one and finish in a handful of nodes; this bound only
 * matters when a goal re-plans every course at once (then the best schedule
 * found so far is used).
 */
const RECOMMEND_MAX_NODES = 20_000;

/**
 * One schedule for a goal, keeping `fixedSelections` (locks and existing
 * picks) as they are. Courses without timed options are skipped, and so is
 * a course whose fixed pick is not one of them: a pick that no longer
 * resolves, or one with no set time, is not the optimizer's to replace. When
 * the fixed sections clash so that nothing fits, they are returned as they
 * are and the clash is left for the page to show.
 */
export function recommendSections(
  option: OptimizationKey,
  courseCodes: string[] = courses.filter((course) => course.planned).map((course) => course.code),
  fixedSelections: Record<string, string> = {},
  catalog: SectionCatalog = sampleCatalog,
  // Campus walkway times plus the Discovery Park shuttle, the same provider Optimize uses.
  walkingTime: WalkingTimeFn = plannerTravelTime,
  filter: CandidateFilter = DEFAULT_CANDIDATE_FILTER,
) {
  const optimizerCourses = toOptimizerCourses(courseCodes, catalog, filter).filter(
    (course) => !(course.code in fixedSelections) || course.sections.some((section) => section.id === fixedSelections[course.code]),
  );
  const locks = Object.fromEntries(
    optimizerCourses.filter((course) => course.code in fixedSelections).map((course) => [course.code, fixedSelections[course.code]]),
  );
  if (optimizerCourses.length === 0) {
    return {};
  }
  const result = optimize({
    courses: optimizerCourses,
    locks,
    excluded: [],
    term: planningTermDates,
    constraints: NO_CONSTRAINTS,
    weights: GOAL_WEIGHTS[option],
    walkingTime,
    k: 1,
    maxNodes: RECOMMEND_MAX_NODES,
    timeBudgetMs: Number.POSITIVE_INFINITY,
    explainBudgetMs: 0,
  });
  if (result.schedules.length > 0) {
    return { ...result.schedules[0].byCourse };
  }
  return locks;
}

/**
 * Where a planned course stands against the sections loaded so far:
 * - `chosen`: the student's pick, found among the current options;
 * - `recommended`: no pick, so the goal's recommendation is shown;
 * - `sample-pick`: a saved synthetic sample while real options exist; it
 *   stays on the week, labeled, until the student picks a real section;
 * - `needs-review`: a saved pick that names no current option; it is kept
 *   and flagged, never swapped for another option;
 * - `choose`: options exist but none can be recommended (no set times, or
 *   none fits the fixed picks);
 * - `not-offered`: vsb says the course has no classes this term;
 * - `no-data`: no real record and no samples.
 */
export type PlannedCourseState =
  | "loading"
  | "chosen"
  | "recommended"
  | "sample-pick"
  | "needs-review"
  | "choose"
  | "not-offered"
  | "no-data";

export type PlannedCourse = {
  code: string;
  state: PlannedCourseState;
  /** The catalog's answer for the course, once loaded. */
  result: CourseSections | null;
  /** The option on the week: chosen, recommended, or a saved sample. */
  section: Section | null;
  /** The student's saved pick, resolved or not. */
  savedId: string | null;
};

export type SectionPlan = {
  /** Planning-term courses in catalog order. */
  courses: PlannedCourse[];
  /** Course -> option id: every saved pick (resolved or not) plus the recommendations. */
  selections: Record<string, string>;
};

function placeSavedPick(code: string, result: CourseSections, savedId: string): PlannedCourse {
  const found = result.sections.find((section) => section.id === savedId);
  if (found) return { code, state: "chosen", result, section: found, savedId };
  const sample = sectionRef(savedId).provenance === "sample" ? sampleOption(savedId) : undefined;
  if (sample?.courseCode === code && result.provenance.kind === "real") {
    return { code, state: "sample-pick", result, section: sample, savedId };
  }
  return { code, state: "needs-review", result, section: null, savedId };
}

/**
 * The plan's sections against what has loaded. Saved picks are resolved,
 * never replaced; courses without a pick get the goal's recommendation,
 * planned around the chosen sections.
 */
export function resolveSectionPlan(
  state: PlannerState,
  catalog: SectionCatalog = sampleCatalog,
  filter: CandidateFilter = DEFAULT_CANDIDATE_FILTER,
  walkingTime: WalkingTimeFn = plannerTravelTime,
): SectionPlan {
  const placed = getPlanningTermCourseCodes(state).map((code): PlannedCourse => {
    const options = catalog(code);
    const savedId = state.selectedSections[code] ?? null;
    if (options.status === "loading") return { code, state: "loading", result: null, section: null, savedId };
    const result = options.result;
    if (savedId) return placeSavedPick(code, result, savedId);
    if (result.availability === "no_classes") return { code, state: "not-offered", result, section: null, savedId };
    if (result.sections.length === 0) return { code, state: "no-data", result, section: null, savedId };
    return { code, state: "choose", result, section: null, savedId };
  });

  const chosen = Object.fromEntries(placed.filter((course) => course.state === "chosen").map((course) => [course.code, course.savedId!]));
  const open = placed.filter((course) => course.state === "choose");
  const recommended =
    open.length > 0
      ? recommendSections(state.optimization, [...Object.keys(chosen), ...open.map((course) => course.code)], chosen, catalog, walkingTime, filter)
      : {};
  const courses = placed.map((course): PlannedCourse => {
    if (course.state !== "choose") return course;
    const options = course.result!.sections;
    // With nothing to place on the week, a lone suggestible option is still the only choice.
    const lone = options.length === 1 && isCandidate(options[0], filter) ? options[0] : null;
    const section = options.find((option) => option.id === recommended[course.code]) ?? lone;
    return section ? { ...course, state: "recommended", section } : course;
  });

  const selections: Record<string, string> = {};
  for (const course of courses) {
    const id = course.savedId ?? course.section?.id;
    if (id) selections[course.code] = id;
  }
  return { courses, selections };
}

export const DEFAULT_SCHEDULE_CONSTRAINTS: ScheduleConstraints = {
  earliestStart: null,
  latestEnd: null,
  daysOff: [],
  blocked: [],
  maxCredits: null,
  // On by default: a schedule whose walk does not fit the break is not a schedule.
  walkingBufferMinutes: 0,
  excludedSections: [],
  openSeatsOnly: false,
  otherSites: false,
};

export function defaultSchedulePreferences(goal: OptimizationKey): SchedulePreferences {
  return { constraints: DEFAULT_SCHEDULE_CONSTRAINTS, weights: { ...GOAL_WEIGHTS[goal] } };
}

const WEEK_DAYS: readonly WeekDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function isMinute(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 24 * 60;
}

function isWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
}

/**
 * Stored preferences, or null when the stored value is not a valid
 * preferences object (it is then replaced by defaults, never half-read).
 */
export function parseSchedulePreferences(raw: unknown): SchedulePreferences | null {
  if (!isPlainRecord(raw) || !isPlainRecord(raw.constraints) || !isPlainRecord(raw.weights)) return null;
  const c = raw.constraints;
  const w = raw.weights;
  const weightKeys = ["fewerDays", "compact", "mornings", "evenings", "walking", "rating"] as const;
  if (!weightKeys.every((key) => isWeight(w[key]))) return null;
  if (!(c.earliestStart === null || isMinute(c.earliestStart))) return null;
  if (!(c.latestEnd === null || isMinute(c.latestEnd))) return null;
  if (!Array.isArray(c.daysOff) || !c.daysOff.every((day) => WEEK_DAYS.includes(day as WeekDay))) return null;
  if (!(c.maxCredits === null || (typeof c.maxCredits === "number" && c.maxCredits >= 0 && c.maxCredits <= 40))) return null;
  if (!(c.walkingBufferMinutes === null || (isMinute(c.walkingBufferMinutes) && c.walkingBufferMinutes <= 120))) return null;
  if (!Array.isArray(c.excludedSections) || !c.excludedSections.every((id) => typeof id === "string")) return null;
  // Preferences stored before these switches existed have neither; absent means off.
  if (![c.openSeatsOnly, c.otherSites].every((flag) => flag === undefined || typeof flag === "boolean")) return null;
  if (
    !Array.isArray(c.blocked) ||
    !c.blocked.every(
      (block) =>
        isPlainRecord(block) &&
        typeof block.id === "string" &&
        typeof block.label === "string" &&
        WEEK_DAYS.includes(block.day as WeekDay) &&
        isMinute(block.start) &&
        isMinute(block.end) &&
        (block.end as number) > (block.start as number) &&
        blockedDatesValid(block.dates),
    )
  ) {
    return null;
  }
  // Blocked-time ids name the cause in an infeasibility explanation; the optimizer rejects duplicates.
  const blockedIds = (c.blocked as Array<{ id: string }>).map((block) => block.id);
  if (new Set(blockedIds).size !== blockedIds.length) return null;
  // Connected calendars follow the preferences document's own schema, which refuses a plain feed address.
  const calendars = PreferencesBodySchema.shape.calendars.safeParse(raw.calendars);
  if (!calendars.success) return null;
  return {
    constraints: {
      earliestStart: c.earliestStart as number | null,
      latestEnd: c.latestEnd as number | null,
      daysOff: [...new Set(c.daysOff as WeekDay[])],
      blocked: c.blocked as ScheduleConstraints["blocked"],
      maxCredits: c.maxCredits as number | null,
      walkingBufferMinutes: c.walkingBufferMinutes as number | null,
      excludedSections: [...new Set(c.excludedSections as string[])],
      openSeatsOnly: c.openSeatsOnly === true,
      otherSites: c.otherSites === true,
    },
    weights: Object.fromEntries(weightKeys.map((key) => [key, w[key]])) as SchedulePreferences["weights"],
    ...(calendars.data ? { calendars: calendars.data } : {}),
  };
}

export type HeldOutCourse = { code: string; reason: "pick-not-suggestible" | "lock-unavailable" };

/**
 * Planned courses Optimize leaves exactly as they are, and why:
 * - `pick-not-suggestible`: the pick is a loaded option the optimizer may
 *   not offer (no set time, or at another site); it could only replace it;
 * - `lock-unavailable`: the course is locked to a section that is no loaded
 *   option (an old sample, or one that no longer exists). Searching without
 *   the lock would move a locked course, so the course is held out and the
 *   page asks the student to unlock it.
 */
export function heldOutCourses(
  state: PlannerState,
  catalog: SectionCatalog,
  filter: CandidateFilter,
  courseCodes: readonly string[] = getPlanningTermCourseCodes(state),
): HeldOutCourse[] {
  const locked = getLockedSelections(state);
  const offered = new Map(toOptimizerCourses(courseCodes, catalog, filter).map((course) => [course.code, course]));
  return courseCodes.flatMap((code): HeldOutCourse[] => {
    const pick = state.selectedSections[code];
    if (!pick || offered.get(code)?.sections.some((section) => section.id === pick)) return [];
    const loaded = catalog(code);
    if (loaded.status === "ready" && loaded.result.sections.some((section) => section.id === pick)) {
      return [{ code, reason: "pick-not-suggestible" }];
    }
    return locked[code] === pick ? [{ code, reason: "lock-unavailable" }] : [];
  });
}

/**
 * The optimizer request for a plan. `courseCodes` defaults to the courses
 * marked Taking; a course-suggestion step can pass its own list instead.
 * A course `heldOutCourses` names keeps exactly its current section: it
 * goes in as a locked one-option course, so its meetings count for
 * conflicts, walking and days. The student's own pick ignores the
 * suggestion filters, and an old sample lock brings the meetings Week shows
 * for it. A held course with nothing timed to place (online, or a pick that
 * no longer exists), and a course with no option to suggest, adds only its
 * credits (`fixedCredits`); a course not offered this term adds nothing.
 * Excluded sections that no longer exist in the catalog are dropped rather
 * than rejected.
 */
export function buildOptimizeRequest(
  state: PlannerState,
  preferences: SchedulePreferences,
  options: {
    courseCodes?: string[];
    catalog?: SectionCatalog;
    walkingTime?: WalkingTimeFn;
    timeBudgetMs?: number;
    k?: number;
    /** Dated busy pieces from the busy route's serialized response (calendar-feeds/busy-serialize.ts); title-free by construction. */
    busyOccurrences?: readonly SerializedBusyOccurrence[];
  } = {},
): OptimizeRequest {
  const catalog = options.catalog ?? sampleCatalog;
  const codes = options.courseCodes ?? getPlanningTermCourseCodes(state);
  const held = new Set(heldOutCourses(state, catalog, preferences.constraints, codes).map((course) => course.code));
  const keptAsIs = [...held].flatMap((code): OptCourse[] => {
    const section = findOption(catalog, code, state.selectedSections[code]);
    const fixed = section && toOptSection(section);
    const course = getCourseByCode(code);
    return fixed && course ? [{ code, credits: course.creditHours, sections: [fixed] }] : [];
  });
  const optimizerCourses = [
    ...toOptimizerCourses(codes, catalog, preferences.constraints).filter((course) => !held.has(course.code)),
    ...keptAsIs,
  ];
  const searched = new Set(optimizerCourses.map((course) => course.code));
  const fixedCredits = codes
    .filter((code) => !searched.has(code))
    .filter((code) => {
      const loaded = catalog(code);
      return !(loaded.status === "ready" && loaded.result.availability === "no_classes");
    })
    .reduce((sum, code) => sum + (getCourseByCode(code)?.creditHours ?? 0), 0);
  const offered = new Set(optimizerCourses.flatMap((course) => course.sections.map((section) => section.id)));
  const locked = getLockedSelections(state);
  const c = preferences.constraints;
  const keptIds = new Set(keptAsIs.map((course) => course.sections[0].id));
  return {
    courses: optimizerCourses,
    locks: Object.fromEntries([
      ...optimizerCourses.filter((course) => offered.has(locked[course.code] ?? "")).map((course) => [course.code, locked[course.code]]),
      ...keptAsIs.map((course) => [course.code, course.sections[0].id]),
    ]),
    excluded: c.excludedSections.filter((id) => offered.has(id) && !keptIds.has(id)),
    constraints: {
      earliestStart: c.earliestStart,
      latestEnd: c.latestEnd,
      daysOff: c.daysOff,
      blocked: [
        ...c.blocked,
        ...calendarBlockedTimes(preferences.calendars, planningTerm.id, planningTermDates ?? null),
        ...busyOccurrencesToBlockedTime(options.busyOccurrences ?? [], planningTermDates),
      ],
      maxCredits: c.maxCredits,
      walking: c.walkingBufferMinutes === null ? null : { bufferMinutes: c.walkingBufferMinutes },
    },
    weights: preferences.weights,
    term: planningTermDates,
    fixedCredits,
    // Campus walkway times (map v2's matrix), straight-line only where the walkway graph has no route,
    // and the Discovery Park shuttle's fixed time (planner-walking.ts).
    walkingTime: options.walkingTime ?? plannerTravelTime,
    k: options.k ?? 3,
    timeBudgetMs: options.timeBudgetMs ?? 300,
  };
}

export function normalizePlannerState(state: PlannerState): PlannerState {
  const optimization = isValidOptimization(state.optimization)
    ? state.optimization
    : defaultPlannerState.optimization;
  const activeDay = isValidClassDay(state.activeDay) ? state.activeDay : defaultPlannerState.activeDay;
  const userCourseStatuses: Record<string, CourseStatus> = {};
  Object.entries(state.courseStatuses ?? {}).forEach(([courseCode, status]) => {
    if (isValidCourseStatus(status) && catalogCourseCodes.has(courseCode)) {
      userCourseStatuses[courseCode] = status;
    }
  });
  // Pick only the known planner fields: a request body may carry arbitrary
  // extra keys (e.g. a spoofed userId or id), and none of them may reach
  // persistence.
  const merged: PlannerState = {
    ...defaultPlannerState,
    lockedSections: {},
    courseStatuses: {
      ...defaultPlannerState.courseStatuses,
      ...userCourseStatuses,
    },
    selectedSections: {
      ...defaultPlannerState.selectedSections,
      ...(state.selectedSections ?? {}),
    },
    transcriptRecords: sanitizeTranscriptRecords(state.transcriptRecords),
    optimization,
    activeDay,
    selectedMajor: state.selectedMajor ?? null,
    updatedAt:
      typeof state.updatedAt === "string" ? state.updatedAt : defaultPlannerState.updatedAt,
  };
  const planned = new Set(getPlanningTermCourseCodes(merged));
  // Picks for planned courses are kept as saved. Whether one still names a
  // current option is decided where sections are loaded (resolveSectionPlan),
  // so normalizing, which also runs on the server, never drops or swaps one.
  const selectedSections = Object.fromEntries(
    Object.entries(merged.selectedSections).filter(
      ([courseCode, sectionId]) => planned.has(courseCode) && typeof sectionId === "string",
    ),
  );
  const selectedMajor =
    merged.selectedMajor && validMajorIds.has(merged.selectedMajor) ? merged.selectedMajor : null;
  // A lock survives only while it names the pick of a planned course;
  // anything else (old ids, dropped courses) is released.
  const rawLocks = isPlainRecord(state.lockedSections) ? state.lockedSections : {};
  const lockedSections = Object.fromEntries(
    Object.entries(rawLocks).filter(
      ([courseCode, sectionId]) => typeof sectionId === "string" && selectedSections[courseCode] === sectionId,
    ),
  );
  return {
    ...merged,
    selectedMajor,
    selectedSections,
    lockedSections,
    coursePlan:
      state.coursePlan === undefined || state.coursePlan === null
        ? { manualCredit: legacyManualCredit(merged), autoPlanned: [], lastAuto: null }
        : sanitizeCoursePlan(state.coursePlan, (code) => catalogCourseCodes.has(code)),
  };
}

/** The annotation v1's "Done" toggle wrote onto a course's transcript rows. */
const MANUALLY_DONE_NOTE = "Manually marked done in course review.";

/**
 * Plans saved before coursePlan existed: a course marked done by hand while
 * its transcript rows were not completed (in progress, ignored or needing
 * review) carries v1's explicit annotation. Only that annotation counts as the student's credit claim;
 * a bare "completed" next to an in-progress row is not guessed at.
 */
function legacyManualCredit(state: PlannerState): string[] {
  return [
    ...new Set(
      (state.transcriptRecords ?? [])
        .filter(
          (record) =>
            !record.duplicateExcluded &&
            // v1's Done toggle annotated every non-completed row of the course:
            // in progress, ignored and needs-review alike.
            record.appliedStatus !== "completed" &&
            record.rationale.includes(MANUALLY_DONE_NOTE) &&
            state.courseStatuses[record.code] === "completed",
        )
        .map((record) => record.code),
    ),
  ].sort();
}

/**
 * A hand edit to `codes` (a status change, or a section picked in Week).
 * When the pending Auto run changed one of them, the course is the
 * student's now and Undo is refused: restoring the run's old values would
 * overwrite their choice. Restore paths must not call this.
 */
export function takeFromAutoRun(coursePlan: CoursePlan, codes: readonly string[]): CoursePlan {
  const run = coursePlan.lastAuto;
  if (!run || run.invalidatedBy) return coursePlan;
  const owned = codes.find((code) => run.changes.some((change) => change.code === code));
  return owned ? { ...coursePlan, lastAuto: { ...run, invalidatedBy: owned } } : coursePlan;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Locked sections that still match the selection: the fixed input to every optimize. */
export function getLockedSelections(state: PlannerState): Record<string, string> {
  const locks = state.lockedSections ?? {};
  return Object.fromEntries(
    Object.entries(locks).filter(([courseCode, sectionId]) => state.selectedSections[courseCode] === sectionId),
  );
}

/**
 * Options of planned courses the optimizer will not suggest under `filter`,
 * counted by why: each other site ("Frisco": 2), and full sections. A
 * section at another site that is also full counts as the site.
 */
export function hiddenOptions(plan: SectionPlan, filter: CandidateFilter): { sites: Map<string, number>; full: number } {
  const sites = new Map<string, number>();
  let full = 0;
  for (const course of plan.courses) {
    for (const section of course.result?.sections ?? []) {
      const site = otherSiteOf(section);
      if (site && !filter.otherSites) sites.set(site, (sites.get(site) ?? 0) + 1);
      else if (filter.openSeatsOnly && !hasOpenSeats(section)) full += 1;
    }
  }
  return { sites, full };
}

/**
 * What a student types into myUNT: each real option's class numbers, every
 * component, one course per line. Courses without a real option on the plan
 * (a sample, a pick needing review, still loading) are listed in `missing`.
 */
export function myUntClassNumbers(plan: SectionPlan): { text: string; count: number; missing: string[] } {
  const lines: string[] = [];
  const missing: string[] = [];
  let count = 0;
  for (const course of plan.courses) {
    const numbers = course.section && course.section.term !== null ? classNumbersOf(course.section) : [];
    if (numbers.length === 0) {
      if (course.state !== "not-offered") missing.push(course.code);
      continue;
    }
    count += numbers.length;
    lines.push(`${course.code} §${optionLabel(course.section!)}: ${numbers.join(", ")}`);
  }
  return { text: lines.join("\n"), count, missing };
}

/** The week's timed meetings, for the displays that take events. Courses without an option on the week add none. */
export function buildScheduleEvents(plan: SectionPlan): ScheduleEvent[] {
  return plan.courses.flatMap((course) => (course.section ? scheduleEventsOf(course.section) : []));
}

/**
 * One weekday's classes as map stops, in time order. A room that maps to no
 * catalogue building stays unplaced: its text is never looked up, because a
 * fuzzy match would invent a building.
 */
export function buildStopsForDay(events: readonly ScheduleEvent[], day: ClassDay): MapStop[] {
  return events
    .filter((event) => event.day === day)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    .map((event): MapStop => {
      const shared = {
        courseCode: event.courseCode,
        title: event.title,
        location: event.location,
        geocodeQuery: buildCampusGeocodeQuery(event.location),
        day,
        start: event.start,
        end: event.end,
        dates: event.dates,
      };
      if (!event.buildingId) {
        return {
          ...shared,
          buildingName: event.buildingName,
          shortName: event.location,
          resolutionStatus: "unresolved",
          unmappedRoom: true,
        };
      }
      const auditedBuilding = resolveCampusLocation(event.location, event.buildingId);
      const buildingMetadata = resolveCampusBuilding(event.location, event.buildingId) ?? getBuilding(event.buildingId);
      return {
        ...shared,
        buildingId: buildingMetadata?.id ?? event.buildingId,
        buildingName: buildingMetadata?.name ?? event.location,
        shortName: buildingMetadata?.shortName ?? event.location,
        lat: auditedBuilding?.lat,
        lng: auditedBuilding?.lng,
        resolutionStatus: auditedBuilding ? "local" : "unresolved",
      };
    });
}

export function routeStopsOf(events: readonly ScheduleEvent[]): Record<ClassDay, MapStop[]> {
  return Object.fromEntries(classDays.map((day) => [day, buildStopsForDay(events, day)])) as Record<ClassDay, MapStop[]>;
}

/**
 * What the server stores. It has no loaded sections, so its route stops
 * cover synthetic sample picks only; the client builds its own from the
 * sections it loads.
 */
export function serializePlannerPayload(state: PlannerState): PlannerApiPayload {
  const normalized = normalizePlannerState(state);
  return { ...normalized, routeStops: routeStopsOf(buildScheduleEvents(resolveSectionPlan(normalized))) };
}

export function courseMap() {
  return new Map(courses.map((course) => [course.code, course]));
}

export function readPlannerStateFromSessionStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(plannerStorageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PlannerState;
    return normalizePlannerState(parsed);
  } catch {
    return null;
  }
}

export function writePlannerStateToSessionStorage(state: PlannerState) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(plannerStorageKey, JSON.stringify(normalizePlannerState(state)));
}

export function getInitialPlannerState() {
  return normalizePlannerState(defaultPlannerState);
}

export function getCourseByCode(courseCode: string): Course | undefined {
  return courses.find((course) => course.code === courseCode);
}

export function getBuildingById(buildingId: string | null | undefined) {
  return buildings.find((building) => building.id === buildingId);
}

export function formatTime(value: string) {
  const minutes = toMinutes(value);
  const hours = Math.floor(minutes / 60);
  const suffix = hours >= 12 ? "PM" : "AM";
  const normalizedHour = hours % 12 === 0 ? 12 : hours % 12;
  const normalizedMinutes = minutes % 60;
  return `${normalizedHour}:${`${normalizedMinutes}`.padStart(2, "0")} ${suffix}`;
}

export function summarizeCredits(state: PlannerState) {
  return getPlanningTermCourseCodes(state).reduce((total, courseCode) => {
    const course = getCourseByCode(courseCode);
    return total + (course?.creditHours ?? 0);
  }, 0);
}

export function summarizeCompletedCourses(state: PlannerState) {
  return Object.values(state.courseStatuses).filter((value) => value === "completed").length;
}

export function summarizeInProgressCourses(state: PlannerState) {
  return Object.values(state.courseStatuses).filter((value) => value === "inProgress").length;
}

export function summarizeNotTakenCourses(state: PlannerState) {
  return Object.values(state.courseStatuses).filter((value) => value === "notTaken").length;
}

export function getDailySpan(events: ScheduleEvent[]) {
  if (events.length === 0) {
    return 0;
  }

  const starts = events.map((event) => toMinutes(event.start));
  const ends = events.map((event) => toMinutes(event.end));
  return Math.max(...ends) - Math.min(...starts);
}

export function getMajorById(id: MajorId | null | undefined) {
  if (!id) return undefined;
  return majors.find((major) => major.id === id);
}

export function getCoreCoursesForMajor(id: MajorId | null | undefined): Course[] {
  const major = getMajorById(id);
  if (!major) return [];
  return major.coreCourseCodes
    .map((code) => courses.find((course) => course.code === code))
    .filter((course): course is Course => Boolean(course));
}

export function getMissingPrerequisites(
  courseCode: string,
  courseStatuses: Record<string, CourseStatus>,
  transcriptRecords: PlannerState["transcriptRecords"] = [],
): string[] {
  return prerequisiteEdges
    .filter((edge) => edge.courseCode === courseCode)
    .map((edge) => edge.prerequisiteCode)
    .filter((prereqCode) => !doesCourseSatisfyPrerequisite(prereqCode, courseStatuses, transcriptRecords));
}

export function isCourseLocked(state: PlannerState, courseCode: string) {
  return getMissingPrerequisites(courseCode, state.courseStatuses, state.transcriptRecords).length > 0;
}

export function summarizeMajorProgress(state: PlannerState) {
  const coreCourses = getCoreCoursesForMajor(state.selectedMajor);
  const total = coreCourses.length;
  if (total === 0) {
    return { completed: 0, total: 0, pct: 0 };
  }
  const completed = coreCourses.filter(
    (course) => state.courseStatuses[course.code] === "completed",
  ).length;
  return { completed, total, pct: Math.round((completed / total) * 100) };
}

export function doesCourseSatisfyPrerequisite(
  courseCode: string,
  courseStatuses: Record<string, CourseStatus>,
  transcriptRecords: PlannerState["transcriptRecords"] = [],
) {
  if (courseStatuses[courseCode] !== "completed") {
    return false;
  }

  const transcriptEvidence = transcriptRecords.filter(
    (record) => record.code === courseCode && record.appliedStatus === "completed",
  );

  if (transcriptEvidence.length === 0) {
    return true;
  }

  return transcriptEvidence.some((record) => record.prerequisiteSatisfied);
}

export function mergeTranscriptRecords(
  current: PlannerState["transcriptRecords"],
  incoming: PlannerState["transcriptRecords"],
) {
  const byId = new Map<string, PlannerState["transcriptRecords"][number]>();

  [...current, ...incoming].forEach((record) => {
    byId.set(record.id, record);
  });

  return [...byId.values()].sort((a, b) => {
    const codeOrder = a.code.localeCompare(b.code);
    if (codeOrder !== 0) return codeOrder;
    return compareAcademicTerms(a.term, b.term);
  });
}
