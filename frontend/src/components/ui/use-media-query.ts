"use client";

import { useCallback, useSyncExternalStore } from "react";

/** The phone layout: the tab bar shell and sheets instead of side panels. */
export const PHONE_QUERY = "(max-width: 759px)";

/** Whether a media query matches now, kept live. False on the server. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
