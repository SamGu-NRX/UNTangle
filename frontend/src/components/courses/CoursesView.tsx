"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { useShell, useShellSearch, type ShellSearchProvider } from "@/components/shell/shell-context";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button, IconButton, SplitButton } from "@/components/ui/Button";
import { Close } from "@/components/ui/icons";
import type { MenuEntry } from "@/components/ui/Menu";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { SearchTrigger } from "@/components/ui/SearchField";
import type { SearchItem } from "@/components/ui/SearchPalette";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { usePresence } from "@/components/ui/use-presence";
import { getMajorById, getPlanningTermCourseCodes } from "@/lib/planner";
import { optionIdLabel, optionLabel } from "@/lib/planner-sections";
import { majors } from "@/lib/seed-data";
import type { CoursePlan, CourseStatus, MajorId } from "@/lib/types";
import styles from "./courses.module.css";
import { CourseNavigationContext, type CourseNavigation } from "./bits";
import { CourseList, type RowActions } from "./CourseList";
import { DetailContent, type PanelActions } from "./DetailPanel";
import { PHONE_QUERY, useMediaQuery } from "./hooks";
import { computeAuto, describeAuto, undoBlocker } from "./model/auto";
import { applyAuto, manualEdit, undoAuto as undoAutoUpdate } from "./model/plan-edits";
import { buildCourseModel, buildGroups, isFinished, statusLabels, type CourseRowModel } from "./model/course-model";
import { onlyCheckable, ruleCourseIds } from "./model/rules";
import { SAMPLE_TRANSCRIPT_LABEL, sampleTranscript } from "./model/sample-transcript";
import { instructorIndex, searchCatalog } from "./model/search";
import { untProfile } from "./school";

const majorOptions = majors.map((major) => ({
  value: major.id,
  label: major.name,
  meta: major.department === "—" ? undefined : major.department,
}));
const MAJOR_TRIGGER = { desktop: "courses-major-desktop", phone: "courses-major-phone" };
const INSTRUCTOR_ITEM = "instructor:";
/** Phone sheet detents: half and nearly full; it opens nearly full. */
const SHEET_DETENTS = ["50%", "92%"] as const;

const without = (list: readonly string[], id: string) => list.filter((value) => value !== id);

/**
 * Opens the Connect sheet over Courses. Its owner listens for
 * `untangle:open-connect` and calls preventDefault() to claim the event;
 * when nothing claims it (the sheet is not mounted), go to the import route.
 */
export function openConnect(navigate: (href: string) => void) {
  const claimed = !window.dispatchEvent(new CustomEvent("untangle:open-connect", { cancelable: true }));
  if (!claimed) navigate("/courses/import");
}

function rowSummary(row: CourseRowModel | undefined): string {
  if (!row) return "";
  const label = statusLabels[row.status];
  if (row.status === "locked" || row.status === "check") {
    const needs = ruleCourseIds(onlyCheckable(row.unmet));
    return needs.length > 0 ? `${label}, needs ${needs.slice(0, 2).join(" and ")}` : label;
  }
  return label;
}

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
    sectionPlan,
    sectionCatalog,
    catalogVersion,
    loadSections,
    setSelectedMajor,
    applyTranscriptRecords,
    setSection,
    updateCoursePlan,
  } = usePlanner();
  const { openSearch } = useShell();
  const router = useRouter();
  const importTranscript = () => openConnect((href) => router.push(href));
  const isPhone = useMediaQuery(PHONE_QUERY);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(initialCourseId);
  const [panelOpen, setPanelOpen] = useState(initialCourseId !== null);
  const [paletteInstructor, setPaletteInstructor] = useState<{ id: string; name: string } | null>(null);
  const [sheetDetent, setSheetDetent] = useState(1);
  const [announcement, setAnnouncement] = useState("");

  const coursePlan: CoursePlan = plannerState.coursePlan ?? { manualCredit: [], autoPlanned: [], lastAuto: null };
  const planned = useMemo(() => new Set(getPlanningTermCourseCodes(plannerState)), [plannerState]);
  const manualCredit = useMemo(() => new Set(coursePlan.manualCredit), [coursePlan.manualCredit]);
  const autoPlanned = useMemo(() => new Set(coursePlan.autoPlanned), [coursePlan.autoPlanned]);
  const model = useMemo(
    () =>
      buildCourseModel(profile, {
        statuses: plannerState.courseStatuses,
        transcript: plannerState.transcriptRecords,
        planned,
        manualCredit,
        autoPlanned,
      }),
    [profile, plannerState.courseStatuses, plannerState.transcriptRecords, planned, manualCredit, autoPlanned],
  );
  const major = getMajorById(plannerState.selectedMajor);
  const coreIds = useMemo(() => major?.coreCourseCodes ?? [], [major]);
  const coreSet = useMemo(() => new Set(coreIds), [coreIds]);
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
  const coreCovered = coreIds.filter((id) => model.rows.get(id)?.status === "covered").length;

  const searchCourses = useMemo(() => [...model.rows.values()].map((row) => ({ id: row.id, title: row.title })), [model]);
  // Instructors of every course whose options have loaded: real ones, or the samples a fallback course shows.
  const instructors = useMemo(
    () =>
      instructorIndex(
        profile.catalog.flatMap((course) => {
          const options = sectionCatalog(course.id);
          return options.status === "ready" ? options.result.sections : [];
        }),
      ),
    // catalogVersion is how the catalog says it has more loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, sectionCatalog, catalogVersion],
  );

  const untouched =
    !model.hasTranscript && Object.values(plannerState.courseStatuses).every((status) => status === "notTaken");
  // The empty state stays until the student has a major or any course data.
  const idle = hydrated && untouched && !major;
  const sampleOnly = model.hasTranscript && plannerState.transcriptRecords.every((record) => record.id.startsWith("sample-"));

  const say = (text: string) => setAnnouncement(text);

  const openCourse = useCallback(
    (id: string) => {
      if (!model.rows.has(id)) return;
      setSelectedId(id);
      setPanelOpen(true);
      setSheetDetent(1);
    },
    [model],
  );
  const navigation = useMemo<CourseNavigation>(() => ({ open: openCourse, isKnown: (id) => model.rows.has(id) }), [openCourse, model]);

  /** The student's own edit, applied atomically to the planner's current state (model/plan-edits). */
  const edit = (
    statuses: Record<string, CourseStatus>,
    plan: (current: CoursePlan) => Partial<CoursePlan> = () => ({}),
    alsoTouched: readonly string[] = [],
  ) => updateCoursePlan(manualEdit(statuses, plan, alsoTouched));

  const plan = (id: string) => {
    edit({ [id]: "inProgress" }, (current) => ({ autoPlanned: without(current.autoPlanned, id) }));
    say(`Planned ${id} for ${profile.planningTerm}.`);
  };
  const unplan = (id: string) => {
    edit({ [id]: "notTaken" }, (current) => ({ autoPlanned: without(current.autoPlanned, id) }));
    say(`Removed ${id} from the plan.`);
  };
  const markCredit = (id: string) => {
    edit(
      { [id]: "completed" },
      (current) => ({ manualCredit: [...without(current.manualCredit, id), id], autoPlanned: without(current.autoPlanned, id) }),
    );
    say(`Marked ${id} as credit you have.`);
  };
  const clearCredit = (id: string) => {
    edit({ [id]: "notTaken" }, (current) => ({ manualCredit: without(current.manualCredit, id) }));
    say(`Removed your credit mark from ${id}.`);
  };

  const rowActions: RowActions = {
    open: openCourse,
    plan,
    unplan,
    resetOverride: (id) => {
      const row = model.rows.get(id);
      if (row?.status === "done") clearCredit(id);
      else unplan(id);
    },
  };

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    const id = selectedId;
    if (id) {
      window.requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-row-open="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }),
      );
    }
  }, [selectedId]);

  const panelActions: PanelActions = {
    plan,
    unplan,
    markCredit,
    clearCredit,
    chooseSection: (id, sectionId) => {
      // Picking a section is a hand edit to that course, even when it is already planned.
      edit(model.rows.get(id)?.inPlan ? {} : { [id]: "inProgress" }, (current) => ({ autoPlanned: without(current.autoPlanned, id) }), [id]);
      setSection(id, sectionId);
      const option = sectionCatalog(id);
      const section = option.status === "ready" ? option.result.sections.find((entry) => entry.id === sectionId) : undefined;
      say(`Using section ${section ? optionLabel(section) : optionIdLabel(sectionId)} of ${id}.`);
    },
    close: closePanel,
  };

  const focusMajorPicker = () => {
    document.getElementById(isPhone ? MAJOR_TRIGGER.phone : MAJOR_TRIGGER.desktop)?.focus();
  };

  const runAuto = () => {
    if (!major) {
      toast("Choose your major first. Auto-fill plans from its core courses.");
      focusMajorPicker();
      return;
    }
    const outcome = computeAuto(model, plannerState.courseStatuses, coreIds, profile.autoCreditBudget);
    const summary = describeAuto(outcome, model.hasTranscript, profile.planningTerm);
    updateCoursePlan(
      applyAuto(outcome, {
        id: `auto-${Date.now().toString(36)}`,
        at: new Date().toISOString(),
        major: major.id,
        changes: outcome.changes,
        summary,
        needsCheck: outcome.needsCheck,
      }),
    );
    say(summary);
  };

  const lastAuto = coursePlan.lastAuto;
  const undoBlocked = lastAuto ? undoBlocker(lastAuto, plannerState.courseStatuses, plannerState.selectedMajor) : null;

  const undoAuto = () => {
    if (!lastAuto || undoBlocked) return;
    updateCoursePlan(undoAutoUpdate(plannerState.selectedMajor));
    say("Auto-fill undone. Your plan is back to how it was.");
  };

  const dismissAuto = () => edit({}, () => ({ lastAuto: null }));

  const clearAutoPlan = () => {
    const ids = coursePlan.autoPlanned.filter((id) => model.rows.get(id)?.inPlan);
    edit(Object.fromEntries(ids.map((id) => [id, "notTaken" as const])), () => ({ autoPlanned: [], lastAuto: null }));
    say(ids.length ? `Removed ${ids.length} auto-planned course${ids.length === 1 ? "" : "s"}.` : "Nothing was auto-planned.");
  };

  const trySample = () => {
    applyTranscriptRecords(sampleTranscript);
    say("Added the sample transcript. Press Auto-fill to plan from it.");
  };

  const togglePlanFromSearch = (id: string) => {
    const row = model.rows.get(id);
    if (!row) return;
    if (row.status === "available" || row.status === "check") {
      plan(id);
      toast(`Planned ${id} for ${profile.planningTerm}.`);
    } else if (row.status === "planned") {
      unplan(id);
      toast(`Removed ${id} from the plan.`);
    } else {
      toast(`${id} is ${statusLabels[row.status].toLowerCase()}. Press Enter to see why.`);
    }
  };

  // The shell's palette (⌘K, the top bar's field, the phone search sheet) shows this search on Courses.
  const searchProvider = useMemo<ShellSearchProvider>(
    () => ({
      placeholder: "Search courses",
      emptyQueryHint: "Type a course code like 1030, a title, or an instructor.",
      planShortcut: true,
      search: (query) => {
        const results = searchCatalog(query, searchCourses, instructors, coreSet);
        return [
          {
            id: "courses",
            label: "Courses",
            items: results.courses.map((course): SearchItem => {
              const row = model.rows.get(course.id);
              return { id: course.id, code: course.id, title: course.title, meta: rowSummary(row), metaTone: row?.status === "locked" ? "danger" : "default" };
            }),
          },
          {
            id: "instructors",
            label: "Instructors",
            items: results.instructors.map((instructor): SearchItem => ({
              id: `${INSTRUCTOR_ITEM}${instructor.name}`,
              title: instructor.name,
              meta: instructor.courseIds.slice(0, 3).join(", "),
            })),
          },
        ];
      },
      onSelect: (item, { plan: wantsPlan }) => {
        if (item.id.startsWith(INSTRUCTOR_ITEM)) {
          const name = item.id.slice(INSTRUCTOR_ITEM.length);
          const first = instructors.find((instructor) => instructor.name === name)?.courseIds[0];
          if (first) {
            setPaletteInstructor({ id: first, name });
            openCourse(first);
          }
          return;
        }
        if (wantsPlan) {
          togglePlanFromSearch(item.id);
          return true;
        }
        setPaletteInstructor(null);
        openCourse(item.id);
      },
    }),
    // togglePlanFromSearch and openCourse read the same model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, searchCourses, instructors, coreSet, openCourse],
  );
  useShellSearch(searchProvider);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Modal layers (the palette, a Select, a Menu) handle their own Escape first.
      if (event.key === "Escape" && panelOpen && !isPhone && !event.defaultPrevented) closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, isPhone, closePanel]);

  // selectedId is never cleared, so the panel keeps its course while it slides out.
  const panelRow = selectedId ? model.rows.get(selectedId) : undefined;
  useEffect(() => {
    if (selectedId && panelOpen) loadSections([selectedId]);
  }, [loadSections, panelOpen, selectedId]);
  const planSections = sectionPlan.courses.flatMap((course) => (course.section ? [course.section] : []));
  const desktopPresence = usePresence(panelOpen && !isPhone && panelRow !== undefined, 150);

  const instructorForPanel =
    paletteInstructor && paletteInstructor.id === selectedId
      ? paletteInstructor.name
      : selectedId === initialCourseId
        ? initialInstructor
        : null;

  const content = (row: CourseRowModel) => (
    <DetailContent
      key={`${row.id}|${instructorForPanel ?? ""}`}
      row={row}
      profile={profile}
      inCore={coreSet.has(row.id)}
      selectedSectionId={plannerState.selectedSections[row.id]}
      sectionOptions={sectionCatalog(row.id)}
      planSections={planSections}
      initialInstructor={instructorForPanel}
      actions={panelActions}
      showClose
    />
  );

  const autoItems: MenuEntry[] = [
    { id: "import", label: "Import a transcript", onSelect: importTranscript },
    ...(model.hasTranscript ? [] : [{ id: "sample", label: "Try the sample transcript", onSelect: trySample }]),
    ...(coursePlan.autoPlanned.length > 0
      ? [{ kind: "separator" as const, id: "sep" }, { id: "clear", label: "Clear the auto plan", onSelect: clearAutoPlan, destructive: true }]
      : []),
  ];

  const autoControl = (small: boolean) => (
    <SplitButton
      size={small ? "sm" : "md"}
      icon={<span aria-hidden="true">✦</span>}
      onClick={runAuto}
      menuLabel="More Auto-fill options"
      menuItems={autoItems}
    >
      Auto-fill
    </SplitButton>
  );

  const majorPicker = (id: string) => (
    <div className={styles.majorPicker}>
      <Select
        id={id}
        label="Major"
        hideLabel
        options={majorOptions}
        value={plannerState.selectedMajor ?? ""}
        placeholder="Choose your major"
        onValueChange={(value) => {
          setSelectedMajor(value as MajorId);
          say(`Major set to ${getMajorById(value as MajorId)?.name}.`);
        }}
      />
    </div>
  );

  const pct = coreIds.length ? coreDone / coreIds.length : 0;

  return (
    <CourseNavigationContext.Provider value={navigation}>
      <div className={`${styles.tokens} ${styles.root}`} data-panel={desktopPresence.mounted ? "open" : "closed"}>
        <h1 className={styles.srOnly}>Courses</h1>
        <div className={styles.viewhead}>
          {majorPicker(MAJOR_TRIGGER.desktop)}
          {major && coreIds.length > 0 ? (
            <span className={styles.headMeta}>
              <span className={styles.meta}>
                {coreDone} of {coreIds.length} core done
                {coreCovered > 0 ? `, ${coreCovered} covered` : ""}
              </span>
              <span className={styles.progress} aria-hidden="true">
                <i style={{ transform: `scaleX(${pct})` }} />
              </span>
            </span>
          ) : null}
          <span className={styles.spacer} />
          {autoControl(false)}
          <Button variant="ghost" onClick={importTranscript}>
            Import PDF
          </Button>
        </div>

        <div className={styles.phoneHead}>
          <SearchTrigger className={styles.phoneSearch} shortcut="" onClick={openSearch} />
          <div className={styles.phoneBar}>
            {majorPicker(MAJOR_TRIGGER.phone)}
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
              <span className={styles.autonoteText}>{lastAuto.summary}</span>
              {lastAuto.needsCheck.length > 0 && model.rows.has(lastAuto.needsCheck[0]) ? (
                <button type="button" className={styles.link} onClick={() => openCourse(lastAuto.needsCheck[0])}>
                  {lastAuto.needsCheck.length === 1
                    ? "Review the core course that needs an advisor"
                    : `Review the ${lastAuto.needsCheck.length} core courses that need an advisor`}
                </button>
              ) : null}
              {undoBlocked ? (
                <span className={styles.meta} data-undo-blocked>
                  Undo is off: {undoBlocked}
                </span>
              ) : (
                <button type="button" className={styles.link} onClick={undoAuto}>
                  Undo
                </button>
              )}
              <span className={styles.spacer} />
              {model.hasTranscript ? (
                <ProvenanceTag
                  source={sampleOnly ? "Statuses come from a made-up sample transcript." : "Statuses come from the transcript you imported."}
                >
                  {sampleOnly ? SAMPLE_TRANSCRIPT_LABEL : "From transcript"}
                </ProvenanceTag>
              ) : null}
              <IconButton size="sm" className={styles.noteDismiss} label="Dismiss note" onClick={dismissAuto}>
                <Close />
              </IconButton>
            </div>
          ) : null}
          <span className={styles.srOnly}>{announcement}</span>
        </div>

        <div className={styles.body}>
          <div className={styles.list} data-course-list>
            {!hydrated ? (
              <div className={styles.loading} aria-label="Loading your plan" role="status">
                <span className={styles.spinner} />
              </div>
            ) : idle ? (
              <EmptyState onImport={importTranscript} onSample={trySample} onByHand={focusMajorPicker} />
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
                {content(panelRow)}
              </aside>
            </div>
          ) : null}
        </div>

        {isPhone && panelRow ? (
          <BottomSheet
            open={panelOpen}
            onOpenChange={(open) => {
              if (!open) closePanel();
            }}
            title={`${panelRow.id} details`}
            detents={[...SHEET_DETENTS]}
            initialDetent={1}
            detent={sheetDetent}
            onDetentChange={setSheetDetent}
            className={styles.tokens}
          >
            {/* At half height the body does not scroll; moving focus into it opens the sheet fully. */}
            <div onFocusCapture={() => setSheetDetent(1)}>{content(panelRow)}</div>
          </BottomSheet>
        ) : null}
      </div>
    </CourseNavigationContext.Provider>
  );
}

function EmptyState({ onImport, onSample, onByHand }: { onImport: () => void; onSample: () => void; onByHand: () => void }) {
  return (
    <section className={styles.empty} aria-labelledby="empty-title">
      <h2 className={styles.emptyTitle} id="empty-title">
        Start with what you&apos;ve taken
      </h2>
      <button type="button" className={styles.emptyOption} data-primary="true" onClick={onImport}>
        <span>
          <strong>Import your transcript</strong>
          <span className={styles.meta}>Upload the unofficial transcript PDF from myUNT.</span>
        </span>
      </button>
      <button type="button" className={styles.emptyOption} onClick={onSample}>
        <span>
          <strong>Try a sample transcript</strong>
          <span className={styles.meta}>A made-up first year in Computer Science, to see what Auto-fill does.</span>
        </span>
      </button>
      <button type="button" className={styles.emptyOption} onClick={onByHand}>
        <span>
          <strong>Pick courses by hand</strong>
          <span className={styles.meta}>Choose your major, then browse its courses.</span>
        </span>
      </button>
    </section>
  );
}
