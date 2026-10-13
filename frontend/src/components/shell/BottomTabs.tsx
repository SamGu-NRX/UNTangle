"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { VIEWS, type ViewId } from "./routes";

const GLYPHS: Record<ViewId, ReactNode> = {
  courses: (
    <>
      <rect x="3" y="4" width="16" height="14" rx="2" />
      <path d="M7 9h8M7 13h5" />
    </>
  ),
  week: (
    <>
      <rect x="3" y="4" width="16" height="15" rx="2" />
      <path d="M3 9h16M8 4v4M14 4v4" />
    </>
  ),
  map: (
    <>
      <path d="M11 19s6-5.3 6-9.5A6 6 0 0 0 5 9.5C5 13.7 11 19 11 19z" />
      <circle cx="11" cy="9.5" r="2" />
    </>
  ),
};

/**
 * Phone navigation: three tabs, 20px glyph and 11px label, 56px plus the
 * home-indicator inset. Switching never animates (DESIGN.md §4).
 */
export function BottomTabs({ view }: { view: ViewId | null }) {
  return (
    <nav aria-label="Views" className="shell-tabs">
      {VIEWS.map((v) => (
        <Link key={v.id} href={v.href} className="shell-tab" aria-current={v.id === view ? "page" : undefined}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 22 22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            {GLYPHS[v.id]}
          </svg>
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
