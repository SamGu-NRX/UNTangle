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

/**
 * Each lens keeps its own place (DESIGN.md §3.4): the page it was on and its
 * scroll position. A tab or view tab returns to both; tapping the lens
 * you are on scrolls it to the top. Switching never animates.
 *
 * Positions are kept for this visit only. A switch restores the position
 * only when it came from the tabs, so a link into another lens ("Open in
 * Week") still opens that page at its top.
 */
export function useLensMemory(lens: Lens | null, pathname: string) {
  // `/` is where the app opens, not a place in Courses: it is never
  // remembered, so the landing rule still sees the lens used before it.
  const place = pathname === "/" ? null : lens;
  const [hrefs, setHrefs] = useState<Record<Lens, string>>({ ...LENS_HREF });
  if (place && hrefs[place] !== pathname) setHrefs({ ...hrefs, [place]: pathname });

  const positions = useRef<Partial<Record<Lens, number>>>({});
  const current = useRef(lens);
  const restoreTo = useRef<Lens | null>(null);

  useLayoutEffect(() => {
    current.current = lens;
    if (!lens) return;
    if (pathname !== "/") writeLastLens(lens);
    if (restoreTo.current !== lens) return;
    restoreTo.current = null;
    const target = positions.current[lens] ?? 0;
    // The page may still be growing (a list filling in); try for a few frames.
    let frames = 0;
    let handle = 0;
    const restore = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) > 1 && frames++ < 10) handle = requestAnimationFrame(restore);
    };
    restore();
    return () => cancelAnimationFrame(handle);
  }, [lens, pathname]);

  // Scroll events arrive after layout effects, so a position clamped by the
  // switch itself is recorded for the new lens, never the one being left.
  useEffect(() => {
    const record = () => {
      if (current.current) positions.current[current.current] = window.scrollY;
    };
    window.addEventListener("scroll", record, { passive: true });
    return () => window.removeEventListener("scroll", record);
  }, []);

  const pick = (target: Lens, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (target === lens && pathname === hrefs[target]) {
      event.preventDefault();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      return;
    }
    restoreTo.current = target;
  };

  return { hrefs, pick };
}
