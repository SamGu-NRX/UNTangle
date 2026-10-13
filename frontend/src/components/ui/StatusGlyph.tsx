import { cx } from "./cx";

export type CourseStatusGlyph = "done" | "taking" | "planned" | "available" | "locked";

const NAMES: Record<CourseStatusGlyph, string> = {
  done: "Done",
  taking: "Taking",
  planned: "Planned",
  available: "Available",
  locked: "Locked",
};

/**
 * The 16px course-status glyph, shape first so status never rests on colour
 * alone: filled disc with a check (done), half-filled ring (taking), filled
 * brand disc (planned), open ring (available), dotted ring (locked).
 * Decorative by default because the row's status label carries the word;
 * pass `labelled` when the glyph stands alone.
 */
export function StatusGlyph({
  status,
  labelled,
  className,
}: {
  status: CourseStatusGlyph;
  labelled?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx("ui-status", `ui-status--${status}`, className)}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? NAMES[status] : undefined}
      aria-hidden={labelled ? undefined : true}
    />
  );
}
