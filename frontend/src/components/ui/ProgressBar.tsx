"use client";

import type { CSSProperties } from "react";

export function ProgressBar({
  pct,
  label,
  className = "",
}: {
  pct: number;
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={className}>
      {label ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "var(--copy)",
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          <span>{label}</span>
          <span>{clamped}%</span>
        </div>
      ) : null}
      <div className="progress-track" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ "--p": clamped / 100 } as CSSProperties} />
      </div>
    </div>
  );
}
