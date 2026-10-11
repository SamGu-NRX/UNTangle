"use client";

import { useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { usePlanner } from "@/components/planner-provider";
import { buildSavedPlanSnapshot } from "@/lib/plan-library/snapshot";
import { defaultPlanName, exportPlanJson } from "@/lib/saved-plans/store";
import { exportFileName } from "@/components/saved-plans/plans-view-model";
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
  const conflictSummary = useMemo(
    () => (conflict ? { mine: summarizeVersion(conflict.mine), theirs: conflict.theirs ? summarizeVersion(conflict.theirs) : null } : null),
    [conflict],
  );

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p
        role="status"
        aria-label="Save state"
        style={{
          margin: 0,
          border: "1px solid var(--line)",
          borderRadius: "var(--r-sm)",
          padding: "0.6rem 0.75rem",
          fontSize: "0.86rem",
          background: saveState.status === "not-saved" || saveState.status === "failed" ? "var(--surface-muted)" : "transparent",
        }}
      >
        <strong>{saveState.label}</strong>
        {saveState.detail ? <span style={{ color: "var(--copy)" }}> — {saveState.detail}</span> : null}
      </p>

      {saveState.status === "failed" ? (
        <button type="button" className="btn-secondary" onClick={retrySave} disabled={busy}>
          Retry save
        </button>
      ) : null}

      {saveState.status === "not-saved" ? (
        <button type="button" className="btn-secondary" onClick={() => downloadSnapshotJson(plannerState)}>
          Export schedule
        </button>
      ) : null}

      {tookNewerVersion ? (
        <p role="status" style={{ margin: 0, fontSize: "0.85rem", color: "var(--copy)" }}>
          Loaded a newer version saved from another tab.
          <button type="button" className="btn-ghost" style={{ marginLeft: 8 }} onClick={dismissNewerVersionNotice}>
            Dismiss
          </button>
        </p>
      ) : null}

      {storeNotices.map((notice, index) => (
        <p
          key={`store-notice-${index}`}
          role="status"
          style={{ margin: 0, fontSize: "0.82rem", color: "var(--copy)" }}
        >
          {notice.message}
          {notice.quarantinedTo ? ` (kept at ${notice.quarantinedTo})` : ""}
        </p>
      ))}

      <Modal
        open={conflict !== null}
        onClose={() => resolveConflict("keep-mine")}
        title={conflict ? "Unsaved changes conflict" : ""}
        maxWidth={560}
      >
        {conflict && conflictSummary ? (
          <div style={{ display: "grid", gap: "0.7rem" }}>
            <p style={{ margin: 0, fontSize: "0.9rem" }}>
              This tab has unsaved edits, and another tab just saved a newer version of this schedule.
              Choose which version to keep — nothing is overwritten until you decide.
            </p>
            <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: "0.6rem 0.75rem", fontSize: "0.86rem", display: "grid", gap: 4 }}>
              <strong>This tab (unsaved)</strong>
              <span style={{ color: "var(--copy)" }}>{conflictSummary.mine}</span>
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: "0.6rem 0.75rem", fontSize: "0.86rem", display: "grid", gap: 4 }}>
              <strong>
                Other tab (saved {formatTimestamp(conflict.theirsSavedAt)}, version {conflict.theirsRevision})
              </strong>
              <span style={{ color: "var(--copy)" }}>{conflictSummary.theirs ?? "empty"}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
              <button type="button" className="btn-primary" onClick={() => resolveConflict("keep-mine")}>
                Keep my edits
              </button>
              <button type="button" className="btn-ghost" onClick={() => resolveConflict("take-theirs")}>
                Use the newer version
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
