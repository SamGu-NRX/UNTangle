"use client";

import { useEffect, useReducer, useRef, type MouseEvent } from "react";

/**
 * The trip to myUNT for the transcript PDF. A web page can't read the
 * Downloads folder (Chromium blocks it for the File System Access API), so
 * the student downloads the PDF in myUNT and comes back to choose it. This
 * module opens myUNT in a separate window and notices the return, so the
 * sheet can then lead with "Use the downloaded PDF".
 *
 *   idle --open--> away --(window closed | page regains focus/visibility)--> back
 *
 * "Back" only changes which action leads; the student can choose the PDF
 * from "away" too. That matters because a page that sets
 * Cross-Origin-Opener-Policy (possible on UNT's sign-in pages; not checked)
 * cuts the link to the window, which then reads as closed early.
 */

export type TripVia = "popup" | "tab";
export type Trip =
  | { stage: "idle" }
  /** `left`: this page has lost focus or visibility since myUNT opened. */
  | { stage: "away"; via: TripVia; left: boolean }
  | { stage: "back" };

export type TripEvent =
  | { type: "opened"; via: TripVia }
  | { type: "left" }
  | { type: "returned" }
  | { type: "popupClosed" }
  | { type: "reset" };

export function tripReducer(trip: Trip, event: TripEvent): Trip {
  switch (event.type) {
    case "opened":
      return { stage: "away", via: event.via, left: false };
    case "reset":
      return { stage: "idle" };
    case "left":
      return trip.stage === "away" && !trip.left ? { ...trip, left: true } : trip;
    case "returned":
      // Focus that never went away (the click itself) is not a return.
      return trip.stage === "away" && trip.left ? { stage: "back" } : trip;
    case "popupClosed":
      return trip.stage === "away" && trip.via === "popup" ? { stage: "back" } : trip;
  }
}

/** The window name: opening again reuses (and focuses) the same window. */
export const MYUNT_WINDOW = "untangle-myunt";

type Geometry = {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  screen: { availWidth: number; availHeight: number };
};

/** A 1000x800 window (smaller on small screens), centred over this one. */
export function popupFeatures(win: Geometry): string {
  const width = Math.max(320, Math.min(1000, win.screen.availWidth - 80));
  const height = Math.max(320, Math.min(800, win.screen.availHeight - 80));
  const left = Math.max(0, Math.round(win.screenX + (win.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(win.screenY + (win.outerHeight - height) / 2));
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

/** The parts of a popup this module touches. */
export type PopupHandle = {
  closed: boolean;
  opener: unknown;
  location: { href: string };
  focus(): void;
};
type OpenerWindow = Geometry & {
  open(url: string, target: string, features: string): PopupHandle | null;
};

export type Opened = { via: "popup"; handle: PopupHandle } | { via: "tab" };

/**
 * Opens myUNT in a popup window, or reports that the popup was blocked, in
 * which case the caller lets its link open myUNT in a new tab instead.
 *
 * The window starts blank so it can be cut off from this page
 * (`opener = null`, the effect of noopener) before it navigates, while this
 * page keeps the handle it needs to notice the window closing. `noopener`
 * in the features would do the first but return no handle.
 */
export function openMyUnt(win: OpenerWindow, url: string): Opened {
  const handle = win.open("", MYUNT_WINDOW, popupFeatures(win));
  if (!handle) return { via: "tab" };
  let fresh = false;
  try {
    fresh = handle.location.href === "about:blank";
  } catch {
    // Cross-origin: a myUNT window from an earlier click. Leave its page alone.
  }
  if (fresh) {
    handle.opener = null;
    handle.location.href = url;
  }
  handle.focus();
  return { via: "popup", handle };
}

/** How often to check whether the popup has closed; `closed` has no event. */
const POLL_MS = 500;

/**
 * Trip state plus the click handler for the "Open myUNT" link. While away,
 * it polls the popup's `closed` and watches this page's focus and
 * visibility. `document.hasFocus()` is polled too, because the blur can
 * land before the listeners are attached.
 */
export function useMyUntTrip(initial: () => Trip, onOpened: () => void) {
  const [trip, dispatch] = useReducer(tripReducer, null, initial);
  const popup = useRef<PopupHandle | null>(null);
  const away = trip.stage === "away";

  useEffect(() => {
    if (!away) return;
    const left = () => dispatch({ type: "left" });
    const returned = () => dispatch({ type: "returned" });
    const onVisibility = () => (document.visibilityState === "hidden" ? left() : returned());
    window.addEventListener("blur", left);
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => {
      if (popup.current?.closed) {
        popup.current = null;
        dispatch({ type: "popupClosed" });
        return;
      }
      if (document.visibilityState === "hidden" || !document.hasFocus()) left();
      else returned();
    }, POLL_MS);
    return () => {
      window.removeEventListener("blur", left);
      window.removeEventListener("focus", returned);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [away]);

  /** For the "Open myUNT" link, whose own navigation is the new-tab fallback. */
  function openFromLink(event: MouseEvent<HTMLAnchorElement>) {
    // A modified click asks for a tab: let the link do it.
    const wantsTab = event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0;
    const opened: Opened = wantsTab ? { via: "tab" } : openMyUnt(window, event.currentTarget.href);
    if (opened.via === "popup") {
      event.preventDefault();
      popup.current = opened.handle;
    }
    dispatch({ type: "opened", via: opened.via });
    onOpened();
  }

  function reset() {
    popup.current = null;
    dispatch({ type: "reset" });
  }

  return { trip, openFromLink, reset };
}
