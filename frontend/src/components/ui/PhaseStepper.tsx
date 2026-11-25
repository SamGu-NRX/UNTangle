"use client";

export function PhaseStepper({
  current,
  total = 4,
}: {
  current: number; // 0-indexed; pass total to mark all done
  total?: number;
}) {
  return (
    <div className="phase-stepper" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={current + 1}>
      {Array.from({ length: total }, (_, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return <span key={i} className="phase-stepper__dot" data-state={state} />;
      })}
    </div>
  );
}
