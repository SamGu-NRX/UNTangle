import type { ReactNode } from "react";

/**
 * Column for public pages (/about). The app shell's top bar sits above it,
 * so it carries no navigation of its own.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  return <article className="about">{children}</article>;
}
