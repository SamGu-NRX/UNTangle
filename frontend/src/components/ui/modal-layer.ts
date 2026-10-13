"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open modal layers, bottom to top. Only the top one handles Escape. */
const stack: symbol[] = [];

/**
 * Behaviour every modal surface shares (Dialog, modal BottomSheet,
 * SearchPalette):
 *
 * - everything outside the layer's portal root becomes `inert`, so Tab, the
 *   pointer and the screen reader's virtual cursor all stay inside;
 * - page scroll is locked;
 * - focus moves in on open (the `initialFocus` element, else the first
 *   focusable, else the root) and returns to the opener on close;
 * - Escape calls `onEscape`, for the topmost layer only.
 *
 * `rootRef` must be the element passed to createPortal (a direct child of
 * body). Elements marked `data-ui-live` (the toast region) stay outside the
 * inert set so announcements keep working.
 */
export function useModalLayer(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  opts: { onEscape?: () => void; initialFocus?: RefObject<HTMLElement | null> } = {},
) {
  const onEscapeRef = useRef(opts.onEscape);
  const initialFocusRef = opts.initialFocus;
  useLayoutEffect(() => {
    onEscapeRef.current = opts.onEscape;
  });

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const id = Symbol("modal-layer");
    stack.push(id);

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const madeInert: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === root || el.hasAttribute("inert") || el.hasAttribute("data-ui-live")) continue;
      el.setAttribute("inert", "");
      madeInert.push(el);
    }
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = "hidden";

    const target =
      initialFocusRef?.current ?? root.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    target.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || stack[stack.length - 1] !== id) return;
      if (!onEscapeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current();
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      for (const el of madeInert) el.removeAttribute("inert");
      html.style.overflow = previousOverflow;
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, rootRef, initialFocusRef]);
}
