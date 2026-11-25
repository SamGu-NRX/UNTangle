"use client";

import type { ReactNode } from "react";

type Tone = "done" | "progress" | "none";

export function CountChip({
  count,
  label,
  tone = "none",
  icon,
}: {
  count: number;
  label: string;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <span className="count-chip" data-tone={tone}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span className="count-chip__num">{count}</span>
      <span>{label}</span>
    </span>
  );
}
