/**
 * UNTangle's WebMCP tools: what an agent in the student's own browser may
 * read and change. Each tool is a thin wrapper over an engine the pages
 * already use (prerequisites, planner, optimizer, walking times), reached
 * through a small `PlannerPort`, so tests run the tools on a fixture plan
 * without React or a browser.
 *
 * Writes go through the same planner actions as the Courses and Week
 * views, only after the student confirms in the page, and each one offers
 * Undo by the Week view's rule. Never exposed: transcript import,
 * transcript rows or grades, account and sign-in, saving to the server,
 * or anything about other users.
 */
import { buildCourseModel, type CourseModel } from "@/components/courses/model/course-model";
import { manualEdit, type PlanUpdate } from "@/components/courses/model/plan-edits";
import { ruleTokens, tokensToString } from "@/components/courses/model/rules";
import { searchCatalog } from "@/components/courses/model/search";
import { untProfile } from "@/components/courses/school";
import { parseBlockDraft } from "@/components/schedule/constraint-logic";
import { canApply, IDLE, locksKey, optimizerInputKey, undoAvailable } from "@/components/schedule/run-state";
import { findSection } from "@/components/schedule/week-model";
import { getWalkingSeconds } from "@/lib/campus/walking-times";
import { activeDataset } from "@/lib/data-provenance";
import { fromMinutes, toMinutes, transferFit, walkMinutesFromSeconds } from "@/lib/map-itinerary";
import { GOAL_WEIGHTS, goalForWeights } from "@/lib/optimizer/presets";
import type { OptimizeRequest, OptimizeResult, RankedSchedule } from "@/lib/optimizer/types";
import {
  buildOptimizeRequest,
  buildScheduleEvents,
  buildStopsForDay,
  getBuildingById,
  getMajorById,
  getPlanningTermCourseCodes,
  getSectionsForCourse,
  sectionConflicts,
  sectionNumber,
  summarizeCredits,
} from "@/lib/planner";
import { summarizeWeeklyWalking } from "@/lib/planner-walking";
import type { Reason } from "@/lib/prereq";
import {
  weekDays,
  type BlockedTime,
  type CoursePlan,
  type CourseSection,
  type OptimizationKey,
  type PlannerState,
  type SchedulePreferences,
  type WeekDay,
} from "@/lib/types";
import { validate, type ObjectSchema, type StringSchema } from "./schema";

/** The planner as the tools see it: the page's live state and its existing actions. */
export type PlannerPort = {
  /** The plan as the page shows it (normalized). */
  plan(): PlannerState;
  preferences(): SchedulePreferences;
  /** planner-provider's planEpoch: counts plan replacements, which end Undo. */
  epoch(): number;
  optimize(request: OptimizeRequest): Promise<OptimizeResult>;
  applySchedule(byCourse: Record<string, string>, goal: OptimizationKey | null): void;
  restoreSchedule(snapshot: { sections: Record<string, string>; goal: OptimizationKey }): void;
  setSection(courseCode: string, sectionId: string): void;
  updateCoursePlan(update: PlanUpdate): void;
  setSchedulePreferences(update: (current: SchedulePreferences) => SchedulePreferences): void;
};

export type ToolContext = {
  port: PlannerPort;
  /** Asks the student in the page. True only when they approve. */
  confirm(question: string, action: string): Promise<boolean>;
  /** Tells the student a write happened and offers Undo; `undo` returns false once it no longer applies. */
  applied(message: string, undo: () => boolean): void;
};

export type FailureReason =
  | "invalid_input"
  | "rate_limited"
  | "busy"
  | "declined"
  | "unknown_course"
  | "unknown_section"
  | "unknown_alternative"
  | "cannot_apply"
  | "course_locked"
  | "not_in_plan"
  | "nothing_to_schedule"
  | "failed";
export type Failure = { ok: false; reason: FailureReason; detail?: string };
export type ToolResult = Failure | ({ ok: true } & Record<string, unknown>);

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: ObjectSchema;
  writes: boolean;
  /** Validates `input` against `inputSchema`, then runs. */
  run(input: unknown, ctx: ToolContext): Promise<ToolResult>;
};

export const fail = (reason: FailureReason, detail?: string): Failure => (detail ? { ok: false, reason, detail } : { ok: false, reason });

function defineTool<Input>(spec: Omit<Tool, "run"> & { run(input: Input, ctx: ToolContext): ToolResult | Promise<ToolResult> }): Tool {
  return {
    ...spec,
    run: async (input, ctx) => {
      const problem = validate(spec.inputSchema, input);
      // The check above is what makes `input` an Input.
      return problem ? fail("invalid_input", problem) : spec.run(input as Input, ctx);
    },
  };
}

/* ---------- shared readers ---------- */

const PROVENANCE = activeDataset.kind === "synthetic-sample" ? "sample" : "real";
const EMPTY_PLAN: CoursePlan = { manualCredit: [], autoPlanned: [], lastAuto: null };
/** get_course lists this many sections; build_schedule always considers all of them. */
const SECTIONS_SHOWN = 10;

const codeField: StringSchema = { type: "string", minLength: 1, maxLength: 20, description: 'A UNT course code, such as "CSCE 1030".' };
const timeField = (description: string): StringSchema => ({ type: "string", maxLength: 5, pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description });
const dayField: StringSchema = { type: "string", maxLength: 3, enum: weekDays, description: "Mon, Tue, Wed, Thu or Fri." };

function courseId(code: string): string | null {
  const id = untProfile().normalizeId(code);
  return id && untProfile().entries.has(id) ? id : null;
}

function courseModel(plan: PlannerState): CourseModel {
  const coursePlan = plan.coursePlan ?? EMPTY_PLAN;
  return buildCourseModel(untProfile(), {
    statuses: plan.courseStatuses,
    transcript: plan.transcriptRecords,
    planned: new Set(getPlanningTermCourseCodes(plan)),
    manualCredit: new Set(coursePlan.manualCredit),
    autoPlanned: new Set(coursePlan.autoPlanned),
  });
}

/** "Mon/Wed/Fri 09:00-09:50 at GAB; Tue 14:00-15:20 at ENV". */
function meetingsText(section: CourseSection): string {
  const groups = new Map<string, WeekDay[]>();
  for (const meeting of section.meetings) {
    const place = getBuildingById(meeting.buildingId)?.shortName ?? meeting.location;
    const key = `${meeting.start}-${meeting.end} at ${place}`;
    groups.set(key, [...(groups.get(key) ?? []), meeting.day]);
  }
  return [...groups].map(([key, days]) => `${days.join("/")} ${key}`).join("; ");
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

type Outcome = "met" | "unmet" | "unknown";
const OUTCOME: Record<Reason["outcome"], Outcome> = { satisfied: "met", unmet: "unmet", unknown: "unknown" };
const SEVERITY: Record<Outcome, number> = { met: 0, unknown: 1, unmet: 2 };

/**
 * Every course or condition the engine checked, with its outcome. Built
 * from the reason tree's structure only (course ids and catalog text,
 * never `message`), because messages quote the student's recorded grades.
 */
function checkedRequirements(reason: Reason, found = new Map<string, Outcome>()): Map<string, Outcome> {
  if (reason.kind === "cycle" || (!reason.courseId && reason.children?.length)) {
    reason.children?.forEach((child) => checkedRequirements(child, found));
    return found;
  }
  const key = reason.courseId ?? reason.source?.trim();
  if (!key) return found;
  const outcome = OUTCOME[reason.outcome];
  const previous = found.get(key);
  // One course checked twice (two grade minimums) counts by its worse result.
  if (!previous || SEVERITY[outcome] > SEVERITY[previous]) found.set(key, outcome);
  return found;
}

const VERDICT = { done: "done", taking: "taking", eligible: "eligible", locked: "not_eligible", unknown: "check_with_advisor" } as const;

/* ---------- write helpers ---------- */

/**
 * Undo for a tool's write, by the Week view's rule (run-state.ts
 * undoAvailable): offered while the plan has not been replaced and no lock
 * has changed. Restores the picks and goal, and the course statuses when
 * the write changed them.
 */
function undoFor(port: PlannerPort, label: string, restoresStatuses: boolean): () => boolean {
  const plan = port.plan();
  const snapshot = {
    sections: { ...plan.selectedSections },
    goal: plan.optimization,
    letter: label,
    epoch: port.epoch(),
    locks: locksKey(plan.lockedSections ?? {}),
  };
  const parts = { courseStatuses: plan.courseStatuses, coursePlan: plan.coursePlan ?? EMPTY_PLAN };
  return () => {
    if (!undoAvailable(snapshot, port.epoch(), locksKey(port.plan().lockedSections ?? {}))) return false;
    if (restoresStatuses) port.updateCoursePlan(() => parts);
    port.restoreSchedule(snapshot);
    return true;
  };
}

const withoutCode = (list: readonly string[], code: string) => list.filter((id) => id !== code);

/* ---------- build_schedule state ---------- */

type BuildInput = {
  goal?: OptimizationKey;
  earliestStart?: string;
  latestEnd?: string;
  daysOff?: WeekDay[];
  maxCredits?: number;
};

/** The student's saved preferences with this run's overrides on top. Nothing is saved. */
function withOverrides(saved: SchedulePreferences, input: BuildInput): SchedulePreferences {
  const c = saved.constraints;
  return {
    weights: input.goal ? { ...GOAL_WEIGHTS[input.goal] } : saved.weights,
    constraints: {
      ...c,
      earliestStart: input.earliestStart === undefined ? c.earliestStart : toMinutes(input.earliestStart),
      latestEnd: input.latestEnd === undefined ? c.latestEnd : toMinutes(input.latestEnd),
      daysOff: input.daysOff === undefined ? c.daysOff : [...new Set(input.daysOff)],
      maxCredits: input.maxCredits ?? c.maxCredits,
    },
  };
}

function runKey(plan: PlannerState, preferences: SchedulePreferences): string {
  return optimizerInputKey(preferences, plan.lockedSections ?? {}, getPlanningTermCourseCodes(plan));
}

type Build = { number: number; input: BuildInput; key: string; goal: OptimizationKey | null; result: OptimizeResult };

/* ---------- the tools ---------- */

/** A fresh tool set. build_schedule's alternatives live in it until the next build. */
export function createTools(): Tool[] {
  let builds = 0;
  let latest: Build | null = null;

  const alternative = (id: string): { build: Build; schedule: RankedSchedule; letter: string } | null => {
    const match = /^opt-(\d+)-([ABC])$/.exec(id);
    if (!latest || !match || Number(match[1]) !== latest.number) return null;
    const schedule = latest.result.schedules["ABC".indexOf(match[2])];
    return schedule ? { build: latest, schedule, letter: match[2] } : null;
  };

  return [
    defineTool<{ query: string; limit?: number }>({
      name: "search_courses",
      title: "Search courses",
      description:
        'Search UNT\'s course catalog by code ("CSCE 1030", "1030") or title words. Returns matching courses with credit hours and the student\'s status: done, taking, planned, covered, available, locked or check (ask an advisor).',
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 80, description: "Course code or title words." },
          limit: { type: "integer", minimum: 1, maximum: 10, description: "Most results to return. Default 8." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      writes: false,
      run({ query, limit = 8 }, { port }) {
        const plan = port.plan();
        const model = courseModel(plan);
        const core = new Set(getMajorById(plan.selectedMajor)?.coreCourseCodes ?? []);
        const rows = [...model.rows.values()];
        const { courses } = searchCatalog(query, rows, [], core, { courses: limit, instructors: 0 });
        return {
          ok: true,
          courses: courses.map(({ id }) => {
            const row = model.rows.get(id)!;
            return { code: id, title: row.title, credits: row.credits, status: row.status };
          }),
        };
      },
    }),

    defineTool<{ code: string }>({
      name: "get_course",
      title: "Get course",
      description: `One course: catalog title, credits, description, the student's status, the prerequisite rule, and up to ${SECTIONS_SHOWN} sections with meeting times (24-hour). sections.provenance is "sample" while sections are synthetic, not UNT's class schedule.`,
      inputSchema: { type: "object", properties: { code: codeField }, required: ["code"], additionalProperties: false },
      writes: false,
      run({ code }, { port }) {
        const id = courseId(code);
        if (!id) return fail("unknown_course");
        const row = courseModel(port.plan()).rows.get(id)!;
        const sections = getSectionsForCourse(id);
        return {
          ok: true,
          code: id,
          title: row.title,
          credits: row.credits,
          description: clip(row.description, 300),
          status: row.status,
          inPlan: row.inPlan,
          prerequisites: row.rule ? clip(tokensToString(ruleTokens(row.rule)), 300) : null,
          sections: {
            provenance: PROVENANCE,
            total: sections.length,
            items: sections.slice(0, SECTIONS_SHOWN).map((section) => ({
              id: section.id,
              meetings: meetingsText(section),
              instructor: section.professor,
            })),
          },
        };
      },
    }),

    defineTool<{ code: string }>({
      name: "check_eligibility",
      title: "Check eligibility",
      description:
        "Whether the student can take a course now, from UNTangle's prerequisite engine: a verdict (eligible, not_eligible, check_with_advisor, done, taking) and which required courses or conditions are met, unmet or unknown. Grades are never returned.",
      inputSchema: { type: "object", properties: { code: codeField }, required: ["code"], additionalProperties: false },
      writes: false,
      run({ code }, { port }) {
        const id = courseId(code);
        if (!id) return fail("unknown_course");
        const row = courseModel(port.plan()).rows.get(id)!;
        const verdict = VERDICT[row.assessment?.status ?? "unknown"];
        const checked = verdict === "done" || verdict === "taking" || !row.assessment ? new Map<string, Outcome>() : checkedRequirements(row.assessment.reason);
        const having = (outcome: Outcome) => [...checked].filter(([, value]) => value === outcome).map(([key]) => clip(key, 120));
        return {
          ok: true,
          code: id,
          verdict,
          requirement: row.rule ? clip(tokensToString(ruleTokens(row.rule)), 300) : null,
          met: having("met"),
          unmet: having("unmet"),
          unknown: having("unknown"),
          coveredBy: row.coveredBy,
        };
      },
    }),

    defineTool<Record<string, never>>({
      name: "get_schedule",
      title: "Get schedule",
      description:
        "The student's planned week for the planning term: each course's section and meeting times (24-hour), total credits, pairs of courses that overlap, courses with no section data, and walking minutes per week between back-to-back classes.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      writes: false,
      run(_input, { port }) {
        const plan = port.plan();
        const locks = plan.lockedSections ?? {};
        const planned = getPlanningTermCourseCodes(plan).map((code) => ({ code, section: findSection(plan.selectedSections[code]) }));
        const scheduled = planned.filter((entry): entry is { code: string; section: CourseSection } => Boolean(entry.section));
        const overlaps = scheduled.flatMap((a, i) =>
          scheduled.slice(i + 1).filter((b) => sectionConflicts(a.section, [b.section])).map((b) => [a.code, b.code]),
        );
        const walking = summarizeWeeklyWalking(buildScheduleEvents(plan), getWalkingSeconds);
        return {
          ok: true,
          provenance: PROVENANCE,
          credits: summarizeCredits(plan),
          courses: scheduled.map(({ code, section }) => ({
            code,
            sectionId: section.id,
            meetings: meetingsText(section),
            instructor: section.professor,
            locked: locks[code] === section.id,
          })),
          overlaps,
          withoutSections: planned.filter((entry) => !entry.section).map((entry) => entry.code),
          walking: {
            minutesPerWeek: Math.round(walking.knownSeconds / 60),
            unknownWalks: walking.unknownLegs,
            estimated: walking.estimated,
          },
        };
      },
    }),

    defineTool<{ day: WeekDay }>({
      name: "get_day",
      title: "Get day",
      description:
        "One weekday's classes in time order and the walk between each pair: break minutes, walking minutes over campus walkways (null when unknown), leaveBy (24-hour time to leave the earlier class) and fit: ok, tight (2 minutes or less to spare), late or unknown.",
      inputSchema: { type: "object", properties: { day: dayField }, required: ["day"], additionalProperties: false },
      writes: false,
      run({ day }, { port }) {
        const stops = buildStopsForDay(port.plan(), day);
        return {
          ok: true,
          day,
          classes: stops.map((stop) => ({ code: stop.courseCode, start: stop.start, end: stop.end, building: stop.shortName })),
          walks: stops.slice(1).map((to, index) => {
            const from = stops[index];
            const gapMinutes = toMinutes(to.start) - toMinutes(from.end);
            const walk = getWalkingSeconds(from.buildingId ?? "", to.buildingId ?? "");
            // Like the map: a straight-line estimate gives no minutes, because nobody walks a straight line.
            const walkMinutes = walk.source === "campus-network" ? walkMinutesFromSeconds(walk.seconds) : null;
            return {
              from: from.courseCode,
              to: to.courseCode,
              gapMinutes,
              walkMinutes,
              leaveBy: walkMinutes ? fromMinutes(toMinutes(to.start) - walkMinutes) : null,
              fit: transferFit(walkMinutes, gapMinutes),
            };
          }),
        };
      },
    }),

    defineTool<BuildInput>({
      name: "build_schedule",
      title: "Build schedule",
      description:
        "Runs UNTangle's schedule optimizer over the planned courses and returns up to 3 ranked alternatives with ids. Uses the student's saved constraints and busy times; the optional fields override them for this run only. Changes nothing: pass an id to apply_alternative to use one. Takes up to about 3 seconds.",
      inputSchema: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            maxLength: 20,
            enum: ["clusterMorning", "clusterNight", "compact", "minimizeDistance", "maximizeProfessor"],
            description: "Mornings, evenings, compact days, less walking, or better-rated instructors.",
          },
          earliestStart: timeField("No class before this time, HH:MM."),
          latestEnd: timeField("No class after this time, HH:MM."),
          daysOff: { type: "array", maxItems: 5, items: dayField, description: "Weekdays with no class." },
          maxCredits: { type: "integer", minimum: 1, maximum: 24, description: "Most credit hours." },
        },
        additionalProperties: false,
      },
      writes: false,
      async run(input, { port }) {
        const plan = port.plan();
        const preferences = withOverrides(port.preferences(), input);
        const request = buildOptimizeRequest(plan, preferences);
        if (request.courses.length === 0) return fail("nothing_to_schedule", "No planned course has section data.");
        const result = await port.optimize(request);
        builds += 1;
        latest = { number: builds, input, key: runKey(plan, preferences), goal: goalForWeights(preferences.weights), result };
        const current = plan.selectedSections;
        return {
          ok: true,
          status: result.status,
          provenance: PROVENANCE,
          alternatives: result.schedules.map((schedule, index) => {
            const b = schedule.breakdown;
            return {
              id: `opt-${builds}-${"ABC"[index]}`,
              changes: Object.entries(schedule.byCourse).filter(([code, id]) => current[code] !== id).length,
              sections: Object.fromEntries(Object.entries(schedule.byCourse).map(([code, id]) => [code, sectionNumber(id)])),
              daysOnCampus: b.daysOnCampus,
              gapMinutes: b.gapMinutes,
              walkMinutes: Math.round(b.walkSeconds / 60),
              earliest: b.earliestStart === null ? null : fromMinutes(b.earliestStart),
              latest: b.latestEnd === null ? null : fromMinutes(b.latestEnd),
              credits: b.credits,
              proven: schedule.proven,
            };
          }),
          ...(result.status === "infeasible"
            ? { why: result.explanation.sentence, fixes: result.explanation.suggestions.slice(0, 3).map((s) => s.label) }
            : {}),
        };
      },
    }),

    defineTool<Record<string, never>>({
      name: "export_class_numbers",
      title: "Export class numbers",
      description:
        'Registration class numbers for the planned sections. While provenance is "sample", sections are synthetic and classNumber is null; the student finds real class numbers in UNT\'s class search.',
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      writes: false,
      run(_input, { port }) {
        const plan = port.plan();
        return {
          ok: true,
          provenance: PROVENANCE,
          courses: getPlanningTermCourseCodes(plan).flatMap((code) => {
            const section = findSection(plan.selectedSections[code]);
            // The bundled sections carry no class numbers (lib/data-provenance.ts).
            return section ? [{ code, section: sectionNumber(section.id), classNumber: null }] : [];
          }),
        };
      },
    }),

    defineTool<{ id: string }>({
      name: "apply_alternative",
      title: "Apply schedule alternative",
      description:
        "Replaces the planned sections with an alternative from the latest build_schedule. The student must confirm in the page and can Undo afterwards. Refused when their courses, locks or constraints changed since that run.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", maxLength: 16, pattern: "^opt-\\d{1,6}-[ABC]$", description: 'An id from build_schedule, such as "opt-1-A".' } },
        required: ["id"],
        additionalProperties: false,
      },
      writes: true,
      async run({ id }, ctx) {
        const found = alternative(id);
        if (!found) return fail("unknown_alternative", "Use an id from the latest build_schedule.");
        const { build, schedule, letter } = found;
        const check = () => {
          const plan = ctx.port.plan();
          const key = runKey(plan, withOverrides(ctx.port.preferences(), build.input));
          const verdict = canApply({ ...IDLE, result: build.result, resultKey: build.key }, key, schedule, plan.lockedSections ?? {});
          return verdict.ok ? null : fail("cannot_apply", verdict.reason);
        };
        const refused = check();
        if (refused) return refused;
        const current = ctx.port.plan().selectedSections;
        const changes = Object.entries(schedule.byCourse).filter(([code, sectionId]) => current[code] !== sectionId);
        if (changes.length === 0) return { ok: true, changed: 0 };
        const list = changes.map(([code, sectionId]) => `${code} to section ${sectionNumber(sectionId)}`).join(", ");
        if (!(await ctx.confirm(`Use schedule option ${letter}? It moves ${list}.`, `Use option ${letter}`))) return fail("declined");
        const stale = check();
        if (stale) return stale;
        const undo = undoFor(ctx.port, letter, false);
        ctx.port.applySchedule(schedule.byCourse, build.goal);
        ctx.applied(`Using option ${letter} from your assistant`, undo);
        return { ok: true, changed: changes.length };
      },
    }),

    defineTool<{ code: string; sectionId: string }>({
      name: "add_section",
      title: "Add section",
      description:
        "Puts one section of a course in the plan, adding the course to the planning term if needed. Reports overlaps with other planned classes. The student must confirm in the page and can Undo afterwards. Refused for a course whose section the student locked.",
      inputSchema: {
        type: "object",
        properties: {
          code: codeField,
          sectionId: { type: "string", minLength: 1, maxLength: 40, description: 'A section id from get_course, such as "csce-1030-002", or its number, "002".' },
        },
        required: ["code", "sectionId"],
        additionalProperties: false,
      },
      writes: true,
      async run({ code, sectionId }, ctx) {
        const id = courseId(code);
        if (!id) return fail("unknown_course");
        const section = getSectionsForCourse(id).find((s) => s.id === sectionId || sectionNumber(s.id) === sectionId);
        if (!section) return fail("unknown_section", `Sections of ${id} are listed by get_course.`);
        const check = () => {
          const plan = ctx.port.plan();
          const lock = plan.lockedSections?.[id];
          return lock && lock !== section.id ? fail("course_locked", `The student locked ${id}; they can unlock it in Week.`) : null;
        };
        const refused = check();
        if (refused) return refused;
        const plan = ctx.port.plan();
        const inPlan = getPlanningTermCourseCodes(plan).includes(id);
        if (inPlan && plan.selectedSections[id] === section.id) return { ok: true, changed: false, overlapsWith: [] };
        const overlapsWith = getPlanningTermCourseCodes(plan).filter((other) => {
          const picked = other === id ? undefined : findSection(plan.selectedSections[other]);
          return picked !== undefined && sectionConflicts(section, [picked]);
        });
        const clash = overlapsWith.length > 0 ? ` It overlaps ${overlapsWith.join(" and ")}.` : "";
        const question = `Add ${id} section ${sectionNumber(section.id)} (${meetingsText(section)}) to your plan?${clash}`;
        if (!(await ctx.confirm(question, "Add section"))) return fail("declined");
        const stale = check();
        if (stale) return stale;
        const undo = undoFor(ctx.port, id, true);
        // The Courses view's "choose section" edit: plan the course by hand, then pick the section.
        ctx.port.updateCoursePlan(
          manualEdit(inPlan ? {} : { [id]: "inProgress" }, (current) => ({ autoPlanned: withoutCode(current.autoPlanned, id) }), [id]),
        );
        ctx.port.setSection(id, section.id);
        ctx.applied(`Your assistant added ${id} section ${sectionNumber(section.id)}`, undo);
        return { ok: true, changed: true, overlapsWith };
      },
    }),

    defineTool<{ code: string }>({
      name: "remove_course",
      title: "Remove course",
      description:
        "Removes a course from the planning-term plan. The student must confirm in the page and can Undo afterwards. Refused for a course whose section the student locked.",
      inputSchema: { type: "object", properties: { code: codeField }, required: ["code"], additionalProperties: false },
      writes: true,
      async run({ code }, ctx) {
        const id = courseId(code);
        if (!id) return fail("unknown_course");
        const check = () => {
          const plan = ctx.port.plan();
          if (!getPlanningTermCourseCodes(plan).includes(id)) return fail("not_in_plan");
          return plan.lockedSections?.[id] ? fail("course_locked", `The student locked ${id}; they can unlock it in Week.`) : null;
        };
        const refused = check();
        if (refused) return refused;
        if (!(await ctx.confirm(`Remove ${id} from your ${untProfile().planningTerm} plan?`, "Remove"))) return fail("declined");
        const stale = check();
        if (stale) return stale;
        const undo = undoFor(ctx.port, id, true);
        // The Courses view's "remove from plan" edit.
        ctx.port.updateCoursePlan(manualEdit({ [id]: "notTaken" }, (current) => ({ autoPlanned: withoutCode(current.autoPlanned, id) })));
        ctx.applied(`Your assistant removed ${id} from the plan`, undo);
        return { ok: true, removed: id };
      },
    }),

    defineTool<{ blocks: Array<{ day: WeekDay; start: string; end: string; label?: string }> }>({
      name: "set_busy_times",
      title: "Set busy times",
      description:
        "Replaces the student's weekly busy times (a job, practice) that build_schedule keeps free of classes. Times are 24-hour HH:MM. An empty list clears them. The student must confirm in the page and can Undo afterwards.",
      inputSchema: {
        type: "object",
        properties: {
          blocks: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                day: dayField,
                start: timeField("Start, HH:MM."),
                end: timeField("End, HH:MM, after start."),
                label: { type: "string", maxLength: 40, description: 'What it is, such as "Work". Default "Busy".' },
              },
              required: ["day", "start", "end"],
              additionalProperties: false,
            },
          },
        },
        required: ["blocks"],
        additionalProperties: false,
      },
      writes: true,
      async run({ blocks }, ctx) {
        const blocked: BlockedTime[] = [];
        for (const [index, block] of blocks.entries()) {
          const parsed = parseBlockDraft({ ...block, label: block.label?.trim() || "Busy" }, `busy-${index + 1}`);
          if (!parsed.ok) return fail("invalid_input", `blocks[${index}]: ${parsed.reason}`);
          blocked.push(parsed.block);
        }
        const before = ctx.port.preferences().constraints.blocked;
        const list = blocks.map((b) => `${b.day} ${b.start}-${b.end}`).join(", ");
        const question = blocked.length === 0 ? "Clear all your busy times?" : `Replace your busy times with ${list}?`;
        if (!(await ctx.confirm(question, "Save busy times"))) return fail("declined");
        ctx.port.setSchedulePreferences((p) => ({ ...p, constraints: { ...p.constraints, blocked } }));
        ctx.applied("Your assistant updated your busy times", () => {
          // Only while the list is still the one this call saved.
          if (JSON.stringify(ctx.port.preferences().constraints.blocked) !== JSON.stringify(blocked)) return false;
          ctx.port.setSchedulePreferences((p) => ({ ...p, constraints: { ...p.constraints, blocked: before } }));
          return true;
        });
        return { ok: true, busyTimes: blocked.length };
      },
    }),
  ];
}
