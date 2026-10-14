import type { ReactNode } from "react";
import { cx } from "./cx";

export type CourseStatus = "done" | "covered" | "taking" | "planned" | "available" | "locked" | "check";

/** Default accessible names; a caller with more context passes `label`. */
const NAMES: Record<CourseStatus, string> = {
  done: "Done",
  covered: "Covered by another course",
  taking: "Taking now",
  planned: "Planned",
  available: "You can take this",
  locked: "Locked",
  check: "Check with an advisor",
};

/*
 * Shape first, so a status never rests on color alone: a filled disc with a
 * check, a dashed ring with a check, a half-filled ring, a disc with a dot, an
 * open ring, a lock, and a ring with "!". Drawn on a 24-unit grid.
 */
const SHAPES: Record<CourseStatus, ReactNode> = {
  done: (
    <>
      <circle cx="12" cy="12" r="8.5" style={{ fill: "var(--ink-2)" }} />
      <path d="M8.2 12.3l2.6 2.6 5-5.2" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  covered: (
    <>
      <circle cx="12" cy="12" r="7.75" fill="none" strokeWidth="1.5" strokeDasharray="2.6 2.2" style={{ stroke: "var(--ink-3)" }} />
      <path d="M8.4 12.3l2.5 2.5 4.8-5" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--ink-2)" }} />
    </>
  ),
  taking: (
    <>
      <circle cx="12" cy="12" r="7.75" fill="none" strokeWidth="2" style={{ stroke: "var(--accent)" }} />
      <path d="M12 4.25a7.75 7.75 0 0 1 0 15.5z" style={{ fill: "var(--accent)" }} />
    </>
  ),
  planned: (
    <>
      <circle cx="12" cy="12" r="8.5" style={{ fill: "var(--brand)" }} />
      <circle cx="12" cy="12" r="3" fill="#fff" />
    </>
  ),
  available: <circle cx="12" cy="12" r="7.75" fill="none" strokeWidth="1.5" style={{ stroke: "var(--ink-3)" }} />,
  locked: (
    <>
      <rect x="7.2" y="11" width="9.6" height="7.2" rx="1.6" style={{ fill: "var(--ink-4)" }} />
      <path d="M9.4 11V9.2a2.6 2.6 0 0 1 5.2 0V11" fill="none" strokeWidth="1.6" style={{ stroke: "var(--ink-4)" }} />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="7.75" strokeWidth="1.5" style={{ fill: "var(--attention-soft)", stroke: "var(--attention)" }} />
      <path d="M12 8v4.6" strokeWidth="2" strokeLinecap="round" style={{ stroke: "var(--attention)" }} />
      <circle cx="12" cy="15.6" r="1.1" style={{ fill: "var(--attention)" }} />
    </>
  ),
};

/** The 18px course-status glyph (DESIGN.md §8.2), always with an accessible name. */
export function StatusGlyph({ status, label, className }: { status: CourseStatus; label?: string; className?: string }) {
  return (
    <svg className={cx("ui-glyph", className)} viewBox="0 0 24 24" role="img" aria-label={label ?? NAMES[status]} data-status={status}>
      {SHAPES[status]}
    </svg>
  );
}
