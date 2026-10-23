/**
 * What a guest's work on this browser becomes when they sign in
 * (docs/architecture/guest-sync.md, "Guest work on sign-in"). Pure: the
 * provider reads the guest stores and the account's documents, asks the
 * student what this says to ask, and writes the result.
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
 * A schedule or courses the student doesn't choose from this browser are
 * kept as a saved copy (`dropsGuestWork`). Preferences that signing in
 * replaces go on that copy too, which is made for them alone if needed
 * (`replacedPreferences`).
 */
import { equal, type AcademicQuestion } from "@untangle/sync";
import { defaultSchedulePreferences, getInitialPlannerState } from "@/lib/planner";
import { joinPlanner, splitPlanner, type PlannerBodies, type StoredBodies } from "@/lib/planner-documents";
import { academicQuestions, answerAcademicQuestions, questionKey, scheduleDifference } from "@/lib/sync/planner-sync";
import type { SavedPlanPreferences } from "@/lib/plan-library/snapshot-types";
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
  /** Per record question, by questionKey: "mine" is this browser's value, "latest" (the default) the account's. */
  answers: Readonly<Record<string, "latest" | "mine">>;
  preferences: "guest" | "account";
};

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

/** True when the student would be asked the same questions about both: the account didn't change in a way that matters. */
export function sameQuestions(a: GuestSignIn, b: GuestSignIn): boolean {
  return (
    a.schedule === b.schedule &&
    a.record === b.record &&
    a.preferences === b.preferences &&
    equal(a.questions.map(questionKey), b.questions.map(questionKey))
  );
}

/**
 * The planner after signing in, for this choice. Parts the account keeps
 * come from `current`, the planner as it is now, so applying the choice never
 * writes an older copy of the account over a newer one.
 */
export function applyGuestSignIn(signIn: GuestSignIn, choice: GuestChoice, current: PlannerBodies, activeDay: ClassDay): { state: PlannerState; preferences: SchedulePreferences } {
  const pick = <K extends keyof PlannerBodies>(kind: K, outcome: PartOutcome, guestChosen: boolean): PlannerBodies[K] =>
    outcome === "save" || (outcome === "ask" && guestChosen) ? signIn.guest[kind] : current[kind];
  const record =
    signIn.record === "none"
      ? current["academic-record"]
      : // Merged per course even when nothing is asked, so a course only the account has stays.
        answerAcademicQuestions(
          { kind: "academic-record", base: signIn.empty["academic-record"], mine: signIn.guest["academic-record"], latest: current["academic-record"] },
          signIn.questions.map((question) => choice.answers[questionKey(question)] ?? "latest"),
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

/** True when this browser has a schedule or courses worth a saved copy. */
export function hasCopyableWork(signIn: GuestSignIn): boolean {
  return !equal(signIn.guest.schedule, signIn.empty.schedule) || !equal(signIn.guest["academic-record"], signIn.empty["academic-record"]);
}

/** This browser's preferences as a saved copy keeps them. */
export function guestPreferences(signIn: GuestSignIn): SavedPlanPreferences {
  const { goal, constraints, weights, calendars } = signIn.guest.preferences;
  return { goal, constraints, weights, ...(calendars ? { calendars } : {}) };
}

/** This browser's preferences when the choice replaces them with the account's, for the saved copy; null otherwise. */
export function replacedPreferences(signIn: GuestSignIn, choice: GuestChoice): SavedPlanPreferences | null {
  return signIn.preferences === "ask" && choice.preferences === "account" ? guestPreferences(signIn) : null;
}

const PREFERENCE_GROUPS: Array<[string, (p: PlannerBodies["preferences"]) => unknown]> = [
  ["what Auto favors", (p) => [p.goal, p.weights]],
  ["class hours", (p) => [p.constraints.earliestStart, p.constraints.latestEnd]],
  ["days off", (p) => p.constraints.daysOff],
  ["busy time", (p) => p.constraints.blocked],
  ["credit limit", (p) => p.constraints.maxCredits],
  ["walking time", (p) => p.constraints.walkingBufferMinutes],
  ["sections you never want", (p) => p.constraints.excludedSections],
  ["which sections Auto suggests", (p) => [p.constraints.openSeatsOnly, p.constraints.otherSites]],
];

/** The preference groups this browser and the account set differently, in words. */
export function preferenceDifferences(signIn: GuestSignIn): string[] {
  return PREFERENCE_GROUPS.filter(([, read]) => !equal(read(signIn.guest.preferences), read(signIn.account.preferences))).map(([name]) => name);
}

/** True when the choice leaves out any of this browser's work, which is then kept as a saved copy. */
export function dropsGuestWork(signIn: GuestSignIn, choice: GuestChoice): boolean {
  return (
    (signIn.schedule === "ask" && choice.schedule === "account") ||
    (signIn.preferences === "ask" && choice.preferences === "account") ||
    signIn.questions.some((question) => (choice.answers[questionKey(question)] ?? "latest") === "latest")
  );
}

