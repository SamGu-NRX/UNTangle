import type { ReactNode } from "react";

/**
 * @deprecated The app shell (components/shell/AppShell, mounted in the root
 * layout) now draws the top bar, view switcher and phone tabs around every
 * route. NavShell remains so v1 views compile unchanged; it only gives
 * their content the page margins. `step`, `back`, `next` and
 * `stickyFooter` are ignored: v2 has no step sequence and no wizard footer
 * (DESIGN.md §2). Still imported by courses-client, schedule-client,
 * map-client, saved-plans/plans-client and the
 * course and instructor detail pages.
 */
export function NavShell({
  children,
}: {
  step?: number;
  back?: { href: string; label: string };
  next?: { href: string; label: string };
  stickyFooter?: boolean;
  children: ReactNode;
}) {
  return <div className="shell-content">{children}</div>;
}
