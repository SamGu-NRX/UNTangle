/**
 * What the map and the itinerary both highlight: one class stop, one walking
 * leg, or nothing.
 * - `instant`: a keyboard choice. The camera and the list jump there instead
 *   of animating, because keyboard actions never animate.
 * - `afterSheet`: the phone sheet is moving to half height to show the map,
 *   so the camera waits for it (MOTION.md §6) instead of aiming at a map the
 *   sheet still covers.
 */
export type MapSelection = { kind: "stop" | "leg"; key: string; instant?: boolean; afterSheet?: boolean } | null;

/** A click from Enter or Space reports detail 0; a pointer click reports 1 or more. */
export function fromKeyboard(event: { detail: number }): boolean {
  return event.detail === 0;
}
