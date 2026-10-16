"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A sheet rises from the bottom and leaves the page above it in view; a dialog (and the search palette) covers the middle or all of it. */
export type LayerKind = "sheet" | "dialog";

type Layer = {
  id: symbol;
  root: HTMLElement;
  kind: LayerKind;
  opener: HTMLElement | null;
  restore: () => HTMLElement | null;
};

/**
 * Open modal layers, bottom to top. One stack owns everything layers share,
 * so layers may close in any order: inert state, the scroll lock and focus
 * restore are recomputed from the whole stack, never undone by one layer
 * on its own.
 */
const layers: Layer[] = [];
/** Elements this module made inert; anything inert for another reason is left alone. */
const managedInert = new Set<Element>();
/** html's own overflow, saved while any layer holds the scroll lock. */
let savedOverflow: string | null = null;
/**
 * Portalled popovers (listbox, menu, date picker, tooltip) and the layer
 * root they belong to, or null for one opened from the page. A popover
 * lives beside its layer's root in <body>, so without this it would count
 * as background and go inert under its own dialog.
 */
const popoverOwners = new Map<Element, HTMLElement | null>();

const stackListeners = new Set<() => void>();

/** Calls `listener` whenever the stack changes; `topModal` reads it. The Toaster uses it to step out of a modal's way. */
export function subscribeModalStack(listener: () => void): () => void {
  stackListeners.add(listener);
  return () => {
    stackListeners.delete(listener);
  };
}

/** The kind of the topmost modal layer, or null when none is open. */
export const topModal = (): LayerKind | null => layers[layers.length - 1]?.kind ?? null;

/** Each sheet's resting top edge, in px from the top of the viewport, by its portal root. */
const sheetTops = new WeakMap<HTMLElement, number>();

/**
 * Records where a modal sheet's top edge rests (BottomSheet calls it as the
 * detent changes). While that sheet is on top, the edge is published as
 * `--sheet-top` on <html>, so the toast can sit in the space above it.
 */
export function setSheetTop(root: HTMLElement, top: number) {
  if (sheetTops.get(root) === top) return;
  sheetTops.set(root, top);
  syncStack();
}

/** Brings inert state and the scroll lock in line with the current stack. */
function syncStack() {
  const top = layers[layers.length - 1];
  const html = document.documentElement;
  if (top && savedOverflow === null) {
    savedOverflow = html.style.overflow;
    html.style.overflow = "hidden";
  } else if (!top && savedOverflow !== null) {
    html.style.overflow = savedOverflow;
    savedOverflow = null;
  }

  // Everything except the top layer's root, the popovers it owns and the
  // text-only live region is inert, lower layers included.
  const wanted = new Set<Element>();
  if (top) {
    for (const el of Array.from(document.body.children)) {
      if (el === top.root || el.hasAttribute("data-ui-live")) continue;
      if (popoverOwners.has(el) && popoverOwners.get(el) === top.root) continue;
      if (el.hasAttribute("inert") && !managedInert.has(el)) continue;
      wanted.add(el);
    }
  }
  for (const el of Array.from(managedInert)) {
    if (!wanted.has(el)) {
      el.removeAttribute("inert");
      managedInert.delete(el);
    }
  }
  for (const el of wanted) {
    if (!managedInert.has(el)) {
      el.setAttribute("inert", "");
      managedInert.add(el);
    }
  }
  const sheetTop = top?.kind === "sheet" ? sheetTops.get(top.root) : undefined;
  if (sheetTop !== undefined) html.style.setProperty("--sheet-top", `${sheetTop}px`);
  else html.style.removeProperty("--sheet-top");
  stackListeners.forEach((listener) => listener());
}

/**
 * Records a portalled popover as belonging to the modal layer that contains
 * its anchor (or to the page), so the stack keeps it live exactly while its
 * owner is on top. Returns the unregister function. Called by
 * useAnchoredPosition, which every popover uses.
 */
export function registerPopover(popover: HTMLElement, anchor: HTMLElement): () => void {
  const owner = [...layers].reverse().find((layer) => layer.root.contains(anchor))?.root ?? null;
  popoverOwners.set(popover, owner);
  syncStack();
  return () => {
    popoverOwners.delete(popover);
    if (popover.hasAttribute("inert") && managedInert.has(popover)) {
      popover.removeAttribute("inert");
      managedInert.delete(popover);
    }
  };
}

function usable(el: HTMLElement | null): el is HTMLElement {
  return Boolean(el && el.isConnected && !el.closest("[inert]"));
}

function pushLayer(layer: Layer) {
  layers.push(layer);
  syncStack();
}

function removeLayer(id: symbol) {
  const at = layers.findIndex((layer) => layer.id === id);
  if (at < 0) return;
  const [layer] = layers.splice(at, 1);
  // Reopened, a sheet reports its edge again; until then it has none, so no stale edge is published for a frame.
  sheetTops.delete(layer.root);
  const wasTop = at === layers.length;
  if (!wasTop) {
    // A lower layer closed first. The layer above may have been opened from
    // inside it; if so, it now returns focus to where this one would have.
    const above = layers[at];
    if (above && (!above.opener || layer.root.contains(above.opener))) above.opener = layer.opener;
  }
  syncStack();
  if (!wasTop) return;
  const top = layers[layers.length - 1];
  const chosen = layer.restore() ?? layer.opener;
  const target = usable(chosen)
    ? chosen
    : top
      ? (top.root.querySelector<HTMLElement>(FOCUSABLE) ?? top.root)
      : null;
  target?.focus({ preventScroll: true });
}

/**
 * Behaviour every modal surface shares (Dialog, modal BottomSheet,
 * SearchPalette):
 *
 * - everything outside the top layer's portal root becomes `inert`, so Tab,
 *   the pointer and the screen reader's virtual cursor all stay inside;
 * - page scroll is locked while any layer is open;
 * - focus moves in on open (the `initialFocus` element, else the first
 *   focusable, else the root) and, when the top layer closes, returns to
 *   its opener (or, if that is gone, into the layer now on top);
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
  {
    kind = "dialog",
    onEscape,
    initialFocus,
    returnFocus,
  }: {
    kind?: LayerKind;
    onEscape?: () => void;
    initialFocus?: RefObject<HTMLElement | null>;
    /** Where focus goes on close, when it should not be the opener (a selection that moved). */
    returnFocus?: () => HTMLElement | null;
  } = {},
) {
  // Read the latest callback and focus target when an effect needs them,
  // not during render, and without re-running the layer when they change.
  const escape = useEffectEvent(() => onEscape?.());
  const canEscape = onEscape !== undefined;
  const focusTarget = useEffectEvent(() => initialFocus?.current ?? null);
  const restoreTarget = useEffectEvent(() => returnFocus?.() ?? null);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const id = Symbol("modal-layer");
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pushLayer({ id, root, kind, opener, restore: restoreTarget });

    const target = focusTarget() ?? root.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    target.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (layers[layers.length - 1]?.id !== id || event.defaultPrevented) return;
      if (event.key === "Tab") {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !root.contains(active)) return;
        const stops = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
        );
        if (!stops.length) return;
        const first = stops[0];
        const last = stops[stops.length - 1];
        // Focus can rest on something outside the Tab order, such as the
        // heading a sheet focuses when it opens. Before the first stop or
        // after the last, the browser would carry Tab out of the layer.
        const follows = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const atStart = active === first || active === root || (active.tabIndex < 0 && follows(active, first));
        const atEnd = active === last || (active.tabIndex < 0 && follows(last, active));
        if (event.shiftKey && atStart) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && atEnd) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape" || !canEscape) return;
      event.preventDefault();
      escape();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      removeLayer(id);
    };
  }, [open, rootRef, canEscape, kind]);
}
