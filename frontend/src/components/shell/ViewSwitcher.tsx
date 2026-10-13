"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { SegmentPill } from "@/components/ui/Segmented";
import { VIEWS, type ViewId } from "./routes";

/**
 * Courses · Week · Map. Real links (so ⌘-click opens a tab) drawn as the
 * segmented control. The pill moves on press, before the route commits,
 * so the switch answers the click at once; the new view itself appears
 * without animation (DESIGN.md §6).
 */
export function ViewSwitcher({ view }: { view: ViewId | null }) {
  const [pending, setPending] = useState<{ from: ViewId | null; to: ViewId } | null>(null);
  // A press only overrides the route until the route catches up.
  const shown = pending && pending.from === view ? pending.to : view;
  const index = VIEWS.findIndex((v) => v.id === shown);
  return (
    <nav aria-label="Views" className="ui-seg shell-switcher" style={{ "--seg-count": VIEWS.length } as CSSProperties} data-ui="">
      <SegmentPill index={index} />
      {VIEWS.map((v) => (
        <Link
          key={v.id}
          href={v.href}
          className="ui-seg__item"
          aria-current={v.id === view ? "page" : undefined}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            setPending({ from: view, to: v.id });
          }}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
