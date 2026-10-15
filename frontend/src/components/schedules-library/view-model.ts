import { normalizePlannerState } from "@/lib/planner";
import type { PlanLockChange } from "@/lib/plan-library/diff";
import type { SectionReferenceReport } from "@/lib/plan-library/snapshot";
import { optionIdLabel, sectionRef } from "@/lib/planner-sections";
import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";
import type { SavedPlanStore, SavedPlanStoreFailure, StoreReadResult } from "@/lib/saved-plans/store";
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

/**
 * The compared schedule "Use in Main" applies to: the one that isn't Main,
 * whichever order the two were picked in; B when neither is Main.
 */
export function adoptableSide<T extends { active: boolean }>(a: T, b: T): T | null {
  if (!b.active) return b;
  if (!a.active) return a;
  return null;
}

/**
 * What "Use in Main" does to section locks, one line per course: the grid
 * doesn't draw locks, and locks decide what Auto may move later.
 * `changes` compares the copy (savedPlan) with Main (workingState).
 */
export function lockChangeLines(changes: readonly PlanLockChange[]): string[] {
  return changes.map(({ courseCode, savedPlan, workingState }) => {
    if (!savedPlan) return `${courseCode}: Use in Main unlocks its section.`;
    // A real option reads "class 12345"; a sample one is just its number, so say "section 001".
    const label = sectionRef(savedPlan).provenance === "real" ? optionIdLabel(savedPlan) : `section ${optionIdLabel(savedPlan)}`;
    return workingState
      ? `${courseCode}: Use in Main locks it to ${label} instead.`
      : `${courseCode}: Use in Main locks it to ${label}.`;
  });
}

/**
 * Opens a schedule file into this browser's library for whoever is signed in
 * when it was chosen. The identity is captured before the file is read, so a
 * file that finishes reading after a sign-in or sign-out is refused
 * ("identityChanged") and lands in neither account's library (#77).
 */
export async function importScheduleFile(
  store: Pick<SavedPlanStore, "captureIdentity" | "importPlan">,
  file: Pick<File, "text">,
): Promise<{ ok: true; name: string } | { ok: false; kind: SavedPlanStoreFailure["kind"] | "notJson"; message: string }> {
  const identity = store.captureIdentity();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, kind: "notJson", message: "That file isn't a schedule file. It has to be the .json UNTangle exports." };
  }
  const result = store.importPlan(parsed, undefined, identity);
  return result.ok ? { ok: true, name: result.snapshot.name } : { ok: false, kind: result.failure.kind, message: result.failure.message };
}

/** What downloadFile needs from the browser; tests pass fakes. */
export type DownloadHost = {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createLink(): { href: string; download: string; click(): void; remove(): void };
  /** Runs `run` in a later task. */
  later(run: () => void): void;
};

const browserDownload = (): DownloadHost => ({
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createLink: () => document.body.appendChild(document.createElement("a")),
  later: (run) => window.setTimeout(run, 0),
});

/**
 * Saves `blob` as `name`. The object URL is revoked in a later task, not in
 * the click's: some browsers start the download after the click returns, and
 * revoking first cancels it or saves an empty file.
 */
export function downloadFile(blob: Blob, name: string, host: DownloadHost = browserDownload()) {
  const url = host.createObjectURL(blob);
  const link = host.createLink();
  link.href = url;
  link.download = name;
  link.click();
  link.remove();
  host.later(() => host.revokeObjectURL(url));
}

/** Lines with keys that can't repeat, even when two lines say the same thing. */
export function keyedLines(lines: readonly string[]): Array<{ key: string; text: string }> {
  return lines.map((text, index) => ({ key: `${index}:${text}`, text }));
}

/** What the library page shows from the saved-plan store. */
export type LibraryView =
  | { phase: "loading"; storeAvailable: false; storageDisabled: false; quarantined: [] }
  | {
      phase: "ready" | "unavailable";
      read: StoreReadResult;
      storeAvailable: boolean;
      /** The banner: browser storage itself refused, for a prepared identity. */
      storageDisabled: boolean;
      quarantined: Array<{ key: string; size: number }>;
    };

const LOADING_VIEW: LibraryView = { phase: "loading", storeAvailable: false, storageDisabled: false, quarantined: [] };

/**
 * Reads the library for the identity the planner has prepared (#93). Until
 * one is prepared nothing is read: the page shows loading, the disabled-storage
 * banner waits (the store refuses reads then for a reason that isn't the
 * browser's), and no quarantined keys are listed.
 */
export function readLibraryView(
  store: Pick<SavedPlanStore, "available" | "list" | "listQuarantined">,
  identityReady: boolean,
): LibraryView {
  if (!identityReady) return LOADING_VIEW;
  const read = store.list();
  return {
    phase: read.ok ? "ready" : "unavailable",
    read,
    storeAvailable: store.available,
    storageDisabled: !store.available,
    quarantined: store.listQuarantined(),
  };
}
