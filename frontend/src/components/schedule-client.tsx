"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { PlannerExportPanel } from "@/components/planner-export-panel";
import { PlannerPersistencePanel } from "@/components/planner-persistence-panel";
import { ScheduleSectionLocks } from "@/components/schedule-section-locks";
import { AlternativesCompare } from "@/components/schedule/AlternativesCompare";
import { ConstraintRail } from "@/components/schedule/ConstraintRail";
import { SampleNote } from "@/components/schedule/SampleNote";
import { WeekGrid } from "@/components/schedule/WeekGrid";
import {
  canApply,
  isStale,
  locksKey,
  optimizerInputKey,
  undoAvailable,
  type UndoSnapshot,
} from "@/components/schedule/run-state";
import styles from "@/components/schedule/schedule.module.css";
import { useMediaQuery, useOptimizerRuns } from "@/components/schedule/use-optimizer";
import { clock, eventsFor, findSection, movedCourses, patternOf } from "@/components/schedule/week-model";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Dialog } from "@/components/ui/Dialog";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { toast } from "@/components/ui/Toast";
import { getWalkingSeconds } from "@/lib/campus/walking-times";
import { goalForWeights } from "@/lib/optimizer/presets";
import type { OptimizeResult, RankedSchedule, RelaxSuggestion } from "@/lib/optimizer/types";
import { toPlainRequest } from "@/lib/optimizer/worker/protocol";
import { summarizeWeeklyWalking } from "@/lib/planner-walking";
import {
  buildOptimizeRequest,
  getActiveCourseCodes,
  getCourseByCode,
  getSectionsForCourse,
  getUnscheduledActiveCourses,
  sectionConflicts,
  sectionNumber,
  summarizeCredits,
} from "@/lib/planner";
import { weekDays, type CourseSection } from "@/lib/types";

/** The shell's phone breakpoint (shell.css). */
const PHONE = "(max-width: 719px)";
const SAMPLE_SOURCE = "Sections, times, rooms and instructors are synthetic samples, not UNT's class schedule.";

function overlapping(selected: CourseSection[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      if (sectionConflicts(selected[i], [selected[j]])) {
        ids.add(selected[i].id);
        ids.add(selected[j].id);
      }
    }
  }
  return ids;
}

export function ScheduleClient() {
  const {
    plannerState,
    scheduleEvents,
    setSection,
    setSectionLock,
    schedulePreferences,
    setSchedulePreferences,
    preferencesReady,
    preferencesStorage,
    applySchedule,
    restoreSchedule,
    planEpoch,
    saveState,
    tookNewerVersion,
    storeNotices,
  } = usePlanner();
  const saveCalm =
    (saveState.status === "saved" || saveState.status === "saving" || saveState.status === "pending") &&
    !tookNewerVersion &&
    storeNotices.length === 0;
  const phone = useMediaQuery(PHONE);
  const { state: run, run: startRun, close: closeRun } = useOptimizerRuns();

  // A preview belongs to the result it came from, so a replaced or stale result never paints ghosts.
  const [preview, setPreview] = useState<{ schedule: RankedSchedule; result: OptimizeResult; instant: boolean } | null>(null);
  const [undo, setUndo] = useState<UndoSnapshot | null>(null);
  const [pickProblem, setPickProblem] = useState<string | null>(null);
  const [rerun, setRerun] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerCourse, setPickerCourse] = useState<string | null>(null);

  const activeCourseCodes = useMemo(() => getActiveCourseCodes(plannerState), [plannerState]);
  const selected = plannerState.selectedSections;
  const selectedSections = useMemo(
    () => Object.values(selected).map((id) => findSection(id)).filter((s): s is CourseSection => Boolean(s)),
    [selected],
  );
  const events = useMemo(() => eventsFor(selected), [selected]);
  const conflicts = useMemo(() => overlapping(selectedSections), [selectedSections]);
  const unscheduled = useMemo(() => getUnscheduledActiveCourses(plannerState), [plannerState]);
  const locks = useMemo(() => plannerState.lockedSections ?? {}, [plannerState.lockedSections]);

  // What a run depends on. A shown result computed from other inputs is stale.
  const inputKey = optimizerInputKey(schedulePreferences, locks, activeCourseCodes);
  const currentLocks = locksKey(locks);
  const stale = isStale(run, inputKey);
  const dirty = run.result === null || run.resultKey !== inputKey;
  const running = run.status === "running";
  const undoOk = undoAvailable(undo, planEpoch, currentLocks);

  // Keyboard actions never animate (DESIGN.md §1): a run started from the keyboard shows its result instantly.
  const [instantResult, setInstantResult] = useState(false);
  const optimizeNow = useCallback(
    (fromKeyboard = false) => {
      setPreview(null);
      setPickProblem(null);
      setInstantResult(fromKeyboard);
      // The worker gets plain data: the request with its walking provider turned into a table.
      startRun(toPlainRequest(buildOptimizeRequest(plannerState, schedulePreferences)), inputKey);
    },
    [inputKey, plannerState, schedulePreferences, startRun],
  );

  // Bring the first answer of each run into view; on a phone it renders below the header.
  const scrolledFor = useRef<number | null>(null);
  useEffect(() => {
    if (run.result === null || run.id === null || scrolledFor.current === run.id) return;
    scrolledFor.current = run.id;
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document
        .getElementById("alternatives-title")
        ?.scrollIntoView({ block: "nearest", behavior: reduce || instantResult ? "auto" : "smooth" });
    });
  }, [instantResult, run.id, run.result]);

  // A relaxation changes settings first; optimize again once they have rendered.
  const firstRerun = useRef(true);
  useEffect(() => {
    if (firstRerun.current) {
      firstRerun.current = false;
      return;
    }
    optimizeNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when a relaxation asks for it
  }, [rerun]);

  const pickSchedule = (schedule: RankedSchedule, letter: string) => {
    // Checked again here: the button may have drawn before the settings changed.
    const check = canApply(run, inputKey, schedule, locks);
    if (!check.ok) {
      setPickProblem(check.reason);
      return;
    }
    const moved = movedCourses(selected, schedule.byCourse);
    setUndo({ sections: { ...selected }, goal: plannerState.optimization, letter, epoch: planEpoch, locks: currentLocks });
    applySchedule(schedule.byCourse, goalForWeights(schedulePreferences.weights));
    setPreview(null);
    setPickProblem(null);
    toast(moved.length === 0 ? `Using option ${letter}` : `Using option ${letter} · ${moved.length} course${moved.length === 1 ? "" : "s"} moved`);
  };

  const undoPick = () => {
    if (!undoAvailable(undo, planEpoch, currentLocks)) return;
    restoreSchedule(undo);
    setUndo(null);
    toast("Restored your previous schedule");
  };

  const relax = (suggestion: RelaxSuggestion) => {
    if (stale) return;
    const r = suggestion.relaxation;
    switch (r.kind) {
      case "unlock":
        setSectionLock(r.courseCode, false);
        break;
      case "include":
        setSchedulePreferences((p) => ({
          ...p,
          constraints: { ...p.constraints, excludedSections: p.constraints.excludedSections.filter((id) => id !== r.sectionId) },
        }));
        break;
      default:
        setSchedulePreferences((p) => {
          const c = p.constraints;
          switch (r.kind) {
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
    }
    toast(suggestion.label);
    setRerun((n) => n + 1);
  };

  const credits = summarizeCredits(plannerState);
  const walking = useMemo(() => summarizeWeeklyWalking(scheduleEvents, getWalkingSeconds), [scheduleEvents]);
  const walkMinutes = Math.round(walking.knownSeconds / 60);
  const earliest = events.length ? Math.min(...events.map((e) => e.start)) : null;
  const latest = events.length ? Math.max(...events.map((e) => e.end)) : null;
  const longest = weekDays
    .map((day) => {
      const list = events.filter((e) => e.day === day);
      return { day, span: list.length ? Math.max(...list.map((e) => e.end)) - Math.min(...list.map((e) => e.start)) : 0 };
    })
    .sort((a, b) => b.span - a.span)[0];
  const daysOnCampus = new Set(events.map((e) => e.day)).size;

  const shownPreview = preview && preview.result === run.result && !stale ? preview.schedule : null;
  const movedInPreview = shownPreview ? movedCourses(selected, shownPreview.byCourse) : [];
  const ghosts = shownPreview ? eventsFor(Object.fromEntries(movedInPreview.map((code) => [code, shownPreview.byCourse[code]]))) : [];
  // The grid's hours cover the plan and every shown option, so previewing one never moves the others.
  const rangeEvents = useMemo(
    () => (run.result && !stale ? [...events, ...run.result.schedules.flatMap((schedule) => eventsFor(schedule.byCourse))] : events),
    [events, run.result, stale],
  );

  const pickerCourseInfo = pickerCourse ? getCourseByCode(pickerCourse) : undefined;
  const pickerSections = pickerCourse ? getSectionsForCourse(pickerCourse) : [];
  const excluded = new Set(schedulePreferences.constraints.excludedSections);

  const rail = (
    <ConstraintRail
      preferences={schedulePreferences}
      onChange={setSchedulePreferences}
      onOptimize={(fromKeyboard) => {
        setSheetOpen(false);
        optimizeNow(fromKeyboard);
      }}
      running={running}
      dirty={dirty}
      disabled={!preferencesReady}
      storage={preferencesStorage}
    />
  );

  const inPlan = (
    <section className={styles.railSection} aria-labelledby="in-plan-title">
      <h2 className={styles.railHeading} id="in-plan-title">
        In this plan
      </h2>
      <div className={styles.inPlan}>
        {selectedSections.length > 0 ? (
          <>
            <p className={styles.meta}>Locked sections stay put when you optimize.</p>
            <ScheduleSectionLocks />
          </>
        ) : (
          <p className={styles.meta}>Nothing planned yet. Mark courses as Taking in Courses.</p>
        )}
      </div>
    </section>
  );

  const walkingNote = (
    <p className={styles.meta}>
      Walking follows campus walkways{walking.estimated ? "; some walks are straight-line estimates" : ""}.
      {walking.unknownLegs > 0
        ? ` ${walking.unknownLegs} walk${walking.unknownLegs === 1 ? " has" : "s have"} no known time and ${walking.unknownLegs === 1 ? "is" : "are"} not counted.`
        : ""}
    </p>
  );

  const stats = (
    <section className={styles.railSection} aria-labelledby="stats-title">
      <h2 className={styles.railHeading} id="stats-title">
        This week
      </h2>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <b>{credits}</b>
          <span>Credits</span>
        </div>
        <div className={styles.stat}>
          <b>{earliest === null ? "—" : clock(earliest)}</b>
          <span>Earliest</span>
        </div>
        <div className={styles.stat}>
          <b>{latest === null ? "—" : clock(latest)}</b>
          <span>Latest</span>
        </div>
        <div className={styles.stat}>
          <b>
            {walkMinutes}
            <small> min</small>
          </b>
          <span>Walking / wk</span>
        </div>
        <div className={styles.stat}>
          <b>{longest && longest.span > 0 ? longest.day : "—"}</b>
          <span>Longest day</span>
        </div>
        <div className={styles.stat}>
          <b>{daysOnCampus}</b>
          <span>Days on campus</span>
        </div>
      </div>
      {walkingNote}
    </section>
  );

  const sectionList = (
    <div className={styles.sectionList}>
      {pickerSections.map((section) => {
        const others = selectedSections.filter((s) => s.courseCode !== section.courseCode);
        const clash = sectionConflicts(section, others);
        const current = selected[section.courseCode] === section.id;
        const skipped = excluded.has(section.id);
        return (
          <div key={section.id} className={styles.sectionRow} data-current={current ? "true" : "false"}>
            <button
              type="button"
              className={styles.sectionPick}
              disabled={clash || current}
              onClick={() => {
                setSection(section.courseCode, section.id);
                setPickerCourse(null);
                toast(`Section updated · ${section.courseCode}`);
              }}
            >
              <span className={styles.sectionPickLine}>
                §{sectionNumber(section.id)} · {patternOf(section)}
              </span>
              <span className={styles.meta} data-clash={clash ? "true" : "false"}>
                {section.professor} · ★ {section.rating.toFixed(1)}
                {current ? " · current section" : clash ? " · overlaps another class" : ""}
              </span>
            </button>
            <Chip
              size="sm"
              selected={skipped}
              onSelectedChange={(skip) =>
                setSchedulePreferences((p) => ({
                  ...p,
                  constraints: {
                    ...p.constraints,
                    excludedSections: skip
                      ? [...p.constraints.excludedSections.filter((id) => id !== section.id), section.id]
                      : p.constraints.excludedSections.filter((id) => id !== section.id),
                  },
                }))
              }
            >
              Skip<span className={styles.srOnly}> section {sectionNumber(section.id)} when optimizing</span>
            </Chip>
          </div>
        );
      })}
    </div>
  );

  const pickerTitle = pickerCourseInfo ? `Swap section · ${pickerCourseInfo.code}` : "Swap section";

  return (
    <div className={`shell-content ${styles.page}`}>
      <header className={styles.viewhead}>
        <h1 className={styles.viewheadTitle}>Week</h1>
        <span className={styles.meta}>
          {phone ? `${credits} cr` : `${credits} credits · ${activeCourseCodes.length} course${activeCourseCodes.length === 1 ? "" : "s"}`}
        </span>
        <ProvenanceTag source={SAMPLE_SOURCE}>{phone ? "Sample" : "Sample sections"}</ProvenanceTag>
        <span className={styles.spacer} />
        {phone ? (
          <Button size="sm" onClick={() => setSheetOpen(true)} loading={running} loadingLabel="Optimizing…" aria-haspopup="dialog">
            Optimize
          </Button>
        ) : null}
      </header>

      <SampleNote />
      {/* The PlanChip shows a calm save state; the panel's own bar appears only when something needs attention.
          It stays mounted for its status region and the conflict dialog (which renders in a portal). */}
      <div className={saveCalm ? styles.srOnly : undefined}>
        <PlannerPersistencePanel />
      </div>

      {phone ? (
        <p className={styles.statsStrip}>
          <span>{earliest === null || latest === null ? "No classes yet" : `${clock(earliest)}–${clock(latest)}`}</span>
          <span>{walkMinutes} min walking</span>
          {longest && longest.span > 0 ? <span>longest {longest.day}</span> : null}
        </p>
      ) : null}

      <div className={styles.body}>
        {phone ? null : (
          <aside className={styles.side} aria-label="Constraints and this plan">
            {rail}
            {inPlan}
            {stats}
            <PlannerExportPanel />
          </aside>
        )}

        <div className={styles.main}>
          {conflicts.size > 0 ? (
            <p className={styles.notice} role="alert">
              Two of your sections overlap. Optimize week, or select a red class to swap its section.
            </p>
          ) : null}
          {unscheduled.length > 0 ? (
            <p className={`${styles.notice} ${styles.noticeQuiet}`} role="status">
              No section data yet for {unscheduled.map((course) => course.code).join(", ")}. It is left out of the week and the optimizer.
            </p>
          ) : null}
          {pickProblem ? (
            <p className={styles.notice} role="alert">
              {pickProblem}
            </p>
          ) : null}
          {undoOk ? (
            <p className={styles.meta} role="status">
              Using option {undo.letter}.{" "}
              <Button variant="link" size="sm" onClick={undoPick}>
                Undo
              </Button>
            </p>
          ) : null}

          <AlternativesCompare
            state={run}
            stale={stale}
            current={selected}
            courseOrder={activeCourseCodes}
            onUse={pickSchedule}
            instant={instantResult}
            onPreview={(schedule, fromKeyboard) =>
              setPreview(schedule && run.result ? { schedule, result: run.result, instant: fromKeyboard } : null)
            }
            onRelax={relax}
            onRetry={optimizeNow}
            onClose={() => {
              closeRun();
              setPreview(null);
            }}
          />

          <WeekGrid
            events={events}
            courseOrder={activeCourseCodes}
            lockedSections={locks}
            conflictSections={conflicts}
            rangeEvents={rangeEvents}
            ghosts={ghosts}
            ghostsInstant={Boolean(preview?.instant)}
            dimmedCourses={movedInPreview}
            onSelect={setPickerCourse}
          />
        </div>

        {phone ? (
          <div className={styles.side}>
            {inPlan}
            {walkingNote}
            <PlannerExportPanel />
          </div>
        ) : null}
      </div>

      {phone ? (
        <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title="Constraints">
          <div className={styles.sheetBody}>{rail}</div>
        </BottomSheet>
      ) : null}

      {phone ? (
        <BottomSheet open={pickerCourse !== null} onOpenChange={(open) => (open ? null : setPickerCourse(null))} title={pickerTitle}>
          <div className={styles.sheetBody}>
            <p className={styles.sheetTitle}>
              <span className={styles.bigCode}>{pickerCourseInfo?.code}</span> {pickerCourseInfo?.title}
            </p>
            {sectionList}
          </div>
        </BottomSheet>
      ) : (
        <Dialog
          open={pickerCourse !== null}
          onOpenChange={(open) => (open ? null : setPickerCourse(null))}
          title={pickerTitle}
          description={pickerCourseInfo?.title}
          width={560}
        >
          {sectionList}
        </Dialog>
      )}
    </div>
  );
}
