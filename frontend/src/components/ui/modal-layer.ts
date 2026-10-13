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
 * - Tab and Shift+Tab wrap inside the topmost layer;
 * - Escape calls `onEscape`, for the topmost layer only, and only when no
 *   widget inside it (an open Select, Menu or date picker) already handled
 *   that Escape: those call preventDefault, and this listener runs after
 *   them, in the bubble phase on document.
 *
 * `rootRef` must be the element passed to createPortal (a direct child of
 * body). Elements marked `data-ui-live` (the toasts' announcement region,
 * which holds text only) stay outside the inert set so announcements keep
 * working.
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
      if (stack[stack.length - 1] !== id || event.defaultPrevented) return;
      if (event.key === "Tab") {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !root.contains(active)) return;
        const stops = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
        );
        if (!stops.length) return;
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (event.shiftKey && (active === first || active === root)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape" || !onEscapeRef.current) return;
      event.preventDefault();
      onEscapeRef.current();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      for (const el of madeInert) el.removeAttribute("inert");
      html.style.overflow = previousOverflow;
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, rootRef, initialFocusRef]);
}
