"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { getMajorById } from "@/lib/planner";
import { defaultPlannerState, majors } from "@/lib/seed-data";
import type { MajorId } from "@/lib/types";
import styles from "./courses.module.css";
import { CloseIcon, OpenCourseContext, ProvenanceTag, SearchIcon } from "./bits";
import { BottomSheet } from "./BottomSheet";
import { CourseList, type RowActions } from "./CourseList";
import { DetailContent, type PanelActions } from "./DetailPanel";
import { PHONE_QUERY, useMediaQuery, usePresence, useStickyTop, useStoredState } from "./hooks";
import { Listbox, type ListboxHandle } from "./Listbox";
import { Menu, type MenuItem } from "./Menu";
import { computeAuto, describeAuto, undoChanges, type StatusChange } from "./model/auto";
import { buildCourseModel, buildGroups, isFinished, statusLabels, type CourseRowModel } from "./model/course-model";
import { SAMPLE_TRANSCRIPT_LABEL, sampleTranscript } from "./model/sample-transcript";
import { instructorIndex } from "./model/search";
import { untProfile } from "./school";
import { SearchPalette } from "./SearchPalette";

type AutoRun = {
  text: string;
  changes: StatusChange[];
  needsCheck: string[];
  previousAutoPlanned: string[];
};

const majorOptions = majors.map((major) => ({ value: major.id, label: major.name, meta: major.department === "—" ? undefined : major.department }));

/** Seed demo statuses a fresh guest inherits; cleared when they start their own plan. */
const seedDemo = Object.entries(defaultPlannerState.courseStatuses).filter(([, status]) => status !== "notTaken");

export function CoursesView({
  initialCourseId = null,
  initialInstructor = null,
}: {
  initialCourseId?: string | null;
  initialInstructor?: string | null;
}) {
  const profile = useMemo(() => untProfile(), []);
  const {
    hydrated,
    plannerState,
    scheduleEvents,
    setCourseStatus,
    setSelectedMajor,
    applyTranscriptRecords,
    setSection,
  } = usePlanner();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const stickyTop = useStickyTop();

  const [autoPlanned, setAutoPlanned] = useStoredState<string[]>("untangle.courses.auto-planned.v1", []);
  const [collapsed, setCollapsed] = useStoredState<Record<string, boolean>>("untangle.courses.groups.v1", {});
  const [startedByHand, setStartedByHand] = useStoredState<boolean>("untangle.courses.started.v1", false);
  const [selectedId, setSelectedId] = useState<string | null>(initialCourseId);
  const [panelOpen, setPanelOpen] = useState(initialCourseId !== null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [lastAuto, setLastAuto] = useState<AutoRun | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const desktopMajor = useRef<ListboxHandle>(null);
  const phoneMajor = useRef<ListboxHandle>(null);

  const autoSet = useMemo(() => new Set(autoPlanned), [autoPlanned]);
  const model = useMemo(
    () =>
      buildCourseModel(profile, {
        statuses: plannerState.courseStatuses,
        transcript: plannerState.transcriptRecords,
        autoPlanned: autoSet,
      }),
    [profile, plannerState.courseStatuses, plannerState.transcriptRecords, autoSet],
  );
  const major = getMajorById(plannerState.selectedMajor);
  const coreIds = useMemo(() => major?.coreCourseCodes ?? [], [major]);
  const groups = useMemo(() => buildGroups(model, coreIds, major?.department ?? null), [model, coreIds, major]);
  const resolvedCollapsed = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const group of groups) {
      const open = group.key === "core" || group.key === `dept:${major?.department}`;
      result[group.key] = collapsed[group.key] ?? !open;
    }
    return result;
  }, [groups, collapsed, major]);
  const coreDone = coreIds.filter((id) => {
    const row = model.rows.get(id);
    return row ? isFinished(row) : false;
  }).length;

  const searchCourses = useMemo(() => [...model.rows.values()].map((row) => ({ id: row.id, title: row.title })), [model]);
  const instructors = useMemo(() => instructorIndex(profile.catalog.flatMap((course) => profile.sections(course.id))), [profile]);

  const untouched =
    !model.hasTranscript &&
    Object.entries(plannerState.courseStatuses).every(
      ([code, status]) => status === (defaultPlannerState.courseStatuses[code] ?? "notTaken"),
    );
  const idle = hydrated && untouched && !startedByHand;
  const sampleOnly = model.hasTranscript && plannerState.transcriptRecords.every((record) => record.id.startsWith("sample-"));

  const say = (text: string) => setAnnouncement(text);

  const openCourse = useCallback((id: string) => {
    setSelectedId(id);
    setPanelOpen(true);
  }, []);
  const [paletteInstructor, setPaletteInstructor] = useState<{ id: string; name: string } | null>(null);

  const forgetAuto = (id: string) => setAutoPlanned((list) => (list.includes(id) ? list.filter((value) => value !== id) : list));

  const plan = (id: string) => {
    setCourseStatus(id, "inProgress");
    say(`Planned ${id} for ${profile.planningTerm}.`);
  };
  const unplan = (id: string) => {
    setCourseStatus(id, "notTaken");
    forgetAuto(id);
    say(`Removed ${id} from the plan.`);
  };

  const rowActions: RowActions = {
    open: openCourse,
    plan,
    unplan,
    resetOverride: (id) => {
      setCourseStatus(id, "notTaken");
      forgetAuto(id);
      say(`Reset ${id} to its inferred status.`);
    },
  };

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    const id = selectedId;
    if (id) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row-open="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
  }, [selectedId]);

  const panelActions: PanelActions = {
    plan,
    unplan,
    markDone: (id) => {
      setCourseStatus(id, "completed");
      forgetAuto(id);
      say(`Marked ${id} done.`);
    },
    clearDone: (id) => {
      setCourseStatus(id, "notTaken");
      say(`Removed your done mark from ${id}.`);
    },
    chooseSection: (id, sectionId) => {
      if (model.rows.get(id)?.status !== "planned") setCourseStatus(id, "inProgress");
      setSection(id, sectionId);
      say(`Using section ${sectionId.split("-").at(-1)} of ${id}.`);
    },
    close: closePanel,
  };

  const clearSeedDemo = () => {
    for (const [code, status] of seedDemo) {
      if (plannerState.courseStatuses[code] === status) setCourseStatus(code, "notTaken");
    }
  };

  const openMajorPicker = () => (isPhone ? phoneMajor : desktopMajor).current?.open();

  const runAuto = () => {
    if (!major) {
      say("Choose your major first; Auto-fill plans from its core courses.");
      openMajorPicker();
      return;
    }
    const outcome = computeAuto(model, plannerState.courseStatuses, coreIds, profile.autoCreditBudget);
    for (const change of outcome.changes) setCourseStatus(change.id, change.to);
    const previousAutoPlanned = autoPlanned;
    setAutoPlanned([...autoPlanned.filter((id) => !outcome.unplanned.includes(id)), ...outcome.planned]);
    const text = describeAuto(outcome, model.hasTranscript, profile.planningTerm);
    setLastAuto({ text, changes: outcome.changes, needsCheck: outcome.needsCheck, previousAutoPlanned });
    say(text);
  };

  const undoAuto = () => {
    if (!lastAuto) return;
    for (const change of undoChanges(lastAuto.changes)) setCourseStatus(change.id, change.to);
    setAutoPlanned(lastAuto.previousAutoPlanned);
    setLastAuto(null);
    say("Auto-fill undone. Your plan is back to how it was.");
  };

  const clearAutoPlan = () => {
    const ids = autoPlanned.filter((id) => plannerState.courseStatuses[id] === "inProgress");
    for (const id of ids) setCourseStatus(id, "notTaken");
    setAutoPlanned([]);
    setLastAuto(null);
    say(ids.length ? `Removed ${ids.length} auto-planned course${ids.length === 1 ? "" : "s"}.` : "Nothing was auto-planned.");
  };

  const trySample = () => {
    clearSeedDemo();
    applyTranscriptRecords(sampleTranscript);
    setStartedByHand(true);
    say("Added the sample transcript. Press Auto-fill to plan from it.");
  };

  const pickByHand = () => {
    clearSeedDemo();
    setStartedByHand(true);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-row-open]")?.focus());
  };

  const togglePlanFromPalette = (id: string) => {
    const row = model.rows.get(id);
    if (!row) return "";
    if (row.status === "available" || row.status === "check") {
      plan(id);
      return `Planned ${id} for ${profile.planningTerm}.`;
    }
    if (row.status === "planned") {
      unplan(id);
      return `Removed ${id} from the plan.`;
    }
    return `${id} is ${statusLabels[row.status].toLowerCase()}. Press Enter to see why.`;
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === "Escape" && panelOpen && !paletteOpen && !isPhone && !event.defaultPrevented) {
        const inPopover = (event.target as HTMLElement | null)?.closest?.('[role="menu"], [aria-expanded="true"]');
        if (!inPopover) closePanel();
      }
    };
    // The app shell's search trigger can open this palette without importing it.
    const onOpenSearch = () => setPaletteOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("untangle:open-search", onOpenSearch);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("untangle:open-search", onOpenSearch);
    };
  }, [panelOpen, paletteOpen, isPhone, closePanel]);

  // selectedId is never cleared, so the panel keeps its course while it slides out.
  const panelRow = selectedId ? model.rows.get(selectedId) : undefined;
  const desktopPresence = usePresence(panelOpen && !isPhone && panelRow !== undefined, 150);

  const instructorForPanel =
    paletteInstructor && paletteInstructor.id === selectedId
      ? paletteInstructor.name
      : selectedId === initialCourseId
        ? initialInstructor
        : null;

  const content = (row: CourseRowModel, showClose: boolean) => (
    <DetailContent
      key={`${row.id}|${instructorForPanel ?? ""}`}
      row={row}
      profile={profile}
      inCore={coreIds.includes(row.id)}
      selectedSectionId={plannerState.selectedSections[row.id]}
      scheduleEvents={scheduleEvents}
      initialInstructor={instructorForPanel}
      actions={panelActions}
      showClose={showClose}
    />
  );

  const autoItems: MenuItem[] = [
    { key: "import", label: "Import a transcript PDF", href: "/courses/import" },
    ...(model.hasTranscript ? [] : [{ key: "sample", label: "Try the sample transcript", onSelect: trySample }]),
    ...(autoPlanned.length > 0 ? [{ key: "clear", label: "Clear the auto plan", onSelect: clearAutoPlan }] : []),
  ];

  const autoControl = (small: boolean) => (
    <div className={styles.split}>
      <button type="button" className={`${styles.btn} ${styles.primary} ${small ? styles.sm : ""}`} onClick={runAuto}>
        <span className={styles.spark} aria-hidden="true">
          ✦
        </span>
        Auto-fill
      </button>
      <Menu
        label="More Auto-fill options"
        items={autoItems}
        triggerClassName={`${styles.btn} ${styles.primary} ${styles.splitCaret} ${small ? styles.sm : ""}`}
        trigger={
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        }
      />
    </div>
  );

  const majorPicker = (ref: React.Ref<ListboxHandle>) => (
    <Listbox
      ref={ref}
      label="Major"
      variant="title"
      options={majorOptions}
      value={plannerState.selectedMajor}
      onChange={(value) => {
        setSelectedMajor(value as MajorId);
        say(`Major set to ${getMajorById(value as MajorId)?.name}.`);
      }}
      placeholder="Choose your major"
    />
  );

  const openSearch = () => setPaletteOpen(true);
  const pct = coreIds.length ? coreDone / coreIds.length : 0;

  return (
    <OpenCourseContext.Provider value={openCourse}>
      <div
        className={`${styles.tokens} ${styles.root}`}
        data-panel={desktopPresence.mounted ? "open" : "closed"}
        style={{ ["--sticky-top" as string]: `${stickyTop}px` }}
      >
        <h1 className={styles.srOnly}>Courses</h1>
        <div className={styles.viewhead}>
          {majorPicker(desktopMajor)}
          {major && coreIds.length > 0 ? (
            <span className={styles.headMeta}>
              <span className={styles.meta}>
                {coreDone} of {coreIds.length} core done
              </span>
              <span className={styles.progress} aria-hidden="true">
                <i style={{ transform: `scaleX(${pct})` }} />
              </span>
            </span>
          ) : null}
          <span className={styles.spacer} />
          <button type="button" className={styles.searchTrigger} onClick={openSearch} aria-keyshortcuts="Meta+K Control+K">
            <SearchIcon />
            <span>Search courses</span>
            <kbd className={styles.kbd}>⌘K</kbd>
          </button>
          {autoControl(false)}
          <Link href="/courses/import" className={`${styles.btn} ${styles.ghost}`}>
            Import PDF
          </Link>
        </div>

        <div className={styles.phoneHead}>
          <button type="button" className={`${styles.searchTrigger} ${styles.phoneSearch}`} onClick={openSearch}>
            <SearchIcon />
            <span>Search courses</span>
          </button>
          <div className={styles.phoneBar}>
            {majorPicker(phoneMajor)}
            <span className={styles.spacer} />
            {autoControl(true)}
          </div>
        </div>

        <div role="status" aria-live="polite">
          {lastAuto ? (
            <div className={styles.autonote} data-autonote>
              <span className={styles.spark} aria-hidden="true">
                ✦
              </span>
              <span className={styles.autonoteText}>{lastAuto.text}</span>
              {lastAuto.needsCheck.length > 0 ? (
                <button type="button" className={styles.link} onClick={() => openCourse(lastAuto.needsCheck[0])}>
                  {lastAuto.needsCheck.length === 1
                    ? "1 core course needs an advisor"
                    : `${lastAuto.needsCheck.length} core courses need an advisor`}{" "}
                  · Review
                </button>
              ) : null}
              <button type="button" className={styles.link} onClick={undoAuto}>
                Undo
              </button>
              <span className={styles.spacer} />
              {model.hasTranscript ? (
                <ProvenanceTag
                  title={sampleOnly ? "Statuses come from a made-up sample transcript." : "Statuses come from the transcript you imported."}
                >
                  {sampleOnly ? SAMPLE_TRANSCRIPT_LABEL : "From transcript"}
                </ProvenanceTag>
              ) : null}
              <button type="button" className={`${styles.btn} ${styles.iconBtn}`} aria-label="Dismiss note" onClick={() => setLastAuto(null)}>
                <CloseIcon />
              </button>
            </div>
          ) : null}
          <span className={styles.srOnly}>{announcement}</span>
        </div>

        <div className={styles.body}>
          <div className={styles.list} data-course-list>
            {!hydrated ? (
              <div style={{ display: "grid", placeItems: "center", padding: 64, color: "var(--c-ink-3)" }} aria-label="Loading your plan" role="status">
                <span className={styles.spinner} style={{ width: 20, height: 20 }} />
              </div>
            ) : idle ? (
              <EmptyState onSample={trySample} onByHand={pickByHand} />
            ) : (
              <CourseList
                groups={groups}
                rows={model.rows}
                selectedId={selectedId}
                collapsed={resolvedCollapsed}
                onToggleGroup={(key) => setCollapsed((current) => ({ ...current, [key]: !resolvedCollapsed[key] }))}
                onMove={(id) => setSelectedId(id)}
                actions={rowActions}
              />
            )}
          </div>
          {desktopPresence.mounted && panelRow ? (
            <div className={styles.panelCol}>
              <aside className={styles.panel} data-state={desktopPresence.state} aria-labelledby="course-panel-title">
                {content(panelRow, true)}
              </aside>
            </div>
          ) : null}
        </div>

        {isPhone && panelRow ? (
          <BottomSheet
            open={panelOpen && panelRow !== undefined}
            onClose={closePanel}
            label={`${panelRow.id} details`}
            className={styles.tokens}
          >
            {content(panelRow, true)}
          </BottomSheet>
        ) : null}

        <SearchPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          className={styles.tokens}
          courses={searchCourses}
          instructors={instructors}
          rows={model.rows}
          onOpenCourse={(id, instructor) => {
            setPaletteInstructor(instructor ? { id, name: instructor } : null);
            openCourse(id);
          }}
          onTogglePlan={togglePlanFromPalette}
        />
      </div>
    </OpenCourseContext.Provider>
  );
}

function EmptyState({ onSample, onByHand }: { onSample: () => void; onByHand: () => void }) {
  return (
    <section className={styles.empty} aria-labelledby="empty-title">
      <h2 className={styles.emptyTitle} id="empty-title">
        Start with what you&apos;ve taken
      </h2>
      <Link href="/courses/import" className={styles.emptyOption} data-primary="true">
        <span>
          <strong>Import your transcript</strong>
          <span className={styles.meta}>Upload the unofficial transcript PDF from myUNT.</span>
        </span>
      </Link>
      <button type="button" className={styles.emptyOption} onClick={onSample}>
        <span>
          <strong>Try a sample transcript</strong>
          <span className={styles.meta}>A made-up first year in Computer Science, to see what Auto-fill does.</span>
        </span>
      </button>
      <button type="button" className={styles.emptyOption} onClick={onByHand}>
        <span>
          <strong>Pick courses by hand</strong>
          <span className={styles.meta}>Browse the catalog and plan courses yourself.</span>
        </span>
      </button>
    </section>
  );
}
