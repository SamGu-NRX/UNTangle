"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import "./planner-persistence.css";
import { usePlanner } from "@/components/planner-provider";
import { buildSavedPlanSnapshot } from "@/lib/plan-library/snapshot";
import { defaultPlanName, exportPlanJson } from "@/lib/saved-plans/store";
import { exportFileName } from "@/components/schedules-library/view-model";
import { getActiveCourseCodes } from "@/lib/planner";
import type { PlannerState } from "@/lib/types";

function formatTimestamp(iso: string | null): string {
  if (!iso) return "unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** One-line honest summary of what a version contains (course → section pairs). */
function summarizeVersion(state: PlannerState): string {
  const codes = getActiveCourseCodes(state);
  if (codes.length === 0) return "no active courses";
  const parts = codes.map((course) => {
    const sectionId = state.selectedSections[course];
    return sectionId ? `${course} → ${sectionId}` : course;
  });
  return parts.join(", ");
}

function downloadSnapshotJson(state: PlannerState) {
  const snapshot = buildSavedPlanSnapshot({
    state,
    name: defaultPlanName(new Date()),
    source: { kind: "workingState", detail: "Exported while storage was unavailable" },
  });
  const blob = new Blob([exportPlanJson(snapshot)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName(snapshot);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * The planner's save-state surface: the contracted `Save state` status region,
 * a persistent `Not saved…` warning with an export option when storage is
 * unavailable, a retry affordance after a failed save, the cross-tab conflict
 * dialog (guests), and the "loaded a newer version" notice.
 */
export function PlannerPersistencePanel() {
  const {
    saveState,
    retrySave,
    conflict,
    resolveConflict,
    tookNewerVersion,
    dismissNewerVersionNotice,
    storeNotices,
    plannerState,
  } = usePlanner();

  const busy = saveState.status === "saving";
  const canRetry = saveState.status === "failed" || saveState.status === "signed-out";
  // Whenever edits are not stored anywhere durable, offer a file copy.
  const offerExport =
    saveState.status === "not-saved" || saveState.status === "failed" || saveState.status === "signed-out";
  const conflictSummary = useMemo(
    () => (conflict ? { mine: summarizeVersion(conflict.mine), theirs: conflict.theirs ? summarizeVersion(conflict.theirs) : null } : null),
    [conflict],
  );

  return (
    <div className="persistence">
      <p role="status" aria-label="Save state" className="persistence__state" data-attention={offerExport || undefined}>
        <span className="persistence__dot" data-tone={saveState.status} aria-hidden="true" />
        <span>
          <strong data-save-label>{saveState.label}</strong>
          {saveState.detail ? <span className="persistence__detail"> — {saveState.detail}</span> : null}
        </span>
      </p>

      {canRetry || offerExport ? (
        <div className="persistence__actions">
          {canRetry ? (
            <Button variant="ghost" size="sm" onClick={retrySave} disabled={busy}>
              Retry save
            </Button>
          ) : null}
          {offerExport ? (
            <Button variant="ghost" size="sm" onClick={() => downloadSnapshotJson(plannerState)}>
              Export schedule
            </Button>
          ) : null}
        </div>
      ) : null}

      {tookNewerVersion ? (
        <p role="status" className="persistence__note">
          Loaded newer version from another tab or device.
          <Button variant="link" size="sm" onClick={dismissNewerVersionNotice}>
            Dismiss
          </Button>
        </p>
      ) : null}

      {storeNotices.map((notice, index) => (
        <p key={`store-notice-${index}`} role="status" className="persistence__note">
          {notice.message}
          {notice.quarantinedTo ? ` (kept at ${notice.quarantinedTo})` : ""}
        </p>
      ))}

      {/* Not dismissible: closing would silently pick a side. The user chooses. */}
      <Dialog
        open={conflict !== null}
        onOpenChange={() => {}}
        dismissible={false}
        role="alertdialog"
        title={conflict ? "Unsaved changes conflict" : ""}
        width={560}
        footer={
          <>
            <Button variant="ghost" onClick={() => resolveConflict("take-theirs")}>
              Use the newer version
            </Button>
            <Button onClick={() => resolveConflict("keep-mine")}>Keep my edits</Button>
          </>
        }
      >
        {conflict && conflictSummary ? (
          <div className="persistence__conflict">
            <p>
              This tab has unsaved edits, and another {conflict.source === "server" ? "tab or device" : "tab"} saved a
              newer version of this schedule. Choose which version to keep. Nothing is overwritten until you decide.
            </p>
            <div className="persistence__version">
              <strong>This tab (unsaved)</strong>
              <span>{conflictSummary.mine}</span>
            </div>
            <div className="persistence__version">
              <strong>
                Newer saved version ({formatTimestamp(conflict.theirsSavedAt)}, version {conflict.theirsRevision})
              </strong>
              <span>{conflictSummary.theirs ?? "empty"}</span>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
