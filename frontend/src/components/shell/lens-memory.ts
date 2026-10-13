"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { LENS_HREF, isLens, type Lens } from "./routes";

const LAST_LENS_KEY = "untangle:last-lens";

/** The lens the student last had open, for the landing rule. Null when never set or unreadable. */
export function readLastLens(): Lens | null {
  try {
    const value = window.localStorage.getItem(LAST_LENS_KEY);
    return isLens(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLastLens(lens: Lens) {
  try {
    window.localStorage.setItem(LAST_LENS_KEY, lens);
  } catch {
    // Storage can be full or blocked; landing then falls back to Courses.
  }
}

/** Where a lens was scrolled: the window, and each of its own scroll containers in order. */
type Place = { window: number; containers: number[] };

/**
 * A lens that scrolls inside its own element (Day's itinerary) marks it
 * with `data-lens-scroll`, so its position is kept along with the window's.
 */
const containers = () => Array.from(document.querySelectorAll<HTMLElement>("#main [data-lens-scroll]"));

function read(): Place {
  return { window: window.scrollY, containers: containers().map((el) => el.scrollTop) };
}

/** Puts a lens back where it was; true once every position took. */
function apply(place: Place): boolean {
  window.scrollTo(0, place.window);
  const els = containers();
  els.forEach((el, i) => {
    if (place.containers[i] !== undefined) el.scrollTop = place.containers[i];
  });
  const containersOk = place.containers.every((top, i) => els[i] && Math.abs(els[i].scrollTop - top) <= 1);
  return Math.abs(window.scrollY - place.window) <= 1 && containersOk;
}

/**
 * Each lens keeps its own place (DESIGN.md §3.4): the page it was on and its
 * scroll positions. A tab or view tab returns to both; tapping the lens you
 * are on scrolls it to the top. Switching never animates.
 *
 * Positions are kept for this visit only. A switch restores them only when
 * it came from the tabs, so a link into another lens ("Open in Week") still
 * opens that page at its top.
 */
export function useLensMemory(lens: Lens | null, pathname: string) {
  // `/` is where the app opens, not a place in Courses: it is never
  // remembered, so the landing rule still sees the lens used before it.
  const place = pathname === "/" ? null : lens;
  const [hrefs, setHrefs] = useState<Record<Lens, string>>({ ...LENS_HREF });
  if (place && hrefs[place] !== pathname) setHrefs({ ...hrefs, [place]: pathname });

  const places = useRef<Partial<Record<Lens, Place>>>({});
  const current = useRef(lens);
  const restoreTo = useRef<Lens | null>(null);
  /** While a restore is still trying, scroll events are the restore's own, not the student's. */
  const restoring = useRef(false);

  useLayoutEffect(() => {
    current.current = lens;
    if (!lens) return;
    if (pathname !== "/") writeLastLens(lens);
    if (restoreTo.current !== lens) return;
    restoreTo.current = null;
    const target = places.current[lens];
    if (!target) return;
    // The page may still be filling in (a list, the map's itinerary); try for a few frames.
    restoring.current = true;
    let frames = 0;
    let handle = 0;
    const attempt = () => {
      if (apply(target) || frames++ >= 20) {
        restoring.current = false;
        return;
      }
      handle = requestAnimationFrame(attempt);
    };
    attempt();
    return () => {
      cancelAnimationFrame(handle);
      restoring.current = false;
    };
  }, [lens, pathname]);

  // Scroll events arrive after layout effects, so a position clamped by the
  // switch itself is recorded for the new lens, never the one being left.
  useEffect(() => {
    const record = () => {
      if (current.current && !restoring.current) places.current[current.current] = read();
    };
    document.addEventListener("scroll", record, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", record, { capture: true });
  }, []);

  const pick = (target: Lens, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (target === lens && pathname === hrefs[target]) {
      event.preventDefault();
      // A keyboard press, or reduced motion, jumps; a tap scrolls up.
      const behavior = event.detail === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      window.scrollTo({ top: 0, behavior });
      for (const el of containers()) el.scrollTo({ top: 0, behavior });
      return;
    }
    restoreTo.current = target;
  };

  return { hrefs, pick };
}
