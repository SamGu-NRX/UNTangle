/**
 * The words above "What's left": the credits headline and the lines that
 * qualify it. Pure, so the DOM tests and the view read the same sentences.
 */
import type { AuditedDegree, Requirement } from "./degree";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "A", "A and B", "A, B and C". */
export function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * How many credits are left, the first answer on the page.
 * - Known: "111 credits left", or "About 9 credits left" when an
 *   in-progress course counts at its catalog credits.
 * - Some credits unknown: "Up to 6 credits left", because the unknown
 *   courses can only lower it. The audit's own figure is null then.
 * - None: "Nothing left to take", "Nothing left after this term" while the
 *   last requirements are in progress, or "All 120 credits counted" when the
 *   total is met but a requirement still needs a course.
 */
export function leftHeadline(degree: AuditedDegree): string {
  const { hours } = degree;
  const about = hours.fromCatalog.length > 0;
  const credits = hours.left ?? hours.atMost;
  if (credits > 0) {
    const amount = plural(credits, "credit");
    if (hours.left === null) return `Up to ${about ? "about " : ""}${amount} left`;
    return `${about ? "About" : ""} ${amount} left`.trim();
  }
  const rows = degree.areas.flatMap((area) => area.requirements);
  if (rows.some((row) => row.status === "needed")) return `All ${hours.required} credits counted`;
  if (rows.some((row) => row.status === "inProgress")) return "Nothing left after this term";
  return "Nothing left to take";
}

/** The lines under the headline: where the figure comes from, and anything it leans on. */
export function leftNotes(degree: AuditedDegree): string[] {
  const { hours } = degree;
  const notes = [`The ${degree.catalogYear} catalog asks ${hours.required} credits for ${degree.programName}.`];
  if (hours.fromCatalog.length > 0) {
    notes.push(`${listAnd(hours.fromCatalog)} ${hours.fromCatalog.length === 1 ? "counts" : "count"} at catalog credits until ${hours.fromCatalog.length === 1 ? "its grade posts" : "grades post"}.`);
  }
  if (hours.unknown.length > 0) {
    notes.push(`UNTangle doesn't know the credits for ${listAnd(hours.unknown)}, so fewer may be left.`);
  }
  if (hours.claimed > 0) notes.push(`Counts ${plural(hours.claimed, "credit")} you marked done.`);
  const needed = degree.areas.some((area) => area.requirements.some((row) => row.status === "needed"));
  if (!needed && degree.advisor.length > 0) notes.push("Before you apply to graduate, go over the list below with an advisor.");
  if (degree.ignoredClaims.length > 0) {
    notes.push(`Your transcript decides ${listAnd(degree.ignoredClaims)}, so ${degree.ignoredClaims.length === 1 ? "your mark doesn't" : "your marks don't"} count.`);
  }
  return notes;
}

/**
 * An area's header when it is closed: "20 courses, 12 credits left", or,
 * with no course or credit left, the unmet rules or what this term finishes.
 */
export function areaSummary(requirements: readonly Requirement[]): string {
  const needed = requirements.filter((row) => row.status === "needed");
  const courses = needed.reduce((sum, row) => sum + row.left.courses, 0);
  const credits = needed.reduce((sum, row) => sum + row.left.credits, 0);
  const amounts = [courses > 0 ? plural(courses, "course") : null, credits > 0 ? plural(credits, "credit") : null].filter((part) => part !== null);
  if (amounts.length > 0) return `${amounts.join(", ")} left`;
  if (needed.length > 0) return `${plural(needed.length, "rule")} not met yet`;
  return requirements.some((row) => row.status === "inProgress") ? "Taking now" : "You marked this done";
}

/** The advisor list's disclosure: "12 things to check with an advisor". */
export const advisorLabel = (count: number) => `${plural(count, "thing")} to check with an advisor`;
