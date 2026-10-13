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
import { ruleFromPrerequisite, ruleTokens, tokensToString } from "@/components/courses/model/rules";
import { searchCatalog } from "@/components/courses/model/search";
import { untProfile } from "@/components/courses/school";
import { parseBlockDraft } from "@/components/schedule/constraint-logic";
import { canApply, IDLE, requestKey } from "@/components/schedule/run-state";
import { firstClash } from "@/components/schedule/week-model";
import { fromMinutes, toMinutes, transferFit, walkMinutesFromSeconds } from "@/lib/map-itinerary";
import { GOAL_WEIGHTS, goalForWeights } from "@/lib/optimizer/presets";
import type { OptimizeRequest, OptimizeResult, RankedSchedule } from "@/lib/optimizer/types";
import {
  buildOptimizeRequest,
  buildScheduleEvents,
  buildStopsForDay,
  getMajorById,
  getPlanningTermCourseCodes,
  myUntClassNumbers,
  resolveSectionPlan,
  summarizeCredits,
  takeFromAutoRun,
  type SectionPlan,
} from "@/lib/planner";
import {
  findOption,
  hasOpenSeats,
  isTimed,
  meetTogether,
  optionIdLabel,
  optionLabel,
  optionsConflict,
  otherSiteOf,
  type SectionCatalog,
} from "@/lib/planner-sections";
import type { PlanStamp, PlanTransaction, TransactionOutcome } from "@/lib/planner-transaction";
import { isShuttleLeg, plannerTravelTime, SHUTTLE_SECONDS, summarizeWeeklyWalking } from "@/lib/planner-walking";
import type { Prerequisite, Reason } from "@/lib/prereq";
import type { Section } from "@/lib/sections";
import { classDays, type BlockedTime, type ClassDay, type CoursePlan, type OptimizationKey, type PlannerState, type SchedulePreferences, type WeekDay } from "@/lib/types";
import { validate, type ObjectSchema, type StringSchema } from "./schema";

/** The planner as the tools see it: the page's last render for reads, a transaction for plan writes. */
export type PlannerPort = {
  /**
   * The plan as the page last rendered it: normalized, with the sections the
   * page shows (saved picks plus the goal's recommendations). Reads and
   * questions only; writes check inside `transact`.
   */
  plan(): PlannerState;
  /** Each planned course's option as the page resolved it (planner-provider's sectionPlan). */
  sectionPlan(): SectionPlan;
  /** Loaded course options; a course not loaded yet is "loading". */
  catalog(): SectionCatalog;
  /** Starts loading these courses' options and resolves once the page shows them, or when `signal` aborts. */
  load(courseCodes: readonly string[], signal: AbortSignal): Promise<void>;
  preferences(): SchedulePreferences;
  /** The identity and plan replacement count the page last rendered; a write or Undo made under another is refused. */
  stamp(): PlanStamp;
  /** Rejects when `signal` aborts, and stops the search. */
  optimize(request: OptimizeRequest, signal: AbortSignal): Promise<OptimizeResult>;
  /** planner-provider's transact: `fn` sees the plan as it actually is and decides there. */
  transact<R>(fn: (plan: PlannerState, meta: { runEdits: number }) => PlanTransaction<R>, stamp: PlanStamp): Promise<TransactionOutcome<R>>;
  setSchedulePreferences(update: (current: SchedulePreferences) => SchedulePreferences): void;
};


export type ToolContext = {
  port: PlannerPort;
  /** Aborts when the agent cancels the call or the tools are unregistered. */
  signal: AbortSignal;
  /** Asks the student in the page. True only when they approve. */
  confirm(question: string, action: string): Promise<boolean>;
  /** Tells the student a write happened and offers Undo; `undo` resolves false once it no longer applies. */
  applied(message: string, undo: () => Promise<boolean>): void;
};

export type FailureReason =
  | "invalid_input"
  | "rate_limited"
  | "busy"
  | "declined"
  | "cancelled"
  | "plan_changed"
  | "identity_changed"
  | "not_plannable"
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

const EMPTY_PLAN: CoursePlan = { manualCredit: [], autoPlanned: [], lastAuto: null };
/** get_course lists this many sections; build_schedule always considers all of them. */
const SECTIONS_SHOWN = 8;

const codeField: StringSchema = { type: "string", minLength: 1, maxLength: 20, description: 'A UNT course code, such as "CSCE 1030".' };
const timeField = (description: string): StringSchema => ({ type: "string", maxLength: 5, pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description });
const dayField: StringSchema = { type: "string", maxLength: 3, enum: classDays, description: "Mon, Tue, Wed, Thu, Fri, Sat or Sun." };
const weekdayField: StringSchema = { type: "string", maxLength: 3, enum: ["Mon", "Tue", "Wed", "Thu", "Fri"], description: "Mon, Tue, Wed, Thu or Fri." };

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

/** "Mon/Wed/Fri 09:00-09:50 at GAB 105; online, no set time". */
function meetingsText(section: Section): string {
  const groups = new Map<string, string[]>();
  for (const meeting of section.meetings) {
    const key = isTimed(meeting)
      ? `${fromMinutes(meeting.startMinutes)}-${fromMinutes(meeting.endMinutes)} at ${meeting.room}`
      : meeting.async || meeting.kind === "online"
        ? "online, no set time"
        : "time to be announced";
    groups.set(key, [...(groups.get(key) ?? []), ...(isTimed(meeting) ? [meeting.day] : [])]);
  }
  return [...groups].map(([key, days]) => (days.length > 0 ? `${[...new Set(days)].join("/")} ${key}` : key)).join("; ");
}

/** The plan with the sections the page shows (planner-provider's plannerState), from saved picks and loaded options. */
function withShownSections(plan: PlannerState, catalog: SectionCatalog, preferences: SchedulePreferences): PlannerState {
  return { ...plan, selectedSections: resolveSectionPlan(plan, catalog, preferences.constraints).selections };
}

/** "the section has no open seats", "it meets at Frisco": what the Week and Courses lists tell a student about an option. */
function optionNotes(section: Section): string[] {
  const site = otherSiteOf(section);
  return [
    ...(section.term !== null && !hasOpenSeats(section) ? ["It has no open seats."] : []),
    ...(site ? [`It meets at ${site}.`] : []),
  ];
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

type Outcome = "met" | "unmet" | "unknown";
const OUTCOME: Record<Reason["outcome"], Outcome> = { satisfied: "met", unmet: "unmet", unknown: "unknown" };
const SEVERITY: Record<Outcome, number> = { met: 0, unknown: 1, unmet: 2 };

/** A requirement as the student reads it: a course id, or the rule's readable text. */
function requirementLabel(node: Prerequisite): string {
  if (node.kind === "course") return node.courseId;
  const rule = ruleFromPrerequisite(node);
  return clip(rule ? tokensToString(ruleTokens(rule)) : node.source.trim(), 120);
}

/**
 * Each requirement of a course's catalog rule with the engine's outcome for
 * it. Walks the rule and the engine's reason tree together, following the
 * engine's own shapes (engine.ts evaluate), so a requirement met through
 * another passed course's prerequisites is reported as that requirement,
 * not as the other course. Reads outcomes only, never `message`, because
 * messages quote the student's recorded grades.
 */
function projectRequirements(node: Prerequisite, reason: Reason, found: Map<string, Outcome>, minimum?: string): void {
  const record = (key: string, outcome: Outcome) => {
    const previous = found.get(key);
    // One course checked twice (two grade minimums) counts by its worse result.
    if (!previous || SEVERITY[outcome] > SEVERITY[previous]) found.set(key, outcome);
  };
  // Closure proves a requirement whole: every part of an AND, or an OR as one requirement.
  const metThroughClosure = (part: Prerequisite): void =>
    part.kind === "and" ? part.children.forEach(metThroughClosure) : record(requirementLabel(part), "met");
  if (reason.kind === "closure") return metThroughClosure(node);
  const child = (index: number) => reason.children?.[index];
  switch (node.kind) {
    case "and":
    case "or":
      node.children.forEach((part, index) => {
        const evaluated = child(index);
        if (evaluated) projectRequirements(part, evaluated, found, minimum);
      });
      return;
    case "minGrade":
      if (minimum === undefined) return projectRequirements(node.requirement, reason, found, node.grade);
      // Two minimums on one requirement: the engine checks each in turn.
      [node.grade, minimum].forEach((grade, index) => {
        const evaluated = child(index);
        if (evaluated) projectRequirements(node.requirement, evaluated, found, grade);
      });
      return;
    case "corequisite": {
      const evaluated = child(0);
      if (evaluated) projectRequirements(node.requirement, evaluated, found, minimum);
      return;
    }
    default:
      record(requirementLabel(node), OUTCOME[reason.outcome]);
  }
}

/** The engine wraps a course's reason when it needs an advisor or sits in a cycle; the rule lies under the wrappers. */
function unwrap(reason: Reason): Reason {
  return (reason.kind === "advisor" || reason.kind === "cycle") && reason.children?.length === 1 ? unwrap(reason.children[0]) : reason;
}

const VERDICT = { done: "done", taking: "taking", eligible: "eligible", locked: "not_eligible", unknown: "check_with_advisor" } as const;

/* ---------- write helpers ---------- */

/** `current` with each of `codes` set back to its saved pick in `before`, or to no pick when it had none. */
function restoreSections(current: Record<string, string>, before: Record<string, string>, codes: readonly string[]): Record<string, string> {
  const sections = { ...current };
  for (const code of codes) {
    if (code in before) sections[code] = before[code];
    else delete sections[code];
  }
  return sections;
}
const withoutCode = (list: readonly string[], code: string) => list.filter((id) => id !== code);

/** A Courses-view edit (model/plan-edits) applied to a plan, as planner-provider's updateCoursePlan does. */
function withPlanEdit(plan: PlannerState, update: PlanUpdate): PlannerState {
  const next = update({ courseStatuses: plan.courseStatuses, coursePlan: plan.coursePlan ?? EMPTY_PLAN });
  return { ...plan, courseStatuses: next.courseStatuses ?? plan.courseStatuses, coursePlan: next.coursePlan ?? plan.coursePlan };
}

/** What a write changed, for its Undo: the plan before it, the courses it changed, and how to tell its values are still there. */
type UndoSpec = {
  before: PlannerState;
  codes: readonly string[];
  stillOurs: (plan: PlannerState) => boolean;
  goalSet?: OptimizationKey | null;
};

/**
 * Undo for a committed write, as a transaction under the write's stamp, so
 * it is refused once another identity signed in or the plan was replaced.
 * It restores only what the write owned: those courses' statuses, sections
 * and Auto-fill membership, and the goal when the write set it. It is
 * refused once one of those courses was locked or `stillOurs` finds a value
 * the write set changed. A pending Auto-fill run gets its Undo back only
 * when this write is what took it away and no update touched the run's
 * courses since (the run's edit count is still the one after the write).
 */
function undoFor(port: PlannerPort, stamp: PlanStamp, runEditsAfter: number, { before, codes, stillOurs, goalSet = null }: UndoSpec): () => Promise<boolean> {
  return async () => {
    const outcome = await port.transact((plan, meta) => {
      if (codes.some((code) => plan.lockedSections?.[code]) || !stillOurs(plan)) return { result: false };
      if (goalSet !== null && plan.optimization !== goalSet) return { result: false };
      const coursePlan = plan.coursePlan ?? EMPTY_PLAN;
      const run = coursePlan.lastAuto;
      const prior = before.coursePlan?.lastAuto;
      const giveBack =
        run && prior && run.id === prior.id && !prior.invalidatedBy && codes.includes(run.invalidatedBy ?? "") && meta.runEdits === runEditsAfter;
      const next: PlannerState = {
        ...plan,
        courseStatuses: { ...plan.courseStatuses, ...Object.fromEntries(codes.map((code) => [code, before.courseStatuses[code] ?? "notTaken"])) },
        selectedSections: restoreSections(plan.selectedSections, before.selectedSections, codes),
        optimization: goalSet === null ? plan.optimization : before.optimization,
        coursePlan: {
          ...coursePlan,
          autoPlanned: [
            ...coursePlan.autoPlanned.filter((id) => !codes.includes(id)),
            ...(before.coursePlan?.autoPlanned ?? []).filter((id) => codes.includes(id)),
          ],
          lastAuto: giveBack ? prior : run,
        },
      };
      return { next, result: true };
    }, stamp);
    return outcome.status === "committed" && outcome.result === true;
  };
}

/**
 * Commits a write decided inside `transact` under the stamp of the plan the
 * student saw, then tells the student, unless the call was cancelled
 * meanwhile: a toast from an ended registration would offer an Undo that
 * can no longer work.
 */
async function commitWrite(
  ctx: ToolContext,
  stamp: PlanStamp,
  message: string,
  fn: (plan: PlannerState) => PlanTransaction<Failure | UndoSpec>,
  reply: ToolResult,
): Promise<ToolResult> {
  if (ctx.signal.aborted) return fail("cancelled");
  const outcome = await ctx.port.transact(fn, stamp);
  switch (outcome.status) {
    case "identity_changed":
      return fail("identity_changed", "The student signed in or out; ask again.");
    case "plan_replaced":
      return fail("plan_changed", "The plan was reloaded, reset or replaced by another tab's version; ask again.");
    case "cancelled":
      return fail("cancelled");
  }
  if ("ok" in outcome.result) return outcome.result;
  if (!ctx.signal.aborted) ctx.applied(message, undoFor(ctx.port, stamp, outcome.runEdits, outcome.result));
  return reply;
}

/** No from the student, or no answer because the call was cancelled. */
const refused = (ctx: ToolContext) => fail(ctx.signal.aborted ? "cancelled" : "declined");
const PLAN_CHANGED = "The plan changed while the student was deciding; ask again.";

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

/** The Week view's run key: the request Optimize sends for this plan (run-state.ts requestKey). */
function runKey(plan: PlannerState, preferences: SchedulePreferences, catalog: SectionCatalog): string {
  return requestKey(buildOptimizeRequest(plan, preferences, { catalog }));
}

/** How the page names an option id: its section code when loaded, else its class numbers or sample number. */
function labelOf(catalog: SectionCatalog, courseCode: string, optionId: string): string {
  const option = findOption(catalog, courseCode, optionId);
  return option ? optionLabel(option) : optionIdLabel(optionId);
}

type Build = { number: number; input: BuildInput; key: string; goal: OptimizationKey | null; result: OptimizeResult };

/* ---------- the tools ---------- */

/** A fresh tool set. build_schedule's alternatives live in it until the next build. */
export function createTools(): Tool[] {
  let builds = 0;
  let latest: Build | null = null;
  // One search at a time: a newer build_schedule cancels the one still running.
  let running: AbortController | null = null;

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
      description: `One course: catalog title, credits, description, the student's status, the prerequisite rule, and up to ${SECTIONS_SHOWN} of its Spring 2027 sections: section code, meetings (24-hour), instructor, open seats and a site other than Denton. provenance is "real" for UNT's class schedule and "sample" for synthetic sections.`,
      inputSchema: { type: "object", properties: { code: codeField }, required: ["code"], additionalProperties: false },
      writes: false,
      async run({ code }, { port, signal }) {
        const id = courseId(code);
        if (!id) return fail("unknown_course");
        await port.load([id], signal);
        const options = port.catalog()(id);
        if (options.status !== "ready") return fail("cancelled");
        const row = courseModel(port.plan()).rows.get(id)!;
        const sections = options.result.sections;
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
            provenance: options.result.provenance.kind,
            offered: options.result.availability !== "no_classes",
            total: sections.length,
            items: sections.slice(0, SECTIONS_SHOWN).map((section) => ({
              id: section.id,
              section: optionLabel(section),
              meetings: meetingsText(section),
              instructor: section.instructor.display,
              openSeats: section.term === null ? null : hasOpenSeats(section),
              site: otherSiteOf(section),
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
        const checked = new Map<string, Outcome>();
        const rule = untProfile().catalog.find((course) => course.id === id)?.prerequisite;
        if (rule && row.assessment && verdict !== "done" && verdict !== "taking") projectRequirements(rule, unwrap(row.assessment.reason), checked);
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
        "The student's planned week for the planning term: each course's section and meeting times (24-hour) and its state (chosen by the student, recommended for the goal, sample-pick or needs-review for a saved pick to look at again, choose, not-offered, no-data, loading), total credits, courses that overlap, and walking minutes per week between back-to-back classes.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      writes: false,
      async run(_input, { port, signal }) {
        await port.load(getPlanningTermCourseCodes(port.plan()), signal);
        const plan = port.plan();
        const sectionPlan = port.sectionPlan();
        const locks = plan.lockedSections ?? {};
        const placed = sectionPlan.courses.flatMap((course) => (course.section ? [{ code: course.code, section: course.section }] : []));
        const walking = summarizeWeeklyWalking(buildScheduleEvents(sectionPlan), plannerTravelTime);
        return {
          ok: true,
          credits: summarizeCredits(plan),
          courses: sectionPlan.courses.map((course) => ({
            code: course.code,
            state: course.state,
            section: course.section ? optionLabel(course.section) : course.savedId ? optionIdLabel(course.savedId) : null,
            meetings: course.section ? meetingsText(course.section) : null,
            provenance: course.section ? (course.section.term === null ? "sample" : "real") : null,
            locked: Boolean(course.savedId && locks[course.code] === course.savedId),
          })),
          overlaps: placed.flatMap((a, i) => placed.slice(i + 1).filter((b) => optionsConflict(a.section, b.section)).map((b) => [a.code, b.code])),
          walking: {
            minutesPerWeek: Math.round(walking.knownSeconds / 60),
            unknownWalks: walking.unknownLegs,
            shuttleRides: walking.shuttleLegs,
            estimated: walking.estimated,
          },
        };
      },
    }),

    defineTool<{ day: ClassDay }>({
      name: "get_day",
      title: "Get day",
      description:
        "One day's classes in time order and the trip between each pair: break minutes, travel (walk, shuttle to or from Discovery Park, or other-weeks when the two never meet on the same date), minutes over campus walkways (null when unknown), leaveBy (24-hour time to leave the earlier class) and fit: ok, tight (2 minutes or less to spare), late or unknown.",
      inputSchema: { type: "object", properties: { day: dayField }, required: ["day"], additionalProperties: false },
      writes: false,
      async run({ day }, { port, signal }) {
        await port.load(getPlanningTermCourseCodes(port.plan()), signal);
        const stops = buildStopsForDay(buildScheduleEvents(port.sectionPlan()), day);
        return {
          ok: true,
          day,
          classes: stops.map((stop) => ({ code: stop.courseCode, start: stop.start, end: stop.end, room: stop.location })),
          walks: stops.slice(1).map((to, index) => {
            const from = stops[index];
            const gapMinutes = toMinutes(to.start) - toMinutes(from.end);
            // Like the map: classes in different weeks make no trip, the shuttle has its fixed time,
            // and a straight-line estimate gives no minutes, because nobody walks a straight line.
            const together = meetTogether(day, from.dates, to.dates);
            const shuttle = isShuttleLeg(from.buildingId, to.buildingId);
            const walk = plannerTravelTime(from.buildingId ?? "", to.buildingId ?? "");
            const minutes = !together
              ? null
              : shuttle
                ? walkMinutesFromSeconds(SHUTTLE_SECONDS)
                : walk.source === "campus-network"
                  ? walkMinutesFromSeconds(walk.seconds)
                  : null;
            return {
              from: from.courseCode,
              to: to.courseCode,
              gapMinutes,
              travel: !together ? "other-weeks" : shuttle ? "shuttle" : "walk",
              minutes,
              leaveBy: minutes ? fromMinutes(toMinutes(to.start) - minutes) : null,
              fit: together ? transferFit(minutes, gapMinutes) : "ok",
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
          daysOff: { type: "array", maxItems: 5, items: weekdayField, description: "Weekdays with no class." },
          maxCredits: { type: "integer", minimum: 1, maximum: 24, description: "Most credit hours." },
        },
        additionalProperties: false,
      },
      writes: false,
      async run(input, { port, signal }) {
        await port.load(getPlanningTermCourseCodes(port.plan()), signal);
        const plan = port.plan();
        const catalog = port.catalog();
        const preferences = withOverrides(port.preferences(), input);
        // The Week view's request: its Open seats only and other-site filters, and the courses it holds out.
        const request = buildOptimizeRequest(plan, preferences, { catalog });
        if (request.courses.length === 0) return fail("nothing_to_schedule", "No planned course has a section to suggest.");
        // The number is taken before waiting, so an older search finishing late cannot replace a newer one.
        const number = ++builds;
        running?.abort();
        const mine = new AbortController();
        running = mine;
        let result: OptimizeResult;
        try {
          result = await port.optimize(request, AbortSignal.any([signal, mine.signal]));
        } catch (error) {
          if (signal.aborted || mine.signal.aborted) return fail("cancelled");
          throw error;
        } finally {
          if (running === mine) running = null;
        }
        if (signal.aborted || number !== builds) return fail("cancelled");
        latest = { number, input, key: requestKey(request), goal: goalForWeights(preferences.weights), result };
        const current = plan.selectedSections;
        return {
          ok: true,
          status: result.status,
          alternatives: result.schedules.map((schedule, index) => {
            const b = schedule.breakdown;
            return {
              id: `opt-${number}-${"ABC"[index]}`,
              changes: Object.entries(schedule.byCourse).filter(([code, id]) => current[code] !== id).length,
              sections: Object.fromEntries(Object.entries(schedule.byCourse).map(([code, id]) => [code, labelOf(catalog, code, id)])),
              daysOnCampus: b.daysOnCampus,
              gapMinutes: b.gapMinutes,
              walkMinutes: Math.round(b.walkSeconds / 60),
              unknownWalks: b.unknownWalks,
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
        "What the student types into myUNT to register: one line per planned course with every class number of its section. missing lists courses with no real section on the plan yet (a sample, a pick to look at again, still loading).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      writes: false,
      async run(_input, { port, signal }) {
        await port.load(getPlanningTermCourseCodes(port.plan()), signal);
        const { text, count, missing } = myUntClassNumbers(port.sectionPlan());
        return { ok: true, lines: text ? text.split("\n") : [], classNumbers: count, missing };
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
        const { port } = ctx;
        const catalog = port.catalog();
        const find = (courseCode: string, optionId: string) => findOption(catalog, courseCode, optionId) ?? undefined;
        /**
         * Each course this option would move from the sections `shown` holds, or why it cannot be used: the
         * Week view's own check (run-state.ts canApply), with its merged-plan guard, so an option is refused
         * when the plan's picks with it applied would make two courses overlap.
         */
        const assess = (shown: PlannerState) => {
          const preferences = withOverrides(port.preferences(), build.input);
          const verdict = canApply(
            { ...IDLE, result: build.result, resultKey: build.key },
            runKey(shown, preferences, catalog),
            schedule,
            shown.lockedSections ?? {},
            (merged) => firstClash(merged, find),
            shown.selectedSections,
          );
          if (!verdict.ok) return fail("cannot_apply", verdict.reason);
          return Object.entries(schedule.byCourse)
            .filter(([code, sectionId]) => shown.selectedSections[code] !== sectionId)
            .map(([code, sectionId]) => [code, shown.selectedSections[code] ?? null, sectionId] as const);
        };
        const stamp = port.stamp();
        const changes = assess(port.plan());
        if (!Array.isArray(changes)) return changes;
        if (changes.length === 0) return { ok: true, changed: 0 };
        const list = changes.map(([code, , to]) => `${code} to section ${labelOf(catalog, code, to)}`).join(", ");
        if (!(await ctx.confirm(`Use schedule option ${letter}? It moves ${list}.`, `Use option ${letter}`))) return refused(ctx);
        // Like the Week view, using an option makes every section in it the student's pick.
        const codes = Object.keys(schedule.byCourse);
        const ours = (plan: PlannerState) => codes.every((code) => plan.selectedSections[code] === schedule.byCourse[code]);
        return commitWrite(ctx, stamp, `Using option ${letter} from your assistant`, (plan) => {
          // The student approved these exact moves; anything else needs a new question.
          const now = assess(withShownSections(plan, catalog, port.preferences()));
          if (!Array.isArray(now)) return { result: now };
          if (JSON.stringify(now) !== JSON.stringify(changes)) return { result: fail("plan_changed", PLAN_CHANGED) };
          // planner-provider's applySchedule: a moved course counts as a hand edit to a pending Auto-fill run.
          const next: PlannerState = {
            ...plan,
            selectedSections: { ...plan.selectedSections, ...schedule.byCourse },
            optimization: build.goal ?? plan.optimization,
            coursePlan: plan.coursePlan && takeFromAutoRun(plan.coursePlan, changes.map(([code]) => code)),
          };
          return { next, result: { before: plan, codes, stillOurs: ours, goalSet: build.goal } };
        }, { ok: true, changed: changes.length });
      },
    }),

    defineTool<{ code: string; sectionId: string }>({
      name: "add_section",
      title: "Add section",
      description:
        "Puts one section of a course in the plan, adding the course to the planning term if needed, as the student can by hand. Reports overlaps with other planned classes, a full section and a site other than Denton. The student must confirm in the page and can Undo afterwards. Refused for a course whose section the student locked.",
      inputSchema: {
        type: "object",
        properties: {
          code: codeField,
          sectionId: { type: "string", minLength: 1, maxLength: 80, description: 'A section id from get_course, or its section code, such as "001".' },
        },
        required: ["code", "sectionId"],
        additionalProperties: false,
      },
      writes: true,
      async run({ code, sectionId }, ctx) {
        const { port } = ctx;
        const id = courseId(code);
        if (!id) return fail("unknown_course");
        await port.load([id], ctx.signal);
        const catalog = port.catalog();
        const options = catalog(id);
        const section = options.status === "ready" ? options.result.sections.find((s) => s.id === sectionId || optionLabel(s) === sectionId) : undefined;
        if (!section) return fail("unknown_section", `Sections of ${id} are listed by get_course.`);
        // Where the course stands in `shown`, or why this section cannot be added.
        const assess = (shown: PlannerState) => {
          const status = courseModel(shown).rows.get(id)!.status;
          // Planning a course already passed, or one the transcript shows in progress, would be normalized away.
          if (status === "done" || status === "taking") return fail("not_plannable", `${id} is ${status === "done" ? "already done" : "in progress this term"}.`);
          const lock = shown.lockedSections?.[id];
          if (lock && lock !== section.id) return fail("course_locked", `The student locked ${id}; they can unlock it in Week.`);
          const planned = getPlanningTermCourseCodes(shown);
          const overlapsWith = planned.filter((other) => {
            const picked = other === id ? null : findOption(catalog, other, shown.selectedSections[other] ?? "");
            return picked !== null && optionsConflict(section, picked);
          });
          return { inPlan: planned.includes(id), current: shown.selectedSections[id] ?? null, overlapsWith };
        };
        const stamp = port.stamp();
        const before = assess(port.plan());
        if ("ok" in before) return before;
        if (before.inPlan && before.current === section.id) return { ok: true, changed: false, overlapsWith: [] };
        const notes = [...(before.overlapsWith.length > 0 ? [`It overlaps ${before.overlapsWith.join(" and ")}.`] : []), ...optionNotes(section)];
        const question = [`Add ${id} section ${optionLabel(section)} (${meetingsText(section)}) to your plan?`, ...notes].join(" ");
        if (!(await ctx.confirm(question, "Add section"))) return refused(ctx);
        const ours = (plan: PlannerState) => plan.courseStatuses[id] === "inProgress" && plan.selectedSections[id] === section.id;
        return commitWrite(ctx, stamp, `Your assistant added ${id} section ${optionLabel(section)}`, (plan) => {
          const now = assess(withShownSections(plan, catalog, port.preferences()));
          if ("ok" in now) return { result: now };
          if (JSON.stringify(now) !== JSON.stringify(before)) return { result: fail("plan_changed", PLAN_CHANGED) };
          // The Courses view's "choose section" edit: plan the course by hand, then pick the section.
          const planned = withPlanEdit(
            plan,
            manualEdit(before.inPlan ? {} : { [id]: "inProgress" }, (current) => ({ autoPlanned: withoutCode(current.autoPlanned, id) }), [id]),
          );
          const next = { ...planned, selectedSections: { ...planned.selectedSections, [id]: section.id } };
          return { next, result: { before: plan, codes: [id], stillOurs: ours } };
        }, { ok: true, changed: true, overlapsWith: before.overlapsWith, notes: optionNotes(section) });
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
        const { port } = ctx;
        const id = courseId(code);
        if (!id) return fail("unknown_course");
        const check = (plan: PlannerState) => {
          if (!getPlanningTermCourseCodes(plan).includes(id)) return fail("not_in_plan");
          return plan.lockedSections?.[id] ? fail("course_locked", `The student locked ${id}; they can unlock it in Week.`) : null;
        };
        const stamp = port.stamp();
        const problem = check(port.plan());
        if (problem) return problem;
        if (!(await ctx.confirm(`Remove ${id} from your ${untProfile().planningTerm} plan?`, "Remove"))) return refused(ctx);
        const ours = (plan: PlannerState) => (plan.courseStatuses[id] ?? "notTaken") === "notTaken";
        return commitWrite(ctx, stamp, `Your assistant removed ${id} from the plan`, (plan) => {
          const stale = check(plan);
          if (stale) return { result: stale };
          // The Courses view's "remove from plan" edit.
          const next = withPlanEdit(plan, manualEdit({ [id]: "notTaken" }, (current) => ({ autoPlanned: withoutCode(current.autoPlanned, id) })));
          return { next, result: { before: plan, codes: [id], stillOurs: ours } };
        }, { ok: true, removed: id });
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
                day: weekdayField,
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
        const list = blocks.map((b) => `${b.day} ${b.start}-${b.end}`).join(", ");
        const question = blocked.length === 0 ? "Clear all your busy times?" : `Replace your busy times with ${list}?`;
        if (!(await ctx.confirm(question, "Save busy times"))) return refused(ctx);
        // A cancelled call changes nothing, even after the student said yes.
        if (ctx.signal.aborted) return fail("cancelled");
        // Read what is replaced, and later compare before restoring, inside the updater: it sees the newest stored value.
        const replaced: { blocked?: BlockedTime[] } = {};
        ctx.port.setSchedulePreferences((p) => {
          replaced.blocked = p.constraints.blocked;
          return { ...p, constraints: { ...p.constraints, blocked } };
        });
        if (ctx.signal.aborted) return { ok: true, busyTimes: blocked.length };
        ctx.applied("Your assistant updated your busy times", async () => {
          let restored = false;
          ctx.port.setSchedulePreferences((p) => {
            if (!replaced.blocked || JSON.stringify(p.constraints.blocked) !== JSON.stringify(blocked)) return p;
            restored = true;
            return { ...p, constraints: { ...p.constraints, blocked: replaced.blocked } };
          });
          return restored;
        });
        return { ok: true, busyTimes: blocked.length };
      },
    }),
  ];
}
