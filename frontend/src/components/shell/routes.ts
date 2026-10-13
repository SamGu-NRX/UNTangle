/**
 * Which routes get the app shell, and which view each one belongs to.
 * Kept as an explicit list so a new route has to choose, and tested.
 */

export type ViewId = "courses" | "week" | "map";

export const VIEWS: ReadonlyArray<{ id: ViewId; label: string; href: string }> = [
  { id: "courses", label: "Courses", href: "/courses" },
  { id: "week", label: "Week", href: "/schedule" },
  { id: "map", label: "Map", href: "/map" },
];

/**
 * Routes drawn without the shell:
 * - sign-in and password reset have their own focused layout;
 * - the printable schedule is a paper layout;
 * - /dev pages are specimen sheets for the controls.
 */
const BARE_PREFIXES = ["/auth", "/forgot-password", "/schedule/print", "/dev"];

function startsWithSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function shellModeFor(pathname: string): "app" | "bare" {
  return BARE_PREFIXES.some((prefix) => startsWithSegment(pathname, prefix)) ? "bare" : "app";
}

/**
 * The view a route belongs to, for the switcher and tabs. `/` is the guest
 * Courses entry, so it counts as Courses. Plans, instructors and /about
 * belong to no view.
 */
export function viewForPath(pathname: string): ViewId | null {
  if (pathname === "/" || startsWithSegment(pathname, "/courses")) return "courses";
  if (startsWithSegment(pathname, "/schedule")) return "week";
  if (startsWithSegment(pathname, "/map")) return "map";
  return null;
}
