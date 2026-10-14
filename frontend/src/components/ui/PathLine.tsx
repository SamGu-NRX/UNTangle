import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * The connector from a stop to the next one.
 *
 * - `done`: satisfied or upcoming order (a prerequisite met, an import step).
 * - `todo`: not yet met, dashed.
 * - `past`: already passed, grey.
 * - `walk`, `tight`, `late`: the walk between two places (docs/design/untangle-v3.md,
 *   "The walk is drawn"). A 2px route line with the minutes on it; `tight` is
 *   a walk that fits the break with under two minutes to spare, `late` one
 *   longer than the break.
 */
export type PathLeg = "done" | "todo" | "past" | "walk" | "tight" | "late";

/** The disc: brand by default, grey once passed, an open ring, or accent for "you are here". */
export type PathStopTone = "default" | "past" | "ring" | "here";

/** Read after the chip, so a tight or late walk is never told by color alone. */
const LEG_WORDS: Partial<Record<PathLeg, string>> = {
  tight: ", tight",
  late: ", longer than the break",
};

export function PathLine({
  orientation = "vertical",
  label,
  className,
  children,
}: {
  orientation?: "vertical" | "horizontal";
  /** Names the sequence, e.g. "Your day" or "Prerequisites". */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ol className={cx("ui-path", className)} data-orientation={orientation} aria-label={label}>
      {children}
    </ol>
  );
}

export function PathStop({
  marker,
  tone = "default",
  leg,
  chip,
  children,
  className,
}: {
  /** A number or a 14px glyph in the disc. Decorative: the row says what it is. */
  marker?: ReactNode;
  tone?: PathStopTone;
  /** The connector to the next stop; leave it out on the last stop. */
  leg?: PathLeg;
  /** Short text on the connector, such as "4 min". */
  chip?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <li className={cx("ui-path__item", className)} data-leg={leg}>
      <span className="ui-path__stop" data-tone={tone} aria-hidden="true">
        {marker}
      </span>
      {children}
      {leg && chip ? (
        <span className="ui-path__chip">
          {chip}
          {LEG_WORDS[leg] ? <span className="sr-only-v2">{LEG_WORDS[leg]}</span> : null}
        </span>
      ) : null}
    </li>
  );
}
