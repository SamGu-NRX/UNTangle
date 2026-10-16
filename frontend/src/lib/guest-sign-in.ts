/**
 * What a guest's work on this browser becomes when they sign in
 * (docs/architecture/guest-sync.md, "Guest work on sign-in"). Pure apart
 * from the session cookie at the end: the provider reads the guest stores
 * and the account's documents, asks the student what this says to ask, and
 * writes the result.
 *
 * Each part is compared in the planner's own terms (split through
 * planner-documents.ts), so a field the planner can't show never makes two
 * plans look different:
 * - the plan, against the account's Main: carried over when the account has
 *   none, asked about when both have different work;
 * - the academic record: carried over when the account has none, otherwise
 *   merged per course against an empty record, with one question per course
 *   (or major, catalog year, transcript row) both sides have differently;
 * - preferences: carried over when the account has only the defaults, asked
 *   about when both differ.
 * Whatever the student doesn't choose from this browser is kept as a saved
 * copy (`dropsGuestWork`), so nothing is lost.
 */
import { equal, type AcademicQuestion } from "@untangle/sync";
import { defaultSchedulePreferences, getInitialPlannerState } from "@/lib/planner";
import { joinPlanner, splitPlanner, type PlannerBodies, type StoredBodies } from "@/lib/planner-documents";
import { academicQuestions, answerAcademicQuestions, scheduleDifference } from "@/lib/sync/planner-sync";
import type { ClassDay, PlannerState, SchedulePreferences } from "@/lib/types";

export type GuestWork = { state: PlannerState; preferences: SchedulePreferences };

/** What happens to one part: nothing to carry, carried over without asking, or asked. */
export type PartOutcome = "none" | "save" | "ask";

export type GuestSignIn = {
  guest: PlannerBodies;
  account: PlannerBodies;
  /** The bodies an untouched planner holds: the base the record merge starts from. */
  empty: PlannerBodies;
  schedule: PartOutcome;
  record: PartOutcome;
  preferences: PartOutcome;
  /** For the record: one question per course both sides have differently. */
  questions: AcademicQuestion[];
  /** Courses the guest's plan and the account's Main differ in, for the sheet's one line. */
  scheduleDifference: number;
};

export type GuestChoice = {
  /** "guest" uses this browser's plan as Main; "account" keeps the account's. */
  schedule: "guest" | "account";
  /** Per record question: "mine" is this browser's value, "latest" the account's. */
  answers: ReadonlyArray<"latest" | "mine">;
  preferences: "guest" | "account";
};

/** The choice Escape and the scrim make: the account keeps everything. */
export const KEEP_ACCOUNT = (signIn: GuestSignIn): GuestChoice => ({
  schedule: "account",
  answers: signIn.questions.map(() => "latest"),
  preferences: "account",
});

function emptyBodies(termId: string): PlannerBodies {
  const initial = getInitialPlannerState();
  return splitPlanner(initial, defaultSchedulePreferences(initial.optimization), termId);
}

/** What signing in does with the guest's work; null when there is nothing to carry over. */
export function planGuestSignIn(work: GuestWork, accountBodies: StoredBodies, termId: string): GuestSignIn | null {
  const empty = emptyBodies(termId);
  const guest = splitPlanner(work.state, work.preferences, termId);
  const joined = joinPlanner(accountBodies, "Mon");
  const account = splitPlanner(joined.state, joined.preferences, termId);
  const outcome = (kind: keyof PlannerBodies, accountHasNone: boolean): PartOutcome => {
    if (equal(guest[kind], empty[kind]) || equal(guest[kind], account[kind])) return "none";
    return accountHasNone ? "save" : "ask";
  };
  const schedule = outcome("schedule", equal(account.schedule, empty.schedule));
  const preferences = outcome("preferences", equal(account.preferences, empty.preferences));
  let record = outcome("academic-record", equal(account["academic-record"], empty["academic-record"]));
  let questions: AcademicQuestion[] = [];
  if (record === "ask") {
    questions = academicQuestions({ kind: "academic-record", base: empty["academic-record"], mine: guest["academic-record"], latest: account["academic-record"] });
    // Without a question the per-course merge settles it: courses only one side has keep that side's value.
    if (questions.length === 0) record = "save";
  }
  if (schedule === "none" && record === "none" && preferences === "none") return null;
  return {
    guest,
    account,
    empty,
    schedule,
    record,
    preferences,
    questions,
    scheduleDifference: scheduleDifference(guest.schedule, account.schedule),
  };
}

/** True when the student is asked anything; otherwise the guest's work is carried over with Undo. */
export function asksStudent(signIn: GuestSignIn): boolean {
  return signIn.schedule === "ask" || signIn.questions.length > 0 || signIn.preferences === "ask";
}

/** The planner after signing in, for this choice. */
export function applyGuestSignIn(signIn: GuestSignIn, choice: GuestChoice, activeDay: ClassDay): { state: PlannerState; preferences: SchedulePreferences } {
  const pick = <K extends keyof PlannerBodies>(kind: K, outcome: PartOutcome, guestChosen: boolean): PlannerBodies[K] =>
    outcome === "save" || (outcome === "ask" && guestChosen) ? signIn.guest[kind] : signIn.account[kind];
  const record =
    signIn.record === "none"
      ? signIn.account["academic-record"]
      : // Merged per course even when nothing is asked, so a course only the account has stays.
        answerAcademicQuestions(
          { kind: "academic-record", base: signIn.empty["academic-record"], mine: signIn.guest["academic-record"], latest: signIn.account["academic-record"] },
          choice.answers,
        );
  return joinPlanner(
    {
      "academic-record": record,
      schedule: pick("schedule", signIn.schedule, choice.schedule === "guest"),
      preferences: pick("preferences", signIn.preferences, choice.preferences === "guest"),
    },
    activeDay,
  );
}

/** True when the choice leaves out any of this browser's work, which is then kept as a saved copy. */
export function dropsGuestWork(signIn: GuestSignIn, choice: GuestChoice): boolean {
  return (
    (signIn.schedule === "ask" && choice.schedule === "account") ||
    (signIn.preferences === "ask" && choice.preferences === "account") ||
    choice.answers.some((answer) => answer === "latest")
  );
}

/*
 * Whose guest work is it? The guest stores outlive the browser session, so
 * on a shared computer they can hold an earlier visitor's plan and
 * transcript. Only work a confirmed guest used in this browser session is
 * carried into an account on sign-in; the cookie below, which has no expiry
 * and so ends when the browser closes, says so. Older guest work is left for
 * the guest guards in docs/architecture/README.md ("Guests") to settle, and
 * signing out clears it.
 */
const GUEST_HERE_COOKIE = "untangle_guest_here";

/** A confirmed guest used the planner in this browser session. */
export function markGuestHere(): void {
  document.cookie = `${GUEST_HERE_COOKIE}=1; path=/; SameSite=Lax`;
}

export function guestWasHere(): boolean {
  return document.cookie.split(";").some((part) => part.trim() === `${GUEST_HERE_COOKIE}=1`);
}

export function forgetGuestHere(): void {
  document.cookie = `${GUEST_HERE_COOKIE}=; path=/; SameSite=Lax; Max-Age=0`;
}
