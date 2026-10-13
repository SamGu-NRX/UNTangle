"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export type SegmentedOption<V extends string> = { value: V; label: ReactNode; disabled?: boolean };

export type SegmentedProps<V extends string> = {
  /** Accessible name of the group, e.g. "Day". */
  label: string;
  options: SegmentedOption<V>[];
  value: V | null;
  onValueChange: (value: V) => void;
  size?: "md" | "sm";
  /** Stretches to the container; used on phones. */
  fullWidth?: boolean;
  className?: string;
};

/**
 * Index of the next enabled option from `from` moving by `delta`, wrapping
 * (radio groups wrap, per the APG). Returns `from` if none is enabled.
 */
export function nextEnabledWrapping(disabled: boolean[], from: number, delta: 1 | -1): number {
  const n = disabled.length;
  for (let step = 1; step <= n; step += 1) {
    const i = (((from + delta * step) % n) + n) % n;
    if (!disabled[i]) return i;
  }
  return from;
}

/**
 * Segmented control as a radio group: Tab enters on the selected segment,
 * arrows move and select (wrapping), Home/End jump. Segments share one
 * width, so the selected pill is a single element that moves with
 * transform alone (DESIGN.md §4): no measuring, nothing to settle after
 * hydration, and the labels themselves never animate. Arrow keys move the
 * pill instantly; keyboard actions never animate (DESIGN.md §1).
 */
export function Segmented<V extends string>({
  label,
  options,
  value,
  onValueChange,
  size = "md",
  fullWidth,
  className,
}: SegmentedProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const index = options.findIndex((option) => option.value === value);
  const disabled = options.map((option) => Boolean(option.disabled));

  const move = (to: number, keyboard: boolean) => {
    const option = options[to];
    if (!option || option.disabled) return;
    setFromKeyboard(keyboard);
    onValueChange(option.value);
    refs.current[to]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(nextEnabledWrapping(disabled, at, 1), true);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(nextEnabledWrapping(disabled, at, -1), true);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(nextEnabledWrapping(disabled, -1, 1), true);
    } else if (event.key === "End") {
      event.preventDefault();
      move(nextEnabledWrapping(disabled, options.length, -1), true);
    }
  };

  // The selected segment is the tab stop unless it is missing or disabled
  // (a disabled button cannot take focus); then the first enabled one is.
  const tabStop = index >= 0 && !disabled[index] ? index : nextEnabledWrapping(disabled, -1, 1);

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("ui-seg", size === "sm" && "ui-seg--sm", fullWidth && "ui-seg--full", className)}
      style={{ "--seg-count": options.length } as CSSProperties}
      data-instant={fromKeyboard ? "" : undefined}
      data-ui=""
    >
      <SegmentPill index={index} />
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(node) => {
            refs.current[i] = node;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          disabled={option.disabled}
          tabIndex={i === tabStop ? 0 : -1}
          className="ui-seg__item"
          onClick={(event) => move(i, event.detail === 0)}
          onKeyDown={(event) => onKeyDown(event, i)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The one moving pill. Hidden when nothing is selected. */
export function SegmentPill({ index }: { index: number }) {
  return (
    <span
      className="ui-seg__pill"
      aria-hidden="true"
      data-ui=""
      hidden={index < 0}
      style={{ transform: `translateX(${Math.max(index, 0) * 100}%)` }}
    />
  );
}
