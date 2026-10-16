"use client";

import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { Close } from "./icons";
import { useModalLayer } from "./modal-layer";
import { keyboardFocused } from "./input-source";
import { usePresence } from "./use-presence";

const EXIT_MS = 150;

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title, DM Sans 18/24 600. Also the dialog's accessible name. */
  title?: ReactNode;
  /** Name for a dialog without a visible title. */
  ariaLabel?: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons row, right-aligned. */
  footer?: ReactNode;
  /** Max width in px. Default 480. */
  width?: number;
  /** False hides the × and ignores Escape and scrim clicks. */
  dismissible?: boolean;
  /** `alertdialog` for a decision the user must make before continuing. */
  role?: "dialog" | "alertdialog";
  initialFocus?: RefObject<HTMLElement | null>;
  /**
   * Opens with focus on the title rather than the first control, as a sheet
   * does (components.md, BottomSheet "Focus on open"): for a decision the
   * student should read before reaching a button. The title is focusable by
   * script only and draws no ring. Needs a string `title`.
   */
  focusTitle?: boolean;
  /** Where focus goes on close, when the opener may not have kept focus (Safari doesn't focus a clicked link). */
  returnFocus?: () => HTMLElement | null;
  /**
   * Id of a heading inside the body that names the dialog, when `title`
   * is decoration (a wordmark) and the body's heading changes with its step.
   */
  labelledBy?: string;
  className?: string;
};

/**
 * Centred modal. Not anchored to a trigger, so it scales from its own
 * centre (.96 → 1 with opacity, 220ms in, 150ms out). The scrim is flat
 * --overlay with no blur. The page behind is inert while open, and focus
 * returns to the opener on close.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  ariaLabel,
  description,
  children,
  footer,
  width = 480,
  dismissible = true,
  role = "dialog",
  initialFocus,
  focusTitle = false,
  returnFocus,
  labelledBy,
  className,
}: DialogProps) {
  // Opened or closed from the keyboard (an opener with a focus ring, Escape,
  // Enter on Close), the dialog appears and leaves at once.
  const [instant, setInstant] = useState(false);
  const { mounted, state } = usePresence(open, instant ? 0 : EXIT_MS);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  // Keep the last title through the exit so the closing dialog stays named.
  const [shownTitle, setShownTitle] = useState(title);
  if (title && title !== shownTitle) setShownTitle(title);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setInstant(keyboardFocused());
  }

  useModalLayer(open, rootRef, {
    onEscape: dismissible ? () => onOpenChange(false) : undefined,
    initialFocus: initialFocus ?? (focusTitle ? titleRef : undefined),
    returnFocus,
  });

  if (!mounted || typeof document === "undefined") return null;
  const heading = title ?? shownTitle;

  return createPortal(
    <div
      ref={rootRef}
      className="ui-dialog-layer"
      data-state={state}
      data-instant={instant ? "" : undefined}
      data-ui=""
      tabIndex={-1}
      // On its way out, nothing in it can be reached.
      inert={state === "closed" || undefined}
    >
      <div
        className="ui-dialog-scrim"
        data-state={state}
        data-ui=""
        aria-hidden="true"
        onClick={dismissible ? () => onOpenChange(false) : undefined}
      />
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy ?? (heading ? titleId : undefined)}
        aria-label={labelledBy || heading ? undefined : ariaLabel}
        aria-describedby={description ? descriptionId : undefined}
        className={cx("ui-dialog", className)}
        data-state={state}
        data-ui=""
        style={{ maxWidth: width }}
        tabIndex={-1}
      >
        {heading || dismissible ? (
          <div className="ui-dialog__head">
            {heading ? (
              typeof heading === "string" ? (
                <h2
                  ref={titleRef}
                  id={titleId}
                  className="ui-dialog__title"
                  tabIndex={focusTitle ? -1 : undefined}
                  data-dialog-start={focusTitle ? "" : undefined}
                >
                  {heading}
                </h2>
              ) : (
                <div id={titleId} className="ui-dialog__title">
                  {heading}
                </div>
              )
            ) : (
              <span />
            )}
            {dismissible ? (
              <button type="button" className="ui-btn ui-btn--ink ui-btn--icon ui-btn--sm" aria-label="Close" onClick={() => onOpenChange(false)}>
                <Close />
              </button>
            ) : null}
          </div>
        ) : null}
        {description ? (
          <p id={descriptionId} className="ui-dialog__description">
            {description}
          </p>
        ) : null}
        {children ? <div className="ui-dialog__body">{children}</div> : null}
        {footer ? <div className="ui-dialog__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
