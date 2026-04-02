"use client";

import { Children, cloneElement, isValidElement, type CSSProperties, type ReactNode } from "react";

const STEP_MS = 40;
const CAP = 6;

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
        if (!isValidElement<{ style?: CSSProperties }>(child)) return child;
        const delay = Math.min(i, CAP) * step;
        const style: CSSProperties = {
          ...child.props.style,
          animation: "content-enter var(--d-enter) var(--ease-out) both",
          animationDelay: `${delay}ms`,
        };
        return cloneElement(child, { style });
      })}
    </>
  );
}
