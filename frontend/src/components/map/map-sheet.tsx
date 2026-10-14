"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { chooseDetent, releaseVelocity, resistedHeight } from "@/components/map/sheet-physics";

export type SheetDetent = "peek" | "half" | "full";
const order: SheetDetent[] = ["peek", "half", "full"];

/** Movement before a press becomes a drag, so taps on cards stay taps. */
const DRAG_THRESHOLD_PX = 8;

type Props = {
  detent: SheetDetent;
  /** `instant` for a move asked for from the keyboard, which doesn't animate. */
  onDetentChange: (detent: SheetDetent, instant?: boolean) => void;
  /** The current detent was chosen from the keyboard: settle on it without the transition. */
  instant: boolean;
  /** Visible height after each settle, for the map's bottom inset. */
  onVisibleHeightChange: (height: number) => void;
  reducedMotion: boolean;
  /** Height of the area the sheet sits in (the map's area), in px. */
  areaHeight: number;
  /**
   * The full detent, measured by the caller: the area less the floating day
   * stepper and the attribution row, which stay visible at every detent.
   */
  fullHeight: number;
  header: ReactNode;
  children: ReactNode;
  bodyRef: RefObject<HTMLDivElement | null>;
};

/**
 * The phone day: a sheet over the map with three detents (MOTION.md §5:
 * peek shows the hero, half is max(320px, 50%), full stops below the
 * stepper). It follows
 * the finger 1:1, resists past its ends, and on release lands on the detent
 * the drag's momentum points at. A drag can grab it mid-settle: the settle
 * transition is a CSS transition, which restarts from wherever the sheet is.
 */
export function MapSheet({
  detent,
  onDetentChange,
  instant,
  onVisibleHeightChange,
  reducedMotion,
  areaHeight,
  fullHeight,
  header,
  children,
  bodyRef,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(112);

  useLayoutEffect(() => {
    const element = headerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeaderHeight(element.offsetHeight));
    observer.observe(element);
    setHeaderHeight(element.offsetHeight);
    return () => observer.disconnect();
  }, []);

  const full = Math.round(fullHeight);
  // Peek shows the handle and the hero (the header, whatever it measures).
  // The map's area ends at the phone tab bar, which already clears the home
  // indicator, so no inset is added here.
  const peek = Math.min(headerHeight, Math.round(full * 0.45));
  // 320px is MOTION.md §5's floor for half, a starting value.
  const half = Math.min(full, Math.max(peek + 80, 320, Math.round(areaHeight * 0.5)));
  const heights: Record<SheetDetent, number> = { peek, half, full };

  const visibleRef = useRef(heights[detent]);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startVisible: number;
    samples: Array<{ t: number; y: number }>;
    active: boolean;
    fromBody: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const place = useCallback(
    (visible: number, animate: boolean) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      visibleRef.current = visible;
      sheet.style.transition = animate && !reducedMotion ? "" : "none";
      sheet.style.transform = `translate3d(0, ${full - visible}px, 0)`;
    },
    [full, reducedMotion],
  );

  // Settle on the controlled detent whenever it or the geometry changes.
  useLayoutEffect(() => {
    place(heights[detent], !instant);
    onVisibleHeightChange(heights[detent]);
    // heights is derived from the three values listed; `instant` only says how the latest detent was chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detent, peek, half, full, place]);

  /** Where the sheet is on screen right now, even mid-transition. */
  const liveVisible = () => {
    const sheet = sheetRef.current;
    if (!sheet) return visibleRef.current;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(sheet).transform);
    return full - matrix.m42;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    // A drag's trailing click, if the browser sent one, came before this press.
    suppressClick.current = false;
    const fromBody = bodyRef.current?.contains(event.target as Node) ?? false;
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startVisible: liveVisible(),
      samples: [],
      active: false,
      fromBody,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const dy = state.startY - event.clientY; // positive: finger moving up, sheet growing
    if (!state.active) {
      if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      const body = bodyRef.current;
      // At full height the list scrolls and the header is the drag handle.
      // (The browser owns touch scrolling there, so a pull-down at the top of
      // the list can't be handed to the sheet mid-gesture.)
      if (state.fromBody && detent === "full" && body && (dy > 0 || body.scrollTop > 0)) {
        drag.current = null;
        return;
      }
      state.active = true;
      // Grab from wherever the sheet is, even mid-settle.
      state.startVisible = liveVisible();
      state.startY = event.clientY;
      state.samples.push({ t: event.timeStamp, y: state.startVisible });
      sheetRef.current?.setPointerCapture(event.pointerId);
    }
    const raw = state.startVisible + (state.startY - event.clientY);
    place(resistedHeight(raw, peek, full, areaHeight), false);
    state.samples.push({ t: event.timeStamp, y: raw });
    if (state.samples.length > 12) state.samples.shift();
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    drag.current = null;
    if (!state.active) return;
    suppressClick.current = true;
    // The release itself is a sample, so a drag that paused before letting go has no flick left.
    state.samples.push({ t: event.timeStamp, y: state.startVisible + (state.startY - event.clientY) });
    const velocity = releaseVelocity(state.samples);
    const landing = order[chooseDetent(visibleRef.current, velocity, [peek, half, full])];
    if (landing === detent) {
      place(heights[landing], true);
      onVisibleHeightChange(heights[landing]);
    } else {
      onDetentChange(landing);
    }
  };

  /** The system took the gesture (a scroll, a call): settle where we were, no momentum, no click to swallow. */
  const cancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    drag.current = null;
    if (state.active) place(heights[detent], true);
  };

  /** At half the list is cut off by the screen edge; tabbing to a card below it opens the sheet fully. */
  const onFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    if (detent !== "half") return;
    const sheet = sheetRef.current;
    const target = event.target as HTMLElement;
    if (!sheet || !bodyRef.current?.contains(target)) return;
    const visibleBottom = sheet.getBoundingClientRect().top + heights.half;
    if (target.getBoundingClientRect().bottom > visibleBottom) onDetentChange("full", true);
  };

  // A click that ends a drag is not a tap on whatever card it ended over.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const onClick = (event: MouseEvent) => {
      if (suppressClick.current) {
        event.stopPropagation();
        event.preventDefault();
        suppressClick.current = false;
      }
    };
    sheet.addEventListener("click", onClick, true);
    return () => sheet.removeEventListener("click", onClick, true);
  }, []);

  const cycle = (event: { detail: number }) => onDetentChange(order[(order.indexOf(detent) + 1) % order.length], event.detail === 0);

  return (
    <div
      ref={sheetRef}
      className="mv-sheet"
      data-detent={detent}
      style={{ height: full }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onFocusCapture={onFocusCapture}
      role="region"
      aria-label="Your day"
    >
      <div ref={headerRef} className="mv-sheet__header">
        <button
          type="button"
          className="mv-sheet__handle"
          onClick={cycle}
          aria-label={detent === "full" ? "Collapse your day" : "Expand your day"}
          aria-expanded={detent !== "peek"}
        >
          <span aria-hidden="true" />
        </button>
        {header}
      </div>
      {/* At peek the list is off screen, so it leaves the tab order (inert) until the sheet opens. */}
      <div
        ref={bodyRef}
        className="mv-sheet__body"
        data-lens-scroll=""
        data-scrollable={detent === "full" ? "true" : "false"}
        // Below full, part of the body is off screen; this much room lets a
        // chosen row scroll up into the part that shows.
        style={{ paddingBottom: 24 + full - heights[detent] }}
        inert={detent === "peek"}
      >
        {children}
      </div>
    </div>
  );
}
