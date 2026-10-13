/**
 * Whether the last thing the reader did was press a key, and focus shows a
 * ring. Overlays read this when they open and close: an action taken from
 * the keyboard never animates (MOTION.md §1). The last input counts rather
 * than :focus-visible alone, because a mouse click on a control that kept a
 * focus ring from earlier keyboard use is still a pointer action.
 */
let lastInput: "keyboard" | "pointer" = "pointer";

if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => (lastInput = "keyboard"), { capture: true, passive: true });
  window.addEventListener("pointerdown", () => (lastInput = "pointer"), { capture: true, passive: true });
}

export function keyboardFocused(): boolean {
  if (typeof document === "undefined" || lastInput !== "keyboard") return false;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body && active.matches(":focus-visible");
}
