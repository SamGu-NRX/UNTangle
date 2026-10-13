"use client";

import { cx } from "./cx";

type Tone = "neutral" | "completed" | "in-progress" | "danger" | "review";

/**
 * @deprecated Course rows move to `StatusGlyph` plus a plain status label
 * (DESIGN.md §4 CourseRow). Kept because the v1 courses, schedule, map and
 * import views still render it; it now draws as a quiet 6px dot and 12.5px
 * text instead of a bordered pill.
 */
export function StatusMark({ label, tone = "neutral", className = "" }: { label: string; tone?: Tone; className?: string }) {
  return (
    <span className={cx("ui-status-mark", className)} data-tone={tone}>
      {label}
    </span>
  );
}
