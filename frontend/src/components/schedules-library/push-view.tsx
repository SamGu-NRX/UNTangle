"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useBackToClose } from "@/components/ui/back-close";
import { ChevronLeft } from "@/components/ui/icons";
import styles from "./library.module.css";

/**
 * The phone's library: the detail pushes in from the right over the list,
 * which slides a quarter left and dims (MOTION.md §3, "Library push":
 * 260ms in, 200ms out, --ease-sheet; a 150ms crossfade under reduced
 * motion). Opened from the keyboard, it appears at once.
 *
 * One screen at a time: the hidden one is inert, so Tab, the pointer and a
 * screen reader stay on the screen showing. Back (the button, Escape, the
 * browser's or the phone's back gesture) pops the detail and returns focus
 * to the row that opened it.
 */
export function PushView({
  open,
  title,
  onBack,
  returnFocus,
  list,
  instant,
  children,
}: {
  open: boolean;
  title: string;
  onBack: () => void;
  returnFocus: () => HTMLElement | null;
  list: ReactNode;
  /** Read when it opens or closes: true when the action came from the keyboard. */
  instant: () => boolean;
  children: ReactNode;
}) {
  const back = useRef<HTMLButtonElement | null>(null);
  const [shown, setShown] = useState({ title, children });
  if (open && (shown.title !== title || shown.children !== children)) setShown({ title, children });
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setFromKeyboard(instant());
  }

  const closeFromHistory = useBackToClose(open, onBack);
  // The row (or Compare) to return to, read on every commit while open: by the
  // time the detail closes, the page has already cleared its selection.
  const target = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) target.current = returnFocus() ?? target.current;
  });
  useLayoutEffect(() => {
    if (open) back.current?.focus({ preventScroll: true });
  }, [open]);
  const opened = useRef(open);
  useEffect(() => {
    if (opened.current && !open && target.current?.isConnected) target.current.focus({ preventScroll: true });
    opened.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setFromKeyboard(true);
      closeFromHistory();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeFromHistory]);

  return (
    <div className={styles.push} data-pushed={open || undefined} data-instant={fromKeyboard || undefined}>
      {/* data-ui: these declare their own reduced-motion fade, so globals.css leaves it alone. */}
      <div className={styles.pushList} inert={open || undefined} data-ui="">
        {list}
      </div>
      <section className={styles.pushDetail} aria-labelledby="push-title" inert={!open || undefined} data-ui="">
        <button ref={back} type="button" className={styles.back} onClick={closeFromHistory}>
          <ChevronLeft size={18} />
          Schedules
        </button>
        <h2 id="push-title" className={styles.pushTitle}>
          {shown.title}
        </h2>
        {shown.children}
      </section>
    </div>
  );
}
