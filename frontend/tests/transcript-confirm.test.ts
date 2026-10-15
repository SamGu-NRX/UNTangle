/**
 * Confirmation-behavior tests for the transcript import apply flow.
 *
 * The import review step requires per-row user approval (the `included` Set,
 * one checkbox per detected row) before any row is applied to the planner.
 * These tests exercise the real gate (`selectApprovedTranscriptRecords`,
 * shared by the component's `saveDetectedCourses` and its review summary) and
 * then verify what the planner's `applyTranscriptRecords` persists via
 * `mergeTranscriptRecords` + sessionStorage — the same happy-dom pattern as
 * planner-core.test.ts.
 *
 * Logic-level by design: rendering TranscriptImportClient would mount the
 * component's unconditional next/script tag for https://js.puter.com/v2/,
 * which these offline tests must never load. All records are fabricated.
 */
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import {
  getInitialPlannerState,
  mergeTranscriptRecords,
  readPlannerStateFromSessionStorage,
  writePlannerStateToSessionStorage,
} from "@/lib/planner";
import {
  selectApprovedTranscriptRecords,
} from "@/lib/transcript-import";
import type { TranscriptCourseRecord } from "@/lib/types";

function record(over: Partial<TranscriptCourseRecord>): TranscriptCourseRecord {
  return {
    id: "unknown-id",
    code: "CSCE 1030",
    title: "Computer Science I",
    term: "2023 Fall",
    grade: "A",
    credits: 3,
    sourceKind: "unt",
    confidence: 0.9,
    rationale: "Letter grade or credit marker satisfies completed credit.",
    duplicateExcluded: false,
    appliedStatus: "completed",
    prerequisiteSatisfied: true,
    reviewRequired: false,
    ...over,
  };
}

const approvedCompleted = record({ id: "row-approved-completed", code: "CSCE 1030" });
const unapprovedCompleted = record({ id: "row-unapproved", code: "MATH 1650" });
const approvedInProgress = record({
  id: "row-in-progress",
  code: "CSCE 2110",
  grade: "EN",
  appliedStatus: "inProgress",
  prerequisiteSatisfied: false,
  confidence: 0.7,
});
const needsReviewRow = record({
  id: "row-review",
  code: "TECM 2700",
  appliedStatus: "needsReview",
  prerequisiteSatisfied: false,
  reviewRequired: true,
});

const ALL_ROWS = [approvedCompleted, unapprovedCompleted, approvedInProgress, needsReviewRow];

describe("transcript import confirmation gate", () => {
  it("applies approved rows and never applies unapproved rows", () => {
    const included = new Set([approvedCompleted.id, approvedInProgress.id]);
    const selected = selectApprovedTranscriptRecords(ALL_ROWS, included);

    expect(selected.map((row) => row.id)).toEqual([
      approvedCompleted.id,
      approvedInProgress.id,
    ]);
    expect(selected.some((row) => row.id === unapprovedCompleted.id)).toBe(false);
  });

  it("applies nothing when no row is approved", () => {
    const selected = selectApprovedTranscriptRecords(ALL_ROWS, new Set());
    expect(selected).toEqual([]);
  });

  it("does not treat an unapproved needs-review row as applied", () => {
    const selected = selectApprovedTranscriptRecords(ALL_ROWS, new Set([needsReviewRow.id]));
    expect(selected).toEqual([]);
  });

  it("applies a needs-review row only after the user overrides it to completed", () => {
    const included = new Set([needsReviewRow.id]);
    const noOverride = selectApprovedTranscriptRecords(ALL_ROWS, included);
    expect(noOverride).toEqual([]);

    const overridden = selectApprovedTranscriptRecords(ALL_ROWS, included, {
      [needsReviewRow.id]: "completed",
    });
    expect(overridden.map((row) => row.id)).toEqual([needsReviewRow.id]);
    expect(overridden[0]?.appliedStatus).toBe("completed");
    expect(overridden[0]?.rationale).toContain("Manually included during transcript review.");
  });

  it("drops a row again when its approval is revoked", () => {
    const included = new Set([approvedCompleted.id]);
    expect(selectApprovedTranscriptRecords(ALL_ROWS, included).length).toBe(1);
    expect(selectApprovedTranscriptRecords(ALL_ROWS, new Set()).length).toBe(0);
  });
});

describe("approved rows applied to planner state (offline)", () => {
  // DOM lib types declare a global `window`, so cast through unknown to swap
  // it for happy-dom's Window (same pattern as planner-core.test.ts).
  const globalWithWindow = globalThis as unknown as { window?: Window | undefined };

  function withBrowserWindow(run: () => void) {
    globalWithWindow.window = new Window();
    try {
      run();
    } finally {
      delete globalWithWindow.window;
    }
  }

  it("persists approved rows and omits unapproved rows from saved planner state", () => {
    withBrowserWindow(() => {
      const included = new Set([approvedCompleted.id, approvedInProgress.id]);
      const selected = selectApprovedTranscriptRecords(ALL_ROWS, included);

      const state = getInitialPlannerState();
      const merged = { ...state, transcriptRecords: mergeTranscriptRecords(state.transcriptRecords ?? [], selected) };
      writePlannerStateToSessionStorage(merged);

      const persisted = readPlannerStateFromSessionStorage();
      expect(persisted?.transcriptRecords?.some((row) => row.id === approvedCompleted.id)).toBe(true);
      expect(persisted?.transcriptRecords?.some((row) => row.id === approvedInProgress.id)).toBe(true);
      expect(persisted?.transcriptRecords?.some((row) => row.id === unapprovedCompleted.id)).toBe(false);
      expect(persisted?.transcriptRecords?.some((row) => row.id === needsReviewRow.id)).toBe(false);
    });
  });
});
