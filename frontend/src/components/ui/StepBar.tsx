"use client";

/**
 * @deprecated v2 has no step sequence (DESIGN.md §8). Still imported by
 * auth-shell.tsx; delete once the auth re-skin (HANDOFF step 9) drops it.
 */
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
    <div className={`step-bar ${className}`} aria-label={`Step ${current + 1} of ${total}`} role="img">
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
