import { cx } from "./cx";

export type PlateProps = {
  /** Building code as campus signs show it: "GAB", "CURY". */
  building: string;
  /** Room number, set in body type after the plate. */
  room?: string;
  /** The building's full name, read out and shown on hover. */
  name?: string;
  /** Paper-3 plate with ink text, for dense lists. */
  quiet?: boolean;
  className?: string;
};

/**
 * A building plate (DESIGN.md §1): the code on a small dark-green plate in
 * DM Sans bold caps, then the room, `[GAB] 535`.
 */
export function Plate({ building, room, name, quiet, className }: PlateProps) {
  return (
    <span className={cx("ui-plate", quiet && "ui-plate--quiet", className)}>
      {name ? (
        <abbr className="ui-plate__code" title={name}>
          {building}
        </abbr>
      ) : (
        <b className="ui-plate__code">{building}</b>
      )}
      {room ? <span>{room}</span> : null}
    </span>
  );
}
