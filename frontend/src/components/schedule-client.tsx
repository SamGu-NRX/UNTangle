"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { PlannerExportPanel } from "@/components/planner-export-panel";
import { PlannerPersistencePanel } from "@/components/planner-persistence-panel";
import { ScheduleSectionLocks } from "@/components/schedule-section-locks";
import { AlternativesCompare } from "@/components/schedule/AlternativesCompare";
import { ConstraintRail } from "@/components/schedule/ConstraintRail";
import { SampleNote } from "@/components/schedule/SampleNote";
import { SectionsTag, summarizeProvenance } from "@/components/sections-provenance";
import { WeekGrid } from "@/components/schedule/WeekGrid";
import {
  canApply,
  isStale,
  locksKey,
  requestKey,
  undoAvailable,
  type UndoSnapshot,
} from "@/components/schedule/run-state";
import styles from "@/components/schedule/schedule.module.css";
import { useMediaQuery, useOptimizerRuns } from "@/components/schedule/use-optimizer";
import {
  clock,
  eventsFor,
  firstClash,
  movedCourses,
  patternOf,
  type FindOption,
} from "@/components/schedule/week-model";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Dialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toast";
import { goalForWeights } from "@/lib/optimizer/presets";
import type { OptimizeResult, RankedSchedule, RelaxSuggestion } from "@/lib/optimizer/types";
import { toPlainRequest } from "@/lib/optimizer/worker/protocol";
import { plannerTravelTime, SHUTTLE_SECONDS, summarizeWeeklyWalking } from "@/lib/planner-walking";
import {
  buildOptimizeRequest,
  getPlanningTermCourseCodes,
  heldOutCourses,
  getCourseByCode,
  hiddenOptions,
  summarizeCredits,
  type PlannedCourse,
} from "@/lib/planner";
import {
  findOption,
  isCandidate,
  isTimed,
  optionIdLabel,
  optionLabel,
  optionsConflict,
  planningTerm,
  rangeLabel,
  sectionRef,
  untimedMeetings,
} from "@/lib/planner-sections";
import type { Section } from "@/lib/sections";
import { classDays } from "@/lib/types";

/** The shell's phone breakpoint (shell.css). */
const PHONE = "(max-width: 719px)";

function overlapping(selected: Section[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      if (optionsConflict(selected[i], selected[j])) {
        ids.add(selected[i].id);
        ids.add(selected[j].id);
      }
    }
  }
  return ids;
}

/** Why a saved pick is flagged, in one sentence; null when it is not. */
function reviewNote(course: PlannedCourse): string | null {
  if (course.state === "sample-pick") {
    return `${course.code} §${optionIdLabel(course.savedId!)} is a sample section, not a real ${planningTerm.label} class.`;
  }
  if (course.state !== "needs-review") return null;
  const saved = optionIdLabel(course.savedId!);
  const ref = sectionRef(course.savedId!);
  if (ref.provenance === "real" && course.result?.provenance.kind === "sample") {
    return `${course.code} ${saved} can't be checked: ${planningTerm.label} sections didn't load.`;
  }
  if (ref.provenance === "real" && ref.term !== planningTerm.id) return `${course.code} ${saved} is from another term.`;
  return `${course.code} ${saved} is no longer offered in ${planningTerm.label}.`;
}

/** "12 of 28 open", "Closed", "Wait list" for a real option; nothing for a sample, which has no seats. */
function seatsNote(section: Section): string | null {
  if (section.term === null) return null;
  if (section.status === "closed") return "Closed";
  if (section.status === "waitlist") return "Wait list";
  if (section.status === "cancelled") return "Cancelled";
  const { open, total } = section.seats;
  return open !== null && total !== null ? `${open} of ${total} open` : null;
}

export function ScheduleClient() {
  const {
    plannerState,
    sectionPlan,
    sectionCatalog,
    catalogVersion,
    loadSections,
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

  const activeCourseCodes = useMemo(() => getPlanningTermCourseCodes(plannerState), [plannerState]);
  const selected = plannerState.selectedSections;
  const find = useMemo<FindOption>(
    () => (courseCode, optionId) => findOption(sectionCatalog, courseCode, optionId) ?? undefined,
    // catalogVersion is how the catalog says it has more loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sectionCatalog, catalogVersion],
  );
  const selectedSections = useMemo(
    () => sectionPlan.courses.flatMap((course) => (course.section ? [course.section] : [])),
    [sectionPlan],
  );
  const events = useMemo(() => eventsFor(selected, find), [selected, find]);
  const conflicts = useMemo(() => overlapping(selectedSections), [selectedSections]);
  const locks = useMemo(() => plannerState.lockedSections ?? {}, [plannerState.lockedSections]);
  const loadingCourses = sectionPlan.courses.filter((course) => course.state === "loading");
  const review = sectionPlan.courses.filter((course) => course.state === "sample-pick" || course.state === "needs-review");
  const unplaceable = sectionPlan.courses.filter((course) => ["choose", "not-offered", "no-data"].includes(course.state));
  const untimed = sectionPlan.courses.flatMap((course) =>
    course.section ? untimedMeetings(course.section).map((meeting) => ({ course: course.code, section: course.section!, meeting })) : [],
  );
  const showsSample = selectedSections.some((section) => section.term === null);
  const lockUnavailable = new Set(
    heldOutCourses(plannerState, sectionCatalog, schedulePreferences.constraints)
      .filter((course) => course.reason === "lock-unavailable")
      .map((course) => course.code),
  );
  const filter = schedulePreferences.constraints;
  const hidden = hiddenOptions(sectionPlan, filter);
  const hiddenNote = [
    ...[...hidden.sites].map(([site, count]) => `${count} ${site} section${count === 1 ? "" : "s"}`),
    hidden.full > 0 ? `${hidden.full} full section${hidden.full === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const provenance = summarizeProvenance(
    sectionPlan.courses.flatMap((course) => (course.result ? [course.result] : [])),
    showsSample,
  );
  // The request Optimize would send now; a shown result computed from another request is stale.
  const request = useMemo(
    () => buildOptimizeRequest(plannerState, schedulePreferences, { catalog: sectionCatalog }),
    // catalogVersion is how the catalog says it has more loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plannerState, schedulePreferences, sectionCatalog, catalogVersion],
  );
  const inputKey = requestKey(request);
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
      startRun(toPlainRequest(request), inputKey);
    },
    [inputKey, request, startRun],
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
    const check = canApply(run, inputKey, schedule, locks, (merged) => firstClash(merged, find), selected);
    if (!check.ok) {
      setPickProblem(check.reason);
      return;
    }
    const moved = movedCourses(selected, schedule.byCourse, find);
    setUndo({ sections: { ...selected }, goal: plannerState.optimization, letter, epoch: planEpoch, locks: currentLocks });
    applySchedule(schedule.byCourse, goalForWeights(schedulePreferences.weights));
    setPreview(null);
    setPickProblem(null);
    toast(moved.length === 0 ? `Using option ${letter}` : `Using option ${letter}, ${moved.length} course${moved.length === 1 ? "" : "s"} moved`);
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
  const walking = useMemo(() => summarizeWeeklyWalking(scheduleEvents, plannerTravelTime), [scheduleEvents]);
  const walkMinutes = Math.round(walking.knownSeconds / 60);
  const earliest = events.length ? Math.min(...events.map((e) => e.start)) : null;
  const latest = events.length ? Math.max(...events.map((e) => e.end)) : null;
  const longest = classDays
    .map((day) => {
      const list = events.filter((e) => e.day === day);
      return { day, span: list.length ? Math.max(...list.map((e) => e.end)) - Math.min(...list.map((e) => e.start)) : 0 };
    })
    .sort((a, b) => b.span - a.span)[0];
  const daysOnCampus = new Set(events.map((e) => e.day)).size;

  const shownPreview = preview && preview.result === run.result && !stale ? preview.schedule : null;
  const movedInPreview = shownPreview ? movedCourses(selected, shownPreview.byCourse, find) : [];
  const ghosts = shownPreview
    ? eventsFor(Object.fromEntries(movedInPreview.map((code) => [code, shownPreview.byCourse[code]])), find)
    : [];
  // The grid's hours cover the plan and every shown option, so previewing one never moves the others.
  const rangeEvents = useMemo(
    () => (run.result && !stale ? [...events, ...run.result.schedules.flatMap((schedule) => eventsFor(schedule.byCourse, find))] : events),
    [events, find, run.result, stale],
  );

  const pickerCourseInfo = pickerCourse ? getCourseByCode(pickerCourse) : undefined;
  const pickerOptions = pickerCourse ? sectionCatalog(pickerCourse) : null;
  const pickerSections = pickerOptions?.status === "ready" ? pickerOptions.result.sections : [];
  useEffect(() => {
    if (pickerCourse) loadSections([pickerCourse]);
  }, [loadSections, pickerCourse]);
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
      {walking.shuttleLegs > 0
        ? ` ${walking.shuttleLegs} trip${walking.shuttleLegs === 1 ? "" : "s"} between main campus and Discovery Park ${walking.shuttleLegs === 1 ? "is a" : "are each a"} ${SHUTTLE_SECONDS / 60} min shuttle (an estimate), not counted as walking.`
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
      {pickerOptions?.status === "loading" ? (
        <p className={styles.meta} role="status">
          Loading {planningTerm.label} sections…
        </p>
      ) : pickerSections.length === 0 ? (
        <p className={styles.meta}>
          {pickerOptions?.status === "ready" && pickerOptions.result.availability === "no_classes"
            ? `Not offered in ${planningTerm.label}.`
            : "No sections for this course."}
        </p>
      ) : null}
      {pickerSections.map((section) => {
        const others = selectedSections.filter((s) => s.courseCode !== section.courseCode);
        const clash = others.some((other) => optionsConflict(section, other));
        const seats = seatsNote(section);
        const dates = rangeLabel(section.session.dates);
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
                // The button that opened the picker may be gone (a Needs review entry): land on the view's heading.
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    if (document.activeElement === document.body) document.getElementById("week-title")?.focus();
                  }),
                );
                toast(`${section.courseCode} section updated`);
              }}
            >
              <span className={styles.sectionPickLine}>
                §{optionLabel(section)}, {patternOf(section)}
              </span>
              <span className={styles.meta} data-clash={clash ? "true" : "false"}>
                {[
                  section.instructor.display ?? "Instructor not listed",
                  [...new Set(section.meetings.map((meeting) => meeting.room))].join(", "),
                  section.term !== null && section.session.label !== "Regular Academic Session" ? dates : null,
                  seats,
                ]
                  .filter(Boolean)
                  .join(", ")}
                {current ? ", current section" : clash ? ", overlaps another class" : ""}
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
              Skip<span className={styles.srOnly}> section {optionLabel(section)} when optimizing</span>
            </Chip>
          </div>
        );
      })}
    </div>
  );

  const pickerTitle = pickerCourseInfo ? `Swap ${pickerCourseInfo.code} section` : "Swap section";

  return (
    <div className={`shell-content ${styles.page}`}>
      <header className={styles.viewhead}>
        <h1 className={styles.viewheadTitle} id="week-title" tabIndex={-1}>
          Week
        </h1>
        <span className={styles.meta}>
          {phone ? `${credits} cr` : `${credits} credits in ${activeCourseCodes.length} course${activeCourseCodes.length === 1 ? "" : "s"}`}
        </span>
        <SectionsTag provenance={provenance} compact={phone} />
        <span className={styles.spacer} />
        {phone ? (
          <Button size="sm" onClick={() => setSheetOpen(true)} loading={running} loadingLabel="Optimizing…" aria-haspopup="dialog">
            Optimize
          </Button>
        ) : null}
      </header>

      {showsSample ? <SampleNote /> : null}
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
          {/* One live region, mounted from the start, so loading and its outcome are announced. */}
          <p className={styles.srOnly} role="status">
            {loadingCourses.length > 0
              ? `Loading ${planningTerm.label} sections.`
              : review.length > 0
                ? `${review.length} course${review.length === 1 ? " needs" : "s need"} review.`
                : ""}
          </p>
          {loadingCourses.length > 0 ? (
            <p className={`${styles.notice} ${styles.noticeQuiet}`}>
              Loading {planningTerm.label} sections for {loadingCourses.map((course) => course.code).join(", ")}…
            </p>
          ) : null}
          {review.length > 0 ? (
            <div className={`${styles.notice} ${styles.noticeQuiet}`} aria-labelledby="review-title">
              <p id="review-title">
                <strong>Needs review.</strong>{" "}
                {review.some((course) => course.state === "sample-pick") ? "Pick real sections for these courses." : "Pick a current section."}
              </p>
              <ul className={styles.statusList}>
                {review.map((course) => (
                  <li key={course.code}>
                    {reviewNote(course)}
                    {lockUnavailable.has(course.code) ? " It is locked, so Optimize leaves the course as it is." : ""}{" "}
                    <Button variant="link" size="sm" onClick={() => setPickerCourse(course.code)}>
                      {course.state === "sample-pick" ? "Pick real section" : "Pick a section"}
                      <span className={styles.srOnly}> for {course.code}</span>
                    </Button>
                    {lockUnavailable.has(course.code) ? (
                      <Button variant="link" size="sm" onClick={() => setSectionLock(course.code, false)}>
                        Unlock<span className={styles.srOnly}> {course.code}</span>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {unplaceable.length > 0 ? (
            <ul className={`${styles.notice} ${styles.noticeQuiet} ${styles.statusList}`} aria-label="Courses not on the week">
              {unplaceable.map((course) => (
                <li key={course.code}>
                  {course.state === "not-offered"
                    ? `${course.code} isn't offered in ${planningTerm.label}.`
                    : course.state === "no-data"
                      ? `No sections for ${course.code}.`
                      : !course.result?.sections.some((section) => section.meetings.some(isTimed))
                        ? `${course.code} has no section with a set time.`
                        : course.result.sections.some((section) => section.meetings.some(isTimed) && isCandidate(section, filter))
                          ? `No section of ${course.code} fits around your other classes.`
                          : `Every section of ${course.code} with a set time is hidden from suggestions.`}
                  {course.state === "choose" ? (
                    <>
                      {" "}
                      <Button variant="link" size="sm" onClick={() => setPickerCourse(course.code)}>
                        Pick a section<span className={styles.srOnly}> for {course.code}</span>
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {hiddenNote.length > 0 ? (
            <p className={styles.meta}>
              Hidden from suggestions: {hiddenNote.join(", ")}. You can still pick them.{" "}
              {hidden.sites.size > 0 ? (
                <Button variant="link" size="sm" onClick={() => setSchedulePreferences((p) => ({ ...p, constraints: { ...p.constraints, otherSites: true } }))}>
                  Include other UNT sites
                </Button>
              ) : null}
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
            find={find}
            tag={<SectionsTag provenance={provenance} compact />}
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
            label={`Week calendar${provenance?.kind === "sample" ? " (sample sections)" : ""}`}
          />

          {untimed.length > 0 ? (
            <section className={styles.noSetTime} aria-labelledby="no-set-time-title">
              <h2 className={styles.railHeading} id="no-set-time-title">
                No set time
              </h2>
              <ul className={styles.statusList}>
                {untimed.map(({ course, section, meeting }, index) => (
                  <li key={`${course}-${index}`}>
                    <Button variant="link" size="sm" onClick={() => setPickerCourse(course)}>
                      {course} §{optionLabel(section)}
                    </Button>{" "}
                    {meeting.async ? "is online with no set time" : `meets ${meeting.day ? `on ${meeting.day}` : "on a day"} at a time to be announced`}
                    {meeting.kind === "building" || meeting.kind === "unknown" ? ` in ${meeting.room}` : ""}
                  </li>
                ))}
              </ul>
              <p className={styles.meta}>These aren&rsquo;t on the week, so they aren&rsquo;t checked for conflicts.</p>
            </section>
          ) : null}
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
