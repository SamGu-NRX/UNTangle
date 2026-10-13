/**
 * Whether the element with focus got it from the keyboard (it shows a focus
 * ring). Overlays read this when they open and close: an action taken from
 * the keyboard never animates (MOTION.md §1).
 */
export function keyboardFocused(): boolean {
  const active = typeof document === "undefined" ? null : document.activeElement;
  return active instanceof HTMLElement && active !== document.body && active.matches(":focus-visible");
}
