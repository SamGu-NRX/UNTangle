"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./cx";

export type ChipProps = Omit<ComponentPropsWithRef<"button">, "onChange"> & {
  selected: boolean;
  onSelectedChange?: (next: boolean) => void;
  /** Counting meta after the label, e.g. "10 min" renders "· 10 min". */
  count?: ReactNode;
  size?: "md" | "sm";
};

/**
 * Toggle chip (aria-pressed). Selected chips show a 12px check that appears
 * with the state; nothing slides.
 */
export function Chip({ selected, onSelectedChange, count, size = "md", className, children, onClick, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx("ui-chip", size === "sm" && "ui-chip--sm", className)}
      data-ui=""
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onSelectedChange?.(!selected);
      }}
      {...rest}
    >
      {selected ? (
        <svg className="ui-chip__check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2.5 6.5 5 9l4.5-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
      <span>{children}</span>
      {count !== undefined ? <span className="ui-chip__count">· {count}</span> : null}
    </button>
  );
}

/** Wraps chips with 6px gaps and names the set for assistive tech. */
export function ChipGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cx("ui-chip-group", className)}>
      {children}
    </div>
  );
}
