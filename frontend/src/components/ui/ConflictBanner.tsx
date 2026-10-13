"use client";

import type { ReactNode } from "react";

/**
 * @deprecated Conflicts are row and event states in v2 (DESIGN.md §4
 * ScheduleEvent `conflict`). Still imported by schedule-client.tsx; delete
 * once the Week view rebuild (HANDOFF step 6) drops it.
 */
export function ConflictBanner({ children }: { children: ReactNode }) {
  return (
    <div className="conflict-banner" role="alert">
      <span aria-hidden style={{ fontSize: 16 }}>!</span>
      <span>{children}</span>
    </div>
  );
}
