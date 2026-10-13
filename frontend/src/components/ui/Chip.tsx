"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./cx";
import { Check } from "./icons";

export type ChipProps = Omit<ComponentPropsWithRef<"button">, "onChange"> & {
  selected: boolean;
  onSelectedChange?: (next: boolean) => void;
  /** A quieter fact after the label, such as "10 min", set apart by weight and color. */
  count?: ReactNode;
  size?: "md" | "sm";
  /** `warn` draws the chip in attention, for a choice that costs something. */
  tone?: "default" | "warn";
};

/**
 * Toggle chip (aria-pressed), 32px. On is a brand-soft fill, a 1.5px brand
 * ring and a check; the check appears with the state and nothing slides.
 */
export function Chip({ selected, onSelectedChange, count, size = "md", tone = "default", className, children, onClick, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx("ui-chip", size === "sm" && "ui-chip--sm", className)}
      data-tone={tone === "warn" ? "warn" : undefined}
      data-ui=""
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onSelectedChange?.(!selected);
      }}
      {...rest}
    >
      {selected ? <Check size={14} className="ui-chip__check" /> : null}
      <span>{children}</span>
      {count !== undefined ? <span className="ui-chip__count">{count}</span> : null}
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
