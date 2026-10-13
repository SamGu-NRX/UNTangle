"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { BottomSheet } from "./BottomSheet";
import { IconButton } from "./Button";
import { Close } from "./icons";
import { PHONE_QUERY, useMediaQuery } from "./use-media-query";
import { usePresence } from "./use-presence";

const EXIT_MS = 150;

export type ContextPanelProps = {
  /** True while something is selected. With nothing selected the panel renders nothing. */
  open: boolean;
  onClose: () => void;
  /** The panel's heading and accessible name, such as "CSCE 2110". */
  title: string;
  /**
   * Where focus goes on close. Defaults to whatever had focus when the panel
   * opened, which is normally the selected row.
   */
  returnFocus?: () => HTMLElement | null;
  children: ReactNode;
};

/**
 * The one detail surface for a selection: a panel on the right on desktop,
 * the same content in a modal sheet on phones.
 *
 * On desktop it is not modal: the page stays live, so the student can pick
 * another row and the content swaps in place without animating. Escape
 * closes it unless a dialog, sheet or open menu took that Escape first.
 * When it closes, focus goes back to the selected item if focus was in the
 * panel (or had nowhere to be); it never pulls focus from somewhere the
 * student moved it on purpose.
 */
export function ContextPanel({ open, onClose, title, returnFocus, children }: ContextPanelProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const { mounted, state } = usePresence(open && !phone, EXIT_MS);
  const panelRef = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [shownTitle, setShownTitle] = useState(title);
  if (open && title !== shownTitle) setShownTitle(title);

  const close = useEffectEvent(() => onClose());
  const focusTarget = useEffectEvent(() => returnFocus?.() ?? opener.current);

  useEffect(() => {
    if (!open || phone) return;
    const panel = panelRef.current;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The last thing focused outside the panel is the current selection.
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && !panel?.contains(event.target)) opener.current = event.target;
    };
    document.addEventListener("focusin", onFocusIn);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A dialog or sheet on top owns Escape.
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      const active = document.activeElement;
      const lost = !active || active === document.body || panel?.contains(active);
      const target = focusTarget();
      if (lost && target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [open, phone]);

  if (phone) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        title={shownTitle}
        closeOnBack
      >
        {children}
      </BottomSheet>
    );
  }

  if (!mounted) return null;
  return (
    <aside ref={panelRef} className="ui-context" data-state={state} aria-labelledby={titleId} data-ui="">
      <div className="ui-context__head">
        <h2 id={titleId} className="ui-context__title">
          {shownTitle}
        </h2>
        <IconButton label={`Close ${shownTitle}`} size="sm" onClick={onClose}>
          <Close />
        </IconButton>
      </div>
      <div className="ui-context__body">{children}</div>
    </aside>
  );
}
