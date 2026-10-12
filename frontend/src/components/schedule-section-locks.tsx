"use client";

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

/**
 * Pin a scheduled section so optimizing never changes it. One toggle button
 * per section, named `Lock {COURSE} section {NNN}` with `aria-pressed` as the
 * state (evals/CONTRACT.md: unlock reuses the same button).
 */
export function SectionLockButton({ courseCode, sectionId }: { courseCode: string; sectionId: string }) {
  const { plannerState, setSectionLock } = usePlanner();
  const locked = plannerState.lockedSections?.[courseCode] === sectionId;
  return (
    <button
      type="button"
      className="lock-toggle"
      aria-label={`Lock ${courseCode} section ${sectionNumber(sectionId)}`}
      aria-pressed={locked}
      data-locked={locked ? "true" : "false"}
      onClick={() => setSectionLock(courseCode, !locked)}
    >
      <LockGlyph locked={locked} />
      <span aria-hidden="true">{locked ? "Locked" : "Lock"}</span>
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
