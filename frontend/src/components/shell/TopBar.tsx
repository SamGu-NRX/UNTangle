"use client";

import Link from "next/link";
import { SearchTrigger } from "@/components/ui/SearchField";
import { AccountMenu } from "./AccountMenu";
import { PlanChip } from "./PlanChip";
import type { ViewId } from "./routes";
import { ViewSwitcher } from "./ViewSwitcher";

/**
 * Desktop: 56px — wordmark, Courses/Week/Map, the search trigger (a full
 * field on Courses, an icon on Week and Map), then the plan and account.
 * Phone: 48px — wordmark, plan, account; the views move to BottomTabs.
 */
export function TopBar({ view, onSearch }: { view: ViewId | null; onSearch: () => void }) {
  return (
    <header className="shell-topbar">
      <div className="shell-topbar__row">
        <Link href="/" className="shell-wordmark">
          UNTangle
        </Link>
        <ViewSwitcher view={view} />
        <SearchTrigger className="shell-search" compact={view === "week" || view === "map"} onClick={onSearch} />
        <span className="shell-spacer" />
        <PlanChip />
        <AccountMenu />
      </div>
    </header>
  );
}
