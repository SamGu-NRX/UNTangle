"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Close } from "./icons";

export type ToastInput = {
  message: string;
  /** e.g. { label: "Undo", onClick }. A toast with an action stays until dismissed. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before a plain toast leaves. Default 4000. */
  duration?: number;
};

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
 * Bottom-centre toast region: 44px, ink, white 13px, radius 10. Enters with
 * 8px of rise and a fade over 200ms, leaves in 150ms. The live region is
 * always mounted (and stays reachable while a dialog makes the page
 * inert), so each new message is announced.
 */
export function Toaster() {
  const record = useSyncExternalStore(subscribe, () => current, () => null);
  const [shown, setShown] = useState<ToastRecord | null>(record);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
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
    remaining.current = shown && !shown.action ? (shown.duration ?? 4000) : Infinity;
  }, [shown]);

  // Count down only while visible, unhovered and unfocused.
  useEffect(() => {
    if (!shown || leaving || shown.action) return;
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

  // A direct child of <body>, so a modal's inert set never swallows it.
  return createPortal(
    <div className="ui-toaster" role="status" aria-live="polite" data-ui-live="" data-ui="">
      {shown ? (
        <div
          key={shown.id}
          className="ui-toast"
          data-state={leaving ? "closed" : "open"}
          data-ui=""
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <span className="ui-toast__message">{shown.message}</span>
          {shown.action ? (
            <>
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
              <button type="button" className="ui-toast__close" aria-label="Dismiss" onClick={() => dismissToast(shown.id)}>
                <Close size={14} />
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
