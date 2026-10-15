/**
 * Week's programmatic motion (MOTION.md §3, §9), on WAAPI so it stays on the
 * compositor and can be cancelled mid-flight. Curves and durations come from
 * the CSS tokens, so there is one source for them.
 */

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Browsers without WAAPI (and test DOMs) change state without the motion. */
const canAnimate = (element: Element) => typeof element.animate === "function";

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const ms = (value: string) => Number.parseFloat(value) || 0;
const easeOut = () => token("--ease-out", "cubic-bezier(.23, 1, .32, 1)");

/**
 * Replaces one text with another in place (Next, and the best-so-far
 * upgrade): the old leaves in 110ms, 4px left through a 2px blur; the new
 * enters in --t-swap from 8px right. The blur hides the double image of a
 * plain crossfade. A second call mid-swap doesn't restart: the new text goes
 * in at once and enters from wherever the fade had reached. Instant from the
 * keyboard; a 120ms fade under reduced motion.
 */
export function swapText(element: HTMLElement | null, apply: () => void, instant: boolean) {
  if (!element || !canAnimate(element)) return apply();
  const running = element.getAnimations();
  const opacity = running.length > 0 ? Number(getComputedStyle(element).opacity) : 1;
  running.forEach((animation) => animation.cancel());
  if (instant) return apply();
  if (reducedMotion()) {
    apply();
    element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: easeOut() });
    return;
  }
  const enter = (from: number) =>
    element.animate(
      [
        { opacity: from, transform: "translateX(8px)", filter: "blur(2px)" },
        { opacity: 1, transform: "none", filter: "blur(0)" },
      ],
      { duration: ms(token("--t-swap", "160ms")), easing: easeOut() },
    );
  if (running.length > 0) {
    apply();
    enter(Math.min(opacity, 1));
    return;
  }
  const out = element.animate(
    [
      { opacity: 1, transform: "none", filter: "blur(0)" },
      { opacity: 0, transform: "translateX(-4px)", filter: "blur(2px)" },
    ],
    { duration: 110, easing: easeOut(), fill: "forwards" },
  );
  out.onfinish = () => {
    apply();
    out.cancel();
    enter(0);
  };
}

type Point = { x: number; y: number };

/** An element's layout position in `origin`'s padding box, ignoring any transform on it. */
function layoutOf(element: HTMLElement): Point {
  const column = element.offsetParent === element.parentElement ? element.parentElement : null;
  return { x: element.offsetLeft + (column?.offsetLeft ?? 0), y: element.offsetTop + (column?.offsetTop ?? 0) };
}

/** Where an element is drawn now, transforms included, in `origin`'s padding box. */
export function visualOf(origin: HTMLElement, element: HTMLElement): Point {
  const base = origin.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return { x: rect.left - base.left - origin.clientLeft, y: rect.top - base.top - origin.clientTop };
}

/**
 * Layout positions of the keyed events, for the next FLIP. Offsets, not
 * rects: a FLIP that has just started already draws its first keyframe, and
 * a rect would record the old slot as the new one.
 */
export function measure(elements: HTMLElement[]): Map<string, Point> {
  return new Map(elements.map((element) => [element.dataset.key ?? "", layoutOf(element)]));
}

/**
 * FLIP: each element moves from where it was to where it now is laid out,
 * with --ease-in-out over `duration` (--t-move, 300ms; 260ms for Undo and
 * for leaving a preview, MOTION.md §7). An element caught mid-flight starts
 * from where it is drawn, so a second change turns it instead of jumping.
 * New elements fade in over --t-swap. All reads, then all writes. Under
 * reduced motion nothing moves and new elements fade in 120ms.
 */
export function flip(origin: HTMLElement, elements: HTMLElement[], before: Map<string, Point>, duration: number) {
  const reduce = reducedMotion();
  const moves = elements.map((element) => {
    const now = layoutOf(element);
    const drawn = visualOf(origin, element);
    // What a running animation adds right now; zero when nothing is moving.
    const flight = { x: drawn.x - now.x, y: drawn.y - now.y };
    const from = before.get(element.dataset.key ?? "");
    return { element, from, dx: from ? from.x + flight.x - now.x : 0, dy: from ? from.y + flight.y - now.y : 0 };
  });
  const easing = token("--ease-in-out", "cubic-bezier(.77, 0, .175, 1)");
  const fade = reduce ? 120 : ms(token("--t-swap", "160ms"));
  for (const { element, from, dx, dy } of moves) {
    if (!canAnimate(element)) continue;
    element.getAnimations().forEach((animation) => animation.cancel());
    if (!from) {
      element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fade, easing: easeOut() });
    } else if (!reduce && Math.abs(dx) + Math.abs(dy) > 1) {
      element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration, easing });
    }
  }
}

export const MOVE_MS = () => ms(token("--t-move", "300ms"));
/** Undo and leaving a preview are exits, so a little faster than a move (MOTION.md §7). */
export const EXIT_MOVE_MS = 260;

/** A dragged event that missed every section springs back in 260ms (MOTION.md §3). */
export function settleBack(element: HTMLElement, from: string) {
  element.style.transform = "";
  if (reducedMotion() || !canAnimate(element)) return;
  element.animate([{ transform: from }, { transform: "none" }], { duration: EXIT_MOVE_MS, easing: easeOut() });
}
