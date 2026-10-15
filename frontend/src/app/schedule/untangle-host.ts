"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import type { BuilderEdits, BuilderHost, OptionsFeed, SearchHit, WeekCourse } from "@/components/schedule-builder/host";
import { isStale, requestKey } from "@/components/schedule/run-state";
import { useOptimizerRuns } from "@/components/schedule/use-optimizer";
import { searchCourses } from "@/components/shell/course-search";
import { toast } from "@/components/ui/Toast";
import type { Brand } from "@/lib/brand";
import type { RelaxSuggestion } from "@/lib/optimizer/types";
import { toPlainRequest } from "@/lib/optimizer/worker/protocol";
import {
  buildOptimizeRequest,
  defaultSchedulePreferences,
  getCoreCoursesForMajor,
  getCourseByCode,
  getMissingPrerequisites,
  getPlanningTermCourseCodes,
  takeFromAutoRun,
  type PlannedCourse,
} from "@/lib/planner";
import { findOption, optionIdLabel, planningTerm, sectionRef } from "@/lib/planner-sections";
import { isShuttleLeg, plannerTravelTime } from "@/lib/planner-walking";
import { findClassNumber } from "@/lib/sections/client";
import { optionReasons } from "./option-reasons";
import { courses as catalog } from "@/lib/seed-data";
import type { CourseStatus, PlannerState } from "@/lib/types";

/** What one undo puts back: the touched courses' status, section, lock and Auto-filled mark as they were. */
type Snapshot = {
  codes: string[];
  statuses: Record<string, CourseStatus | undefined>;
  sections: Record<string, string | undefined>;
  locks: Record<string, string | undefined>;
  autoPlanned: Record<string, boolean>;
};

/** Undo steps kept per visit. More than anyone presses; a bound, not a rule. */
const HISTORY = 50;
const SUGGESTIONS = 8;

function withEntry<T>(record: Record<string, T> | undefined, code: string, value: T | undefined): Record<string, T> {
  const next = { ...(record ?? {}) };
  if (value === undefined) delete next[code];
  else next[code] = value;
  return next;
}

/** One sentence for a course the student has to settle, or null when it is on the week. */
function noteFor(course: PlannedCourse): { state: WeekCourse["state"]; note?: string } {
  switch (course.state) {
    case "loading":
      return { state: "loading" };
    case "chosen":
    case "recommended":
      return { state: "placed" };
    case "sample-pick":
      return { state: "pick", note: `${course.code} section ${optionIdLabel(course.savedId!)} is made up for planning. Pick a real one.` };
    case "needs-review": {
      const ref = sectionRef(course.savedId!);
      const saved = `${course.code} section ${optionIdLabel(course.savedId!)}`;
      if (ref.provenance === "real" && course.result?.provenance.kind === "sample") return { state: "pick", note: `${saved} can't be checked: ${planningTerm.label} sections didn't load.` };
      if (ref.provenance === "real" && ref.term !== planningTerm.id) return { state: "pick", note: `${saved} is from another term. Pick a ${planningTerm.label} section.` };
      return { state: "pick", note: `${saved} isn't offered in ${planningTerm.label} anymore. Pick another section.` };
    }
    case "choose":
      return { state: "pick", note: `No section of ${course.code} fits around your other classes. Pick one by hand.` };
    case "not-offered":
      return { state: "none", note: `${course.code} isn't offered in ${planningTerm.label}.` };
    case "no-data":
      return { state: "none", note: `There are no ${planningTerm.label} sections for ${course.code}.` };
  }
}

/**
 * The schedule builder's host in UNTangle: the week is the student's plan
 * (planner-provider), every change is one checked `transact`, and Undo puts
 * back exactly the courses a change touched.
 */
export function useUntangleHost(brand: Brand): BuilderHost {
  const planner = usePlanner();
  const {
    plannerState,
    sectionPlan,
    sectionCatalog,
    catalogVersion,
    loadSections,
    schedulePreferences,
    setSchedulePreferences,
    preferencesReady,
    setSectionLock,
    transact,
    planStamp,
  } = planner;

  const history = useRef<Snapshot[]>([]);
  const [historySize, setHistorySize] = useState(0);
  const { state: run, run: startRun, close: closeRun } = useOptimizerRuns();

  const courses = useMemo<WeekCourse[]>(
    () =>
      sectionPlan.courses.map((course) => {
        const info = getCourseByCode(course.code);
        return {
          code: course.code,
          title: info?.title ?? course.code,
          credits: info?.creditHours ?? 3,
          section: course.section,
          locked: Boolean(plannerState.lockedSections?.[course.code]),
          ...noteFor(course),
        };
      }),
    [plannerState.lockedSections, sectionPlan],
  );

  const find = useCallback(
    (code: string, id: string) => findOption(sectionCatalog, code, id) ?? undefined,
    // catalogVersion is how the catalog says it has more loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sectionCatalog, catalogVersion],
  );

  // Sections the planner suggests for courses without a pick. They are recomputed
  // around every pick, so the first change by hand pins the ones on screen:
  // adding one course must not move the others under the student.
  const suggested = useMemo(
    () => Object.fromEntries(sectionPlan.courses.flatMap((course) => (course.state === "recommended" && course.section ? [[course.code, course.section.id]] : []))),
    [sectionPlan],
  );

  /**
   * Writes a change as one transaction, pinning the suggested sections, and
   * records what every touched course was in the stored plan just before it,
   * so Undo restores saved picks and returns pinned ones to suggestions.
   */
  const change = useCallback(
    (codes: string[], next: (plan: PlannerState) => PlannerState | null) => {
      let snapshot: Snapshot | null = null;
      void transact((plan) => {
        const touched = [...new Set([...codes, ...Object.keys(suggested)])];
        snapshot = {
          codes: touched,
          statuses: Object.fromEntries(touched.map((code) => [code, plan.courseStatuses[code]])),
          sections: Object.fromEntries(touched.map((code) => [code, plan.selectedSections[code]])),
          locks: Object.fromEntries(touched.map((code) => [code, plan.lockedSections?.[code]])),
          autoPlanned: Object.fromEntries(touched.map((code) => [code, Boolean(plan.coursePlan?.autoPlanned.includes(code))])),
        };
        const result = next(plan);
        if (!result) return { result: false };
        const pinned = { ...result.selectedSections };
        for (const [code, id] of Object.entries(suggested)) {
          if (!codes.includes(code) && pinned[code] === undefined && result.courseStatuses[code] === "inProgress") pinned[code] = id;
        }
        // A course the pending Auto-fill planned is the student's once they change it here,
        // as with the provider's own edits: Courses then refuses to undo that Auto-fill.
        const edited = codes.filter((code) => plan.courseStatuses[code] !== result.courseStatuses[code] || plan.selectedSections[code] !== result.selectedSections[code]);
        const coursePlan = result.coursePlan && edited.length > 0 ? takeFromAutoRun(result.coursePlan, edited) : result.coursePlan;
        return { next: { ...result, selectedSections: pinned, coursePlan }, result: true };
      }, planStamp).then((outcome) => {
        if (outcome.status === "committed" && outcome.result && snapshot) {
          history.current = [...history.current, snapshot].slice(-HISTORY);
          setHistorySize(history.current.length);
        } else if (outcome.status === "plan_replaced" || outcome.status === "identity_changed") {
          toast({ message: "Your plan changed in another tab, so nothing was changed here. Try again.", tone: "error" });
        }
      });
    },
    [planStamp, suggested, transact],
  );

  const takingNow = useMemo(
    () => new Set(plannerState.transcriptRecords.filter((r) => !r.duplicateExcluded && r.appliedStatus === "inProgress").map((r) => r.code)),
    [plannerState.transcriptRecords],
  );
  const refusal = (code: string): string | null => {
    if (!getCourseByCode(code)) return `${code} isn't in UNTangle's course list yet.`;
    if (plannerState.courseStatuses[code] === "completed") return `${code} is done already.`;
    if (takingNow.has(code)) return `You're taking ${code} now, so it isn't planned for ${planningTerm.label}.`;
    return null;
  };

  const edits: BuilderEdits = {
    canUndo: historySize > 0,
    place: (code, sectionId) => {
      const refused = refusal(code);
      if (refused) return void toast({ message: refused, tone: "error" });
      change([code], (plan) => ({
        ...plan,
        courseStatuses: { ...plan.courseStatuses, [code]: "inProgress" },
        selectedSections: { ...plan.selectedSections, [code]: sectionId },
        // A kept section the student moves by hand stays kept, on its new section.
        lockedSections: plan.lockedSections?.[code] ? { ...plan.lockedSections, [code]: sectionId } : plan.lockedSections,
      }));
    },
    remove: (code) =>
      change([code], (plan) => ({
        ...plan,
        courseStatuses: { ...plan.courseStatuses, [code]: "notTaken" },
        selectedSections: withEntry(plan.selectedSections, code, undefined),
        lockedSections: withEntry(plan.lockedSections, code, undefined),
        coursePlan: plan.coursePlan && { ...plan.coursePlan, autoPlanned: plan.coursePlan.autoPlanned.filter((c) => c !== code) },
      })),
    keep: (code, kept) => {
      // A suggested section is pinned as the student's pick when kept.
      const id = courses.find((course) => course.code === code)?.section?.id;
      if (!id) return;
      change([code], (plan) => ({
        ...plan,
        selectedSections: kept ? { ...plan.selectedSections, [code]: id } : plan.selectedSections,
        lockedSections: withEntry(plan.lockedSections, code, kept ? id : undefined),
      }));
    },
    use: (byCourse) => {
      const checked = Object.keys(byCourse).map((code) => [code, refusal(code)] as const);
      const codes = checked.flatMap(([code, refused]) => (refused ? [] : [code]));
      const refusals = checked.flatMap(([, refused]) => (refused ? [refused] : []));
      if (codes.length === 0) return refusals;
      change(codes, (plan) => {
        let locks = plan.lockedSections ?? {};
        for (const code of codes) if (locks[code] && locks[code] !== byCourse[code]) locks = withEntry(locks, code, undefined);
        return {
          ...plan,
          courseStatuses: { ...plan.courseStatuses, ...Object.fromEntries(codes.map((code) => [code, "inProgress" as const])) },
          selectedSections: { ...plan.selectedSections, ...Object.fromEntries(codes.map((code) => [code, byCourse[code]])) },
          lockedSections: locks,
        };
      });
      return refusals;
    },
    clear: () => {
      const codes = getPlanningTermCourseCodes(plannerState);
      if (codes.length === 0) return;
      change(codes, (plan) =>
        codes.reduce<PlannerState>(
          (acc, code) => ({
            ...acc,
            courseStatuses: { ...acc.courseStatuses, [code]: "notTaken" },
            selectedSections: withEntry(acc.selectedSections, code, undefined),
            lockedSections: withEntry(acc.lockedSections, code, undefined),
            coursePlan: acc.coursePlan && { ...acc.coursePlan, autoPlanned: acc.coursePlan.autoPlanned.filter((c) => c !== code) },
          }),
          plan,
        ),
      );
    },
    undo: () => {
      const last = history.current.at(-1);
      if (!last) return;
      history.current = history.current.slice(0, -1);
      setHistorySize(history.current.length);
      // The stamp makes the plan refuse this if it was reloaded or replaced since the change.
      void transact(
        (plan) => ({
          next: last.codes.reduce<PlannerState>(
            (acc, code) => ({
              ...acc,
              courseStatuses: withEntry(acc.courseStatuses, code, last.statuses[code]),
              selectedSections: withEntry(acc.selectedSections, code, last.sections[code]),
              lockedSections: withEntry(acc.lockedSections, code, last.locks[code]),
              coursePlan: acc.coursePlan && {
                ...acc.coursePlan,
                autoPlanned: last.autoPlanned[code]
                  ? [...new Set([...acc.coursePlan.autoPlanned, code])]
                  : acc.coursePlan.autoPlanned.filter((c) => c !== code),
              },
            }),
            plan,
          ),
          result: true,
        }),
        planStamp,
      ).then((outcome) => {
        if (outcome.status !== "plan_replaced" && outcome.status !== "identity_changed") return;
        history.current = [];
        setHistorySize(0);
        toast({ message: "Your plan was reloaded since that change, so it can't be undone.", tone: "error" });
      });
    },
  };

  // Auto: the same request the optimizer receives everywhere in UNTangle.
  const request = useMemo(
    () => buildOptimizeRequest(plannerState, schedulePreferences, { catalog: sectionCatalog }),
    // catalogVersion is how the catalog says it has more loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plannerState, schedulePreferences, sectionCatalog, catalogVersion],
  );
  const inputKey = requestKey(request);
  const relax = (suggestion: RelaxSuggestion) => {
    const r = suggestion.relaxation;
    if (r.kind === "unlock") return setSectionLock(r.courseCode, false);
    setSchedulePreferences((p) => {
      const c = p.constraints;
      switch (r.kind) {
        case "include":
          return { ...p, constraints: { ...c, excludedSections: c.excludedSections.filter((id) => id !== r.sectionId) } };
        case "earliestStart":
          return { ...p, constraints: { ...c, earliestStart: r.to } };
        case "latestEnd":
          return { ...p, constraints: { ...c, latestEnd: r.to } };
        case "dayOff":
          return { ...p, constraints: { ...c, daysOff: c.daysOff.filter((day) => day !== r.day) } };
        case "blocked":
          return { ...p, constraints: { ...c, blocked: c.blocked.filter((b) => b.id !== r.blockedId) } };
        case "maxCredits":
          return { ...p, constraints: { ...c, maxCredits: r.to } };
        case "walking":
          return { ...p, constraints: { ...c, walkingBufferMinutes: r.to === null ? null : r.to.bufferMinutes } };
      }
    });
  };
  // The exact request each run was sent, walking time included: reasons are computed against it, never a rebuilt one.
  const sent = useRef<{ inputKey: string; request: typeof request } | null>(null);
  const result = run.result;
  const explain = (byCourse: Record<string, string>) => {
    const asked = sent.current;
    if (!result || result.status === "infeasible" || !asked || asked.inputKey !== run.resultKey) return [];
    const index = result.schedules.findIndex((schedule) => JSON.stringify(schedule.byCourse) === JSON.stringify(byCourse));
    if (index < 0) return [];
    const seats = Object.fromEntries(
      Object.entries(byCourse).flatMap(([code, id]) => {
        const section = find(code, id);
        return section ? [[id, section] as const] : [];
      }),
    );
    try {
      return optionReasons({ alternatives: result.schedules, index, request: asked.request, seats });
    } catch (error) {
      // A mismatch between the result and its request is a bug; Details still shows the figures.
      console.error("Week: reasons for the option on screen failed", error);
      return [];
    }
  };
  const optimizer: OptionsFeed = {
    runId: run.id,
    status: run.status,
    options: result && result.status !== "infeasible" ? result.schedules.map((schedule) => schedule.byCourse) : [],
    stale: isStale(run, inputKey),
    infeasible:
      result?.status === "infeasible"
        ? { sentence: result.explanation.sentence, fixes: result.explanation.suggestions.map((s) => ({ label: s.label, apply: () => relax(s) })) }
        : result?.status === "timeout" && result.schedules.length === 0 && run.status === "done"
          ? { sentence: "No week turned up in time. Loosen a preference or keep fewer sections.", fixes: [] }
          : null,
    error: run.error,
    explain,
    run: () => {
      sent.current = { inputKey, request };
      startRun(toPlainRequest(request), inputKey);
    },
    close: closeRun,
  };

  const hitFor = useCallback(
    (code: string, title: string): SearchHit => {
      const status = plannerState.courseStatuses[code];
      return {
        code,
        title,
        status:
          status === "completed"
            ? "done"
            : takingNow.has(code)
              ? "taking"
              : status === "inProgress"
                ? "planned"
                : getMissingPrerequisites(code, plannerState.courseStatuses, plannerState.transcriptRecords).length > 0
                  ? "locked"
                  : "available",
      };
    },
    [plannerState.courseStatuses, plannerState.transcriptRecords, takingNow],
  );

  const search = useMemo<BuilderHost["search"]>(
    () => ({
      find: (query) => searchCourses(catalog, query, 20).map((item) => hitFor(item.code!, item.title ?? item.code!)),
      suggestions: () =>
        brand.suggestions
          ? getCoreCoursesForMajor(plannerState.selectedMajor)
              .map((course) => hitFor(course.code, course.title))
              .filter((hit) => hit.status === "available")
              .slice(0, SUGGESTIONS)
          : [],
      options: (code) => {
        const options = sectionCatalog(code);
        return options.status === "ready" ? options.result.sections : null;
      },
      load: loadSections,
      classNumber: (number) => findClassNumber(planningTerm.id, number),
    }),
    // catalogVersion is how the catalog says it has more loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brand.suggestions, catalogVersion, hitFor, loadSections, plannerState.selectedMajor, sectionCatalog],
  );

  const walk = useCallback((from: string, to: string) => {
    const time = plannerTravelTime(from, to);
    // Whole seconds, as the optimizer rounds them (walkSeconds in lib/optimizer/score.ts), so Week and Auto agree at the boundary.
    return time.seconds === null ? null : { seconds: Math.round(time.seconds), shuttle: isShuttleLeg(from, to) };
  }, []);

  return {
    brand: { id: brand.id, primaryLabel: brand.primaryLabel, primaryShort: brand.primaryShort, suggestions: brand.suggestions },
    term: { id: planningTerm.id, label: planningTerm.label },
    courses,
    provenance: courses.some((course) => course.section?.term === null) ? "sample" : "real",
    preferences: schedulePreferences,
    defaults: defaultSchedulePreferences(plannerState.optimization),
    setPreferences: setSchedulePreferences,
    preferencesReady,
    walk,
    search,
    edits,
    optimizer,
    find,
    printHref: "/schedule/print",
    shareUrl: (encoded) => {
      const url = new URL("/schedule", window.location.origin);
      url.searchParams.set("week", encoded);
      const host = new URLSearchParams(window.location.search).get("host");
      if (host) url.searchParams.set("host", host);
      return url.toString();
    },
  };
}
