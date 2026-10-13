/**
 * What the map and the itinerary both highlight: one class stop, one walking
 * leg, or nothing. `instant` marks a keyboard choice: the camera and the list
 * jump there instead of animating, because keyboard actions never animate.
 */
export type MapSelection = { kind: "stop" | "leg"; key: string; instant?: boolean } | null;

/** A click from Enter or Space reports detail 0; a pointer click reports 1 or more. */
export function fromKeyboard(event: { detail: number }): boolean {
  return event.detail === 0;
}
