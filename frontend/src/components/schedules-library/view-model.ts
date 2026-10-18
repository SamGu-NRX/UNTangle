import { figuresOf } from "@/components/schedule-builder/answer";
import { eventsOf, unknownWalksOf, walksOf, type WalkFn } from "@/components/schedule-builder/week";
import { normalizePlannerState } from "@/lib/planner";
import type { PlanDiff, PlanLockChange } from "@/lib/plan-library/diff";
import type { SectionReferenceReport } from "@/lib/plan-library/snapshot";
import { optionIdLabel, sectionRef } from "@/lib/planner-sections";
import { weekTravel } from "@/lib/planner-walking";
import type { Section } from "@/lib/sections";
import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";
import { freeName } from "@/lib/saved-plans/names";
import type { SavedPlanStore, SavedPlanStoreFailure, StoreReadResult } from "@/lib/saved-plans/store";
import { workingStateFingerprint } from "@/lib/saved-plans/restore-adapter";
import type { PlannerState } from "@/lib/types";

/**
 * What a copy saved with its name left blank is called: "Copy of Main",
 * then "Copy of Main 2", "Copy of Main 3", skipping any already taken
 * (archived copies included, in any letter case).
 */
export function defaultCopyName(taken: readonly string[], of: string): string {
  return freeName(`Copy of ${of}`, taken);
}

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

/** Whether two schedules hold the same plan, ignoring timestamps: using one in place of the other changes nothing. */
export function samePlan(a: PlannerState, b: PlannerState): boolean {
  return workingStateFingerprint(normalizePlannerState(a)) === workingStateFingerprint(normalizePlannerState(b));
}

/**
 * Whether the working schedule already has a saved copy, ignoring
 * timestamps. When it doesn't, replacing it with another schedule loses it
 * once Undo is gone, so the library offers to save a copy first.
 */
export function hasSavedCopy(working: PlannerState, plans: readonly SavedPlanSnapshot[]): boolean {
  return plans.some((plan) => samePlan(working, plan.state));
}

/**
 * A week's walking as Week's Details counts it, so Compare and Week give one
 * number: walks between classes in different buildings with 30 minutes or
 * less between them (walksOf), timed by weekTravel. A walk with no known
 * time (a building not on the campus map) isn't in the totals; it is
 * counted in `unknownWalks`, so the totals can be shown as at least that
 * much, never as complete. A shuttle ride is not walking but can still be
 * tight. Tight or late: less than two minutes to spare, or longer than the
 * break.
 */
export function weekWalking(sections: readonly Section[], travel: WalkFn = weekTravel): { walkMinutes: number; tightWalks: number; unknownWalks: number } {
  const events = eventsOf(sections);
  const figures = figuresOf(events, walksOf(events, travel));
  return { walkMinutes: figures.walkMinutes, tightWalks: figures.badWalks, unknownWalks: unknownWalksOf(events, travel) };
}

/**
 * What "Use in Main" does with saved sections the week can't draw, one line
 * per course: stale samples are replaced, inactive sections aren't used, and
 * unknown courses leave the schedule. A real id stays saved when the class
 * schedule no longer has it, or when the schedule can't be read yet (still
 * loading, or only the samples are there), so those need a line too.
 */
export function skippedSectionLines(report: SectionReferenceReport): string[] {
  return [
    ...report.stale.map((finding) => `${finding.courseCode}: its saved section is no longer offered, so Week picks another.`),
    ...report.inactive.map((finding) => `${finding.courseCode}: not planned this term, so its saved section isn't used.`),
    ...report.unknownCourses.map((finding) => `${finding.courseCode}: not in this catalog, so it leaves the schedule.`),
    ...report.needsReview.map((finding) => `${finding.courseCode}: its saved section isn't in the class schedule now. Use in Main keeps it, marked Needs review in Week.`),
    ...report.unchecked.map((finding) => `${finding.courseCode}: its saved section can't be checked against the class schedule yet. Use in Main keeps it.`),
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
 * What "Use in Main" replaces beyond sections and locks, since the week can't
 * show course evidence or the major. `diff` compares the copy (savedPlan)
 * with Main (workingState); adoption applies the copy's side. Only a change
 * to or from done is said: planned against not taken is which courses the
 * week schedules, and the week already draws that.
 */
export function adoptionChangeLines(diff: PlanDiff): string[] {
  const lines = diff.statusChanges.flatMap(({ courseCode, from, to }) => {
    if (from === "completed") return [`${courseCode}: Use in Main marks it done.`];
    if (to === "completed") return [`${courseCode}: Use in Main no longer counts it as done.`];
    return [];
  });
  for (const { courseCode, fact, savedPlan } of diff.courseFactChanges) {
    lines.push(
      fact === "manualCredit"
        ? savedPlan
          ? `${courseCode}: Use in Main counts it as credit you have.`
          : `${courseCode}: Use in Main drops the credit you marked for it.`
        : savedPlan
          ? `${courseCode}: Use in Main marks it as planned by Auto.`
          : `${courseCode}: Use in Main drops its Auto-fill mark.`,
    );
  }
  if (diff.majorChanged) lines.push("Use in Main changes the major to this copy's.");
  if (diff.transcriptRecords.changed) {
    const records = (count: number) => `${count} ${count === 1 ? "record" : "records"}`;
    lines.push(`Use in Main replaces Main's transcript records (${records(diff.transcriptRecords.workingState)}) with this copy's (${records(diff.transcriptRecords.savedPlan)}).`);
  }
  return lines;
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
