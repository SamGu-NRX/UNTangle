"use client";

export function StepBar({
  total,
  current,
  className = "",
}: {
  total: number;
  current: number;
  className?: string;
}) {
  return (
    <div className={`step-bar ${className}`} aria-label={`Step ${current + 1} of ${total}`}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="step-bar__bar"
          data-state={i < current ? "done" : i === current ? "active" : "pending"}
        />
      ))}
    </div>
  );
}
