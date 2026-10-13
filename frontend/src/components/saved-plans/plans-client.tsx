"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { NavShell } from "@/components/nav-shell";
import { Modal } from "@/components/ui/Modal";
import { usePlanner, useToast } from "@/components/planner-provider";
import { PlannerSampleNotice } from "@/components/planner-sample-notice";
import { resolveSectionReferences } from "@/lib/plan-library/snapshot";
import { describeCourseFactChanges, describeLockChanges } from "@/lib/plan-library/diff";
import {
  createSavedPlanStore,
  subscribeSavedPlans,
  exportPlanJson,
} from "@/lib/saved-plans/store";
import type { SavedPlanStoreFailure, StoreReadResult } from "@/lib/saved-plans/store";
import {
  describeRestoreSteps,
  describeSkippedReferences,
  dispatchRestore,
  workingStateFingerprint,
} from "@/lib/saved-plans/restore-adapter";

import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";
import {
  assessRestoreDrift,
  comparePlan,
  exportFileName,
  statusLabel,
} from "@/components/saved-plans/plans-view-model";

type ReadDoc = Extract<StoreReadResult, { ok: true }>["doc"];

type ListState =
  | { phase: "loading" }
  | { phase: "unavailable"; message: string }
  | { phase: "ready"; doc: ReadDoc; notices: SavedPlanStoreFailure[] };

const sourceLabel: Record<SavedPlanSnapshot["source"]["kind"], string> = {
  workingState: "saved from your schedule",
  duplicate: "duplicated",
  import: "imported",
};

function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DiffRow({ children }: { children: React.ReactNode }) {
  return <li style={{ padding: "0.3rem 0", fontSize: "0.88rem" }}>{children}</li>;
}

const noopSubscribe = () => () => {};

function toListState(result: StoreReadResult): ListState {
  return result.ok
    ? { phase: "ready", doc: result.doc, notices: result.notices }
    : { phase: "unavailable", message: result.failure.message };
}

/** Rendered on the server and during hydration; replaced by the real read after mount. */
const LOADING_LIST: ListState = { phase: "loading" };

export function PlansClient() {
  const router = useRouter();
  const { toast } = useToast();
  const planner = usePlanner();
  const store = useMemo(() => createSavedPlanStore(), []);

  const [saveName, setSaveName] = useState("");
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [openCompareId, setOpenCompareId] = useState<string | null>(null);
  const [restorePlanId, setRestorePlanId] = useState<string | null>(null);
  // Fingerprint of the working schedule captured when the restore preview was
  // opened; confirm re-checks it so a schedule that changed in between cannot
  // be replaced silently.
  const restoreFingerprintRef = useRef<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // The store is synchronous, so the library read happens during render through
  // useSyncExternalStore: the server/hydration snapshot is the stable "loading"
  // state, and every mutation bumps the version to re-read the cache below.
  const [storeVersion, setStoreVersion] = useState(0);
  const listCacheRef = useRef<{ version: number; state: ListState } | null>(null);
  const readLibrary = useCallback(() => {
    const cache = listCacheRef.current;
    if (!cache || cache.version !== storeVersion) {
      const state = toListState(store.list());
      listCacheRef.current = { version: storeVersion, state };
      return state;
    }
    return cache.state;
  }, [store, storeVersion]);
  const bumpLibrary = useCallback(() => setStoreVersion((version) => version + 1), []);
  // Writes from elsewhere (the top bar's "Save a copy", another tab) re-read
  // the library too.
  useEffect(() => subscribeSavedPlans(bumpLibrary), [bumpLibrary]);
  const listState = useSyncExternalStore(noopSubscribe, readLibrary, () => LOADING_LIST);
  // Availability is read through a store snapshot too: the server renders the
  // storage-disabled state and React re-renders after hydration, so the banner
  // never causes a hydration mismatch.
  const storeAvailable = useSyncExternalStore(
    noopSubscribe,
    () => store.available,
    () => false,
  );

  const plans = listState.phase === "ready" ? listState.doc.plans : [];
  const activePlans = plans.filter((plan) => !plan.archivedAt);
  const archivedPlans = plans.filter((plan) => plan.archivedAt);
  const unreadable = listState.phase === "ready" ? listState.doc.unreadable : [];
  const saveCurrent = () => {
    const saved = store.savePlan({
      state: planner.plannerState,
      name: saveName.trim() || undefined,
    });
    if (!saved.ok) {
      toast(saved.failure.message);
      if (saved.failure.kind === "storageUnavailable") bumpLibrary();
      return;
    }
    setSaveName("");
    toast(`Saved “${saved.value.name}”`);
    bumpLibrary();
  };

  const withPlan = (plan: SavedPlanSnapshot, run: () => void) => {
    setBusyPlanId(plan.planId);
    // Let the pressed button paint its disabled state before the sync work.
    setTimeout(() => {
      run();
      setBusyPlanId(null);
    }, 0);
  };

  const renamePlan = (plan: SavedPlanSnapshot, name: string) =>
    withPlan(plan, () => {
      const renamed = store.renamePlan(plan.planId, name);
      if (!renamed.ok) {
        toast(renamed.failure.message);
        return;
      }
      toast(`Renamed to “${name}”`);
      bumpLibrary();
    });

  const duplicatePlan = (plan: SavedPlanSnapshot) =>
    withPlan(plan, () => {
      const duplicated = store.duplicatePlan(plan.planId);
      if (!duplicated.ok) {
        toast(duplicated.failure.message);
        return;
      }
      toast(`Created “${duplicated.value.name}”`);
      bumpLibrary();
    });

  const setArchived = (plan: SavedPlanSnapshot, archived: boolean) =>
    withPlan(plan, () => {
      const updated = store.setPlanArchived(plan.planId, archived);
      if (!updated.ok) {
        toast(updated.failure.message);
        return;
      }
      toast(archived ? `Archived “${plan.name}”` : `Reopened “${plan.name}”`);
      bumpLibrary();
    });

  const exportPlan = (plan: SavedPlanSnapshot) => {
    const blob = new Blob([exportPlanJson(plan)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(plan);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast(`Exported “${plan.name}”`);
  };

  const importPlan = async (file: File) => {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setImportError("The file is not valid JSON.");
      return;
    }
    const result = store.importPlan(parsed);
    if (!result.ok) {
      setImportError(result.failure.message);
      return;
    }
    toast(`Imported “${result.snapshot.name}”`);
    bumpLibrary();
  };

  const restorePlan = plans.find((plan) => plan.planId === restorePlanId) ?? null;
  // Saved section ids are checked against the options loaded now, so load the plan's courses.
  const { loadSections, sectionCatalog } = planner;
  const checkedPlan = restorePlan ?? plans.find((plan) => plan.planId === openCompareId) ?? null;
  useEffect(() => {
    if (checkedPlan) loadSections(Object.keys(checkedPlan.state.selectedSections));
  }, [checkedPlan, loadSections]);
  // Cheap computations on a small plan — recomputed per render, no memoization
  // needed, and the React Compiler cannot prove the deps stay unmutated.
  const restoreReferences = restorePlan ? resolveSectionReferences(restorePlan.state, sectionCatalog) : null;
  const restoreDrift = restorePlan ? assessRestoreDrift(restorePlan, planner.plannerState) : null;
  // Lock differences, shown before the steps: restoring replaces the working
  // schedule's locks with the plan's.
  const restoreLockLines = restorePlan
    ? describeLockChanges(comparePlan(restorePlan, planner.plannerState, sectionCatalog).lockChanges)
    : [];
  const restoreSkipWarnings =
    restorePlan && restoreReferences ? describeSkippedReferences(restoreReferences) : [];
  // listQuarantined() is a cheap localStorage key scan; recomputed per render
  // so it refreshes whenever the library version (listState) changes.
  const quarantinedKeys = store.listQuarantined();

  const openRestore = (plan: SavedPlanSnapshot) => {
    restoreFingerprintRef.current = workingStateFingerprint(planner.plannerState);
    setRestorePlanId(plan.planId);
  };

  const confirmRestore = async () => {
    if (!restorePlan || !restoreReferences) return;
    // Hydration gate: the working schedule must be fully loaded (or decided
    // not to load) before a restore may overwrite it.
    await planner.afterHydration();
    if (
      restoreFingerprintRef.current !== null &&
      workingStateFingerprint(planner.plannerState) !== restoreFingerprintRef.current
    ) {
      toast("Your working schedule changed since the preview was opened. Re-check the preview, then restore again.");
      setRestorePlanId(null);
      return;
    }
    const outcome = dispatchRestore(planner, restorePlan, restoreReferences);
    const skipped = outcome.staleSkipped.length + outcome.inactiveSkipped.length + outcome.unknownSkipped.length;
    const skipNote = skipped > 0 ? `; ${skipped} section reference${skipped === 1 ? "" : "s"} no longer resolve and were skipped` : "";
    toast(
      `Restored “${restorePlan.name}”: ${outcome.appliedStatusCount} status${outcome.appliedStatusCount === 1 ? "" : "es"}, ${outcome.appliedSectionCount} section${outcome.appliedSectionCount === 1 ? "" : "s"}${skipNote}`,
    );
    setRestorePlanId(null);
    router.push("/schedule");
  };

  const renderPlanCard = (plan: SavedPlanSnapshot, archived: boolean) => {
    const busy = busyPlanId === plan.planId;
    const compareOpen = openCompareId === plan.planId;
    const compare = compareOpen ? comparePlan(plan, planner.plannerState, sectionCatalog) : null;
    const compareId = `plan-compare-${plan.planId}`;
    return (
      <li
        key={plan.planId}
        style={{
          border: "1px solid var(--line)",
          borderRadius: "var(--r-md)",
          background: "var(--surface)",
          padding: "0.9rem 1rem",
          display: "grid",
          gap: "0.55rem",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.5rem" }}>
          <strong className="font-display" style={{ fontSize: "1.02rem", color: "var(--brand-900)" }}>
            {plan.name}
          </strong>
          <span style={{ fontSize: "0.78rem", color: "var(--copy)" }}>
            {formatSavedAt(plan.source.capturedAt)} · {sourceLabel[plan.source.kind]}
          </span>
          {archived ? (
            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--copy)", border: "1px solid var(--line)", borderRadius: 999, padding: "0.05rem 0.5rem" }}>
              Archived
            </span>
          ) : null}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
          {!archived ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => openRestore(plan)}>
              Preview restore
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            aria-expanded={compareOpen}
            aria-controls={compareId}
            onClick={() => setOpenCompareId(compareOpen ? null : plan.planId)}
          >
            {compareOpen ? "Hide comparison" : "Compare with working schedule"}
          </button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setArchived(plan, !archived)}>
            {archived ? "Reopen" : "Archive"}
          </button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => duplicatePlan(plan)}>
            Duplicate
          </button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => exportPlan(plan)}>
            Export
          </button>
          <label className="btn-ghost" style={{ display: "inline-flex", alignItems: "center", cursor: busy ? "default" : "pointer" }}>
            Rename
            <input
              type="text"
              aria-label={`Rename ${plan.name}`}
              defaultValue={plan.name}
              disabled={busy}
              style={{ marginLeft: 6, maxWidth: 160 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const value = (e.target as HTMLInputElement).value;
                  if (value && value.trim() && value.trim() !== plan.name) renamePlan(plan, value.trim());
                }
              }}
            />
          </label>
        </div>

        {compareOpen && compare ? (
          <div id={compareId} style={{ borderTop: "1px solid var(--line)", paddingTop: "0.55rem", display: "grid", gap: "0.4rem" }}>
            <p style={{ fontSize: "0.85rem", fontWeight: 600 }}>
              {compare.preservedFieldCount} of {compare.comparedFieldCount} fields match the working schedule
              {compare.changedFieldCount > 0 ? ` · ${compare.changedFieldCount} differ` : ""}
            </p>
            {compare.changedFieldCount === 0 && compare.unknownReferences.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--copy)" }}>
                Everything this plan declares matches the working schedule.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingInlineStart: "1.1rem", display: "grid", gap: 2 }}>
                {compare.statusChanges.map((change) => (
                  <DiffRow key={`status-${change.courseCode}`}>
                    <strong>{change.courseCode}</strong> is {statusLabel(change.from)} in the plan but{" "}
                    {statusLabel(change.to)} in the working schedule
                  </DiffRow>
                ))}
                {compare.sectionChanges.map((change) => (
                  <DiffRow key={`section-${change.courseCode}-${change.kind}`}>
                    <strong>{change.courseCode}</strong>{" "}
                    {change.kind === "added"
                      ? `has a working-schedule section not in the plan (${change.to ? change.to.sectionId : ""})`
                      : change.kind === "removed"
                        ? `is selected in the plan (${change.from?.sectionId}) but not in the working schedule`
                        : `selects ${change.from?.sectionId} in the plan but ${change.to?.sectionId} in the working schedule`}
                  </DiffRow>
                ))}
                {compare.unknownReferences.map((ref) => (
                  <DiffRow key={`unknown-${ref.courseCode}-${ref.sectionId}`}>
                    <strong>{ref.courseCode}</strong> references {ref.sectionId}, which no longer resolves (
                    {ref.side === "savedPlan" ? "saved plan" : "working schedule"})
                  </DiffRow>
                ))}
                {describeLockChanges(compare.lockChanges).map((line) => (
                  <DiffRow key={`lock-${line}`}>{line}</DiffRow>
                ))}
                {describeCourseFactChanges(compare.courseFactChanges).map((line) => (
                  <DiffRow key={`fact-${line}`}>{line}</DiffRow>
                ))}
                {compare.optimizationChanged ? <DiffRow>The optimization preference differs</DiffRow> : null}
                {compare.activeDayChanged ? <DiffRow>The preferred day differs</DiffRow> : null}
                {compare.majorChanged ? <DiffRow>The selected major differs</DiffRow> : null}
                {compare.transcriptRecords.changed ? (
                  <DiffRow>
                    Transcript records differ ({compare.transcriptRecords.savedPlan} in the plan,{" "}
                    {compare.transcriptRecords.workingState} in the working schedule)
                  </DiffRow>
                ) : null}
              </ul>
            )}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <NavShell step={3} back={{ href: "/map", label: "Back to map" }}>
      <div style={{ display: "grid", gap: 18, maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <header>
          <p className="editorial-label">Step 4 — Plan library</p>
          <h1 className="font-display" style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--brand-900)" }}>
            Saved plans
          </h1>
          <p style={{ color: "var(--copy)", maxWidth: "60ch" }}>
            Keep versions of your schedule, compare them with what you are building now, and restore a
            saved plan only after seeing exactly what it will change.
          </p>
        </header>

        <PlannerSampleNotice />

        {!storeAvailable ? (
          <p role="alert" style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "0.8rem 1rem", background: "var(--surface-muted)" }}>
            Saved plans are unavailable because browser storage is disabled. You can still export plans
            that were saved earlier in another browser.
          </p>
        ) : listState.phase === "unavailable" ? (
          <p role="alert" style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "0.8rem 1rem", background: "var(--surface-muted)" }}>
            {listState.message}
          </p>
        ) : null}

        {listState.phase === "ready" &&
          listState.notices.map((notice, index) => (
            <p
              key={`notice-${index}`}
              role="status"
              style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "0.8rem 1rem", background: "var(--surface-muted)" }}
            >
              {notice.message}
              {notice.quarantinedTo ? ` (kept at ${notice.quarantinedTo})` : ""}
            </p>
          ))}

        <section aria-labelledby="save-current-heading" style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md)", background: "var(--surface)", padding: "1rem", display: "grid", gap: "0.6rem" }}>
          <h2 id="save-current-heading" className="font-display" style={{ fontSize: "1.1rem", fontWeight: 700 }}>
            Save the working schedule
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
            <label htmlFor="save-plan-name" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
              Plan name (optional)
            </label>
            <input
              id="save-plan-name"
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && storeAvailable) saveCurrent();
              }}
              placeholder="e.g. Fall finals week"
              disabled={!storeAvailable}
              style={{ maxWidth: 280 }}
            />
            <button type="button" className="btn-primary" onClick={saveCurrent} disabled={!storeAvailable}>
              Save current schedule
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
            <button type="button" className="btn-secondary" onClick={() => importInputRef.current?.click()} disabled={!storeAvailable}>
              Import a plan file
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              aria-label="Import a saved-plan JSON file"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importPlan(file);
                e.target.value = "";
              }}
            />
            {importError ? <span style={{ fontSize: "0.85rem", color: "var(--brand-700)" }}>{importError}</span> : null}
          </div>
        </section>

        {listState.phase === "loading" ? <p style={{ color: "var(--copy)" }}>Loading your saved plans…</p> : null}

        {listState.phase === "ready" ? (
          <>
            <section aria-labelledby="active-plans-heading" style={{ display: "grid", gap: "0.6rem" }}>
              <h2 id="active-plans-heading" className="font-display" style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                Plans ({activePlans.length})
              </h2>
              {activePlans.length === 0 ? (
                <p style={{ color: "var(--copy)" }}>
                  No saved plans yet. Build a schedule you like, then save it here as a version you can
                  return to.
                </p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.6rem" }}>
                  {activePlans.map((plan) => renderPlanCard(plan, false))}
                </ul>
              )}
            </section>

            <section aria-labelledby="archived-plans-heading" style={{ display: "grid", gap: "0.6rem" }}>
              <h2 id="archived-plans-heading" className="font-display" style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                Archived ({archivedPlans.length})
              </h2>
              {archivedPlans.length === 0 ? (
                <p style={{ color: "var(--copy)" }}>Archived plans stay here, fully readable, until you reopen them.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.6rem" }}>
                  {archivedPlans.map((plan) => renderPlanCard(plan, true))}
                </ul>
              )}
            </section>

            {unreadable.length > 0 ? (
              <section aria-labelledby="unreadable-heading" style={{ border: "1px dashed var(--line)", borderRadius: "var(--r-md)", padding: "0.9rem 1rem" }}>
                <h2 id="unreadable-heading" className="font-display" style={{ fontSize: "1rem", fontWeight: 700 }}>
                  {unreadable.length} unreadable record{unreadable.length === 1 ? "" : "s"} kept visible
                </h2>
                <p style={{ fontSize: "0.85rem", color: "var(--copy)" }}>
                  These records could not be read with this version of the planner. They are preserved, not
                  lost, and travel with the library.
                </p>
                <ul style={{ margin: 0, paddingInlineStart: "1.1rem", fontSize: "0.82rem", color: "var(--copy)" }}>
                  {unreadable.map((entry, index) => (
                    <li key={`unreadable-${index}`}>{entry.reason}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {quarantinedKeys.length > 0 ? (
              <section aria-labelledby="quarantine-heading" style={{ border: "1px dashed var(--line)", borderRadius: "var(--r-md)", padding: "0.9rem 1rem" }}>
                <h2 id="quarantine-heading" className="font-display" style={{ fontSize: "1rem", fontWeight: 700 }}>
                  Kept unreadable data ({quarantinedKeys.length})
                </h2>
                <p style={{ fontSize: "0.85rem", color: "var(--copy)" }}>
                  When saved-plan storage could not be read, the raw bytes were kept (not deleted) so
                  nothing is silently destroyed. Nothing on this page uses them unless you restore them
                  by hand.
                </p>
                <ul style={{ margin: 0, paddingInlineStart: "1.1rem", fontSize: "0.82rem", color: "var(--copy)" }}>
                  {quarantinedKeys.map((entry) => (
                    <li key={entry.key}>
                      <code>{entry.key}</code> — {entry.size} characters kept
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      <Modal
        open={restorePlan !== null}
        onClose={() => setRestorePlanId(null)}
        title={restorePlan ? `Restore “${restorePlan.name}”` : ""}
        maxWidth={640}
      >
        {restorePlan && restoreReferences && restoreDrift ? (
          <div style={{ display: "grid", gap: "0.8rem" }}>
            {restoreDrift.drifted ? (
              <p role="alert" style={{ margin: 0, border: "1px solid var(--brand-700)", borderRadius: "var(--r-sm)", padding: "0.6rem 0.75rem", fontSize: "0.88rem" }}>
                {restoreDrift.message}
              </p>
            ) : null}
            {restoreSkipWarnings.length > 0 ? (
              <div role="alert" style={{ border: "1px solid var(--brand-700)", borderRadius: "var(--r-sm)", padding: "0.6rem 0.75rem", fontSize: "0.88rem", display: "grid", gap: "0.3rem" }}>
                <strong>{restoreSkipWarnings.length} saved section reference{restoreSkipWarnings.length === 1 ? "" : "s"} will not carry over:</strong>
                <ul style={{ margin: 0, paddingInlineStart: "1.1rem", display: "grid", gap: "0.2rem" }}>
                  {restoreSkipWarnings.map((warning) => (
                    <li key={`skip-${warning.courseCode}-${warning.sectionId}`}>{warning.warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--copy)" }}>
              Section ids, times and instructors below are sample data.
            </p>
            {restoreLockLines.length > 0 ? (
              <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: "0.6rem 0.75rem", fontSize: "0.88rem", display: "grid", gap: "0.3rem" }}>
                <strong>Section locks will change:</strong>
                <ul style={{ margin: 0, paddingInlineStart: "1.1rem", display: "grid", gap: "0.2rem" }}>
                  {restoreLockLines.map((line) => (
                    <li key={`restore-lock-${line}`}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ol style={{ margin: 0, paddingInlineStart: "1.2rem", display: "grid", gap: "0.35rem", fontSize: "0.9rem" }}>
              {describeRestoreSteps(restorePlan, restoreReferences).map((step, index) => (
                <li key={`restore-step-${index}`}>{step}</li>
              ))}
            </ol>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--copy)" }}>
              Restoring replaces the working schedule. Your current schedule is not saved automatically —
              save it first if you want to keep it.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
              <button type="button" className="btn-primary" onClick={confirmRestore}>
                Restore this plan
              </button>
              <button type="button" className="btn-ghost" onClick={() => setRestorePlanId(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </NavShell>
  );
}
