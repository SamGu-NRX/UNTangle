"use client";

import type { CSSProperties } from "react";
import { cx } from "./cx";

export type ProgressBarProps = {
  /** 0–100. v1 name; same as `value` with the default `max`. */
  pct?: number;
  value?: number;
  max?: number;
  /** A constant-motion 30% segment for work of unknown length. */
  indeterminate?: boolean;
  /** v1: a visible label row with the percentage at right. */
  label?: string;
  /** Accessible name when there is no visible `label`. */
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * 4px pill: surface-3 track, brand fill. Indeterminate slides a 30% segment
 * at 1.2s linear, the one place linear easing is right (constant motion).
 */
export function ProgressBar({
  pct,
  value,
  max = 100,
  indeterminate,
  label,
  "aria-label": ariaLabel,
  className,
  style,
}: ProgressBarProps) {
  const raw = value ?? pct ?? 0;
  const ratio = Math.max(0, Math.min(1, max > 0 ? raw / max : 0));
  const percent = Math.round(ratio * 100);
  const bar = (
    <div
      className="ui-progress"
      role="progressbar"
      aria-label={label ?? ariaLabel}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : percent}
      data-indeterminate={indeterminate ? "" : undefined}
      data-ui=""
    >
      <span
        className="ui-progress__fill"
        data-ui=""
        style={indeterminate ? undefined : { transform: `translateX(${percent - 100}%)` }}
      />
    </div>
  );
  if (!label) {
    return (
      <div className={className} style={style}>
        {bar}
      </div>
    );
  }
  return (
    <div className={cx("ui-progress-labelled", className)} style={style}>
      <div className="ui-progress-labelled__row" aria-hidden="true">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      {bar}
    </div>
  );
}
