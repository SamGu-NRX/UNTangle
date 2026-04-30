"use client";

import { Children, cloneElement, isValidElement, type ReactNode, type CSSProperties } from "react";

const STEP_MS = 40;
const CAP = 6;

/**
 * Fragment-style stagger: clones each direct child and applies an inline
 * `content-enter` animation with an incrementing delay (capped). No wrapper
 * element so it can sit inside grids/flex containers transparently.
 */
export function StaggerGroup({
  children,
  step = STEP_MS,
}: {
  children: ReactNode;
  step?: number;
}) {
  return (
    <>
      {Children.map(children, (child, i) => {
        if (!isValidElement(child)) return child;
        const delay = Math.min(i, CAP) * step;
        const existing = (child.props as { style?: CSSProperties }).style ?? {};
        const style: CSSProperties = {
          ...existing,
          animation: "content-enter var(--d-enter) var(--ease-out) both",
          animationDelay: `${delay}ms`,
        };
        return cloneElement(child as React.ReactElement<{ style?: CSSProperties }>, { style });
      })}
    </>
  );
}
