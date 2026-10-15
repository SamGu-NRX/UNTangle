"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { SearchTrigger } from "@/components/ui/SearchField";
import { AccountMenu } from "./AccountMenu";
import type { Lens } from "./routes";
import { PhoneSchedulePill, SchedulePill } from "./SchedulePill";
import { ViewTabs } from "./ViewTabs";

type LensNav = {
  lens: Lens | null;
  hrefs: Record<Lens, string>;
  onPick: (lens: Lens, event: MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * Desktop and tablet (DESIGN.md §3.3), 56px and frosted: the wordmark, the
 * three lenses, search, then the schedule pill and the account. It is the
 * only navigation; there is no side rail.
 */
export function TopBar({ lens, hrefs, onPick, onSearch }: LensNav & { onSearch: () => void }) {
  return (
    <header className="shell-topbar" data-glass="">
      <Link href="/" className="shell-wordmark">
        UNTangle
      </Link>
      <ViewTabs lens={lens} hrefs={hrefs} onPick={onPick} />
      {/* The same field on every lens, so nothing in the bar moves when the lens changes. */}
      <SearchTrigger className="shell-search" onClick={onSearch} />
      <span className="shell-spacer" />
      <SchedulePill />
      <AccountMenu />
    </header>
  );
}

/**
 * Phones (DESIGN.md §3.4), 52px plus the status bar, frosted: the
 * wordmark, the schedule pill and the account. Day hides it so the map
 * runs to the top edge.
 */
export function PhoneHeader() {
  return (
    <header className="shell-pheader" data-glass="">
      <Link href="/" className="shell-wordmark">
        UNTangle
      </Link>
      <PhoneSchedulePill />
      <AccountMenu compact />
    </header>
  );
}
