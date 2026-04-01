"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const EXIT_DURATION = 160;

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
  const triggerRef = useRef<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
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

  // Close on Escape and lock background scroll while the dialog is present.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable) onClose();
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
        style={{ maxWidth }}
      >
        {title || closable ? (
          <div className="modal-head">
            <div style={{ minWidth: 0 }}>
              {typeof title === "string" ? (
                <h2 className="font-display" style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--brand-900)" }}>
                  {title}
                </h2>
              ) : (
                title
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
