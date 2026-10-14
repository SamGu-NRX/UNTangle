import { normalizePlannerState } from "@/lib/planner";
import type { SectionReferenceReport } from "@/lib/plan-library/snapshot";
import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";
import { workingStateFingerprint } from "@/lib/saved-plans/restore-adapter";
import type { PlannerState } from "@/lib/types";

/** Download name for an exported schedule file. */
export function exportFileName(plan: SavedPlanSnapshot): string {
  const slug = plan.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const day = plan.createdAt.slice(0, 10);
  return `untangle-${slug || "plan"}-${day}.json`;
}

const MINUTE = 60_000;

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * A schedule row's one fact, when it last changed, the way a person says it:
 * "Edited 2 min ago", "Saved yesterday", "Saved Oct 12". `verb` is "Edited"
 * for the working schedule and "Saved" for a copy. Local time.
 */
export function whenText(verb: "Edited" | "Saved", iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return verb;
  const minutes = Math.floor((now.getTime() - at.getTime()) / MINUTE);
  if (minutes < 1) return `${verb} just now`;
  if (minutes < 60) return `${verb} ${minutes} min ago`;
  if (sameDay(at, now)) return `${verb} today`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(at, yesterday)) return `${verb} yesterday`;
  const month = at.toLocaleString("en-US", { month: "short" });
  return at.getFullYear() === now.getFullYear()
    ? `${verb} ${month} ${at.getDate()}`
    : `${verb} ${month} ${at.getDate()}, ${at.getFullYear()}`;
}

/** "Today at 10:41", "Oct 12 at 3:05 PM": when a version was made. */
export function versionTime(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  // Built by hand: Intl puts a narrow no-break space before AM in some engines and not others.
  const hour = at.getHours();
  const time = `${hour % 12 === 0 ? 12 : hour % 12}:${String(at.getMinutes()).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  if (sameDay(at, now)) return `Today at ${time}`;
  return `${at.toLocaleString("en-US", { month: "short" })} ${at.getDate()} at ${time}`;
}

/**
 * Whether the working schedule already has a saved copy, ignoring
 * timestamps. When it doesn't, replacing it with another schedule loses it
 * once Undo is gone, so the library offers to save a copy first.
 */
export function hasSavedCopy(working: PlannerState, plans: readonly SavedPlanSnapshot[]): boolean {
  const mine = workingStateFingerprint(normalizePlannerState(working));
  return plans.some((plan) => workingStateFingerprint(normalizePlannerState(plan.state)) === mine);
}

/**
 * What "Use in Main" does with each saved section it can't keep, one line per
 * course, said by what happens (lib/plan-library/snapshot.ts classifies them):
 * a section no longer offered is replaced, one for a course not planned this
 * term is not used, and a course the catalog doesn't know leaves the schedule.
 */
export function skippedSectionLines(report: SectionReferenceReport): string[] {
  return [
    ...report.stale.map((finding) => `${finding.courseCode}: its saved section is no longer offered, so Week picks another.`),
    ...report.inactive.map((finding) => `${finding.courseCode}: not planned this term, so its saved section isn't used.`),
    ...report.unknownCourses.map((finding) => `${finding.courseCode}: not in this catalog, so it leaves the schedule.`),
  ];
}
