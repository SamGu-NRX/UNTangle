"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, type Side } from "./anchored";
import { mergeRefs } from "./cx";

const FIRST_DELAY = 400;
/** A tooltip opened within this long after another closed shows at once. */
const ADJACENT_WINDOW = 300;
let lastClosedAt = 0;
let openCount = 0;

/** Whether another tooltip is open or closed a moment ago (read on hover/focus, never in render). */
function nextToAnother(): boolean {
  return openCount > 0 || Date.now() - lastClosedAt < ADJACENT_WINDOW;
}

type TriggerProps = {
  ref?: Ref<HTMLElement>;
  "aria-describedby"?: string;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
};

export type TooltipProps = {
  content: ReactNode;
  /** One element that accepts a ref and event handlers. */
  children: ReactElement<TriggerProps>;
  side?: Side;
  /** Also open on tap, for touch users (ProvenanceTag). */
  openOnTap?: boolean;
};

/**
 * Hover and keyboard-focus tooltip: 24px, ink, white 12px, max 240 wide.
 * The first waits 400ms; one opened right after another shows at once with
 * no fade. Opacity only, 125ms. The text is also a hidden description on
 * the trigger, so screen readers get it on focus without waiting for the
 * popup, and the popup itself is hidden from them to avoid a double read.
 * Never put the only copy of an instruction here.
 */
export function Tooltip({ content, children, side = "top", openOnTap }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const descriptionId = useId();

  useAnchoredPosition(open, triggerRef, tipRef, { side, align: "center", offset: 8 });

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const show = (immediate: boolean) => {
    clearTimer();
    const adjacent = nextToAnother();
    if (immediate || adjacent) {
      setInstant(adjacent);
      setOpen(true);
    } else {
      setInstant(false);
      timer.current = window.setTimeout(() => setOpen(true), FIRST_DELAY);
    }
  };

  const hide = () => {
    clearTimer();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    openCount += 1;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      openCount -= 1;
      lastClosedAt = Date.now();
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => clearTimer, []);

  if (!isValidElement(children)) return children;
  const childProps = children.props;
  const describedBy = [childProps["aria-describedby"], descriptionId].filter(Boolean).join(" ");

  // react-hooks/refs flags any closure over a ref passed to a function, since
  // the function might call it during render. cloneElement only stores these
  // props: mergeRefs attaches at commit and the handlers run on events.
  /* eslint-disable react-hooks/refs */
  const trigger = cloneElement(children, {
    ref: mergeRefs(childProps.ref, triggerRef),
    "aria-describedby": describedBy,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      childProps.onPointerEnter?.(event);
      if (event.pointerType === "mouse") show(false);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      childProps.onPointerLeave?.(event);
      if (event.pointerType === "mouse") hide();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(event);
      if (event.currentTarget.matches(":focus-visible")) show(true);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(event);
      hide();
    },
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      childProps.onClick?.(event);
      if (openOnTap && (event.nativeEvent as globalThis.PointerEvent).pointerType !== "mouse") {
        setInstant(true);
        setOpen((o) => !o);
      }
    },
  });
  /* eslint-enable react-hooks/refs */

  return (
    <>
      {trigger}
      <span id={descriptionId} hidden>
        {content}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div ref={tipRef} className="ui-tooltip" aria-hidden="true" data-instant={instant ? "" : undefined} data-ui="">
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
