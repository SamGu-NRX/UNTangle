"use client";

import { useEffect, useState } from "react";

/**
 * Keeps an overlay mounted for its exit animation. `state` is "open" while
 * open and "closed" during the `exitMs` window before unmount, so CSS can
 * transition to the closed look. Reopening during the exit cancels it.
 */
export function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  if (open && !mounted) setMounted(true);
  if (open && closing) setClosing(false);
  if (!open && mounted && !closing) setClosing(true);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, exitMs);
    return () => window.clearTimeout(timer);
  }, [closing, exitMs]);

  return { mounted, state: closing ? ("closed" as const) : ("open" as const) };
}
