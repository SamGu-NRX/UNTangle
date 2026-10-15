"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePlanner } from "@/components/planner-provider";
import { SCHEDULE_NAME } from "@/components/shell/plan-status";
import { Button, IconButton } from "@/components/ui/Button";
import { ContextPanel } from "@/components/ui/ContextPanel";
import { Dialog } from "@/components/ui/Dialog";
import { MoreGlyph, Plus } from "@/components/ui/icons";
import { keyboardFocused } from "@/components/ui/input-source";
import { Menu, type MenuEntry } from "@/components/ui/Menu";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { TextField } from "@/components/ui/TextField";
import { toast } from "@/components/ui/Toast";
import { PHONE_QUERY, useMediaQuery } from "@/components/ui/use-media-query";
import { replaceWith, undoReplace, type Replaced } from "@/lib/plan-library/versions";
import { eventsOf, usesSampleSections, weekBlocks, weekColors, type WeekBlock } from "@/lib/plan-library/week";
import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";
import { PLANNING_TERM } from "@/lib/terms";
import { createSavedPlanStore, exportPlanJson, subscribeSavedPlans, type SavedPlanStoreFailure, type StoreReadResult } from "@/lib/saved-plans/store";
import type { PlannerState } from "@/lib/types";
import { PlannerPersistencePanel } from "@/components/planner-persistence-panel";
import { saveOutcome } from "@/lib/connect/review";
import { adoptCopy, announcementStep, noteLanded, undoAdoption, type Adoption } from "./adopt";
import { CompareView, type CompareSide } from "./compare-view";
import { PushView } from "./push-view";
import { ScheduleDetail } from "./schedule-detail";
import { downloadFile, exportFileName, hasSavedCopy, importScheduleFile, keyedLines, readLibraryView, whenText, type LibraryView } from "./view-model";
import { WeekThumb } from "./week-grid";
import styles from "./library.module.css";

/** The working schedule's id in this view. Saved copies use their planId. */
export const MAIN_ID = "main";

/** One row: the working schedule (what every lens shows) or a saved copy of one. */
export type Entry = {
  id: string;
  name: string;
  /** The working schedule: the one Courses, Week and Day show. */
  active: boolean;
  fact: string;
  state: PlannerState;
  blocks: WeekBlock[];
  snapshot: SavedPlanSnapshot | null;
};

type ReadDoc = Extract<StoreReadResult, { ok: true }>["doc"];
type ListState =
  | { phase: "loading" }
  | { phase: "unavailable"; message: string }
  | { phase: "ready"; doc: ReadDoc; notices: SavedPlanStoreFailure[] };

const LOADING: ListState = { phase: "loading" };
const LOADING_VIEW: LibraryView = { phase: "loading", storeAvailable: false, storageDisabled: false, quarantined: [] };
const noopSubscribe = () => () => {};
const toListState = (result: StoreReadResult): ListState =>
  result.ok ? { phase: "ready", doc: result.doc, notices: result.notices } : { phase: "unavailable", message: result.failure.message };

/** The minute, for "Edited 2 min ago"; it ticks so the words stay true while the page is open. */
function subscribeMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}
const currentMinute = () => Math.floor(Date.now() / 60_000);

/**
 * /schedules (DESIGN.md §4.5, 05-schedules-library.html): the term's
 * schedules as rows, each a small drawn week, a name and when it changed.
 * Picking one opens its detail in the contextual panel (on a phone it pushes
 * in from the right); Compare picks two and shows them side by side.
 *
 * "Main" is the working schedule every lens shows. The others are copies
 * saved in this browser (lib/saved-plans/store.ts, with its quarantine and
 * unreadable-record handling shown below the list). Using a copy, or
 * restoring Main's "Before Auto", can be undone while Main is unchanged.
 */
export function SchedulesClient() {
  const planner = usePlanner();
  const { plannerState, scheduleEvents, sectionCatalog, loadSections, transact } = planner;
  const phone = useMediaQuery(PHONE_QUERY);
  const store = useMemo(() => createSavedPlanStore(), []);

  // The store is synchronous: read during render through a versioned cache, re-read on every write.
  const [storeVersion, setStoreVersion] = useState(0);
  const cache = useRef<{ version: number; identityReady: boolean; view: LibraryView } | null>(null);
  // No identity's library is read until the planner has prepared one (readLibraryView).
  const identityReady = planner.identityReady;
  const readLibrary = useCallback(() => {
    if (!cache.current || cache.current.version !== storeVersion || cache.current.identityReady !== identityReady) {
      cache.current = { version: storeVersion, identityReady, view: readLibraryView(store, identityReady) };
    }
    return cache.current.view;
  }, [store, storeVersion, identityReady]);
  const bump = useCallback(() => setStoreVersion((n) => n + 1), []);
  useEffect(() => subscribeSavedPlans(bump), [bump]);
  const view = useSyncExternalStore(noopSubscribe, readLibrary, () => LOADING_VIEW);
  const list: ListState = view.phase === "loading" ? LOADING : toListState(view.read);
  const { storeAvailable, storageDisabled, quarantined } = view;
  const minute = useSyncExternalStore(subscribeMinute, currentMinute, () => 0);

  const plans = list.phase === "ready" ? list.doc.plans : [];
  const live = plans.filter((plan) => !plan.archivedAt);
  const archived = plans.filter((plan) => plan.archivedAt);

  // Saved copies are drawn from the sections loaded now, so load their courses.
  const savedCodes = [...new Set(plans.flatMap((plan) => Object.keys(plan.state.courseStatuses).filter((code) => plan.state.courseStatuses[code] === "inProgress")))].join("|");
  useEffect(() => {
    if (savedCodes) loadSections(savedCodes.split("|"));
  }, [savedCodes, loadSections]);

  // A handful of schedules, each resolved against the loaded sections: cheap enough to redo per
  // render, which also redraws a saved week as its course options arrive (catalogVersion).
  const now = new Date(minute * 60_000);
  const main: Entry = {
    id: MAIN_ID,
    name: SCHEDULE_NAME,
    active: true,
    fact: whenText("Edited", plannerState.updatedAt, now),
    state: plannerState,
    blocks: weekBlocks(scheduleEvents),
    snapshot: null,
  };
  const copy = (plan: SavedPlanSnapshot): Entry => ({
    id: plan.planId,
    name: plan.name,
    active: false,
    fact: whenText("Saved", plan.source.capturedAt, now),
    state: plan.state,
    blocks: weekBlocks(eventsOf(plan.state, sectionCatalog)),
    snapshot: plan,
  });
  const entries = { main, live: live.map(copy), archived: archived.map(copy) };
  // Said once, on the term heading (rule 6), whenever any week drawn here uses the bundled samples.
  const samples =
    usesSampleSections(scheduleEvents) || plans.some((plan) => usesSampleSections(eventsOf(plan.state, sectionCatalog)));
  const all = [entries.main, ...entries.live, ...entries.archived];
  const find = (id: string | null) => all.find((entry) => entry.id === id) ?? null;

  const [selected, setSelected] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [naming, setNaming] = useState<{ kind: "save" } | { kind: "rename"; planId: string } | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const compareButton = useRef<HTMLButtonElement | null>(null);

  // The panel lines up beside this page's 560px column (ui.css .ui-context reads --main-max).
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--main-max", "560px");
    return () => {
      root.style.removeProperty("--main-max");
    };
  }, []);

  const selectedEntry = find(selected);
  const open = comparing || selectedEntry !== null;
  const closePanel = () => {
    setSelected(null);
    setComparing(false);
    setPicks([]);
  };
  const focusTarget = () => (comparing ? compareButton.current : (selected && rowButtons.current.get(selected)) || null);

  function pickRow(entry: Entry) {
    if (comparing) {
      setPicks((current) => (current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [...current, entry.id].slice(-2)));
      return;
    }
    setSelected((current) => (current === entry.id ? null : entry.id));
  }

  function toggleCompare() {
    if (comparing) {
      closePanel();
      return;
    }
    setComparing(true);
    setPicks(selected ? [selected] : []);
    setSelected(null);
  }

  // A toast's Undo runs long after the render that made it: it reads the planner through this.
  const plannerNow = useRef(planner);
  useEffect(() => {
    plannerNow.current = planner;
  });
  const changedSince = () => toast("Main has changed since, so it was left as it is.");

  /**
   * Restores "Before Auto" in one transaction. Undo is bound to the stamp the
   * restore ran under, so a reset, another tab's version or a sign-in since
   * refuses it, and to the plan the restore left, so an edit since does too.
   */
  async function restoreVersion(pick: (current: PlannerState) => PlannerState | null, label: string) {
    await planner.afterHydration();
    const stamp = plannerNow.current.planStamp;
    const outcome = await transact(replaceWith(pick), stamp);
    if (outcome.status !== "committed") {
      toast("Main changed while that was running. Try again.");
      return;
    }
    const result: Replaced = outcome.result;
    if (result.status === "gone") {
      toast(`${label} is no longer available.`);
      return;
    }
    toast({
      message: `Restored ${label}`,
      action: {
        label: "Undo",
        onClick: async () => {
          const undone = await plannerNow.current.transact(undoReplace(result), stamp);
          if (undone.status !== "committed" || !undone.result) changedSince();
        },
      },
    });
  }

  /** The pending "Use in Main" whose Undo is on the toast (adopt.ts). */
  const pendingUndo = useRef<Adoption | null>(null);
  useEffect(() => {
    if (pendingUndo.current) noteLanded(pendingUndo.current, planner);
  });

  // Success is said only once the new Main is stored (#37's honest-save rule). Until then, or
  // when the save fails or meets a newer version from another tab, the save panel shows below.
  const announce = useRef<{ name: string; adoption: Adoption } | null>(null);
  const outcome = saveOutcome(planner.saveState.status, Boolean(planner.conflict));
  useEffect(() => {
    // Runs on every commit: the save state arriving re-renders this page.
    if (!announce.current) return;
    const step = announcementStep(outcome);
    if (step === "wait") return;
    const pending = announce.current;
    announce.current = null;
    // A save that failed or met a newer version isn't this adoption landing; a later save mustn't announce it.
    if (step === "drop") return;
    const { name, adoption } = pending;
    toast({
      message: `Main now uses ${name}`,
      action: {
        label: "Undo",
        onClick: () => {
          if (pendingUndo.current !== adoption || !undoAdoption(plannerNow.current, adoption)) {
            changedSince();
            return;
          }
          pendingUndo.current = null;
        },
      },
    });
  });

  async function adoptEntry(entry: Entry) {
    const snapshot = entry.snapshot;
    if (!snapshot) return;
    await planner.afterHydration();
    const adoption = adoptCopy(plannerNow.current, snapshot);
    pendingUndo.current = adoption;
    announce.current = { name: entry.name, adoption };
  }

  function saveCopy(name: string) {
    const saved = store.savePlan({ state: plannerState, name: name.trim() || undefined });
    if (!saved.ok) {
      toast({ message: saved.failure.message, tone: "error" });
      bump();
      return;
    }
    toast(`Saved “${saved.value.name}”`);
    bump();
  }

  function report(result: { ok: boolean; failure?: SavedPlanStoreFailure }, message: string) {
    toast(result.ok ? message : { message: result.failure?.message ?? "That didn't work.", tone: "error" });
    bump();
  }

  function exportPlan(plan: SavedPlanSnapshot) {
    downloadFile(new Blob([exportPlanJson(plan)], { type: "application/json" }), exportFileName(plan));
    toast(`Exported “${plan.name}”`);
  }

  async function importFile(file: File) {
    setImportError(null);
    const result = await importScheduleFile(store, file);
    if (!result.ok) {
      setImportError(result.message);
      if (result.kind === "identityChanged") bump();
      return;
    }
    toast(`Added “${result.name}”`);
    bump();
  }

  function submitName() {
    if (!naming) return;
    if (naming.kind === "save") saveCopy(nameValue);
    else {
      const plan = plans.find((entry) => entry.planId === naming.planId);
      const value = nameValue.trim();
      if (plan && value && value !== plan.name) report(store.renamePlan(plan.planId, value), `Renamed to “${value}”`);
    }
    setNaming(null);
  }

  function menuFor(entry: Entry): MenuEntry[] {
    const plan = entry.snapshot;
    if (!plan) return [{ id: "save", label: "Save a copy", onSelect: () => startSaving() }];
    if (plan.archivedAt) {
      return [
        { id: "reopen", label: "Reopen", onSelect: () => report(store.setPlanArchived(plan.planId, false), `Reopened “${plan.name}”`) },
        { id: "export", label: "Export file", onSelect: () => exportPlan(plan) },
      ];
    }
    return [
      { id: "rename", label: "Rename", onSelect: () => (setNameValue(plan.name), setNaming({ kind: "rename", planId: plan.planId })) },
      { id: "duplicate", label: "Duplicate", onSelect: () => report(store.duplicatePlan(plan.planId), `Duplicated “${plan.name}”`) },
      { id: "export", label: "Export file", onSelect: () => exportPlan(plan) },
      { kind: "separator", id: "sep" },
      {
        id: "archive",
        label: "Archive",
        destructive: true,
        onSelect: () => {
          if (selected === plan.planId) setSelected(null);
          report(store.setPlanArchived(plan.planId, true), `Archived “${plan.name}”`);
        },
      },
    ];
  }

  function startSaving() {
    setNameValue("");
    setNaming({ kind: "save" });
  }

  const mainSaved = hasSavedCopy(plannerState, live);
  // Main isn't stored: a conflict with another tab, or a failed, refused or signed-out save.
  const saveTrouble = ["conflict", "unsaved"].includes(saveOutcome(planner.saveState.status, Boolean(planner.conflict)));
  const sides: CompareSide[] = picks.map((id) => find(id)).filter((entry): entry is Entry => entry !== null);
  const colors = weekColors(...all.map((entry) => entry.blocks));

  const panelTitle = comparing ? (sides.length === 2 ? `${sides[0].name} and ${sides[1].name}` : "Compare") : (selectedEntry?.name ?? "");
  const panelBody: ReactNode = comparing ? (
    <CompareView
      sides={sides}
      colors={colors}
      onUse={(entry) => void adoptEntry(entry)}
      onDone={closePanel}
    />
  ) : selectedEntry ? (
    <ScheduleDetail
      key={selectedEntry.id}
      entry={selectedEntry}
      colors={colors}
      now={now}
      mainSaved={mainSaved}
      onUse={() => void adoptEntry(selectedEntry)}
      onSaveMain={startSaving}
      onExport={() => selectedEntry.snapshot && exportPlan(selectedEntry.snapshot)}
      onRestore={(pick, label) => void restoreVersion(pick, label)}
    />
  ) : null;

  const row = (entry: Entry) => {
    const pickIndex = picks.indexOf(entry.id);
    const on = comparing ? pickIndex >= 0 : selected === entry.id && open;
    const label = comparing
      ? pickIndex >= 0
        ? `Remove ${entry.name} from compare`
        : `Compare ${entry.name}`
      : `Open ${entry.name}${entry.active ? ", active" : ""}`;
    return (
      <li key={entry.id} className={styles.row} data-selected={on || undefined}>
        <button
          ref={(node) => {
            if (node) rowButtons.current.set(entry.id, node);
            else rowButtons.current.delete(entry.id);
          }}
          type="button"
          className={styles.hit}
          aria-label={label}
          aria-pressed={on}
          onClick={() => pickRow(entry)}
        />
        <WeekThumb blocks={entry.blocks} colors={colors} />
        <div className={styles.rowText}>
          <span className={styles.rowName}>
            {/* Beside the name, so it never covers the drawn week. */}
            {comparing && pickIndex >= 0 ? (
              <span className={styles.pick} aria-hidden="true">
                {"AB"[pickIndex]}
              </span>
            ) : null}
            {entry.active ? <span className={styles.dot} aria-hidden="true" /> : null}
            {entry.name}
          </span>
          <span className={styles.rowFact}>{entry.fact}</span>
        </div>
        <Menu
          label={`More for ${entry.name}`}
          align="end"
          items={menuFor(entry)}
          trigger={(props) => (
            <button {...props} type="button" className={styles.more} aria-label={`More for ${entry.name}`}>
              <MoreGlyph />
            </button>
          )}
        />
      </li>
    );
  };

  const listView = (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Schedules</h1>
        <div className={styles.headActions}>
          <Button
            ref={compareButton}
            variant="secondary"
            size="sm"
            aria-pressed={comparing}
            aria-label={phone ? "Compare" : undefined}
            icon={<CompareGlyph />}
            onClick={toggleCompare}
          >
            {phone ? null : "Compare"}
          </Button>
          <Button size="sm" icon={<Plus size={16} />} aria-label={phone ? "Save a copy" : undefined} disabled={!storeAvailable} onClick={startSaving}>
            {phone ? null : "Save a copy"}
          </Button>
          <Menu
            label="More for schedules"
            align="end"
            items={[{ id: "open-file", label: "Open a schedule file", onSelect: () => importRef.current?.click(), disabled: !storeAvailable }]}
            trigger={(props) => (
              <IconButton {...props} label="More for schedules" size="sm">
                <MoreGlyph />
              </IconButton>
            )}
          />
        </div>
      </header>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        aria-label="Open a schedule file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.target.value = "";
        }}
      />
      {saveTrouble ? (
        <div className={styles.saveTrouble}>
          <PlannerPersistencePanel />
        </div>
      ) : null}
      {comparing && phone && sides.length < 2 ? (
        <p className={styles.quiet} role="status">
          Pick {sides.length ? "one more schedule" : "two schedules"} to compare.
        </p>
      ) : null}
      {importError ? (
        <p role="alert" className={styles.notice}>
          {importError}
        </p>
      ) : null}

      <section className={styles.term} aria-labelledby="term-heading">
        <h2 id="term-heading" className={styles.termTitle}>
          {PLANNING_TERM.name}
          {samples ? (
            <ProvenanceTag source="These weeks use synthetic sample sections, not UNT's class schedule.">Sample sections</ProvenanceTag>
          ) : null}
        </h2>
        <ul className={styles.rows}>{[entries.main, ...entries.live].map(row)}</ul>
        {list.phase === "loading" ? <p className={styles.quiet}>Loading saved schedules…</p> : null}
        {list.phase === "ready" && entries.live.length === 0 ? (
          <p className={styles.quiet}>Save a copy of Main to try another week without losing this one.</p>
        ) : null}
      </section>

      {entries.archived.length ? (
        <section className={styles.term}>
          <button type="button" className={styles.groupToggle} aria-expanded={showArchived} onClick={() => setShowArchived((on) => !on)}>
            Archived
            {showArchived ? null : <span className={styles.count}>{entries.archived.length}</span>}
          </button>
          {showArchived ? <ul className={styles.rows}>{entries.archived.map(row)}</ul> : null}
        </section>
      ) : null}

      <LibraryNotices list={list} storageDisabled={storageDisabled} quarantined={quarantined} />
    </div>
  );

  return (
    <>
      {phone ? (
        <PushView
          // A phone pushes compare only once two are picked: the list has to stay usable for picking.
          open={comparing ? sides.length === 2 : selectedEntry !== null}
          title={panelTitle}
          onBack={closePanel}
          returnFocus={focusTarget}
          list={listView}
          instant={keyboardFocused}
        >
          {panelBody}
        </PushView>
      ) : (
        <>
          {listView}
          <ContextPanel open={open} onClose={closePanel} title={panelTitle} returnFocus={focusTarget}>
            {panelBody}
          </ContextPanel>
        </>
      )}

      <Dialog
        open={naming !== null}
        onOpenChange={(next) => {
          if (!next) setNaming(null);
        }}
        title={naming?.kind === "rename" ? "Rename schedule" : "Save a copy of Main"}
        width={420}
        initialFocus={nameRef}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNaming(null)}>
              Cancel
            </Button>
            <Button type="submit" form="schedule-name-form">
              {naming?.kind === "rename" ? "Rename" : "Save"}
            </Button>
          </>
        }
      >
        <form
          id="schedule-name-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitName();
          }}
        >
          <TextField
            ref={nameRef}
            label="Name"
            value={nameValue}
            placeholder={naming?.kind === "save" ? "Fridays off" : undefined}
            onChange={(event) => setNameValue(event.target.value)}
            autoComplete="off"
          />
        </form>
      </Dialog>
    </>
  );
}

/**
 * What #37's library kept visible about storage, said once below the list:
 * storage that can't be used, records this version can't read (kept, not
 * lost) and quarantined bytes. Each line is there only while it is true.
 */
function LibraryNotices({
  list,
  storageDisabled,
  quarantined,
}: {
  list: ListState;
  storageDisabled: boolean;
  quarantined: ReadonlyArray<{ key: string; size: number }>;
}) {
  const lines: string[] = [];
  if (storageDisabled) {
    lines.push("Saved copies can't be kept because this browser's storage is turned off. Main still saves.");
  } else if (list.phase === "unavailable") lines.push(list.message);
  if (list.phase === "ready") {
    for (const notice of list.notices) lines.push(notice.quarantinedTo ? `${notice.message} Kept at ${notice.quarantinedTo}.` : notice.message);
    // Why each kept record can't be read, as #37's library listed them.
    for (const entry of list.doc.unreadable) lines.push(`Unreadable: ${entry.reason}`);
  }
  if (quarantined.length) {
    lines.push(
      `${quarantined.length} unreadable ${quarantined.length === 1 ? "copy is" : "copies are"} kept in this browser's storage, not deleted: ${quarantined.map((entry) => entry.key).join(", ")}.`,
    );
  }
  if (!lines.length) return null;
  return (
    <div className={styles.notices} role="status">
      {keyedLines(lines).map((line) => (
        <p key={line.key}>{line.text}</p>
      ))}
    </div>
  );
}

function CompareGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="2.5" width="5" height="11" rx="1.2" />
      <rect x="9" y="2.5" width="5" height="11" rx="1.2" />
    </svg>
  );
}
