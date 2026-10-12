"use client";

import type { CSSProperties } from "react";
import { usePlanner } from "@/components/planner-provider";
import { sectionNumber } from "@/lib/planner";

function LockGlyph({ locked }: { locked: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path
        d={locked ? "M5 7V5a3 3 0 0 1 6 0v2" : "M5 7V5a3 3 0 0 1 5.8-1"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

/**
 * Pin a scheduled section so optimizing never changes it. One toggle button
 * per section, named `Lock {COURSE} section {NNN}` with `aria-pressed` as the
 * state (evals/CONTRACT.md: unlock reuses the same button).
 *
 * The name comes from the button's own text, not an aria-label: the visible
 * word "Lock" plus a visually hidden "{COURSE} section {NNN}". An aria-label
 * with a visible "Locked" failed WCAG 2.5.3 (label in name; axe
 * label-content-name-mismatch). The locked state is the pressed styling and
 * the closed padlock.
 */
export function SectionLockButton({ courseCode, sectionId }: { courseCode: string; sectionId: string }) {
  const { plannerState, setSectionLock } = usePlanner();
  const locked = plannerState.lockedSections?.[courseCode] === sectionId;
  return (
    <button
      type="button"
      className="lock-toggle"
      aria-pressed={locked}
      data-locked={locked ? "true" : "false"}
      onClick={() => setSectionLock(courseCode, !locked)}
    >
      <LockGlyph locked={locked} />
      Lock<span style={VISUALLY_HIDDEN}> {courseCode} section {sectionNumber(sectionId)}</span>
    </button>
  );
}

export function ScheduleSectionLocks() {
  const { plannerState } = usePlanner();
  const scheduled = Object.entries(plannerState.selectedSections).sort(([a], [b]) => a.localeCompare(b));
  if (scheduled.length === 0) {
    return null;
  }
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
      {scheduled.map(([courseCode, sectionId]) => (
        <li key={courseCode} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: "0.84rem", minWidth: 0 }}>
            <strong>{courseCode}</strong>{" "}
            <span style={{ color: "var(--copy)", fontVariantNumeric: "tabular-nums" }}>§{sectionNumber(sectionId)}</span>
          </span>
          <SectionLockButton courseCode={courseCode} sectionId={sectionId} />
        </li>
      ))}
    </ul>
  );
}
