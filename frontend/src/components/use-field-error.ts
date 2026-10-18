"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Makes a field error heard. Call `report(field, text)` in the same handler
 * that sets the error state.
 *
 * - Focus moves to the field after the commit that renders the error, so
 *   the screen reader reads it as the field's description. Focusing before
 *   then would read the field without it.
 * - If the field already has focus (the person pressed Enter in it), focus
 *   cannot move, so the text goes to a live region instead. A trailing
 *   no-break space alternates so a repeated message still changes it.
 *
 * Call `clear()` wherever the error clears, so the live region never holds
 * a reason the field no longer shows: a later error reported by moving
 * focus leaves the announcement as it is.
 */
export function useFieldError() {
  const pendingFocus = useRef<HTMLElement | null>(null);
  const flip = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    pendingFocus.current?.focus();
    pendingFocus.current = null;
  });

  function report(field: HTMLElement | null, text: string) {
    if (field && document.activeElement === field) {
      flip.current = !flip.current;
      setAnnouncement(flip.current ? text : `${text} `);
    } else {
      pendingFocus.current = field;
    }
  }

  function clear() {
    setAnnouncement("");
  }

  return { report, clear, announcement };
}
