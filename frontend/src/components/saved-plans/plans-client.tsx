"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { NavShell } from "@/components/nav-shell";
import { usePlanner, useToast } from "@/components/planner-provider";
import { ViewHeader } from "@/components/shell/ViewHeader";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MoreGlyph } from "@/components/ui/icons";
import { Menu } from "@/components/ui/Menu";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { TextField } from "@/components/ui/TextField";
import "./plans.css";
import { resolveSectionReferences } from "@/lib/plan-library/snapshot";
import { describeLockChanges } from "@/lib/plan-library/diff";
import { PlanComparison } from "@/components/saved-plans/plan-comparison";
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
  const [renaming, setRenaming] = useState<{ planId: string; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
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
  // Cheap computations on a small plan — recomputed per render, no memoization
  // needed, and the React Compiler cannot prove the deps stay unmutated.
  const restoreReferences = restorePlan ? resolveSectionReferences(restorePlan.state) : null;
  const restoreDrift = restorePlan ? assessRestoreDrift(restorePlan, planner.plannerState) : null;
  // Lock differences, shown before the steps: restoring replaces the working
  // schedule's locks with the plan's.
  const restoreLockLines = restorePlan
    ? describeLockChanges(comparePlan(restorePlan, planner.plannerState).lockChanges)
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

  const renamingPlan = renaming ? (plans.find((plan) => plan.planId === renaming.planId) ?? null) : null;
  const submitRename = () => {
    if (!renaming || !renamingPlan) return;
    const value = renaming.value.trim();
    setRenaming(null);
    if (value && value !== renamingPlan.name) renamePlan(renamingPlan, value);
  };

  const renderPlanCard = (plan: SavedPlanSnapshot, archived: boolean) => {
    const busy = busyPlanId === plan.planId;
    const compareOpen = openCompareId === plan.planId;
    const compare = compareOpen ? comparePlan(plan, planner.plannerState) : null;
    const compareId = `plan-compare-${plan.planId}`;
    return (
      <li key={plan.planId} className="plans-card">
        <div className="plans-card__head">
          <div className="plans-card__name">
            <strong>{plan.name}</strong>
            <span className="plans-card__meta">
              {formatSavedAt(plan.source.capturedAt)} · {sourceLabel[plan.source.kind]}
              {archived ? " · Archived" : ""}
            </span>
          </div>
          <div className="plans-card__actions">
            {archived ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setArchived(plan, false)}>
                Reopen
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => openRestore(plan)}>
                Restore
              </Button>
            )}
            <Menu
              label={`Actions for ${plan.name}`}
              align="end"
              items={[
                {
                  id: "compare",
                  label: compareOpen ? "Hide comparison" : "Compare with working schedule",
                  onSelect: () => setOpenCompareId(compareOpen ? null : plan.planId),
                },
                { id: "duplicate", label: "Duplicate", onSelect: () => duplicatePlan(plan), disabled: busy },
                { id: "export", label: "Export", onSelect: () => exportPlan(plan), disabled: busy },
                {
                  id: "rename",
                  label: "Rename…",
                  onSelect: () => setRenaming({ planId: plan.planId, value: plan.name }),
                  disabled: busy,
                },
                { kind: "separator", id: "sep" },
                archived
                  ? { id: "reopen", label: "Reopen", onSelect: () => setArchived(plan, false), disabled: busy }
                  : { id: "archive", label: "Archive", onSelect: () => setArchived(plan, true), disabled: busy, destructive: true },
              ]}
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
                  aria-label={`More actions for ${plan.name}`}
                  disabled={busy}
                  data-ui=""
                >
                  <MoreGlyph />
                </button>
              )}
            />
          </div>
        </div>

        {compareOpen && compare ? <PlanComparison id={compareId} diff={compare} /> : null}
      </li>
    );
  };

  return (
    <NavShell>
      <div className="plans">
        <ViewHeader
          title="Plan library"
          meta={
            <>
              {listState.phase === "ready" ? `${activePlans.length} saved` : null}
              <ProvenanceTag source="Section ids, times and instructors in these plans are synthetic samples, not UNT's class schedule.">
                Sample sections
              </ProvenanceTag>
            </>
          }
          actions={
            <Button variant="ghost" onClick={() => importInputRef.current?.click()} disabled={!storeAvailable}>
              Import a plan file
            </Button>
          }
        />
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          aria-label="Import a saved-plan JSON file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importPlan(file);
            e.target.value = "";
          }}
        />
        {importError ? (
          <p role="alert" className="plans-notice plans-notice--error">
            {importError}
          </p>
        ) : null}

        {!storeAvailable ? (
          <p role="alert" className="plans-notice">
            Saved plans are unavailable because browser storage is disabled. You can still export plans that were saved
            earlier in another browser.
          </p>
        ) : listState.phase === "unavailable" ? (
          <p role="alert" className="plans-notice">
            {listState.message}
          </p>
        ) : null}

        {listState.phase === "ready" &&
          listState.notices.map((notice, index) => (
            <p key={`notice-${index}`} role="status" className="plans-notice">
              {notice.message}
              {notice.quarantinedTo ? ` (kept at ${notice.quarantinedTo})` : ""}
            </p>
          ))}

        <section aria-labelledby="save-current-heading" className="plans-save">
          <h2 id="save-current-heading" className="plans-section-title">
            Save the working schedule
          </h2>
          <form
            className="plans-save__row"
            onSubmit={(e) => {
              e.preventDefault();
              if (storeAvailable) saveCurrent();
            }}
          >
            <TextField
              id="save-plan-name"
              label="Plan name (optional)"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Fall finals week"
              disabled={!storeAvailable}
              className="plans-save__name"
            />
            <Button type="submit" disabled={!storeAvailable}>
              Save current schedule
            </Button>
          </form>
        </section>

        {listState.phase === "loading" ? <p className="plans-muted">Loading your saved plans…</p> : null}

        {listState.phase === "ready" ? (
          <>
            <section aria-labelledby="active-plans-heading" className="plans-group">
              <h2 id="active-plans-heading" className="plans-section-title">
                Plans ({activePlans.length})
              </h2>
              {activePlans.length === 0 ? (
                <p className="plans-muted">
                  No saved plans yet. Build a schedule you like, then save it here as a version you can return to.
                </p>
              ) : (
                <ul className="plans-list">{activePlans.map((plan) => renderPlanCard(plan, false))}</ul>
              )}
            </section>

            <section aria-labelledby="archived-plans-heading" className="plans-group">
              <h2 id="archived-plans-heading" className="plans-section-title">
                Archived ({archivedPlans.length})
              </h2>
              {archivedPlans.length === 0 ? (
                <p className="plans-muted">Archived plans stay here, fully readable, until you reopen them.</p>
              ) : (
                <ul className="plans-list">{archivedPlans.map((plan) => renderPlanCard(plan, true))}</ul>
              )}
            </section>

            {unreadable.length > 0 ? (
              <section aria-labelledby="unreadable-heading" className="plans-kept">
                <h2 id="unreadable-heading" className="plans-section-title">
                  {unreadable.length} unreadable record{unreadable.length === 1 ? "" : "s"} kept visible
                </h2>
                <p className="plans-muted">
                  These records could not be read with this version of the planner. They are preserved, not lost, and
                  travel with the library.
                </p>
                <ul>
                  {unreadable.map((entry, index) => (
                    <li key={`unreadable-${index}`}>{entry.reason}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {quarantinedKeys.length > 0 ? (
              <section aria-labelledby="quarantine-heading" className="plans-kept">
                <h2 id="quarantine-heading" className="plans-section-title">
                  Kept unreadable data ({quarantinedKeys.length})
                </h2>
                <p className="plans-muted">
                  When saved-plan storage could not be read, the raw bytes were kept (not deleted) so nothing is
                  silently destroyed. Nothing on this page uses them unless you restore them by hand.
                </p>
                <ul>
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

      <Dialog
        open={renamingPlan !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        title="Rename plan"
        width={420}
        initialFocus={renameInputRef}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="submit" form="rename-plan-form">
              Rename
            </Button>
          </>
        }
      >
        <form
          id="rename-plan-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitRename();
          }}
        >
          <TextField
            ref={renameInputRef}
            label="Plan name"
            value={renaming?.value ?? ""}
            onChange={(e) => setRenaming((current) => (current ? { ...current, value: e.target.value } : current))}
          />
        </form>
      </Dialog>

      <Dialog
        open={restorePlan !== null}
        onOpenChange={(open) => {
          if (!open) setRestorePlanId(null);
        }}
        title={restorePlan ? `Restore “${restorePlan.name}”` : ""}
        width={640}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestorePlanId(null)}>
              Cancel
            </Button>
            <Button onClick={confirmRestore}>Restore this plan</Button>
          </>
        }
      >
        {restorePlan && restoreReferences && restoreDrift ? (
          <div className="plans-restore">
            {restoreDrift.drifted ? (
              <p role="alert" className="plans-notice plans-notice--warn">
                {restoreDrift.message}
              </p>
            ) : null}
            {restoreSkipWarnings.length > 0 ? (
              <div role="alert" className="plans-notice plans-notice--warn">
                <strong>
                  {restoreSkipWarnings.length} saved section reference{restoreSkipWarnings.length === 1 ? "" : "s"} will
                  not carry over:
                </strong>
                <ul>
                  {restoreSkipWarnings.map((warning) => (
                    <li key={`skip-${warning.courseCode}-${warning.sectionId}`}>{warning.warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="plans-muted">
              Section ids, times and instructors below are sample data.
            </p>
            {restoreLockLines.length > 0 ? (
              <div className="plans-notice">
                <strong>Section locks will change:</strong>
                <ul>
                  {restoreLockLines.map((line) => (
                    <li key={`restore-lock-${line}`}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ol className="plans-restore__steps">
              {describeRestoreSteps(restorePlan, restoreReferences).map((step, index) => (
                <li key={`restore-step-${index}`}>{step}</li>
              ))}
            </ol>
            <p className="plans-muted">
              Restoring replaces the working schedule. Your current schedule is not saved automatically; save it first
              if you want to keep it.
            </p>
          </div>
        ) : null}
      </Dialog>
    </NavShell>
  );
}
