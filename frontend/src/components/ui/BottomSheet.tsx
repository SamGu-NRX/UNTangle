"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useBackToClose } from "./back-close";
import { cx } from "./cx";
import { useModalLayer } from "./modal-layer";
import {
  BOUNCE_VELOCITY,
  DRAG_HYSTERESIS,
  EXIT,
  FLICK,
  SETTLE,
  detentHeight,
  detentOffsets,
  releaseTarget,
  releaseVelocity,
  rubberBand,
  springSettled,
  springStep,
  type Detent,
  type Spring,
} from "./sheet-physics";

/**
 * Extra sheet below the screen edge, so a flick that overshoots the top
 * detent shows more sheet instead of a gap (MOTION.md §5).
 */
const OVERSCAN = 40;

export type BottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name. */
  title: string;
  /**
   * Heights, smallest to largest is conventional. Default: one detent at 92%,
   * which existing callers rely on. Detail sheets pass ["52%", "92%"] to open
   * at half height first (MOTION.md §5).
   */
  detents?: Detent[];
  /** Index into `detents` to open at. Default 0. */
  initialDetent?: number;
  /** Controlled detent index. */
  detent?: number;
  onDetentChange?: (index: number) => void;
  /**
   * Modal sheets (details, sections, export) dim and inert the page and keep
   * focus inside. Non-modal sheets (Day) leave the page live.
   */
  modal?: boolean;
  /** False keeps the sheet up: no swipe to close, no scrim close, no Escape. */
  dismissible?: boolean;
  /** Frosted material, for a sheet over moving content such as the map. */
  glass?: boolean;
  /**
   * Back (the browser's, the iOS edge swipe, Android's) closes the sheet
   * before it leaves the page. On by default; turn it off for a sheet whose
   * URL already changes when it opens, such as Connect.
   */
  closeOnBack?: boolean;
  /** Where focus goes when the sheet closes. Default: whatever had focus when it opened. */
  returnFocus?: () => HTMLElement | null;
  /** Content under the handle that also drags the sheet (title, switcher). */
  header?: ReactNode;
  /** Element to focus on open (modal sheets). Default: the first focusable. */
  initialFocus?: RefObject<HTMLElement | null>;
  children?: ReactNode;
  className?: string;
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Drag = {
  pointerId: number;
  element: HTMLElement;
  fromBody: boolean;
  downY: number;
  startY: number;
  startOffset: number;
  offset: number;
  active: boolean;
  samples: Array<{ y: number; t: number }>;
};

/**
 * The phone container for details, sections, preferences and export, and the
 * Day itinerary.
 *
 * Physics (MOTION.md §5): a press becomes a drag after 8px, then the sheet
 * follows the finger 1:1 with pointer capture and ignores a second finger.
 * Past the top detent it rubber-bands. On release, the velocity over the
 * last 100ms projects where momentum would carry the sheet, and that picks
 * the detent; a flick always moves at least one. A spring then settles it,
 * starting at the release velocity so there is no seam between drag and
 * animation. Grabbing a moving sheet stops the spring where it is.
 *
 * The body scrolls only at the top detent; below it, dragging the body
 * moves the sheet. Under reduced motion the sheet jumps to each detent with
 * a short opacity dip; a drag still tracks the finger, because that is
 * direct manipulation rather than animation.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  detents = ["92%"],
  initialDetent = 0,
  detent,
  onDetentChange,
  modal = true,
  dismissible = true,
  glass = false,
  closeOnBack = true,
  header,
  initialFocus,
  returnFocus,
  children,
  className,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [ownDetent, setOwnDetent] = useState(initialDetent);
  const index = detent ?? ownDetent;
  const [bodyAtTop, setBodyAtTop] = useState(true);

  const heights = detents.map((d) => detentHeight(d, viewportHeight));
  const { max, offsets } = detentOffsets(heights.length ? heights : [0]);
  const closedOffset = max + OVERSCAN;
  const topIndex = offsets.indexOf(0);
  const expanded = index === topIndex;

  const y = useRef<number | null>(null);
  /** The running spring's velocity (px/s), so a new target starts from the motion already under way. */
  const liveVelocity = useRef(0);
  const stopSpring = useRef<(() => void) | null>(null);
  /** Set when a touch stopped a moving sheet; a tap then lets it carry on to its detent. */
  const stoppedByTouch = useRef(false);
  /** Escape closes without animating: keyboard actions never animate. */
  const instantExit = useRef(false);
  const drag = useRef<Drag | null>(null);
  /** A release's velocity (px/ms) for the next spring; null when there was no release. */
  const handoffVelocity = useRef<number | null>(null);
  const keyboardMove = useRef(false);
  const suppressClick = useRef(false);
  // Moves and the release are read from the document, not the pressed
  // element: the first move can leave a small handle before the drag claims
  // the pointer, and a desktop mouse has no implicit capture.
  const stopTracking = useRef<(() => void) | null>(null);
  useEffect(() => () => stopTracking.current?.(), []);

  const setIndex = useCallback(
    (next: number) => {
      setOwnDetent(next);
      onDetentChange?.(next);
    },
    [onDetentChange],
  );

  const dismissByBack = useBackToClose(open && closeOnBack, () => onOpenChange(false));
  const requestClose = () => (closeOnBack ? dismissByBack() : onOpenChange(false));

  useModalLayer(modal && open, rootRef, {
    onEscape: dismissible
      ? () => {
          instantExit.current = true;
          requestClose();
        }
      : undefined,
    initialFocus,
    returnFocus,
  });

  // Reset to the opening detent each time the sheet opens.
  useEffect(() => {
    if (open) setOwnDetent(initialDetent);
  }, [open, initialDetent]);

  useLayoutEffect(() => {
    if (!mounted) return;
    const measure = () => setViewportHeight(window.innerHeight);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [mounted]);

  const place = (offset: number) => {
    y.current = offset;
    if (sheetRef.current) sheetRef.current.style.transform = `translate3d(0, ${offset}px, 0)`;
  };

  /** will-change only while the sheet moves (MOTION.md §11). */
  const moving = (on: boolean) => {
    if (sheetRef.current) sheetRef.current.style.willChange = on ? "transform" : "";
  };

  const cancelSpring = () => {
    stopSpring.current?.();
    stopSpring.current = null;
    moving(false);
  };

  /**
   * Moves to `target` on a spring, or jumps under reduced motion. The spring
   * starts at `velocity` (px/ms) when a release hands one over; otherwise it
   * keeps whatever motion is already under way, so retargeting never stalls.
   */
  const moveTo = (target: number, velocity: number | null, spring: Spring, done?: () => void) => {
    const carried = stopSpring.current ? liveVelocity.current : 0;
    cancelSpring();
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (prefersReducedMotion() || y.current === null) {
      if (y.current !== null && y.current !== target) {
        sheet.animate([{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
      }
      place(target);
      done?.();
      return;
    }
    let state = { x: y.current, v: velocity === null ? carried : velocity * 1000 };
    let last = performance.now();
    let frame = 0;
    moving(true);
    const step = (now: number) => {
      state = springStep(state, target, (now - last) / 1000, spring);
      liveVelocity.current = state.v;
      last = now;
      if (springSettled(state, target)) {
        place(target);
        stopSpring.current = null;
        liveVelocity.current = 0;
        moving(false);
        done?.();
        return;
      }
      place(state.x);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    stopSpring.current = () => cancelAnimationFrame(frame);
  };

  // Enter from below the screen, or fade in under reduced motion.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !sheet || viewportHeight === 0 || y.current !== null) return;
    const target = offsets[index] ?? 0;
    if (prefersReducedMotion()) {
      place(target);
      sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "ease-out" });
      return;
    }
    place(closedOffset);
    moveTo(target, null, SETTLE);
  });

  // Settle whenever the target moves: a detent change, new geometry, or a
  // reopen during the exit. Keyboard moves land instantly (keyboard actions
  // never animate). A release hands its velocity to this spring.
  const offsetsKey = offsets.join(",");
  useLayoutEffect(() => {
    if (!open || y.current === null || drag.current?.active) return;
    const target = offsets[index] ?? 0;
    const velocity = handoffVelocity.current;
    handoffVelocity.current = null;
    if (keyboardMove.current) {
      keyboardMove.current = false;
      cancelSpring();
      place(target);
      return;
    }
    moveTo(target, velocity, velocity !== null && Math.abs(velocity) > BOUNCE_VELOCITY ? FLICK : SETTLE);
    // offsetsKey stands for offsets, which is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, offsetsKey, open]);

  // Exit: down off the screen (or a fade), then unmount.
  useEffect(() => {
    if (open || !mounted) return;
    stopTracking.current?.();
    drag.current = null;
    const sheet = sheetRef.current;
    const finish = () => {
      y.current = null;
      setMounted(false);
    };
    if (!sheet || y.current === null) return finish();
    if (instantExit.current) {
      instantExit.current = false;
      cancelSpring();
      return finish();
    }
    if (prefersReducedMotion()) {
      cancelSpring();
      const fade = sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" });
      fade.onfinish = finish;
      return () => fade.cancel();
    }
    const velocity = handoffVelocity.current;
    handoffVelocity.current = null;
    moveTo(closedOffset, velocity, EXIT, finish);
    // closedOffset is read at the moment of closing on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  // Unmounting mid-spring stops its frame loop.
  useEffect(() => () => stopSpring.current?.(), []);

  const onDragMove = (event: globalThis.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    if (!d.active) {
      const dy = event.clientY - d.downY;
      if (Math.abs(dy) < DRAG_HYSTERESIS) return;
      // At the top detent an upward drag in the body is a scroll, not a drag.
      if (d.fromBody && expanded && dy < 0) {
        stopTracking.current?.();
        drag.current = null;
        return;
      }
      d.active = true;
      moving(true);
      d.startY = event.clientY;
      d.startOffset = y.current ?? 0;
      try {
        d.element.setPointerCapture(event.pointerId);
      } catch {
        // The pointer already ended; the release handler runs next.
      }
    }
    const raw = d.startOffset + event.clientY - d.startY;
    d.offset = raw < 0 ? -rubberBand(-raw, window.innerHeight) : raw;
    d.samples.push({ y: event.clientY, t: event.timeStamp });
    if (d.samples.length > 12) d.samples.shift();
    place(d.offset);
  };

  const onDragEnd = (event: globalThis.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    stopTracking.current?.();
    drag.current = null;
    if (!d.active) {
      // A tap stopped a moving sheet: let it finish its way to the detent.
      if (stoppedByTouch.current && open) moveTo(offsets[index] ?? 0, 0, SETTLE);
      stoppedByTouch.current = false;
      return;
    }
    stoppedByTouch.current = false;
    suppressClick.current = true;
    if (d.element.hasPointerCapture(event.pointerId)) d.element.releasePointerCapture(event.pointerId);
    // The release is a sample too: a finger that stopped before lifting reads as slow.
    d.samples.push({ y: event.clientY, t: event.timeStamp });
    const velocity = event.type === "pointercancel" ? 0 : releaseVelocity(d.samples);
    const target = releaseTarget({ offset: d.offset, velocity, offsets, dismissible });
    handoffVelocity.current = velocity;
    if (target === "dismiss") {
      requestClose();
    } else if (target !== index) {
      setIndex(target);
    } else {
      handoffVelocity.current = null;
      moveTo(offsets[target], velocity, Math.abs(velocity) > BOUNCE_VELOCITY ? FLICK : SETTLE);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>, fromBody: boolean) => {
    // A closing sheet cannot be caught, and one finger at a time: a second touch mid-drag is ignored.
    if (!open || drag.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (fromBody && expanded && (bodyRef.current?.scrollTop ?? 0) > 0) return;
    suppressClick.current = false;
    // Touching a moving sheet stops it where it is (MOTION.md §5, Interrupt).
    stoppedByTouch.current = stopSpring.current !== null;
    cancelSpring();
    drag.current = {
      pointerId: event.pointerId,
      element: event.currentTarget,
      fromBody,
      downY: event.clientY,
      startY: event.clientY,
      startOffset: y.current ?? 0,
      offset: y.current ?? 0,
      active: false,
      samples: [{ y: event.clientY, t: event.timeStamp }],
    };
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", onDragEnd);
    document.addEventListener("pointercancel", onDragEnd);
    stopTracking.current = () => {
      document.removeEventListener("pointermove", onDragMove);
      document.removeEventListener("pointerup", onDragEnd);
      document.removeEventListener("pointercancel", onDragEnd);
      stopTracking.current = null;
    };
  };

  const cycle = (direction: 1 | -1) => {
    const order = offsets.map((value, i) => ({ value, i })).sort((a, b) => b.value - a.value); // small → large
    const at = order.findIndex((d) => d.i === index);
    const next = order[at + direction];
    if (next) setIndex(next.i);
    else if (direction === 1 && order.length > 1) setIndex(order[0].i);
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      // The click that follows cycles the detent; from the keyboard, instantly.
      keyboardMove.current = true;
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      keyboardMove.current = true;
      cycle(event.key === "ArrowUp" ? 1 : -1);
    }
  };

  if (!mounted || typeof document === "undefined") return null;
  const state = open ? "open" : "closed";

  return createPortal(
    <div
      ref={rootRef}
      className={cx("ui-sheet-layer", !modal && "ui-sheet-layer--passive")}
      data-state={state}
      // A closing sheet is on its way out: nothing in it can be reached.
      inert={!open || undefined}
      data-ui=""
      tabIndex={modal ? -1 : undefined}
    >
      {modal ? (
        <div
          className="ui-sheet-scrim"
          data-state={state}
          data-ui=""
          aria-hidden="true"
          onClick={dismissible ? requestClose : undefined}
        />
      ) : null}
      <div
        ref={sheetRef}
        role={modal ? "dialog" : "region"}
        aria-modal={modal || undefined}
        aria-label={title}
        className={cx("ui-sheet", className)}
        data-expanded={expanded ? "" : undefined}
        data-glass={glass ? "" : undefined}
        data-ui=""
        // Position is written imperatively (place); CSS starts it off screen.
        style={{ height: max ? max + OVERSCAN : undefined }}
        tabIndex={-1}
      >
        <div className="ui-sheet__grab" onPointerDown={(event) => onPointerDown(event, false)}>
          {detents.length > 1 ? (
            // A generic name: the sheet's own title stays unique on the page.
            <button
              type="button"
              className="ui-sheet__handle"
              aria-label="Resize sheet"
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                cycle(1);
              }}
              onKeyDown={onHandleKeyDown}
            />
          ) : (
            // One detent: nothing to resize, so the grip is decoration (it
            // still drags; Escape and the sheet's buttons close it).
            <span className="ui-sheet__handle" aria-hidden="true" />
          )}
          {header}
        </div>
        <div
          ref={bodyRef}
          className="ui-sheet__body"
          data-at-top={bodyAtTop ? "" : undefined}
          onScroll={(event) => setBodyAtTop(event.currentTarget.scrollTop <= 0)}
          onPointerDown={(event) => onPointerDown(event, true)}
          onFocus={(event) => {
            // Below the top detent the body cannot scroll, so focus that lands
            // out of sight (Tab, a screen reader) raises the sheet to show it.
            if (!expanded && event.target.getBoundingClientRect().bottom > window.innerHeight) {
              keyboardMove.current = true;
              setIndex(topIndex);
            }
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
