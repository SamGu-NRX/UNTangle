"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Close } from "./icons";

export type ToastInput = {
  message: string;
  /** e.g. { label: "Undo", onClick }. A toast with an action stays until dismissed. */
  action?: { label: string; onClick: () => void };
  /** An error stays until dismissed, so its explanation cannot be missed. */
  tone?: "default" | "error";
  /** Milliseconds before a plain toast leaves. Default 5000 (DESIGN.md §8.2). */
  duration?: number;
};

/** Toasts that carry an action or an error wait for the reader. */
function isPersistent(record: ToastInput): boolean {
  return Boolean(record.action) || record.tone === "error";
}

type ToastRecord = ToastInput & { id: number };

let current: ToastRecord | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/**
 * Shows a toast, replacing any toast on screen (one at a time,
 * DESIGN.md §4). Needs a mounted <Toaster />; the app shell mounts one.
 */
export function toast(input: ToastInput | string): number {
  current = { ...(typeof input === "string" ? { message: input } : input), id: nextId++ };
  emit();
  return current.id;
}

export function dismissToast(id?: number) {
  if (current && (id === undefined || current.id === id)) {
    current = null;
    emit();
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const EXIT_MS = 150;

const noopSubscribe = () => () => {};
/** False during SSR and hydration, true after; portals need a document. */
export function useIsClient() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * Bottom-centre toast, above the tab bar on phones: 44px, ink, white 14px.
 * Enters with 8px of rise and a fade over 220ms, leaves in 150ms. A plain
 * toast leaves after 5s, counting only while the page is visible and the
 * toast is neither hovered nor focused; one with an action or an error
 * waits to be dismissed, so a keyboard user can always reach Undo.
 *
 * Two regions, both direct children of <body>. A visually hidden live
 * region holds only the message text; it stays outside a modal's inert set
 * so every new message is announced. The visible toast with its buttons is
 * an ordinary region that goes inert with the page while a dialog is open,
 * so focus cannot leave the dialog for a toast action.
 */
export function Toaster() {
  const record = useSyncExternalStore(subscribe, () => current, () => null);
  const [shown, setShown] = useState<ToastRecord | null>(record);
  const [leaving, setLeaving] = useState(false);
  // Paused for a specific toast, so a replacement never inherits the pause
  // of the toast that was hovered or focused before it.
  const [pausedFor, setPausedFor] = useState<number | null>(null);
  const paused = shown !== null && pausedFor === shown.id;
  const remaining = useRef(0);

  // Swap records: the old one plays its exit, then the new one enters.
  if (record !== shown && !leaving) {
    if (shown && record?.id !== shown.id) {
      setLeaving(true);
    } else {
      setShown(record);
    }
  }
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => {
      setLeaving(false);
      setShown(current);
    }, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);

  useEffect(() => {
    remaining.current = shown && !isPersistent(shown) ? (shown.duration ?? 5000) : Infinity;
  }, [shown]);

  // Count down only while visible, unhovered and unfocused.
  useEffect(() => {
    if (!shown || leaving || isPersistent(shown)) return;
    const hidden = () => document.visibilityState === "hidden";
    let started = Date.now();
    let timer: number | null = null;
    const arm = () => {
      if (paused || hidden()) return;
      started = Date.now();
      timer = window.setTimeout(() => dismissToast(shown.id), remaining.current);
    };
    const disarm = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
      remaining.current -= Date.now() - started;
    };
    const onVisibility = () => (hidden() ? disarm() : arm());
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disarm();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [shown, leaving, paused]);

  const isClient = useIsClient();
  if (!isClient) return null;

  return (
    <>
      {createPortal(
        // aria-live without role="status": the page's own status regions
        // (save state, Connect's progress) stay the only "status" landmarks.
        <div className="sr-only-v2" aria-live="polite" aria-atomic="true" data-ui-live="">
          {record?.message ?? ""}
        </div>,
        document.body,
      )}
      {createPortal(
        <div className="ui-toaster" data-ui="">
          {shown ? (
            <div
              key={shown.id}
              className="ui-toast"
              data-state={leaving ? "closed" : "open"}
              data-tone={shown.tone ?? "default"}
              data-ui=""
              onPointerEnter={() => setPausedFor(shown.id)}
              onPointerLeave={() => setPausedFor(null)}
              onFocus={() => setPausedFor(shown.id)}
              onBlur={() => setPausedFor(null)}
            >
              <span className="ui-toast__message">{shown.message}</span>
              {shown.action ? (
                <button
                  type="button"
                  className="ui-toast__action"
                  onClick={() => {
                    shown.action?.onClick();
                    dismissToast(shown.id);
                  }}
                >
                  {shown.action.label}
                </button>
              ) : null}
              {isPersistent(shown) ? (
                <button type="button" className="ui-toast__close" aria-label="Dismiss" onClick={() => dismissToast(shown.id)}>
                  <Close size={14} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>,
        document.body,
      )}
    </>
  );
}
