"use client";

import Link from "next/link";
import { useState, type CSSProperties, type MouseEvent } from "react";
import { SegmentPill } from "@/components/ui/Segmented";
import { LENSES, type Lens } from "./routes";

type Props = {
  lens: Lens | null;
  /** Where each lens was left (lens-memory). Defaults to each lens's root. */
  hrefs?: Record<Lens, string>;
  onPick?: (lens: Lens, event: MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * Courses, Week and Day on desktop: real links (so ⌘-click opens a tab)
 * drawn as the segmented control. The pill moves on press, before the
 * route commits, so the switch answers the click at once; from the keyboard
 * it lands without moving. The lens itself appears without animation.
 */
export function ViewTabs({ lens, hrefs, onPick }: Props) {
  const [pending, setPending] = useState<{ from: Lens | null; to: Lens; keyboard: boolean } | null>(null);
  const [committed, setCommitted] = useState(lens);
  // The pill slides only for a pointer press on these tabs. A route that
  // changes any other way (a keyboard press, the search, a link, Back) lands
  // at once; a pressed tab's own route landing keeps the slide it started.
  const [instant, setInstant] = useState(false);
  if (committed !== lens) {
    // Any navigation that lands ends the pending press, so it can never resurface later.
    setInstant(!(pending && pending.to === lens && !pending.keyboard));
    setCommitted(lens);
    setPending(null);
  }
  // A press only overrides the route until the route catches up.
  const shown = pending && pending.from === lens ? pending.to : lens;
  const index = LENSES.findIndex((item) => item.id === shown);
  return (
    <nav
      aria-label="Views"
      className="ui-seg shell-viewtabs"
      style={{ "--seg-count": LENSES.length } as CSSProperties}
      data-instant={instant ? "" : undefined}
      data-ui=""
    >
      <SegmentPill index={index} />
      {LENSES.map((item) => (
        <Link
          key={item.id}
          href={hrefs?.[item.id] ?? item.href}
          // Lenses are not history (DESIGN.md §3.4): a switch replaces the entry.
          replace
          scroll={false}
          className="ui-seg__item"
          aria-current={item.id === lens ? "page" : undefined}
          onClick={(event) => {
            onPick?.(item.id, event);
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            const keyboard = event.detail === 0;
            setInstant(keyboard);
            setPending({ from: lens, to: item.id, keyboard });
          }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
