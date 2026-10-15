/**
 * Marks `element` with data-pressed while a pointer holds it down, so press
 * feedback (scale .97) follows pointer input only. `:active` would also fire
 * for Space and Enter, and keyboard-initiated actions never animate
 * (docs/design/do-not.md).
 */
export function trackPress(element: HTMLElement): void {
  const release = () => element.removeAttribute("data-pressed");
  element.addEventListener("pointerdown", event => {
    if (event.button === 0)
      element.setAttribute("data-pressed", "");
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave", "keydown", "blur"])
    element.addEventListener(type, release);
}
