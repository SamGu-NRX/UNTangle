"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const PHONE_QUERY = "(max-width: 720px)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export type PresenceState = "entering" | "open" | "closing";

/**
 * Keeps an element mounted through its exit transition. It mounts in
 * "entering" (the CSS start state), flips to "open" on the next frame so the
 * transition runs, and stays mounted in "closing" for `exitMs`. Transitions,
 * not keyframes, so reopening mid-exit reverses from where it is.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<PresenceState>(open ? "open" : "entering");
  const [previousOpen, setPreviousOpen] = useState(open);
  // Adjust during render when `open` flips (React's pattern for state derived from a prop change).
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) {
      if (!mounted) setState("entering");
      setMounted(true);
    } else if (mounted) {
      setState("closing");
    }
  }
  useEffect(() => {
    if (open) {
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setState("open"));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);
  return { mounted, state };
}

/**
 * Height of the sticky app bar above the view, so the detail panel can stick
 * just under it. Reads whichever top-pinned header the shell renders rather
 * than hard-coding one shell's height.
 */
export function useStickyTop(fallback = 56): number {
  const [top, setTop] = useState(fallback);
  useIsomorphicLayoutEffect(() => {
    const measure = () => {
      let bottom = 0;
      for (const header of document.querySelectorAll<HTMLElement>("body header")) {
        const style = getComputedStyle(header);
        if ((style.position === "sticky" || style.position === "fixed") && parseFloat(style.top || "0") === 0) {
          bottom = Math.max(bottom, header.getBoundingClientRect().height);
        }
      }
      setTop(bottom || fallback);
    };
    measure();
    const observer = new ResizeObserver(measure);
    document.querySelectorAll("body header").forEach((header) => observer.observe(header));
    return () => observer.disconnect();
  }, [fallback]);
  return top;
}

/** JSON in localStorage; falls back to memory when storage is blocked. */
export function useStoredState<T>(key: string, initial: T): [T, (next: T | ((current: T) => T)) => void] {
  // Read once on the client. Callers only render these values after the planner
  // has hydrated, so the server's `initial` never meets a different client value.
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage blocked: the value lives in memory for this visit.
        }
        return resolved;
      });
    },
    [key],
  );
  return [value, update];
}

/** Closes a popover on outside pointer-down. */
export function useOutsidePress(ref: React.RefObject<HTMLElement | null>, active: boolean, onOutside: () => void) {
  const handler = useRef(onOutside);
  useEffect(() => {
    handler.current = onOutside;
  });
  useEffect(() => {
    if (!active) return;
    const listener = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) handler.current();
    };
    document.addEventListener("pointerdown", listener);
    return () => document.removeEventListener("pointerdown", listener);
  }, [ref, active]);
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside a modal surface and restores focus to the opener on close. */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => element.offsetParent !== null,
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
