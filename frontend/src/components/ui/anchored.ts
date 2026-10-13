"use client";

import { useLayoutEffect, type RefObject } from "react";

export type Side = "bottom" | "top";
export type Align = "start" | "end" | "center";

export type AnchorRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export type Placement = {
  x: number;
  y: number;
  side: Side;
  /** transform-origin in the floating element's own coordinates. */
  originX: number;
  originY: number;
  /** Height available on the chosen side, for internal scrolling. */
  available: number;
};

const EDGE = 8;

/**
 * Places a floating box against an anchor: on the preferred side unless the
 * other side has more room, aligned to the anchor's start, end or centre,
 * clamped inside the viewport. The origin points back at the anchor so a
 * popover scales out of its trigger (DESIGN.md §6).
 */
export function placeFloating(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { side?: Side; align?: Align; offset?: number } = {},
): Placement {
  const offset = opts.offset ?? 4;
  const preferred = opts.side ?? "bottom";
  const below = viewport.height - anchor.bottom - offset - EDGE;
  const above = anchor.top - offset - EDGE;
  let side: Side = preferred;
  if (preferred === "bottom" && size.height > below && above > below) side = "top";
  if (preferred === "top" && size.height > above && below > above) side = "bottom";

  const align = opts.align ?? "start";
  let x =
    align === "start"
      ? anchor.left
      : align === "end"
        ? anchor.right - size.width
        : anchor.left + anchor.width / 2 - size.width / 2;
  x = Math.max(EDGE, Math.min(x, viewport.width - size.width - EDGE));

  const available = side === "bottom" ? below : above;
  const height = Math.min(size.height, available);
  const y = side === "bottom" ? anchor.bottom + offset : anchor.top - offset - height;

  const anchorX = align === "start" ? anchor.left : align === "end" ? anchor.right : anchor.left + anchor.width / 2;
  return {
    x,
    y,
    side,
    originX: Math.max(0, Math.min(size.width, anchorX - x)),
    originY: side === "bottom" ? 0 : height,
    available: Math.max(0, available),
  };
}

/**
 * Keeps `floating` positioned (position: fixed) against `anchor` while
 * mounted, following scroll and resize. Writes styles directly on the
 * element rather than through React state, so tracking never re-renders.
 */
export function useAnchoredPosition(
  mounted: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  opts: { side?: Side; align?: Align; offset?: number; matchWidth?: boolean } = {},
) {
  const { side, align, offset, matchWidth } = opts;
  useLayoutEffect(() => {
    if (!mounted) return;
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      if (matchWidth) floating.style.minWidth = `${anchor.offsetWidth}px`;
      const rect = anchor.getBoundingClientRect();
      // offsetWidth/Height ignore the enter scale, so the box measures true.
      const place = placeFloating(
        rect,
        { width: floating.offsetWidth, height: floating.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { side, align, offset },
      );
      floating.style.left = `${Math.round(place.x)}px`;
      floating.style.top = `${Math.round(place.y)}px`;
      floating.style.transformOrigin = `${place.originX}px ${place.originY}px`;
      floating.style.setProperty("--ui-available-height", `${Math.floor(place.available)}px`);
      // Where the anchor sits along the box, for an arrow that points at it.
      floating.style.setProperty("--ui-anchor-x", `${Math.round(place.originX)}px`);
      floating.dataset.side = place.side;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Twice: the first pass sets --ui-available-height, which can cap the
    // box's height, and a box flipped above the anchor must use that height.
    update();
    update();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [mounted, anchorRef, floatingRef, side, align, offset, matchWidth]);
}
