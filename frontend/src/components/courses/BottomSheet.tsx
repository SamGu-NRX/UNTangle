"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./courses.module.css";
import { REDUCED_MOTION_QUERY, useFocusTrap, useMediaQuery, usePresence } from "./hooks";

type Detent = "full" | "half";

/** Sheet height is 92% of the viewport; "half" leaves 50% of the viewport showing. */
const FULL = 0.92;
const HALF = 0.5;
/** px/ms; a flick faster than this moves one detent regardless of distance. */
const FLICK = 0.11;
/** Past the top detent the sheet follows the finger at 30%. */
const OVERDRAG = 0.3;

const halfOffset = () => (FULL - HALF) * window.innerHeight;

type Drag = { pointerId: number; startY: number; startOffset: number; offset: number; samples: Array<{ y: number; t: number }>; moved: boolean };

export function BottomSheet({
  open,
  onClose,
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  className: string;
  children: ReactNode;
}) {
  const presence = usePresence(open, 200);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const [detent, setDetent] = useState<Detent>("full");
  const [dragging, setDragging] = useState(false);
  /** After a drag or a tap on the handle the sheet settles at 240ms instead of entering at 260ms. */
  const [settling, setSettling] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const justDragged = useRef(false);
  useFocusTrap(sheetRef, presence.mounted && open);

  const [previousOpen, setPreviousOpen] = useState(open);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) {
      setDetent("full");
      setSettling(false);
    }
  }

  useEffect(() => {
    if (!presence.mounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [presence.mounted]);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      // A popover or the palette above the sheet handles its own Escape first.
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!presence.mounted) return null;

  const restingOffset = (target: Detent) => (target === "full" ? 0 : halfOffset());
  const hidden = presence.state !== "open";
  const transform =
    hidden && !reduced ? "translateY(100%)" : `translateY(${typeof window === "undefined" ? 0 : restingOffset(detent)}px)`;

  const settle = (target: Detent | "closed") => {
    const element = sheetRef.current;
    setDragging(false);
    if (target === "closed") {
      onClose();
      return;
    }
    // React will not rewrite an unchanged style prop, so put the resting transform back by hand.
    if (element) element.style.transform = `translateY(${restingOffset(target)}px)`;
    setSettling(true);
    setDetent(target);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (drag.current) return; // a second finger never takes over a drag
    justDragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Start from where the sheet is drawn now, so grabbing it mid-transition does not jump.
    const drawn = sheetRef.current ? new DOMMatrixReadOnly(getComputedStyle(sheetRef.current).transform).m42 : NaN;
    const offset = Number.isFinite(drawn) ? drawn : restingOffset(detent);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startOffset: offset, offset, samples: [{ y: event.clientY, t: event.timeStamp }], moved: false };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const raw = state.startOffset + (event.clientY - state.startY);
    if (!state.moved && Math.abs(event.clientY - state.startY) > 3) {
      state.moved = true;
      setDragging(true);
    }
    state.offset = raw < 0 ? raw * OVERDRAG : raw;
    state.samples = [...state.samples.slice(-3), { y: event.clientY, t: event.timeStamp }];
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${state.offset}px)`;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    drag.current = null;
    if (!state.moved) return; // a tap; the click handler toggles the detent
    justDragged.current = true;
    const first = state.samples[0];
    const last = state.samples.at(-1)!;
    const velocity = (last.y - first.y) / Math.max(1, last.t - first.t);
    const half = halfOffset();
    const sheetHeight = FULL * window.innerHeight;
    let target: Detent | "closed";
    if (velocity > FLICK) target = detent === "full" && state.offset < half ? "half" : "closed";
    else if (velocity < -FLICK) target = "full";
    else if (state.offset > half + (sheetHeight - half) * 0.35) target = "closed";
    else target = state.offset < half / 2 ? "full" : "half";
    settle(target);
  };

  return createPortal(
    <div className={className}>
      <div className={styles.sheetScrim} data-state={presence.state} onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={styles.sheet}
        data-state={presence.state}
        data-dragging={dragging}
        data-settling={settling}
        style={{ transform, outline: "none" }}
      >
        <button
          type="button"
          className={styles.sheetGrip}
          aria-label={detent === "full" ? "Shrink sheet" : "Expand sheet"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => {
            // The click that ends a drag is not a tap.
            if (justDragged.current) {
              justDragged.current = false;
              return;
            }
            settle(detent === "full" ? "half" : "full");
          }}
        />
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
