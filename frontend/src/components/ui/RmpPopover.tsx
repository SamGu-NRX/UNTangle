"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RatingStar, ratingTier } from "@/components/ui/RatingStar";

const EXIT = 120;

export type RmpData = {
  rating: number | null;
  difficulty?: number | null;
  wouldTakeAgainPct?: number | null;
  tags?: string[];
  profileUrl?: string | null;
};

export function RmpPopover({
  open,
  onClose,
  origin,
  data,
  instructorName,
}: {
  open: boolean;
  onClose: () => void;
  origin: { x: number; y: number } | null;
  data: RmpData | null;
  instructorName?: string;
}) {
  const [exiting, setExiting] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const mounted = open || exiting;

  useEffect(() => {
    if (open) return;
    if (!exiting) return;
    const t = setTimeout(() => setExiting(false), EXIT);
    return () => clearTimeout(t);
  }, [open, exiting]);

  useEffect(() => {
    if (!open) return;
    return () => {
      setExiting(true);
    };
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", handle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", handle);
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, onClose]);

  if (!mounted || typeof document === "undefined") return null;

  const top = origin ? Math.max(8, origin.y + 12) : 8;
  const left = origin ? Math.max(8, Math.min(window.innerWidth - 268, origin.x - 130)) : 8;
  const tier = data ? ratingTier(data.rating) : "low";

  return createPortal(
    <div
      ref={ref}
      className="rmp-popover"
      role="dialog"
      data-state={exiting ? "exit" : "enter"}
      style={{ top, left }}
    >
      <div className="rmp-popover__head">
        <span className="rmp-popover__rating" style={{ color: `var(--rmp-${tier})` }}>
          {data?.rating != null ? data.rating.toFixed(1) : "—"}
        </span>
        <span className="rmp-popover__sub">{instructorName ?? "RateMyProfessors"}</span>
      </div>
      {data?.rating == null ? (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.78rem", color: "var(--copy)" }}>
          No RMP data yet.
        </p>
      ) : (
        <>
          {data.difficulty != null ? (
            <div className="rmp-popover__row">
              <span>Difficulty</span>
              <strong>{data.difficulty.toFixed(1)} / 5</strong>
            </div>
          ) : null}
          {data.wouldTakeAgainPct != null ? (
            <div className="rmp-popover__row">
              <span>Would take again</span>
              <strong>{Math.round(data.wouldTakeAgainPct)}%</strong>
            </div>
          ) : null}
          {data.tags && data.tags.length > 0 ? (
            <div className="rmp-popover__tags">
              {data.tags.slice(0, 4).map((t) => (
                <span key={t} className="rmp-popover__tag">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          {data.profileUrl ? (
            <a
              href={data.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rmp-popover__link"
            >
              View profile →
            </a>
          ) : null}
        </>
      )}
    </div>,
    document.body,
  );
}

export function RatingTrigger({
  rating,
  onOpen,
}: {
  rating: number | null;
  onOpen: (origin: { x: number; y: number }) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onOpen({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      style={{
        background: "transparent",
        border: "none",
        padding: "0.18rem 0.4rem",
        borderRadius: "var(--r-sm)",
        cursor: rating != null ? "pointer" : "default",
      }}
      aria-label="View instructor ratings"
    >
      <RatingStar rating={rating} showEmpty />
    </button>
  );
}
