"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * A fixed-height virtual list, small enough to read in one sitting. Browse all
 * can hold hundreds of weeks; only the rows near the visible part of the list
 * are in the DOM. The list lives inside a scroller it doesn't own (the
 * contextual panel's body, or the phone sheet's), so it measures where it sits
 * in that scroller instead of scrolling itself. No dependency: the repo has
 * none for virtualization, and fixed heights need only the arithmetic below.
 */

export type RowWindow = { first: number; last: number };

/**
 * Rows [first, last) that intersect the visible part of the list, widened by
 * `overscan` rows each way and clamped to the list. `listTop` is the list's
 * offset from the scroller's content top; `scrollTop` and `viewport` describe
 * what the scroller shows.
 */
export function visibleRows(input: {
  scrollTop: number;
  viewport: number;
  listTop: number;
  rowHeight: number;
  count: number;
  overscan: number;
}): RowWindow {
  const { scrollTop, viewport, listTop, rowHeight, count, overscan } = input;
  if (count <= 0 || rowHeight <= 0) return { first: 0, last: 0 };
  const top = scrollTop - listTop;
  const first = Math.max(0, Math.min(count, Math.floor(top / rowHeight) - overscan));
  const last = Math.max(first, Math.min(count, Math.ceil((top + viewport) / rowHeight) + overscan));
  return { first, last };
}

/**
 * The scrollTop that brings row `index` fully into view with the least
 * movement, or null when it already is. Rows taller than the viewport align
 * their top.
 */
export function revealRow(input: { index: number; scrollTop: number; viewport: number; listTop: number; rowHeight: number }): number | null {
  const { index, scrollTop, viewport, listTop, rowHeight } = input;
  const rowTop = listTop + index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  if (rowTop < scrollTop) return rowTop;
  if (rowBottom > scrollTop + viewport) return Math.min(rowTop, rowBottom - viewport);
  return null;
}

/**
 * The nearest ancestor that clips the list. `hidden` counts: the phone sheet's
 * body is `hidden` until the sheet is dragged up, and only its height of the
 * list shows until then.
 */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay" || overflow === "hidden") return node;
  }
  return null;
}

/** Where the list sits in `scroller`, and what it shows; the window when there is no scroller. Two rect reads, no style reads. */
function geometry(list: HTMLElement, scroller: HTMLElement | null) {
  if (!scroller) {
    const rect = list.getBoundingClientRect();
    return { scrollTop: window.scrollY, viewport: window.innerHeight, listTop: rect.top + window.scrollY };
  }
  const listTop = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  return { scrollTop: scroller.scrollTop, viewport: scroller.clientHeight, listTop };
}

/**
 * Tracks which rows of `count` fixed-height rows to render. Attach `ref` to
 * the list element (count × rowHeight tall). `reveal` scrolls the scroller
 * so a row is in view, for keyboard movement; `viewport` is the scroller's
 * visible height, for PageUp and PageDown.
 */
export function useVirtualRows(count: number, rowHeight: number, overscan = 4) {
  const ref = useRef<HTMLElement | null>(null);
  /** Found once per mount: the clipping ancestor doesn't change while the list is open. */
  const scroller = useRef<HTMLElement | null>(null);
  // Before the first measurement, render a screenful from the top.
  const [range, setRange] = useState<RowWindow>(() => ({ first: 0, last: Math.min(count, 12) }));

  const measure = useCallback(() => {
    const list = ref.current;
    if (!list) return;
    const { scrollTop, viewport, listTop } = geometry(list, scroller.current);
    const next = visibleRows({ scrollTop, viewport, listTop, rowHeight, count, overscan });
    setRange((current) => (current.first === next.first && current.last === next.last ? current : next));
  }, [count, rowHeight, overscan]);

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    scroller.current = scrollParent(list);
    measure();
    const target: HTMLElement | Window = scroller.current ?? window;
    target.addEventListener("scroll", measure, { passive: true });
    // The scroller resizing (a sheet raised, a window resized) and the text above the list
    // changing height (which moves the list without a scroll) both need a new window.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (scroller.current) observer?.observe(scroller.current);
    if (list.previousElementSibling) observer?.observe(list.previousElementSibling);
    if (!observer) window.addEventListener("resize", measure);
    return () => {
      target.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  const reveal = useCallback(
    (index: number) => {
      const list = ref.current;
      if (!list) return;
      const { scrollTop, viewport, listTop } = geometry(list, scroller.current);
      const to = revealRow({ index, scrollTop, viewport, listTop, rowHeight });
      if (to === null) return;
      if (scroller.current) scroller.current.scrollTop = to;
      else window.scrollTo({ top: to });
      measure();
    },
    [rowHeight, measure],
  );

  const viewport = useCallback(() => (scroller.current ? scroller.current.clientHeight : window.innerHeight), []);

  return { ref, range, reveal, viewport };
}
