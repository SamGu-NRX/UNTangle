"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./schedule.module.css";

const DISMISSED_KEY = "untangle-week-sample-note:dismissed";
const listeners = new Set<() => void>();
let dismissedThisVisit = false;

function dismissed(): boolean {
  if (dismissedThisVisit) return true;
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The one banner on the Week view (DESIGN.md §7): a first-visit note that
 * the sections are samples. Dismissing it is remembered in this browser;
 * the "Sample sections" tag in the view header stays either way. Not drawn
 * on the server, so a dismissed note never flashes.
 */
export function SampleNote() {
  const hidden = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    dismissed,
    () => true,
  );
  if (hidden) return null;
  return (
    <div className={styles.sampleNote}>
      <p>Sections here are samples, not UNT&rsquo;s class schedule. Check the official schedule before you register.</p>
      <Button
        variant="link"
        size="sm"
        onClick={() => {
          dismissedThisVisit = true;
          try {
            window.localStorage.setItem(DISMISSED_KEY, "1");
          } catch {
            // Storage denied: the note hides for this visit only.
          }
          listeners.forEach((listener) => listener());
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
