/**
 * Motion for the Courses list (MOTION.md §7 and §8). Elements that can move
 * carry `data-flip="<key>"`; a row in a group is `row:<id>`, the same course
 * in the term tray is `tray:<id>`. Every function measures once before and
 * once after a single DOM change, and writes transforms on the moving
 * element itself. Transform and opacity only.
 */

/** Auto's timeline (MOTION.md §8), in ms from the press. */
export const AUTO_TIMELINE = {
  /** The engine runs; nothing else moves. The plan is decided at once, so this is the spinner's minimum. */
  engine: 450,
  /** Picked rows tint, then the plan commits 160ms later. */
  tint: 160,
  /** Rows and headers below the tray move to their new places. */
  flip: 320,
  /** Each picked row's flight starts 80ms after the commit, 55ms after the one before. */
  flightDelay: 80,
  flightStagger: 55,
  /** Reduced motion: tray rows fade in, 30ms apart, over 160ms. */
  fadeStagger: 30,
  fade: 160,
  /** Undo: rows go back with no stagger, faster than they came (exits are faster). */
  undo: 260,
} as const;

/** One-off add (300ms) or removal (260ms) of a row; the new row fades in over 160ms (MOTION.md §7). */
export const MOVE = { add: 300, remove: 260, fadeIn: 160 } as const;

/** Over this many rows moving at once, nothing moves: a re-sort reads better as an instant swap (MOTION.md §7). */
const MAX_MOVING = 30;

export type Rects = Map<string, DOMRect>;

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
const easeInOut = () => token("--ease-in-out", "cubic-bezier(.77, 0, .175, 1)");
const easeOut = () => token("--ease-out", "cubic-bezier(.23, 1, .32, 1)");
/** A CSS duration in ms, or null. The production CSS minifier writes `420ms` as `.42s`, so both units are read. */
export function parseDuration(value: string): number | null {
  const match = value.trim().match(/^(\d*\.?\d+)(ms|s)$/);
  if (!match) return null;
  return match[2] === "ms" ? Number(match[1]) : Number(match[1]) * 1000;
}
const flightMs = () => parseDuration(token("--t-reveal", "")) ?? 420;

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const keyed = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>("[data-flip]")];

export function measure(root: ParentNode): Rects {
  return new Map(keyed(root).map((element) => [element.dataset.flip!, element.getBoundingClientRect()]));
}

const onScreen = (rect: DOMRect) => rect.bottom > 0 && rect.top < window.innerHeight;

/**
 * Moves every keyed element from where it was (`first`) to where it is now.
 * An element with no earlier place takes the place of `from(key)` (a course
 * row entering the tray from its group, or back) and travels above the rows
 * it passes; one with neither fades in. Off-screen moves are skipped. With
 * `move: false` (reduced motion) nothing moves and only new elements fade.
 */
export function flip(
  root: ParentNode,
  first: Rects,
  {
    duration,
    from,
    fadeIn = 0,
    move = true,
  }: { duration: number; from?: (key: string) => string | undefined; fadeIn?: number; move?: boolean },
): Animation[] {
  const moves: Array<{ element: HTMLElement; dx: number; dy: number; lifted: boolean }> = [];
  const entering: HTMLElement[] = [];
  for (const element of keyed(root)) {
    const key = element.dataset.flip!;
    const last = element.getBoundingClientRect();
    const own = first.get(key);
    const alias = own ? undefined : from?.(key);
    const start = own ?? (alias ? first.get(alias) : undefined);
    if (!start) {
      if (fadeIn > 0 && onScreen(last)) entering.push(element);
      continue;
    }
    const dx = start.left - last.left;
    const dy = start.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    if (!onScreen(start) && !onScreen(last)) continue;
    moves.push({ element, dx, dy, lifted: Boolean(alias) });
  }
  if (moves.length > MAX_MOVING || !move) moves.length = 0;
  const easing = easeInOut();
  const animations = moves.map(({ element, dx, dy, lifted }) => {
    if (lifted) element.dataset.lifted = "";
    const animation = element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration, easing });
    if (lifted) animation.finished.catch(() => {}).finally(() => delete element.dataset.lifted);
    return animation;
  });
  for (const element of entering) {
    animations.push(element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fadeIn, easing: easeOut() }));
  }
  return animations;
}

/**
 * A copy of a picked row flying from its place in the list to its slot in
 * the tray, above everything (it lives in <body>, outside the page that a
 * panel may shift). Rows below the fold start from the bottom edge.
 */
export function fly(source: HTMLElement, from: DOMRect, to: DOMRect, delay: number): { animation: Animation; remove: () => void } {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-flip");
  clone.removeAttribute("data-selected");
  clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  clone.setAttribute("aria-hidden", "true");
  clone.inert = true;
  clone.dataset.flyer = "";
  const top = Math.min(Math.max(from.top, -from.height), window.innerHeight + 8);
  Object.assign(clone.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${top}px`,
    width: `${to.width}px`,
    height: `${from.height}px`,
    margin: "0",
  });
  document.body.append(clone);
  const animation = clone.animate(
    [{ transform: "translate(0, 0)" }, { transform: `translate(${to.left - from.left}px, ${to.top - top}px)` }],
    { duration: flightMs(), delay, easing: easeInOut(), fill: "both" },
  );
  return { animation, remove: () => clone.remove() };
}

export function fadeIn(element: HTMLElement, delay: number): Animation {
  return element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: AUTO_TIMELINE.fade, delay, easing: easeOut(), fill: "backwards" });
}

export const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
