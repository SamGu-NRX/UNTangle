"use client";

type Tone = "neutral" | "completed" | "in-progress" | "danger" | "review";

export function StatusMark({
  label,
  tone = "neutral",
  className = "",
}: {
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span className={`status-mark ${className}`} data-tone={tone}>
      {label}
    </span>
  );
}
