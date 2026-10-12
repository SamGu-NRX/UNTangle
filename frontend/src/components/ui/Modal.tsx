"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const EXIT_DURATION = 160;
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  origin,
  maxWidth = 560,
  closable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  origin?: { x: number; y: number } | null;
  maxWidth?: number;
  closable?: boolean;
}) {
  const [exiting, setExiting] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Keep the last real title while the exit animation plays so the dialog
  // stays programmatically named (and no empty heading renders) as it closes.
  const [retainedTitle, setRetainedTitle] = useState<ReactNode>(undefined);
  const [prevTitle, setPrevTitle] = useState(title);
  if (prevTitle !== title) {
    setPrevTitle(title);
    if (title) {
      setRetainedTitle(title);
    }
  }
  const shownTitle = title || (exiting ? retainedTitle : undefined);
  const hasTitle = Boolean(shownTitle);
  const mounted = open || exiting;

  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Delay unmount so the exit animation can finish.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    return () => {
      setExiting(true);
      exitTimerRef.current = setTimeout(() => {
        setExiting(false);
        triggerRef.current?.focus?.();
        triggerRef.current = null;
        exitTimerRef.current = null;
      }, EXIT_DURATION);
    };
  }, [open]);

  // Keep the scale animation anchored to the opener when available.
  useLayoutEffect(() => {
    if (!mounted || !boxRef.current) return;
    const box = boxRef.current;
    const r = box.getBoundingClientRect();
    if (origin) {
      const x = Math.max(0, Math.min(r.width, origin.x - r.left));
      const y = Math.max(0, Math.min(r.height, origin.y - r.top));
      box.style.transformOrigin = `${x}px ${y}px`;
    } else {
      box.style.transformOrigin = "50% 50%";
    }
  }, [mounted, origin]);

  // Move focus into the dialog when it opens: the first control, or the box.
  useEffect(() => {
    if (!open) return;
    const box = boxRef.current;
    if (!box || box.contains(document.activeElement)) return;
    const first = box.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box).focus();
  }, [open]);

  // Close on Escape, keep Tab inside the dialog, and lock background scroll
  // while the dialog is present.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable) onClose();
      if (e.key === "Tab" && boxRef.current) {
        const focusable = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (focusable.length === 0) {
          e.preventDefault();
          boxRef.current.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        const inside = boxRef.current.contains(active);
        if (e.shiftKey && (active === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mounted, onClose, closable]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && closable) onClose();
    },
    [onClose, closable],
  );

  if (!mounted || typeof document === "undefined") return null;

  const state = exiting ? "exit" : "enter";

  return createPortal(
    <div
      className="modal-overlay"
      data-state={state}
      onClick={handleBackdrop}
      role="presentation"
    >
      <div
        ref={boxRef}
        className="modal-box"
        data-state={state}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasTitle ? titleId : undefined}
        tabIndex={-1}
        style={{ maxWidth }}
      >
        {shownTitle || closable ? (
          <div className="modal-head">
            <div style={{ minWidth: 0 }} id={typeof shownTitle === "string" ? undefined : titleId}>
              {typeof shownTitle === "string" ? (
                <h2 id={titleId} className="font-display" style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--brand-900)" }}>
                  {shownTitle}
                </h2>
              ) : (
                shownTitle
              )}
            </div>
            {closable ? (
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="btn-ghost"
                style={{ padding: "0.3rem 0.55rem", fontSize: 18, lineHeight: 1 }}
              >
                ✕
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
