"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * "Back closes the top sheet, then pops a pushed screen" (DESIGN.md §3.4).
 *
 * An open sheet owns one history entry at the same URL, marked with its id,
 * so the browser's Back (the iOS edge swipe, Android's back button) lands
 * on the page underneath and closes the sheet instead of leaving the page.
 *
 * Closing a sheet any other way has to give that entry back. When the sheet
 * closes itself (scrim, swipe, Escape, its own Close), it calls history.back()
 * at once. When it closes because the page changed it (a link inside the
 * sheet, a router.push after an import), calling back() could cancel that
 * navigation, so the entry is left in place as "stale": the next Back that
 * steps off it onto the same page skips once more, so no Back press is ever
 * spent on a sheet that is already gone.
 */

const KEY = "__untangleSheet";

export type StaleEntry = { id: string; href: string };

/**
 * What to do on popstate while a closed sheet's entry is still in history.
 * Pure, so the one rule with a single correct answer is tested on its own.
 */
export function afterStalePop(stale: StaleEntry, marker: string | undefined, href: string): { stale: StaleEntry | null; back: boolean } {
  if (marker === stale.id) return { stale, back: false }; // stepped back onto the stale entry itself
  if (marker === undefined && href === stale.href) return { stale: null, back: true }; // stepped off it onto its page
  return { stale: null, back: false };
}

type OpenSheet = { id: string; href: string; close: () => void };

const open: OpenSheet[] = [];
let stale: StaleEntry | null = null;
let ownPops = 0;
let listening = false;
let nextId = 1;

const currentMarker = (): string | undefined => window.history.state?.[KEY];

function onPopState() {
  if (ownPops > 0) {
    ownPops -= 1;
    return;
  }
  const top = open[open.length - 1];
  if (top && currentMarker() !== top.id) {
    open.pop();
    top.close();
    return;
  }
  if (!stale) return;
  const step = afterStalePop(stale, currentMarker(), window.location.href);
  stale = step.stale;
  if (step.back) window.history.back();
}

/**
 * While `active`, Back closes the sheet by calling `close`. Returns the
 * function the sheet calls to close itself, which also gives back its entry.
 */
export function useBackToClose(active: boolean, close: () => void): () => void {
  const closeRef = useRef(close);
  const idRef = useRef<string | null>(null);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!active) return;
    if (!listening) {
      window.addEventListener("popstate", onPopState);
      listening = true;
    }
    const id = `sheet-${nextId++}`;
    idRef.current = id;
    const href = window.location.href;
    // Reopening on top of this sheet's own stale entry reuses it rather than stacking another.
    if (stale && currentMarker() === stale.id) {
      window.history.replaceState({ [KEY]: id }, "");
      stale = null;
    } else {
      window.history.pushState({ [KEY]: id }, "");
    }
    open.push({ id, href, close: () => closeRef.current() });
    return () => {
      idRef.current = null;
      const at = open.findIndex((sheet) => sheet.id === id);
      if (at < 0) return; // closed by Back or by dismiss()
      open.splice(at, 1);
      stale = { id, href };
    };
  }, [active]);

  return useCallback(() => {
    const id = idRef.current;
    const at = id ? open.findIndex((sheet) => sheet.id === id) : -1;
    if (at >= 0 && currentMarker() === id) {
      open.splice(at, 1);
      ownPops += 1;
      window.history.back();
    }
    closeRef.current();
  }, []);
}
