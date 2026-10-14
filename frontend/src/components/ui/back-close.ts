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
 * closes itself (scrim, swipe, Escape, its own Close), it calls back() at
 * once. When the page closes it (a link inside the sheet, a router.push
 * after an import), calling back() could cancel that navigation in the
 * Next.js router, so the entry stays behind as "stale": a Back that steps
 * off a stale entry onto the same page steps once more, so no Back press is
 * ever spent on a sheet that is already gone.
 */

const KEY = "__untangleSheet";

/** The parts of window.history and location this needs; a fake stands in for tests. */
export type HistoryPort = {
  marker(): string | undefined;
  href(): string;
  push(marker: string): void;
  replace(marker: string): void;
  back(): void;
};

type Open = { id: string; href: string; close: () => void };

export class SheetHistory {
  private open: Open[] = [];
  /** Entries left behind by sheets the page closed, by marker: the page each one shows. */
  private stale = new Map<string, string>();
  /** The marker of the entry we are on, as of the last change we saw. */
  private here: string | undefined;
  private ownPops = 0;
  private nextId = 1;

  constructor(private readonly port: HistoryPort) {
    this.here = port.marker();
  }

  /** A sheet opened: give it an entry, reusing a stale one we are standing on. */
  opened(close: () => void): string {
    const id = `sheet-${this.nextId++}`;
    const current = this.port.marker();
    if (current !== undefined && this.stale.has(current)) {
      this.stale.delete(current);
      this.port.replace(id);
    } else {
      this.port.push(id);
    }
    this.here = id;
    this.open.push({ id, href: this.port.href(), close });
    return id;
  }

  /** The sheet closed itself: give its entry back now. */
  dismissed(id: string): void {
    const at = this.open.findIndex((sheet) => sheet.id === id);
    if (at < 0) return;
    this.open.splice(at, 1);
    if (this.port.marker() === id) {
      this.ownPops += 1;
      this.port.back();
    } else {
      this.stale.set(id, this.port.href());
    }
  }

  /** The page closed the sheet (or unmounted it): its entry stays behind as stale. */
  abandoned(id: string): void {
    const at = this.open.findIndex((sheet) => sheet.id === id);
    if (at < 0) return; // already closed by Back or dismissed()
    const [sheet] = this.open.splice(at, 1);
    this.stale.set(id, sheet.href);
  }

  /** The app navigated (a push or replace we did not make). */
  navigated(): void {
    this.here = this.port.marker();
  }

  /** The browser moved through history. */
  popped(): void {
    const left = this.here;
    this.here = this.port.marker();
    if (this.ownPops > 0) {
      this.ownPops -= 1;
      return;
    }
    const top = this.open[this.open.length - 1];
    if (top && this.here !== top.id) {
      this.open.pop();
      top.close();
      return;
    }
    // Stepped off a stale entry onto the same page: that Back changed nothing visible, so take one more.
    if (left !== undefined && this.stale.get(left) === this.port.href()) {
      this.stale.delete(left);
      this.port.back();
    }
  }
}

const windowPort: HistoryPort = {
  marker: () => window.history.state?.[KEY],
  href: () => window.location.href,
  // Next.js copies its own router state into entries pushed without a URL.
  push: (marker) => window.history.pushState({ [KEY]: marker }, ""),
  replace: (marker) => window.history.replaceState({ [KEY]: marker }, ""),
  back: () => window.history.back(),
};

let shared: SheetHistory | null = null;
function sheetHistory(): SheetHistory {
  if (!shared) {
    const instance = new SheetHistory(windowPort);
    window.addEventListener("popstate", () => instance.popped());
    shared = instance;
  }
  return shared;
}

/** The shell calls this when the route changes, so stale entries are judged against the right place. */
export function noteNavigation(): void {
  shared?.navigated();
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
    const history = sheetHistory();
    const id = history.opened(() => closeRef.current());
    idRef.current = id;
    return () => {
      idRef.current = null;
      history.abandoned(id);
    };
  }, [active]);

  return useCallback(() => {
    if (idRef.current) sheetHistory().dismissed(idRef.current);
    closeRef.current();
  }, []);
}
