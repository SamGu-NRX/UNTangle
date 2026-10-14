/**
 * Which routes get the app shell, and which lens each one belongs to. Kept
 * as an explicit list so a new route has to choose, and tested.
 */

/** The three lenses over one plan: the degree, a term, today (DESIGN.md §3). */
export type Lens = "courses" | "week" | "day";

/** Each lens's root route. */
export const LENS_HREF: Readonly<Record<Lens, string>> = { courses: "/courses", week: "/schedule", day: "/day" };

export const LENSES: ReadonlyArray<{ id: Lens; label: string; href: string }> = [
  { id: "courses", label: "Courses", href: LENS_HREF.courses },
  { id: "week", label: "Week", href: LENS_HREF.week },
  { id: "day", label: "Day", href: LENS_HREF.day },
];

export function isLens(value: unknown): value is Lens {
  return LENSES.some((lens) => lens.id === value);
}

/** The schedules library, opened from the schedule pill. */
export const SCHEDULES_HREF = "/schedules";

/**
 * Routes drawn without the shell:
 * - sign-in and password reset have their own focused layout;
 * - the transcript import has its own bar: the lenses have nothing to show before a transcript;
 * - the printable schedule is a paper layout;
 * - /dev pages are specimen sheets for the controls.
 */
const BARE_PREFIXES = ["/auth", "/forgot-password", "/connect", "/schedule/print", "/dev"];

function startsWithSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function shellModeFor(pathname: string): "app" | "bare" {
  return BARE_PREFIXES.some((prefix) => startsWithSegment(pathname, prefix)) ? "bare" : "app";
}

/**
 * The lens a route belongs to, for the tabs. `/` is the first-visit entry
 * on the way to Courses, so it counts as Courses. The schedules library,
 * instructors and /about belong to no lens.
 */
export function lensForPath(pathname: string): Lens | null {
  if (pathname === "/" || startsWithSegment(pathname, "/courses")) return "courses";
  if (startsWithSegment(pathname, "/schedule")) return "week";
  if (startsWithSegment(pathname, "/day")) return "day";
  return null;
}

/** `path` with the same query a renamed route received, for its redirect. */
export function withQuery(path: string, params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
