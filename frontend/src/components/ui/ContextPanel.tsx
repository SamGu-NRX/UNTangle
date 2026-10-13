"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BottomSheet } from "./BottomSheet";
import { IconButton } from "./Button";
import { Close } from "./icons";
import { keyboardFocused } from "./input-source";
import { useIsClient } from "./Toast";
import { PHONE_QUERY, useMediaQuery } from "./use-media-query";
import { usePresence } from "./use-presence";

const EXIT_MS = 150;

export type ContextPanelProps = {
  /** True while something is selected. With nothing selected the panel renders nothing. */
  open: boolean;
  onClose: () => void;
  /** The panel's heading and accessible name, such as "CSCE 2110". */
  title: string;
  /** The selected item, which takes focus back when the panel closes. */
  returnFocus: () => HTMLElement | null;
  children: ReactNode;
};

/** Marks the shell's <main> so its CSS can make room for the panel (shell.css). */
function markMain(name: string, on: boolean) {
  document.getElementById("main")?.toggleAttribute(name, on);
}

/**
 * The one detail surface for a selection (docs/design/untangle-v3.md,
 * simplification rule 2): a panel on the right on desktop, the same content
 * in a modal sheet on phones.
 *
 * Desktop is not modal: the page stays live, so picking another item swaps
 * the content in place without animating. From 1200px the page slides left
 * by half the panel and its gap as the panel comes in, so the two sit side
 * by side; narrower, the panel overlays. Opened from the keyboard, or closed
 * with Escape, nothing animates. Under reduced motion the page keeps the
 * open position and only the panel fades.
 *
 * Escape closes it unless a dialog or sheet on top, or an open menu, took
 * that Escape first. Closing returns focus to the selected item when focus
 * was in the panel or had nowhere to be; it never pulls focus away from
 * somewhere the student moved it on purpose.
 *
 * The page under a panel moves with a transform, so a lens using it should
 * not rely on position: fixed inside <main>.
 */
export function ContextPanel({ open, onClose, title, returnFocus, children }: ContextPanelProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const isClient = useIsClient();
  /** Closing from the keyboard skips the exit; reset whenever the panel opens again. */
  const [instant, setInstant] = useState(false);
  const desktopOpen = open && !phone;
  const [wasOpen, setWasOpen] = useState(desktopOpen);
  if (desktopOpen !== wasOpen) {
    setWasOpen(desktopOpen);
    if (desktopOpen) setInstant(false);
  }
  const { mounted, state } = usePresence(desktopOpen, instant ? 0 : EXIT_MS);
  const titleId = useId();
  const [shownTitle, setShownTitle] = useState(title);
  if (open && title !== shownTitle) setShownTitle(title);

  const closeFromKeyboard = useEffectEvent(() => {
    setInstant(true);
    onClose();
  });
  // The selected item, read on every commit while open: by the time the panel
  // closes, the parent has usually cleared its selection.
  const selected = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (desktopOpen) selected.current = returnFocus();
  });

  // While a panel can open here the page knows; under reduced motion it then keeps the open position.
  useLayoutEffect(() => {
    markMain("data-context-host", true);
    return () => markMain("data-context-host", false);
  }, []);

  useLayoutEffect(() => {
    if (!desktopOpen) return;
    // A keyboard selection lands at once; a pointer one slides. Set before the
    // panel's first style is computed, so its entrance transition never starts.
    const keyboard = keyboardFocused();
    document.getElementById(titleId)?.closest("aside")?.toggleAttribute("data-instant", keyboard);
    markMain("data-context-instant", keyboard);
    markMain("data-context-open", true);

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A dialog or sheet on top owns Escape.
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      markMain("data-context-instant", true);
      closeFromKeyboard();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      markMain("data-context-open", false);
    };
  }, [desktopOpen, titleId]);

  // Focus goes back after the commit: React restores the focus it saw before
  // a commit, which would undo a move made in a layout effect.
  useEffect(() => {
    if (!desktopOpen) return;
    return () => {
      const panel = document.getElementById(titleId)?.closest("aside");
      const active = document.activeElement;
      const lost = !active || active === document.body || panel?.contains(active);
      const target = selected.current;
      if (lost && target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [desktopOpen, titleId]);

  if (phone) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        title={shownTitle}
        detents={["52%", "92%"]}
        returnFocus={returnFocus}
      >
        {children}
      </BottomSheet>
    );
  }

  if (!mounted || !isClient) return null;
  return createPortal(
    <aside
      className="ui-context"
      data-state={state}
      data-instant={instant ? "" : undefined}
      // On its way out, nothing in it can be reached.
      inert={state === "closed" || undefined}
      aria-labelledby={titleId}
      data-ui=""
    >
      <div className="ui-context__head">
        <h2 id={titleId} className="ui-context__title">
          {shownTitle}
        </h2>
        <IconButton
          label={`Close ${shownTitle}`}
          size="sm"
          onClick={(event) => {
            // Enter or Space on Close is a keyboard action: no exit animation.
            const keyboard = event.detail === 0;
            markMain("data-context-instant", keyboard);
            setInstant(keyboard);
            onClose();
          }}
        >
          <Close />
        </IconButton>
      </div>
      <div className="ui-context__body">{children}</div>
    </aside>,
    document.body,
  );
}
