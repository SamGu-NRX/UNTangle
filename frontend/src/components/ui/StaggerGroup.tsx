"use client";

import type { ReactNode } from "react";

/**
 * @deprecated Lists no longer stagger on first render: they often run past
 * 100 rows and are seen many times a session (DESIGN.md §6). This now
 * renders its children unchanged. Still imported by courses-client,
 * major-selection-modal, map-client and schedule-client; delete it once
 * their owners drop the import.
 */
export function StaggerGroup({ children }: { children: ReactNode; step?: number }) {
  return <>{children}</>;
}
