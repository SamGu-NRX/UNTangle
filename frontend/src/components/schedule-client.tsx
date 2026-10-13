"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavShell } from "@/components/nav-shell";
import { Modal } from "@/components/ui/Modal";
import { usePlanner, useToast, type OptimizeRun } from "@/components/planner-provider";
import { PlannerPersistencePanel } from "@/components/planner-persistence-panel";
import { PlannerExportPanel } from "@/components/planner-export-panel";
import { PlannerSampleNotice, SampleTag } from "@/components/planner-sample-notice";
import { ScheduleSectionLocks } from "@/components/schedule-section-locks";
import { AlternativesCompare } from "@/components/schedule/AlternativesCompare";
import { ConstraintRail } from "@/components/schedule/ConstraintRail";
import { WeekGrid } from "@/components/schedule/WeekGrid";
import styles from "@/components/schedule/schedule.module.css";
import { clock, eventsFor, findSection, movedCourses, patternOf } from "@/components/schedule/week-model";
import { summarizeWeeklyWalking } from "@/lib/planner-walking";
import { goalForWeights } from "@/lib/optimizer/presets";
import type { RankedSchedule, RelaxSuggestion } from "@/lib/optimizer/types";
import {
  getActiveCourseCodes,
  getCourseByCode,
  getSectionsForCourse,
  getUnscheduledActiveCourses,
  sectionConflicts,
  sectionNumber,
  summarizeCredits,
} from "@/lib/planner";
import { weekDays, type CourseSection } from "@/lib/types";

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
    runOptimizer,
    applySchedule,
  } = usePlanner();
  const { toast } = useToast();

  const [run, setRun] = useState<(OptimizeRun & { fingerprint: string }) | null>(null);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<RankedSchedule | null>(null);
  const [undo, setUndo] = useState<{ previous: Record<string, string>; letter: string } | null>(null);
  const [rerun, setRerun] = useState(0);
  const [pickerCourse, setPickerCourse] = useState<string | null>(null);
  const [pickerOrigin, setPickerOrigin] = useState<{ x: number; y: number } | null>(null);

  const activeCourseCodes = useMemo(() => getActiveCourseCodes(plannerState), [plannerState]);
  const selected = plannerState.selectedSections;
  const selectedSections = useMemo(
    () => Object.values(selected).map((id) => findSection(id)).filter((s): s is CourseSection => Boolean(s)),
    [selected],
  );
  const events = useMemo(() => eventsFor(selected), [selected]);
  const conflicts = useMemo(() => overlapping(selectedSections), [selectedSections]);
  const unscheduled = useMemo(() => getUnscheduledActiveCourses(plannerState), [plannerState]);
  const locks = plannerState.lockedSections ?? {};

  // What the last run was computed from; when it changes, Optimize is offered again.
  const fingerprint = JSON.stringify([schedulePreferences, locks, activeCourseCodes]);
  const dirty = run === null || run.fingerprint !== fingerprint;

  const optimizeNow = useCallback(() => {
    setRunning(true);
    setPreview(null);
    // Let the button show its running state before the (synchronous) search.
    window.setTimeout(() => {
      const next = runOptimizer();
      setRun({ ...next, fingerprint });
      setRunning(false);
      // Bring the result into view; on a phone it renders below the rail.
      requestAnimationFrame(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        document.getElementById("alternatives-title")?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
      });
    }, 16);
  }, [fingerprint, runOptimizer]);

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
    const moved = movedCourses(selected, schedule.byCourse);
    setUndo({ previous: { ...selected }, letter });
    applySchedule(schedule.byCourse, goalForWeights(schedulePreferences.weights));
    setPreview(null);
    toast(moved.length === 0 ? `Using option ${letter}` : `Using option ${letter} · ${moved.length} course${moved.length === 1 ? "" : "s"} moved`);
  };

  const relax = (suggestion: RelaxSuggestion) => {
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
  const walking = useMemo(() => summarizeWeeklyWalking(scheduleEvents), [scheduleEvents]);
  const earliest = events.length ? Math.min(...events.map((e) => e.start)) : null;
  const latest = events.length ? Math.max(...events.map((e) => e.end)) : null;
  const longest = weekDays
    .map((day) => {
      const list = events.filter((e) => e.day === day);
      return { day, span: list.length ? Math.max(...list.map((e) => e.end)) - Math.min(...list.map((e) => e.start)) : 0 };
    })
    .sort((a, b) => b.span - a.span)[0];
  const daysOnCampus = new Set(events.map((e) => e.day)).size;

  const ghosts = preview ? eventsFor(Object.fromEntries(movedCourses(selected, preview.byCourse).map((code) => [code, preview.byCourse[code]]))) : [];
  const dimmed = preview ? movedCourses(selected, preview.byCourse) : [];

  const pickerCourseInfo = pickerCourse ? getCourseByCode(pickerCourse) : undefined;
  const pickerSections = pickerCourse ? getSectionsForCourse(pickerCourse) : [];
  const excluded = new Set(schedulePreferences.constraints.excludedSections);

  return (
    <NavShell step={1} back={{ href: "/courses", label: "Courses" }} next={{ href: "/map", label: "Generate map" }}>
      <div className={styles.page}>
        <header className={styles.viewhead}>
          <h1 className={styles.viewheadTitle}>Week</h1>
          <span className={styles.meta}>
            {credits} credits · {activeCourseCodes.length} course{activeCourseCodes.length === 1 ? "" : "s"}
          </span>
          <span className={styles.tag} title="Sections, times, rooms and instructors are synthetic samples.">
            Sample sections
          </span>
        </header>

        <PlannerSampleNotice compact />
        <PlannerPersistencePanel />

        <div className={styles.body}>
          <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
            <ConstraintRail
              preferences={schedulePreferences}
              onChange={setSchedulePreferences}
              onOptimize={optimizeNow}
              running={running}
              dirty={dirty}
            />

            <section className={styles.railSection} aria-labelledby="in-plan-title">
              <h2 className={styles.railHeading} id="in-plan-title">
                In this plan
              </h2>
              <div className={styles.inPlan}>
                {selectedSections.length > 0 ? (
                  <>
                    <p className={styles.meta} style={{ margin: "0 0 6px" }}>
                      Locked sections stay put when you optimize.
                    </p>
                    <ScheduleSectionLocks />
                  </>
                ) : (
                  <p className={styles.meta} style={{ margin: 0 }}>
                    Nothing planned yet. Mark courses as Taking on the Courses step.
                  </p>
                )}
              </div>
            </section>

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
                    {Math.round(walking.knownSeconds / 60)}
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
              <p className={styles.meta} style={{ margin: 0 }}>
                Walking is estimated from straight-line distance.
                {walking.unknownLegs > 0 ? ` ${walking.unknownLegs} walk${walking.unknownLegs === 1 ? "" : "s"} could not be estimated and ${walking.unknownLegs === 1 ? "is" : "are"} not counted.` : ""}
              </p>
            </section>

            <PlannerExportPanel />
          </div>

          <div className={styles.main}>
            {conflicts.size > 0 ? (
              <p className={styles.notice} role="alert">
                Two of your sections overlap. Optimize week, or select a red class to swap its section.
              </p>
            ) : null}
            {unscheduled.length > 0 ? (
              <p className={styles.notice} role="status" style={{ background: "var(--surface-2, #eef2ee)" }}>
                No section data yet for {unscheduled.map((course) => course.code).join(", ")}. It is left out of the week and the
                optimizer.
              </p>
            ) : null}
            {undo ? (
              <p className={styles.meta} role="status" style={{ margin: 0 }}>
                Using option {undo.letter}.{" "}
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    applySchedule(undo.previous);
                    setUndo(null);
                    toast("Restored your previous schedule");
                  }}
                >
                  Undo
                </button>
              </p>
            ) : null}

            {run && !running ? (
              <AlternativesCompare
                result={run.result}
                current={selected}
                courseOrder={activeCourseCodes}
                onUse={pickSchedule}
                onPreview={setPreview}
                onRelax={relax}
                onClose={() => {
                  setRun(null);
                  setPreview(null);
                }}
              />
            ) : null}

            <WeekGrid
              events={events}
              courseOrder={activeCourseCodes}
              lockedSections={locks}
              conflictSections={conflicts}
              ghosts={ghosts}
              dimmedCourses={dimmed}
              onSelect={(code, origin) => {
                setPickerOrigin(origin);
                setPickerCourse(code);
              }}
            />
          </div>
        </div>
      </div>

      <Modal
        open={pickerCourse !== null}
        onClose={() => setPickerCourse(null)}
        origin={pickerOrigin}
        title={
          <div>
            <p className={styles.railHeading}>
              Swap section
              <SampleTag />
            </p>
            <h2 style={{ margin: "4px 0 0", font: "700 20px/24px var(--font-display, Syne, sans-serif)", color: "var(--brand, #00512b)" }}>
              {pickerCourseInfo?.code}
            </h2>
            <p className={styles.meta} style={{ margin: "2px 0 0" }}>
              {pickerCourseInfo?.title}
            </p>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 6 }}>
          {pickerSections.map((section) => {
            const others = selectedSections.filter((s) => s.courseCode !== section.courseCode);
            const clash = sectionConflicts(section, others);
            const current = selected[section.courseCode] === section.id;
            const skipped = excluded.has(section.id);
            return (
              <div
                key={section.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  alignItems: "center",
                  padding: "8px 10px",
                  border: `1px solid ${current ? "var(--brand, #00512b)" : "var(--line, #dde8dd)"}`,
                  background: current ? "var(--brand-soft, #e4f0e8)" : "var(--surface, #fff)",
                  borderRadius: 10,
                }}
              >
                <button
                  type="button"
                  disabled={clash || current}
                  onClick={() => {
                    setSection(section.courseCode, section.id);
                    setPickerCourse(null);
                    toast(`Section updated · ${section.courseCode}`);
                  }}
                  style={{ textAlign: "left", border: 0, background: "none", padding: 0, cursor: clash || current ? "default" : "pointer", font: "inherit", color: "inherit" }}
                >
                  <span style={{ display: "block", fontWeight: 600 }}>
                    §{sectionNumber(section.id)} · {patternOf(section)}
                  </span>
                  <span className={styles.meta} style={{ display: "block", color: clash ? "var(--danger, #b3261e)" : undefined }}>
                    {section.professor} · ★ {section.rating.toFixed(1)}
                    {current ? " · current section" : clash ? " · overlaps another class" : ""}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={skipped}
                  onClick={() =>
                    setSchedulePreferences((p) => ({
                      ...p,
                      constraints: {
                        ...p.constraints,
                        excludedSections: skipped
                          ? p.constraints.excludedSections.filter((id) => id !== section.id)
                          : [...p.constraints.excludedSections, section.id],
                      },
                    }))
                  }
                >
                  Skip<span className={styles.srOnly}> section {sectionNumber(section.id)} when optimizing</span>
                </button>
              </div>
            );
          })}
        </div>
      </Modal>
    </NavShell>
  );
}
