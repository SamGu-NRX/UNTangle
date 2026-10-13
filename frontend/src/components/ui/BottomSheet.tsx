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
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { useModalLayer } from "./modal-layer";
import {
  dampedOffset,
  detentHeight,
  detentOffsets,
  releaseTarget,
  releaseVelocity,
  type Detent,
} from "./sheet-physics";
import { usePresence } from "./use-presence";

const ENTER = "transform var(--t-sheet) var(--ease-sheet)";
const SETTLE = "transform 240ms var(--ease-sheet)";
const EXIT = "transform 200ms var(--ease-sheet)";
const EXIT_MS = 200;
/** Movement before a press becomes a drag, so taps on the handle stay taps. */
const DRAG_SLOP = 4;

export type BottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name. */
  title: string;
  /** Heights, smallest to largest is conventional. Default one detent at 92%. */
  detents?: Detent[];
  /** Index into `detents` to open at. Default 0. */
  initialDetent?: number;
  /** Controlled detent index. */
  detent?: number;
  onDetentChange?: (index: number) => void;
  /**
   * Modal sheets (details, alternatives) dim and inert the page and trap
   * focus. Non-modal sheets (the map) leave the page interactive.
   */
  modal?: boolean;
  /** False keeps the sheet up: no flick-to-close, no scrim close, no Escape. */
  dismissible?: boolean;
  /** Content under the handle that also drags the sheet (title, switcher). */
  header?: ReactNode;
  children?: ReactNode;
  className?: string;
};

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The sheet's on-screen translateY right now, mid-transition included. */
function presentationOffset(el: HTMLElement): number {
  const transform = getComputedStyle(el).transform;
  if (!transform || transform === "none") return 0;
  const values = transform.match(/matrix(?:3d)?\(([^)]+)\)/)?.[1].split(",").map(Number);
  if (!values) return 0;
  return values.length === 16 ? values[13] : values[5];
}

/**
 * Phone container for details, alternatives, the map panel and filters.
 *
 * Drag follows the finger 1:1 from the handle and header, and from the body
 * whenever the sheet is below its tallest detent (at the top the body
 * scrolls instead). It uses pointer capture, ignores a second finger, and
 * resists past the top detent (0.3). On release it reads the velocity over
 * the last 100ms: a flick (> 0.11 px/ms) moves one detent or dismisses,
 * otherwise it settles on the nearest. Grabbing a moving sheet starts from
 * where it is on screen, not where it was heading.
 *
 * Enter translateY(100%) → detent over 260ms, settle 240ms, exit 200ms, all
 * on the sheet curve. With reduced motion the sheet fades instead of
 * sliding; a drag still tracks the finger, because that is direct
 * manipulation rather than animation.
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
  header,
  children,
  className,
}: BottomSheetProps) {
  const { mounted, state } = usePresence(open, EXIT_MS);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [ownDetent, setOwnDetent] = useState(initialDetent);
  const index = detent ?? ownDetent;
  const drag = useRef<{
    pointerId: number;
    element: HTMLElement;
    startY: number;
    startOffset: number;
    offset: number;
    active: boolean;
    samples: Array<{ y: number; t: number }>;
  } | null>(null);
  const suppressClick = useRef(false);

  const heights = detents.map((d) => detentHeight(d, viewportHeight));
  const { max, offsets } = detentOffsets(heights.length ? heights : [0]);
  const topIndex = offsets.indexOf(0);
  const expanded = index === topIndex;

  const setIndex = useCallback(
    (next: number) => {
      setOwnDetent(next);
      onDetentChange?.(next);
    },
    [onDetentChange],
  );

  useModalLayer(modal && open, rootRef, {
    onEscape: dismissible ? () => onOpenChange(false) : undefined,
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

  const apply = (offset: number, transition: string) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transition = transition;
    sheet.style.transform = `translateY(${offset}px)`;
  };

  // Enter: start below the screen, then move to the detent.
  const entered = useRef(false);
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!mounted || !sheet || viewportHeight === 0 || entered.current) return;
    entered.current = true;
    const target = offsets[index] ?? 0;
    if (prefersReducedMotion()) {
      apply(target, "none");
      sheet.style.opacity = "0";
      void sheet.offsetHeight;
      sheet.style.transition = "opacity 120ms ease";
      sheet.style.opacity = "1";
      return;
    }
    apply(max, "none");
    void sheet.offsetHeight; // commit the start position before transitioning
    apply(target, ENTER);
  });

  // Settle on detent changes (handle, keyboard, controlled prop) and on a
  // reopen that interrupts the exit. A layout effect, so a resize never
  // paints a frame at the old position. Arrow keys on the handle move
  // instantly: keyboard actions never animate (DESIGN.md §1).
  const keyboardMove = useRef(false);
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!mounted || !sheet || state !== "open" || !entered.current || drag.current?.active) return;
    const reduced = prefersReducedMotion();
    const instant = reduced || keyboardMove.current;
    keyboardMove.current = false;
    apply(offsets[index] ?? 0, reduced ? "opacity 120ms ease" : instant ? "none" : SETTLE);
    // A reduced-motion exit faded the sheet out; a reopen fades it back.
    sheet.style.opacity = "1";
    // offsets derive from detents and viewportHeight, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, viewportHeight, mounted, state]);

  // Exit: slide (or fade) out from wherever the sheet is.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (state !== "closed" || !sheet) return;
    if (prefersReducedMotion()) {
      sheet.style.transition = "opacity 120ms ease";
      sheet.style.opacity = "0";
    } else {
      apply(max, EXIT);
    }
    // max is read at the moment of closing on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (state === "closed") {
      // Closing mid-drag (Escape, scrim) drops the gesture.
      stopTracking.current?.();
      drag.current = null;
    }
  }, [state]);

  useEffect(() => {
    if (!mounted) entered.current = false;
  }, [mounted]);

  // Moves and the release are read from the document, not the pressed
  // element: the first move can already be outside the 4px handle (over the
  // scrim) before the drag claims the pointer, and on a desktop mouse there
  // is no implicit capture to keep the events coming.
  const stopTracking = useRef<(() => void) | null>(null);
  useEffect(() => () => stopTracking.current?.(), []);

  const onDragMove = (event: globalThis.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const dy = event.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < DRAG_SLOP) return;
      d.active = true;
      try {
        d.element.setPointerCapture(event.pointerId);
      } catch {
        // The pointer already ended; the release handler will run next.
      }
    }
    d.offset = dampedOffset(d.startOffset + dy);
    d.samples.push({ y: event.clientY, t: event.timeStamp });
    if (d.samples.length > 12) d.samples.shift();
    apply(d.offset, "none");
  };

  const onDragEnd = (event: globalThis.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    stopTracking.current?.();
    drag.current = null;
    if (!d.active) return;
    suppressClick.current = true;
    if (d.element.hasPointerCapture(event.pointerId)) d.element.releasePointerCapture(event.pointerId);
    // The release itself is a sample: a finger that stopped before lifting
    // must read as slow, not as the speed of the move before the pause.
    d.samples.push({ y: event.clientY, t: event.timeStamp });
    const target = releaseTarget({
      offset: d.offset,
      velocity: event.type === "pointercancel" ? 0 : releaseVelocity(d.samples),
      offsets,
      max,
      dismissible,
    });
    if (target === "dismiss") {
      onOpenChange(false);
      return;
    }
    apply(offsets[target], prefersReducedMotion() ? "none" : SETTLE);
    if (target !== index) setIndex(target);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>, fromBody: boolean) => {
    // One finger at a time: a second touch mid-drag is ignored.
    if (drag.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (fromBody && expanded) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    suppressClick.current = false;
    const startOffset = presentationOffset(sheet);
    drag.current = {
      pointerId: event.pointerId,
      element: event.currentTarget,
      startY: event.clientY,
      startOffset,
      offset: startOffset,
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
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      keyboardMove.current = true;
      cycle(1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      keyboardMove.current = true;
      cycle(-1);
    }
  };

  if (!mounted || typeof document === "undefined") return null;

  const dragHandlers = (fromBody: boolean) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => onPointerDown(event, fromBody),
  });

  return createPortal(
    <div
      ref={rootRef}
      className={cx("ui-sheet-layer", !modal && "ui-sheet-layer--passive")}
      data-state={state}
      data-ui=""
      tabIndex={modal ? -1 : undefined}
    >
      {modal ? (
        <div
          className="ui-sheet-scrim"
          data-state={state}
          data-ui=""
          aria-hidden="true"
          onClick={dismissible ? () => onOpenChange(false) : undefined}
        />
      ) : null}
      <div
        ref={sheetRef}
        role={modal ? "dialog" : "region"}
        aria-modal={modal || undefined}
        aria-label={title}
        className={cx("ui-sheet", className)}
        data-expanded={expanded ? "" : undefined}
        data-ui=""
        // Position is written imperatively (apply); CSS starts it off screen.
        style={{ height: max || undefined }}
        tabIndex={-1}
      >
        <div className="ui-sheet__grab" {...dragHandlers(false)}>
          <button
            type="button"
            className="ui-sheet__handle"
            aria-label={detents.length > 1 ? `Resize ${title}` : `${title} handle`}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              cycle(1);
            }}
            onKeyDown={onHandleKeyDown}
          />
          {header}
        </div>
        <div className="ui-sheet__body" {...dragHandlers(true)}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
