"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { authClient } from "@/lib/auth-client";
import {
  buildScheduleEvents,
  defaultSchedulePreferences,
  getPlanningTermCourseCodes,
  getInitialPlannerState,
  isCourseLocked,
  mergeTranscriptRecords,
  normalizePlannerState,
  resolveSectionPlan,
  routeStopsOf,
  takeFromAutoRun,
  type SectionPlan,
} from "@/lib/planner";
import { planningTerm, type CandidateFilter, type SectionCatalog } from "@/lib/planner-sections";
import { fetchCourseHistory, fetchMissingHistories } from "@/lib/grades-history/course-history";
import type { CourseHistory, HistoryResult } from "@/lib/grades-history/types";
import { courseEvidenceHundredths, evidenceFetchable } from "@/lib/sections/instructor-evidence";
import { createSectionStore, type SectionStore } from "@/lib/section-store";
import {
  GUEST_ID_KEY,
  initialPreferences,
  preferencesKey,
  readOrCreateGuestId,
  readStoredPreferences,
  withGoalWeights,
  writeStoredPreferences,
  type WriteOutcome,
} from "@/components/schedule/preferences-store";
import { forgetGuestCalendars } from "@/lib/calendar-feeds/client";
import { clearPlannerIdentity, createPlannerStateStore, PLANNER_STATE_STORE_KEY } from "@/lib/planner-store";
import { clearSavedPlansIdentity, getSavedPlanIdentity, savedPlansIn, savedPlansKey, setSavedPlanIdentity, subscribeSavedPlans } from "@/lib/saved-plans/store";
import {
  plannerBox,
  reducePlannerBox,
  TransactionRequest,
  type NumberedAction,
  type PlannerAction,
  type PlanStamp,
  type PlanTransaction,
  type TransactionOutcome,
} from "@/lib/planner-transaction";
import type { PlannerStoreIncoming } from "@/lib/planner-store";
import type { AcademicRecordBody } from "../../../packages/contracts/src/documents";
import { createSavedPlanStore } from "@/lib/saved-plans/store";
import { previewCourseCodes } from "@/lib/plan-library/week";
import { forgetGuestWork, guestWorkHandover, guestWorkIsThisSession, stampGuestWork, STAMP_PREFIX } from "@/lib/guest-session";
import { joinPlanner, splitPlanner } from "@/lib/planner-documents";
import {
  applyGuestSignIn,
  asksStudent,
  dropsGuestWork,
  hasCopyableWork,
  planGuestSignIn,
  sameQuestions,
  type GuestChoice,
  type GuestSignIn,
} from "@/lib/guest-sign-in";
import { openIndexedDbStore } from "@/lib/sync/idb-store";
import {
  ClientOutdatedError,
  httpSyncIO,
  PlannerSync,
  type ConflictChoice,
  type OpenConflict,
  type PlannerRead,
  type PlannerView,
} from "@/lib/sync/planner-sync";
import { equal, SyncEngine, type Body, type LocalStore, type SyncStatus } from "@untangle/sync";
import { toast } from "@/components/ui/Toast";
import { workingStateFingerprint } from "@/lib/saved-plans/restore-adapter";
import { notifySessionExpired, onSessionRestored } from "@/lib/session-events";
import { courses } from "@/lib/seed-data";
import type {
  CoursePlan,
  CourseStatus,
  MajorId,
  OptimizationKey,
  PlannerState,
  SchedulePreferences,
  TranscriptCourseRecord,
  ClassDay,
} from "@/lib/types";

/** One cache of loaded sections for the page, shared by every view. */
const browserSectionStore = createSectionStore(planningTerm.id);

/** Whether the schedule builder's preferences reached this browser's storage on the last write. */
export type PreferencesStorage = WriteOutcome["kind"];

function makeGuestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Save lifecycle, honest by construction:
 *
 * - `saving` — a save is in flight, or an edit is waiting for its save;
 * - `saved` — the write path CONFIRMED durability of exactly the state on
 *   screen (server acknowledged the row, or the guest localStorage write
 *   landed). The context re-checks the fingerprint on every render, so an
 *   edit made after the acknowledgement can never be shown as `Saved`;
 * - `pending` — storage works but nothing has been stored yet (`Not saved yet`);
 * - `not-saved` — storage is unavailable (browser storage denied, no server
 *   storage, server unreachable at load, or an unresolved conflict): edits
 *   stay in memory behind a persistent warning, with an export option;
 * - `failed` — a server 500 or dropped connection; retryable;
 * - `signed-out` — a 401 at load or save. Edits stay in memory and in this
 *   browser's mirror; the save is retried when the session is restored.
 */
export type PlannerSaveStatus = "saving" | "saved" | "pending" | "not-saved" | "failed" | "signed-out";

export type PlannerSaveState = {
  status: PlannerSaveStatus;
  label: string;
  detail: string | null;
  reason: "server" | "network" | "session" | "storage" | "conflict" | null;
};

/** A guest's conflict between this tab's edits and a newer version another tab stored. */
export type PlannerConflict = {
  /** This tab's unsaved edits. */
  mine: PlannerState;
  /** The newer version another tab stored. */
  theirs: PlannerState | null;
  theirsRevision: number;
  theirsSavedAt: string | null;
  source: "browser";
};

/** A synced document a signed-in student has to settle; `mine` is their side as it is now. */
export type SyncConflict = OpenConflict & { mine: Body };
export type SyncConflictChoice =
  | { kind: "use-latest" }
  /** A schedule changed elsewhere goes to Schedules as a copy; one deleted elsewhere is saved again as Main. */
  | { kind: "keep-mine" }
  /** The academic record with the student's answer to each question. */
  | { kind: "answers"; body: AcademicRecordBody };

export const SAVE_LABELS: Record<PlannerSaveStatus, string> = {
  saving: "Saving…",
  saved: "Saved",
  pending: "Not saved yet",
  "not-saved": "Not saved…",
  failed: "Saving failed…",
  "signed-out": "Not saved: signed out",
};

function saveStateOf(
  status: PlannerSaveStatus,
  detail: string | null = null,
  reason: PlannerSaveState["reason"] = null,
): PlannerSaveState {
  return { status, label: SAVE_LABELS[status], detail, reason };
}

const SAVING = saveStateOf("saving");
const PENDING = saveStateOf("pending");
const CONFLICT_DETAIL =
  "Another tab or device saved a newer version. Choose which version to keep to continue saving.";

type PlannerContextValue = {
  /**
   * False until this browser's storage is prepared for the signed-in account
   * (or the guest): on the server, during hydration, and while the first
   * session lookup is in flight. Until then the planner refuses edits, and a
   * view must not read or write any identity's stored data.
   */
  identityReady: boolean;
  hydrated: boolean;
  isRegistered: boolean;
  isAuthPending: boolean;
  /**
   * The normalized plan, with `selectedSections` showing what the page shows:
   * every saved pick plus the goal's recommendation for each unpicked course.
   */
  plannerState: PlannerState;
  /** The student's stored section picks, without recommendations for unpicked courses. */
  sectionPicks: PlannerState["selectedSections"];
  /** Each planned course's option against the sections loaded so far. */
  sectionPlan: SectionPlan;
  /** Loaded options by course; `loading` until a view asks with `loadSections`. */
  sectionCatalog: SectionCatalog;
  /** Changes when any course's options finish loading. */
  catalogVersion: number;
  /**
   * The accepted instructor evidence this provider's `sectionPlan` tie-breaks
   * on, per planning course and section id (`instructor-evidence.ts`): known
   * means in whole hundredths, null unknown. Empty until a course's history
   * resolves; surfaces that plan sections read it from here so displayed
   * recommendations and optimizer requests tie-break on the same evidence.
   */
  evidenceHundredths: Readonly<Record<string, Record<string, number | null>>>;
  /**
   * The options `sectionPlan` may recommend: the student's open-seats and
   * other-sites settings. Use in Main keeps them, so a surface that previews
   * another plan resolves it with this filter to show what Main would pick.
   */
  candidateFilter: CandidateFilter;
  /** Starts loading these courses' options (cached, shared with every view). */
  loadSections: (courseCodes: readonly string[]) => void;
  routeStops: ReturnType<typeof routeStopsOf>;
  scheduleEvents: ReturnType<typeof buildScheduleEvents>;
  lockedCourses: Set<string>;
  isLocked: (courseCode: string) => boolean;
  setCourseStatus: (courseCode: string, status: CourseStatus) => void;
  /**
   * One atomic Courses-view edit: statuses and `coursePlan` change together,
   * so Auto-fill, its Undo and manual credit never save half-applied.
   */
  updateCoursePlan: (
    update: (current: { courseStatuses: Record<string, CourseStatus>; coursePlan: CoursePlan }) => {
      courseStatuses?: Record<string, CourseStatus>;
      coursePlan?: CoursePlan;
    },
  ) => void;
  /** Replaces the plan's Courses-view facts wholesale (restoring a saved plan). */
  setCoursePlan: (coursePlan: CoursePlan) => void;
  applyTranscriptRecords: (records: TranscriptCourseRecord[]) => void;
  setOptimization: (optimization: OptimizationKey) => void;
  setSection: (courseCode: string, sectionId: string) => void;
  /** Pin (or release) the section currently selected for a course. */
  setSectionLock: (courseCode: string, locked: boolean) => void;
  /** Re-run the optimizer for the current goal; locked sections stay fixed. */
  optimizeSchedule: () => void;
  /**
   * Constraints and weights for the schedule builder, kept in this browser
   * per identity (components/schedule/preferences-store.ts).
   */
  schedulePreferences: SchedulePreferences;
  setSchedulePreferences: (update: (current: SchedulePreferences) => SchedulePreferences) => void;
  /** False until the plan has loaded and the preferences for this identity have been read. */
  preferencesReady: boolean;
  preferencesStorage: PreferencesStorage;
  /**
   * Use a schedule: its sections replace the current picks for those
   * courses. Refused as a whole when it would move a locked section.
   */
  applySchedule: (byCourse: Record<string, string>, goal?: OptimizationKey | null) => void;
  /** Put back exactly these picks and this goal (Undo after a pick). */
  restoreSchedule: (snapshot: { sections: Record<string, string>; goal: OptimizationKey }) => void;
  /**
   * Counts plan replacements: a load, a reset (restore starts with one),
   * a conflict resolution, another tab's version. An Undo taken before the
   * count changed no longer applies.
   */
  planEpoch: number;
  setActiveDay: (day: ClassDay) => void;
  setSelectedMajor: (id: MajorId | null) => void;
  resetPlanner: () => void;
  /** Save lifecycle for the durable working schedule (guest store or server). */
  saveState: PlannerSaveState;
  retrySave: () => void;
  /** True when the guest's browser storage is unusable (edits stay in memory). */
  guestStorageAvailable: boolean;
  /** Guests: unresolved conflict between this tab's edits and a newer version another tab stored. */
  conflict: PlannerConflict | null;
  resolveConflict: (resolution: "keep-mine" | "take-theirs") => void;
  /** Signed in: a synced document to settle (docs/architecture/README.md, "Conflicts depend on the document kind"). */
  syncConflict: SyncConflict | null;
  /** False when the choice couldn't be applied; the conflict is then still open. */
  settleSyncConflict: (choice: SyncConflictChoice) => Promise<boolean>;
  /**
   * Signed in: this browser's guest work met different work in the account
   * (docs/architecture/guest-sync.md), and the student chooses what to keep.
   */
  guestSignIn: GuestSignIn | null;
  /** A restored browser session may contain another visitor's guest work. */
  guestHandover: { writtenAt: number | null } | null;
  settleGuestHandover: (choice: "bring" | "leave") => void;
  /** Answers `guestSignIn`. Escape and the scrim pass the account-keeping choice. */
  settleGuestSignIn: (choice: GuestChoice) => void;
  /** Signed in: the server holds documents this copy of the app can't read, so it stopped saving until a reload. */
  clientOutdated: boolean;
  /**
   * Before signing out: sends waiting writes once more and says whether any
   * are still waiting. After signing out, `forget` deletes this account's
   * documents from this browser; waiting writes go too only with `discardPending`.
   */
  prepareSignOut: () => Promise<{ unsynced: boolean; forget: (discardPending: boolean) => Promise<void> }>;
  /** This tab adopted a newer version another tab saved (no unsaved edits). */
  tookNewerVersion: boolean;
  dismissNewerVersionNotice: () => void;
  /** Resolves once the planner has loaded (or decided not to load) stored state. */
  afterHydration: () => Promise<void>;
  /** Structural notices from reading the guest store (e.g. quarantine). */
  storeNotices: Array<{ message: string; quarantinedTo?: string }>;
  /**
   * One check-and-write on the plan as it actually is, for callers that act
   * after an await and must not trust the last render (the WebMCP tools).
   * `fn` runs inside the plan's reducer on the normalized current state,
   * including updates still queued, with the pending Auto-fill run's edit
   * count, and returns `next` to commit or no `next` to change nothing. It
   * must be pure: React may run it twice or again on a newer base.
   *
   * Refused without calling `fn` when `stamp` no longer matches: another
   * identity is signed in ("identity_changed"), or the plan was replaced
   * since ("plan_replaced"). The outcome is recorded in the state the
   * reducer returns, and the promise resolves only after a commit that
   * holds it, so a render React discards acknowledges nothing. Unmounting
   * settles every open transaction as "cancelled". Other actions are unchanged
   * (lib/planner-transaction.ts).
   */
  transact: <R>(fn: (current: PlannerState, meta: { runEdits: number }) => PlanTransaction<R>, stamp: PlanStamp) => Promise<TransactionOutcome<R>>;
  /** The identity and plan replacement count of this render, for `transact`. */
  planStamp: PlanStamp;
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

type PlannerProviderProps = {
  children?: React.ReactNode;
  /** Where course options come from; tests pass the sample store. */
  sectionStore?: SectionStore;
  /** This browser's store for a signed-in student's documents and outbox; IndexedDB unless a test passes one. */
  documentStore?: () => Promise<LocalStore>;
};

let browserDocumentStore: Promise<LocalStore> | null = null;
/** One IndexedDB connection per page, shared by every planner instance. */
function openBrowserDocumentStore(): Promise<LocalStore> {
  browserDocumentStore ??= openIndexedDbStore({ indexedDB: window.indexedDB, locks: navigator.locks }).catch((error: unknown) => {
    browserDocumentStore = null;
    throw error;
  });
  return browserDocumentStore;
}

/**
 * A confirmed sign-out, from the account menu or a session the server ended,
 * deletes the account's documents from this browser. A write still waiting
 * to sync is never deleted this way: only the student can choose to discard
 * it (the account menu asks), so until then it waits for that account to
 * sign in again.
 */
function forgetAccountDocuments(open: () => Promise<LocalStore>, userId: string): void {
  void open()
    .then((store) => new SyncEngine(store, { kind: "user", id: userId }, httpSyncIO(userId)).clearLocalData({ discardPending: false }))
    .catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith("Unsynced changes")) return;
      console.error("Couldn't delete the signed-out account's documents from this browser", error);
    });
}

const shortDate = (now: Date) => now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
/** The name a schedule kept from a conflict gets in Schedules. */
function keptCopyName(now: Date): string {
  return `Kept from this device, ${shortDate(now)}`;
}

/** Runs `work` in one tab at a time: two tabs signing in together must not carry guest work over twice. */
function oneTabAtATime<T>(name: string, work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  // request resolves to what the callback resolves to; its type says Promise<Promise<T>>.
  return locks?.request ? (locks.request(name, work) as Promise<T>) : work();
}

/**
 * How each sync state reads on the save surfaces; the labels are the
 * architecture's states. A failed pull matters only while nothing worse is
 * showing: the session ended, or the server can't be reached.
 */
function syncSaveState(status: SyncStatus | null, pull: "offline" | "signed-out" | null): PlannerSaveState {
  const state = (planner: PlannerSaveStatus, label: string, detail: string | null = null, reason: PlannerSaveState["reason"] = null) => ({ status: planner, label, detail, reason });
  const offline = pull === "offline";
  if (pull === "signed-out" && (status === null || status === "Synced" || status === "Saved on this device" || status === "Waiting to sync")) {
    return state("signed-out", "Needs sign-in", "Sign in again to sync. Your changes are saved on this device.", "session");
  }
  switch (status) {
    case "Synced":
      return state("saved", status);
    case "Saved on this device":
      return state("saved", status, offline ? "UNTangle can't be reached right now. Changes sync when it can." : null);
    case "Waiting to sync":
      return state("saving", status);
    case "Save not confirmed (retrying)":
      return state("failed", status, "Your changes are saved on this device. UNTangle keeps trying to sync them.", "network");
    case "Needs sign-in":
      return state("signed-out", status, "Sign in again to sync. Your changes are saved on this device.", "session");
    case "Resolve conflict":
      return state("not-saved", status, "Something you changed was changed somewhere else too. Choose what to keep.", "conflict");
    case null:
      return offline ? state("not-saved", SAVE_LABELS["not-saved"], "UNTangle can't be reached, so your schedule hasn't loaded. Changes stay on this device.", "network") : PENDING;
  }
}

type PlannerSession = ReturnType<typeof authClient.useSession>["data"];
type AccountUser = NonNullable<PlannerSession>["user"];

/**
 * The account the planner has confirmed, which is the one whose data it may
 * show. `checking` lasts until the first session lookup answers. A pending or
 * failed lookup after that keeps the last confirmed account.
 */
export type ConfirmedAccount =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AccountUser };

const ConfirmedAccountContext = createContext<ConfirmedAccount | null>(null);

export function useConfirmedAccount(): ConfirmedAccount {
  const value = useContext(ConfirmedAccountContext);
  if (!value) {
    throw new Error("useConfirmedAccount must be used within PlannerProvider");
  }
  return value;
}

/**
 * Chooses which identity's browser storage the planner may use, then mounts
 * one planner instance for it.
 *
 * The instance renders its children from the first render, including the
 * server render and hydration, because route segments must render there for
 * Next's notFound() and redirect() to set the response. Until an identity is
 * prepared the instance is inert: it reads and writes no storage, refuses
 * edits, and reports `identityReady: false`. Nothing is readable then anyway,
 * because the saved-plan store refuses every read without a prepared identity.
 *
 * The first identity the instance prepares keeps it, so a page load does not
 * remount the app when the session lookup answers. A later change of identity
 * (sign-out, another account) renders nothing until the new identity is
 * prepared, then mounts a fresh instance and fresh children. Those children
 * hold state of their own (a parsed transcript in Connect, Undo snapshots,
 * the shell's per-page state), so keeping them across an account change would
 * carry one student's data into the next student's session.
 */
export function PlannerProvider(props: PlannerProviderProps) {
  const sessionResult = authClient.useSession();
  const sessionValue = sessionResult.error?.status === 401 ? null : (sessionResult.data ?? null);
  const sessionKnown = !sessionResult.isPending && (!sessionResult.error || sessionResult.error.status === 401);
  // Undefined until a lookup has answered once.
  const [confirmedSession, setConfirmedSession] = useState<PlannerSession | undefined>(sessionKnown ? sessionValue : undefined);
  if (sessionKnown && confirmedSession !== sessionValue) {
    setConfirmedSession(sessionValue);
  }
  // A failed or pending lookup is not a sign-out; a server 401 confirms the session ended.
  const sessionData = sessionKnown ? sessionValue : (confirmedSession ?? null);
  // Without a confirmed account, guest storage keeps the app usable without granting access to user data.
  const sessionUnknown = !sessionKnown && !confirmedSession;
  // While the first lookup is in flight no identity is chosen, so no storage is prepared or read.
  // Preparing the guest here quarantined a legacy planner before a signed-in load could claim it.
  const awaitingFirstLookup = sessionResult.isPending && confirmedSession === undefined;
  const userId = sessionData?.user?.id ?? null;
  const identity = userId === null ? "guest" : `user:${userId}`;
  const preparedUser = useSyncExternalStore(subscribeSavedPlans, getSavedPlanIdentity, () => undefined);
  useLayoutEffect(() => {
    if (awaitingFirstLookup || (!sessionKnown && !sessionUnknown) || preparedUser === userId) return;
    // The old subtree retires before storage is prepared for any new consumer render.
    if (sessionKnown && preparedUser !== undefined && preparedUser !== null) {
      clearPlannerIdentity(preparedUser);
      clearSavedPlansIdentity(preparedUser);
      clearPlannerIdentity(null);
      clearSavedPlansIdentity(null);
      // Guest calendars on this browser go with the guest's work (their cookie is HttpOnly, so the server clears it).
      void forgetGuestCalendars();
      forgetAccountDocuments(props.documentStore ?? openBrowserDocumentStore, preparedUser);
    }
    setSavedPlanIdentity(userId);
  }, [awaitingFirstLookup, preparedUser, props.documentStore, sessionKnown, sessionUnknown, userId]);

  const prepared = !awaitingFirstLookup && preparedUser === userId;
  // The identity the mounted instance has served while prepared, and the key
  // that gives the next identity a fresh instance.
  const [served, setServed] = useState<{ identity: string; key: number } | null>(null);
  if (prepared && served?.identity !== identity) {
    setServed({ identity, key: served === null ? 0 : served.key + 1 });
  }
  // Before any identity is prepared nothing is readable, so the first instance may render.
  // Once another identity's storage is prepared, nothing renders until this one's is.
  const renderable = prepared || (preparedUser === undefined && served === null);

  const account = useMemo<ConfirmedAccount>(
    () =>
      awaitingFirstLookup
        ? { status: "checking" }
        : sessionData?.user
          ? { status: "signed-in", user: sessionData.user }
          : { status: "signed-out" },
    [awaitingFirstLookup, sessionData],
  );

  return (
    <ConfirmedAccountContext.Provider value={account}>
      {renderable ? (
        <IdentityPlannerProvider
          {...props}
          key={served?.key ?? 0}
          prepared={prepared}
          sessionData={sessionData}
          sessionKnown={sessionKnown}
          sessionUnknown={sessionUnknown}
          sessionPending={sessionResult.isPending}
        />
      ) : null}
    </ConfirmedAccountContext.Provider>
  );
}

function IdentityPlannerProvider({
  children,
  sectionStore = browserSectionStore,
  documentStore = openBrowserDocumentStore,
  prepared,
  sessionData,
  sessionKnown,
  sessionUnknown,
  sessionPending,
}: PlannerProviderProps & {
  /** This identity's browser storage is prepared; until then the instance is inert. */
  prepared: boolean;
  sessionData: PlannerSession;
  sessionKnown: boolean;
  sessionUnknown: boolean;
  sessionPending: boolean;
}) {
  // False while the identity is unprepared and after the instance retires: every storage and network path checks it.
  const instanceActive = useRef(prepared);
  // The plan lives in a reducer (lib/planner-transaction.ts) so transactions are checked and acknowledged in
  // state. Its dispatch takes everything setState did, so every existing setPlannerState call is unchanged.
  const transactionIdentity = sessionData?.user?.id ? `user:${sessionData.user.id}` : "guest";
  const [planBox, dispatchPlan] = useReducer(
    (box: ReturnType<typeof plannerBox>, numbered: NumberedAction) => reducePlannerBox(box, numbered, transactionIdentity),
    undefined,
    () => plannerBox(getInitialPlannerState()),
  );
  // Numbers every action at dispatch, so a transaction can tell whether the state it gets includes all earlier ones.
  // Never dispatch to the plan while rendering: React can discard a render-phase update without rolling back
  // this counter, and a transaction would then wait for a number that never arrives. Dispatch from events,
  // effects and promise callbacks only.
  const lastActionSeq = useRef(0);
  const setPlannerState = useCallback((action: PlannerAction) => {
    if (instanceActive.current) dispatchPlan({ seq: ++lastActionSeq.current, action });
  }, []);
  const plannerState = planBox.plan;
  const catalogVersion = useSyncExternalStore(sectionStore.subscribe, sectionStore.version, () => 0);
  const normalizedState = useMemo(() => normalizePlannerState(plannerState), [plannerState]);
  const plannedKey = getPlanningTermCourseCodes(normalizedState).join("|");
  useEffect(() => {
    if (plannedKey) sectionStore.ensure(plannedKey.split("|"));
  }, [plannedKey, sectionStore]);
  // The courses this identity's saved copies plan this term. Their previews tie-break on evidence like Main
  // does, so a copy-only course needs its own (#172 review). Read from the stored bytes, which change only on a
  // write, so a render parses nothing new; the sections themselves load where a preview asks for them.
  const copiesOwner = sessionData?.user?.id ?? null;
  const readSavedCopies = useCallback(() => {
    if (!prepared) return null;
    try {
      return browserStorage()?.getItem(savedPlansKey(copiesOwner)) ?? null;
    } catch {
      return null;
    }
  }, [prepared, copiesOwner]);
  const savedCopiesRaw = useSyncExternalStore(subscribeSavedPlans, readSavedCopies, () => null);
  const copyCodes = useMemo(() => previewCourseCodes(savedPlansIn(savedCopiesRaw).map((plan) => plan.state)), [savedCopiesRaw]);
  // Main's courses and the copies', once each: the courses that read instructor evidence.
  const evidenceKey = [...new Set([...(plannedKey ? plannedKey.split("|") : []), ...copyCodes])].join("|");
  // Accepted instructor evidence for the tie-break (Auto's request, this
  // provider's sectionPlan and the saved copies' previews): per course in
  // Main or a saved copy, each section's instructor
  // mean from the grade-history service. A course the service cannot read
  // maps to nulls — unknown evidence never enters the tie-break, so a
  // throttle never reads as weak grades.
  const [evidenceHundredths, setEvidenceHundredths] = useState<Record<string, Record<string, number | null>>>({});
  // The map the plan and the context read: no planned or copied courses read no
  // evidence, derived during render — the effect must not clear state
  // synchronously (react-hooks/set-state-in-effect), and the retained map
  // matches the once-per-session cache it feeds (histories are
  // session-stable; the next plan's fetch replaces the whole map).
  const shownEvidenceHundredths: Readonly<Record<string, Record<string, number | null>>> = useMemo(
    () => (evidenceKey ? evidenceHundredths : {}),
    [evidenceKey, evidenceHundredths],
  );
  // One fetch per course per session: a course's history does not change with
  // the catalog, so each catalogVersion re-maps the cached results instead of
  // refetching every history. Failures cache too, so one dead course costs one
  // bounded attempt, never a retry loop.
  const historiesRef = useRef(new Map<string, Promise<HistoryResult<CourseHistory>>>());
  useEffect(() => {
    const codes = evidenceKey ? evidenceKey.split("|") : [];
    if (codes.length === 0) return;
    const fetchOne = (code: string) => {
      const [subject, number = ""] = code.split(" ");
      // A history the browser cannot read (offline, endpoint down, a test
      // DOM with no origin) maps to nulls like any other unavailable source:
      // unknown evidence never enters the tie-break, and one dead course
      // never blanks the others.
      return fetchCourseHistory(subject, number).catch(
        (): HistoryResult<CourseHistory> => ({
          status: "unavailable",
          source: "untgrades.app",
          data: null,
          error: { reason: "upstream", message: "course history request failed" },
        }),
      );
    };
    // Only loaded, real-provenance courses fetch: a course first fetches when
    // its sections load, then never again this session.
    const fetchable = new Set(codes.filter((code) => evidenceFetchable(code, sectionStore.catalog(code))));
    historiesRef.current = fetchMissingHistories(fetchable, historiesRef.current, fetchOne);
    const histories = historiesRef.current;
    let cancelled = false;
    void Promise.all(
      codes.map(async (code) => {
        const loaded = sectionStore.catalog(code);
        const sections = loaded.status === "ready" ? loaded.result.sections : [];
        if (sections.length === 0 || !fetchable.has(code)) return [code, {}] as const;
        const result = await histories.get(code)!;
        return [code, courseEvidenceHundredths(sections, result)] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setEvidenceHundredths(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [evidenceKey, sectionStore, catalogVersion]);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<PlannerSaveState>(PENDING);
  // Fingerprint the last `saved` acknowledgement covered. `Saved` is only
  // shown while the on-screen state still has this fingerprint.
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PlannerConflict | null>(null);
  const [tookNewerVersion, setTookNewerVersion] = useState(false);
  const [storeNotices, setStoreNotices] = useState<Array<{ message: string; quarantinedTo?: string }>>([]);
  const [guestStorageAvailable, setGuestStorageAvailable] = useState(true);
  // Signed in: what the documents' state reads as, and why it can't move forward.
  const [syncView, setSyncView] = useState<{ status: SyncStatus | null; conflict: SyncConflict | null; refused: boolean; conflictUnsaved: boolean }>({
    status: null,
    conflict: null,
    refused: false,
    conflictUnsaved: false,
  });
  // Why the documents can't move forward: the last pull failed, this build can't read them, this browser
  // can't store them, or the last edit couldn't be stored (a bug, shown rather than only logged).
  const [syncProblem, setSyncProblem] = useState<"offline" | "signed-out" | "outdated" | "storage" | "save-failed" | null>(null);
  const [guestSignIn, setGuestSignIn] = useState<GuestSignIn | null>(null);
  const [guestHandover, setGuestHandover] = useState<{ writtenAt: number | null } | null>(null);
  // Resolves the open guest sign-in question; null means the instance retired before an answer.
  const guestAnswer = useRef<((choice: GuestChoice | "recheck" | null) => void) | null>(null);
  const guestHandoverAnswer = useRef<((choice: "bring" | "leave" | null) => void) | null>(null);
  // An answer waiting for the lock, applied only if the account still asks the same questions.
  const pendingChoice = useRef<GuestChoice | null>(null);
  const syncProblemRef = useRef(syncProblem);
  useEffect(() => {
    syncProblemRef.current = syncProblem;
  }, [syncProblem]);
  const [schedulePreferences, setSchedulePreferencesState] = useState<SchedulePreferences>(() =>
    defaultSchedulePreferences(getInitialPlannerState().optimization),
  );
  const [preferencesStorage, setPreferencesStorage] = useState<PreferencesStorage>("stored");
  const { openSeatsOnly, otherSites } = schedulePreferences.constraints;
  const candidateFilter = useMemo<CandidateFilter>(() => ({ openSeatsOnly, otherSites }), [openSeatsOnly, otherSites]);
  const sectionPlan = useMemo(
    // The evidence map is the same one Auto's request carries: a recommendation
    // the page shows tie-breaks on accepted instructor evidence, not section id.
    () => resolveSectionPlan(normalizedState, sectionStore.catalog, candidateFilter, undefined, shownEvidenceHundredths),
    // catalogVersion is how the catalog says it has more loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalizedState, sectionStore, catalogVersion, candidateFilter, shownEvidenceHundredths],
  );
  // Actions read the newest plan: a lock pins the section the page shows.
  const sectionPlanRef = useRef(sectionPlan);
  useEffect(() => {
    sectionPlanRef.current = sectionPlan;
  }, [sectionPlan]);
  // The identity whose preferences are loaded ("user:<id>" or "guest"); null before the first read.
  const [preferencesFor, setPreferencesFor] = useState<string | null>(null);
  const [planEpoch, setPlanEpoch] = useState(0);
  const bumpPlanEpoch = useCallback(() => setPlanEpoch((n) => n + 1), []);
  const preferencesRef = useRef(schedulePreferences);
  // The server confirmed no one is signed in, so guest writes are this guest's (lib/guest-session.ts). A failed
  // lookup may hide someone's session, and work written then is never carried into an account.
  const guestConfirmed = useRef(false);
  useEffect(() => {
    guestConfirmed.current = sessionKnown && !sessionData?.user;
  }, [sessionKnown, sessionData]);
  // Signed in: the account's documents on this device and the server (lib/sync/planner-sync.ts).
  const syncRef = useRef<PlannerSync | null>(null);
  const preferencesKeyRef = useRef<string | null>(null);
  // Revision of the stored entry this tab last read or wrote (0 for none).
  const preferencesRevision = useRef(0);
  const userId = sessionData?.user?.id ?? null;
  const identityTag = userId ? `user:${userId}` : "guest";

  const adoptPreferences = useCallback((next: SchedulePreferences) => {
    preferencesRef.current = next;
    setSchedulePreferencesState(next);
  }, []);

  // Another tab of this browser stored newer preferences for this identity.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const key = preferencesKeyRef.current;
      const storage = browserStorage();
      if (!key || event.key !== key || !storage) return;
      const read = readStoredPreferences(storage, key);
      if (read.kind !== "ok" || read.revision <= preferencesRevision.current) return;
      preferencesRevision.current = read.revision;
      adoptPreferences(read.preferences);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [adoptPreferences]);

  const setSchedulePreferences = useCallback(
    (update: (current: SchedulePreferences) => SchedulePreferences) => {
      if (!instanceActive.current) return;
      if (syncRef.current) {
        // Signed in: the preferences document carries them (the save effect writes it).
        adoptPreferences(update(preferencesRef.current));
        return;
      }
      const key = preferencesKeyRef.current;
      const storage = browserStorage();
      const outcome: WriteOutcome =
        key && storage
          ? writeStoredPreferences(storage, key, preferencesRevision.current, preferencesRef.current, update)
          : { kind: "not-stored", revision: preferencesRevision.current, preferences: update(preferencesRef.current) };
      preferencesRevision.current = outcome.revision;
      if (outcome.kind !== "not-stored" && guestConfirmed.current) stampGuestWork("preferences");
      adoptPreferences(outcome.preferences);
      setPreferencesStorage(outcome.kind);
    },
    [adoptPreferences],
  );

  const bootstrappedFor = useRef<string | null>(null);
  // Incremented on every identity change; async results from an older
  // generation belong to a previous user (or guest) and are dropped.
  const sessionGeneration = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fingerprint of the state the store is known to hold (last loaded or
  // written). `dirty` = the current state's fingerprint differs from this.
  const lastPersistedFingerprint = useRef<string | null>(null);
  // The stored document revision this tab last loaded or wrote (guest store).
  const baseRevision = useRef(0);
  // Signed in: the next retry of an unconfirmed write, and how long it waits (doubling up to a minute).
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(2000);
  // True between a 401 and the session being restored, so expiry is announced once.
  const sessionExpired = useRef(false);
  // True when the user mutated before bootstrap finished: bootstrap must not
  // overwrite those edits with fetched/stored state.
  const mutatedBeforeBootstrap = useRef(false);
  const hydratedRef = useRef(false);
  const hydrationWaiters = useRef<Array<() => void>>([]);
  const conflictRef = useRef<PlannerConflict | null>(null);
  useEffect(() => {
    conflictRef.current = conflict;
  }, [conflict]);

  // transact: resolvers by transaction id; ids whose receipt has been resolved, so later updates drop it.
  const transactionWaiters = useRef(new Map<number, (outcome: TransactionOutcome<unknown>) => void>());
  const settledTransactions = useRef(new Set<number>());
  const lastTransactionId = useRef(0);
  useEffect(() => {
    const present = new Set(planBox.receipts.map((receipt) => receipt.id));
    for (const id of settledTransactions.current) if (!present.has(id)) settledTransactions.current.delete(id);
    for (const { id, outcome } of planBox.receipts) {
      const resolve = transactionWaiters.current.get(id);
      if (!resolve) continue;
      transactionWaiters.current.delete(id);
      settledTransactions.current.add(id);
      resolve(outcome);
    }
  }, [planBox.receipts]);
  useLayoutEffect(() => {
    if (!prepared) return;
    instanceActive.current = true;
    // Layout-effect replay must restart bootstrap after invalidating its first request.
    bootstrappedFor.current = null;
    const waiters = transactionWaiters.current;
    return () => {
      instanceActive.current = false;
      sessionGeneration.current += 1;
      hydratedRef.current = false;
      syncRef.current?.close();
      syncRef.current = null;
      guestAnswer.current?.(null);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      hydrationWaiters.current.splice(0).forEach((resolve) => resolve());
      const retiredWaiters = [...waiters.values()];
      waiters.clear();
      queueMicrotask(() => {
        const changed = getSavedPlanIdentity() !== userId;
        retiredWaiters.forEach((resolve) => resolve({ status: changed ? "identity_changed" : "cancelled" }));
      });
    };
  }, [prepared, userId]);

  // Creating a store probes its key, so an unprepared instance gets one without storage.
  const guestStore = useMemo(() => createPlannerStateStore(prepared ? undefined : null, userId), [prepared, userId]);
  const localStoreRef = useRef(guestStore);
  useEffect(() => { localStoreRef.current = guestStore; }, [guestStore]);
  const isRegistered = Boolean(sessionData?.user);
  const stateRef = useRef(plannerState);
  useEffect(() => {
    stateRef.current = plannerState;
  }, [plannerState]);

  // Once the plan for this identity has loaded, read that identity's
  // preferences. Declared after the stateRef sync, so the plan's goal is the
  // loaded one when nothing is stored yet.
  useEffect(() => {
    if (!hydrated) return;
    if (userId) {
      // Signed in, the preferences document was read with the plan.
      setPreferencesStorage("stored");
      setPreferencesFor(`user:${userId}`);
      return;
    }
    const storage = browserStorage();
    const guestId = storage ? readOrCreateGuestId(storage, makeGuestId) : null;
    const key = guestId ? preferencesKey({ kind: "guest", id: guestId }) : null;
    const read = key && storage ? readStoredPreferences(storage, key) : ({ kind: "unavailable" } as const);
    preferencesKeyRef.current = key;
    preferencesRevision.current = read.kind === "ok" ? read.revision : 0;
    adoptPreferences(initialPreferences(read, stateRef.current.optimization));
    setPreferencesStorage(read.kind === "unavailable" ? "not-stored" : "stored");
    setPreferencesFor("guest");
  }, [adoptPreferences, hydrated, userId]);

  const markSaved = useCallback((fingerprint: string) => {
    lastPersistedFingerprint.current = fingerprint;
    setSavedFingerprint(fingerprint);
    setSaveState(saveStateOf("saved"));
  }, []);

  const raiseConflict = useCallback((next: PlannerConflict) => {
    conflictRef.current = next;
    setConflict(next);
    setSaveState(saveStateOf("not-saved", CONFLICT_DETAIL, "conflict"));
  }, []);

  const afterHydration = useCallback(() => {
    if (!instanceActive.current || hydratedRef.current) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      hydrationWaiters.current.push(resolve);
    });
  }, []);

  /** The planner now, for the sync controller, which reads it after its awaits. */
  const readPlanner = useCallback<PlannerRead>(() => ({ state: stateRef.current, preferences: preferencesRef.current }), []);

  /** Puts the documents' plan on screen when it differs from what is shown. */
  const showDocuments = useCallback(
    (view: PlannerView, announce: boolean) => {
      if (workingStateFingerprint(view.state) === workingStateFingerprint(stateRef.current) && equal(view.preferences, preferencesRef.current)) return;
      // Set now, not after the render: a save that reads the planner before then must see this plan.
      stateRef.current = view.state;
      setPlannerState(view.state);
      adoptPreferences(view.preferences);
      bumpPlanEpoch();
      if (announce) setTookNewerVersion(true);
    },
    [adoptPreferences, bumpPlanEpoch, setPlannerState],
  );

  const announceSessionExpired = useCallback(() => {
    if (sessionExpired.current) return;
    sessionExpired.current = true;
    notifySessionExpired();
  }, []);

  // Set once the account's documents have been read from the server in this instance.
  // The sync whose first server read has been settled: once per signed-in identity, since each one gets its own.
  const firstSyncSettled = useRef<PlannerSync | null>(null);
  const afterFirstSyncRef = useRef<((sync: PlannerSync) => Promise<void>) | null>(null);
  const runSyncRef = useRef<((operation: (sync: PlannerSync) => Promise<unknown>) => Promise<boolean>) | null>(null);
  /**
   * Runs one operation on the account's documents, then shows what they
   * hold (unless this tab has edits still to save) and the state they're in.
   * An unconfirmed write is tried again after 2 seconds, doubling to a minute.
   */
  const runSync = useCallback(
    async (operation: (sync: PlannerSync) => Promise<unknown>, { saving = false } = {}): Promise<boolean> => {
      const sync = syncRef.current;
      if (!sync) return false;
      try {
        const outcome = await operation(sync);
        if (saving) setSyncProblem((problem) => (problem === "save-failed" ? null : problem));
        // A pull's outcome replaces only an earlier pull's problem.
        const pullProblem = (next: "offline" | "signed-out" | null) =>
          setSyncProblem((problem) => (problem === null || problem === "offline" || problem === "signed-out" ? next : problem));
        if (outcome === "unavailable") pullProblem("offline");
        else if (outcome === "synced") pullProblem(null);
        else if (outcome === "signed-out") {
          pullProblem("signed-out");
          announceSessionExpired();
        }
        const view = await sync.adopt(readPlanner);
        if (syncRef.current !== sync) return false;
        if (view) showDocuments(view, hydratedRef.current);
        if (outcome === "synced" && firstSyncSettled.current !== sync) {
          firstSyncSettled.current = sync;
          void afterFirstSyncRef.current?.(sync);
        }
        const next = await sync.status(readPlanner);
        if (syncRef.current !== sync) return false;
        setSyncView({ status: next.status, conflict: next.conflict, refused: next.refused, conflictUnsaved: next.conflictUnsaved });
        // The state shown is covered by the store only when the planner has nothing left to save.
        setSavedFingerprint(next.clean ? workingStateFingerprint(stateRef.current) : null);
        if (next.status === "Needs sign-in") announceSessionExpired();
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = null;
        if (next.status === "Save not confirmed (retrying)") {
          // The server's Retry-After, when it gave one, is the earliest the write may go again.
          const delay = Math.max(retryDelay.current, next.retryAfterMs);
          retryDelay.current = Math.min(delay * 2, 60_000);
          retryTimer.current = setTimeout(() => void runSyncRef.current?.((current) => current.drain()), delay);
        } else {
          retryDelay.current = 2000;
        }
        return true;
      } catch (error) {
        if (syncRef.current !== sync || sync.isClosed) return false;
        if (error instanceof ClientOutdatedError) {
          // Stop sending: nothing this copy writes may drop what it couldn't read. Its outbox stays, so
          // sign-out still finds waiting writes and the reloaded app sends them.
          sync.close();
          setSyncProblem("outdated");
          return false;
        }
        console.error("Syncing your schedule failed", error);
        if (saving) setSyncProblem("save-failed");
        return false;
      }
    },
    [announceSessionExpired, readPlanner, showDocuments],
  );
  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  const handleSessionRestored = useCallback(() => {
    if (!instanceActive.current || !sessionExpired.current) return;
    sessionExpired.current = false;
    setSyncProblem((problem) => (problem === "signed-out" ? null : problem));
    void runSync((sync) => sync.refresh());
  }, [runSync]);

  useEffect(() => onSessionRestored(handleSessionRestored), [handleSessionRestored]);

  // Bootstrap is keyed on who is signed in (the user id, or guest): it runs
  // once per identity, including sign-out followed by sign-in as someone
  // else. Each run gets a new generation; any response that arrives after a
  // newer run started belongs to the previous identity and is dropped.
  useEffect(() => {
    if (!prepared || !instanceActive.current || (!sessionKnown && !sessionUnknown)) {
      return;
    }
    const userId = sessionData?.user?.id ?? null;
    const registered = userId !== null;
    const needed = registered ? `registered:${userId}` : "guest";
    if (bootstrappedFor.current === needed) {
      return;
    }
    bootstrappedFor.current = needed;
    const generation = ++sessionGeneration.current;
    const isCurrent = () => instanceActive.current && generation === sessionGeneration.current;
    lastPersistedFingerprint.current = null;
    sessionExpired.current = false;
    conflictRef.current = null;
    hydratedRef.current = false;

    /** The planner may be used from here on; idempotent. */
    const finishHydration = () => {
      if (hydratedRef.current) return;
      hydratedRef.current = true;
      bumpPlanEpoch();
      setHydrated(true);
      hydrationWaiters.current.forEach((resolve) => resolve());
      hydrationWaiters.current = [];
    };

    /**
     * Edits made before hydration finished meet a stored plan that differs:
     * neither side may silently replace the other, so show both. Nothing is
     * written until the user chooses (the save effect waits on a conflict).
     */
    const earlyEditsConflict = (stored: PlannerState, revision: number, savedAt: string | null) => {
      lastPersistedFingerprint.current = workingStateFingerprint(stored);
      raiseConflict({ mine: stateRef.current, theirs: stored, theirsRevision: revision, theirsSavedAt: savedAt, source: "browser" });
    };

    startTransition(async () => {
      setHydrated(false);
      setSavedFingerprint(null);
      setConflict(null);
      if (registered) {
        // Signed in: the account's documents (lib/sync/planner-sync.ts). Edits made before they are read
        // are saved against them the way another tab's are, so none is dropped or silently merged into a schedule.
        const initialPlan = getInitialPlannerState();
        let sync: PlannerSync;
        try {
          sync = new PlannerSync(await documentStore(), userId, planningTerm.id, httpSyncIO(userId), {
            state: initialPlan,
            preferences: defaultSchedulePreferences(initialPlan.optimization),
          });
        } catch (error) {
          if (!isCurrent()) return;
          console.error("This browser can't store documents", error);
          setSyncProblem("storage");
          finishHydration();
          return;
        }
        if (!isCurrent()) {
          sync.close();
          return;
        }
        syncRef.current = sync;
        // What this device already holds shows at once, before the network answers. Once the server's copy
        // has been read, afterFirstSync settles what this browser kept outside the account.
        let stored = false;
        await runSync(async (current) => {
          stored = (await current.status(readPlanner)).status !== null;
        });
        if (!isCurrent()) return;
        if (stored) finishHydration();
        await runSync((current) => current.refresh());
        if (!isCurrent()) return;
        finishHydration();
      } else {
        const read = guestStore.read();
        if (read.ok) {
          setGuestStorageAvailable(true);
          setStoreNotices(read.notices);
          const mutated = mutatedBeforeBootstrap.current;
          const storedDiffers =
            read.state !== null && workingStateFingerprint(read.state) !== workingStateFingerprint(stateRef.current);
          if (read.state && mutated && storedDiffers) {
            // The base revision is only adopted when the user chooses.
            baseRevision.current = 0;
            earlyEditsConflict(read.state, read.revision, read.savedAt);
          } else if (read.state) {
            baseRevision.current = read.revision;
            if (!mutated) {
              setPlannerState(read.state);
            }
            // The loaded state survived a previous session: it is durable.
            markSaved(workingStateFingerprint(read.state));
          } else {
            baseRevision.current = read.revision;
            lastPersistedFingerprint.current = mutated ? null : workingStateFingerprint(stateRef.current);
            setSaveState(PENDING);
          }
        } else {
          setGuestStorageAvailable(false);
          setSaveState(saveStateOf("not-saved", read.failure.message, "storage"));
        }
      }
      finishHydration();
    });
  }, [
    adoptPreferences,
    bumpPlanEpoch,
    documentStore,
    guestStore,
    markSaved,
    prepared,
    raiseConflict,
    readPlanner,
    runSync,
    sessionData,
    sessionKnown,
    sessionUnknown,
    setPlannerState,
  ]);

  // Local bridge until #19 lands: a new session for the same signed-in user
  // (signing in again in this tab) counts as a restore. Idempotent, so #19's
  // own `onSessionRestored` event firing as well is harmless.
  const sessionId = sessionData?.session?.id ?? null;
  const previousSessionId = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousSessionId.current;
    previousSessionId.current = sessionId;
    if (sessionId && previous && sessionId !== previous) {
      handleSessionRestored();
    }
  }, [handleSessionRestored, sessionId]);

  const persistGuest = useCallback(
    (state: PlannerState) => {
      if (!instanceActive.current) return;
      const result = guestStore.write(state, baseRevision.current);
      if (result.ok) {
        if (guestConfirmed.current) stampGuestWork("plan");
        baseRevision.current = result.revision;
        markSaved(workingStateFingerprint(state));
        return;
      }
      if ("conflict" in result) {
        // Rule 5: another tab stored a newer version while this tab holds
        // unsaved edits — show both and let the user choose.
        const incoming: PlannerStoreIncoming = result.incoming;
        raiseConflict({
          mine: state,
          theirs: incoming.state,
          theirsRevision: incoming.revision,
          theirsSavedAt: incoming.savedAt,
          source: "browser",
        });
        return;
      }
      setGuestStorageAvailable(false);
      setSaveState(saveStateOf("not-saved", result.failure.message, "storage"));
    },
    [guestStore, markSaved, raiseConflict],
  );

  /** Signed in: puts the planner's edit into this device's outbox, then sends it. */
  const saveDocuments = useCallback(async () => {
    const saved = await runSync((sync) => sync.save(readPlanner), { saving: true });
    await runSync((sync) => sync.drain());
    return saved;
  }, [readPlanner, runSync]);

  useEffect(() => {
    if (!hydrated || !hydratedRef.current) {
      return;
    }

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    saveTimer.current = setTimeout(() => {
      if (syncRef.current) {
        void saveDocuments();
        return;
      }
      const state = stateRef.current;
      if (conflictRef.current || sessionData?.user || workingStateFingerprint(state) === lastPersistedFingerprint.current) {
        return;
      }
      persistGuest(state);
    }, 350);

    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [conflict, hydrated, persistGuest, plannerState, saveDocuments, schedulePreferences, sessionData]);

  // An edit made in the last 350 ms before the page goes away (reload, tab
  // close, full navigation) would never reach the debounced save. Flush it on
  // pagehide: synchronously to the guest store, or into a signed-in student's
  // outbox, whose IndexedDB write usually completes as the page unloads; the
  // next load sends whatever reached it.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const flush = () => {
      if (!instanceActive.current || !hydratedRef.current) return;
      if (syncRef.current) {
        void runSync((sync) => sync.save(readPlanner));
        return;
      }
      const state = stateRef.current;
      if (sessionData?.user || conflictRef.current || workingStateFingerprint(state) === lastPersistedFingerprint.current) {
        return;
      }
      persistGuest(state);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [hydrated, persistGuest, readPlanner, runSync, sessionData]);

  // Signed in: other devices' changes arrive by polling on focus, on coming back online, and once a
  // minute while the page is visible (docs/architecture/README.md); the same pull resends waiting writes.
  useEffect(() => {
    if (!hydrated || !isRegistered) return;
    const refresh = () => void runSync((sync) => sync.refresh());
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const minute = setInterval(onVisibility, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(minute);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hydrated, isRegistered, runSync]);

  const retrySave = useCallback(() => {
    if (!instanceActive.current) return;
    if (syncRef.current) {
      void runSync((sync) => sync.refresh());
    } else if (!sessionData?.user) {
      persistGuest(stateRef.current);
    }
  }, [persistGuest, runSync, sessionData]);

  /**
   * Another tab of this browser stored a guest plan. Adopt it when this tab
   * is clean; when this tab has unsaved edits, show both and let the user
   * choose.
   */
  const adoptOrConflict = useCallback(
    (incoming: { state: PlannerState; revision: number; savedAt: string | null }) => {
      if (!instanceActive.current) return;
      const current = stateRef.current;
      const incomingFingerprint = workingStateFingerprint(incoming.state);
      const dirty = workingStateFingerprint(current) !== lastPersistedFingerprint.current;
      if (incomingFingerprint === workingStateFingerprint(current)) {
        baseRevision.current = incoming.revision;
        markSaved(incomingFingerprint);
        return;
      }
      if (dirty) {
        raiseConflict({
          mine: current,
          theirs: incoming.state,
          theirsRevision: incoming.revision,
          theirsSavedAt: incoming.savedAt,
          source: "browser",
        });
        return;
      }
      baseRevision.current = incoming.revision;
      lastPersistedFingerprint.current = incomingFingerprint;
      setPlannerState(incoming.state);
      bumpPlanEpoch();
      setTookNewerVersion(true);
      markSaved(incomingFingerprint);
    },
    [bumpPlanEpoch, markSaved, raiseConflict, setPlannerState],
  );

  useEffect(() => {
    if (!hydrated || isRegistered) {
      return;
    }
    return guestStore.subscribe(() => {
      if (conflictRef.current) {
        return;
      }
      const read = guestStore.read();
      if (!read.ok || read.revision === baseRevision.current) {
        return;
      }
      if (!read.state) {
        baseRevision.current = read.revision;
        return;
      }
      adoptOrConflict({ state: read.state, revision: read.revision, savedAt: read.savedAt });
    });
  }, [adoptOrConflict, guestStore, hydrated, isRegistered]);

  const resolveConflict = useCallback(
    (resolution: "keep-mine" | "take-theirs") => {
      if (!instanceActive.current) return;
      const current = conflictRef.current;
      conflictRef.current = null;
      setConflict(null);
      if (!current) {
        return;
      }
      // Either way the plan on screen is now a resolved version.
      bumpPlanEpoch();
      if (resolution === "take-theirs") {
        if (current.theirs) {
          baseRevision.current = current.theirsRevision;
          setPlannerState(current.theirs);
          markSaved(workingStateFingerprint(current.theirs));
        }
        return;
      }
      // Keep my edits: rebase onto the newest stored revision first, so the
      // write lands on top of it instead of being refused as another conflict.
      // The newest local state is saved (it includes edits made while the
      // dialog was open).
      baseRevision.current = current.theirsRevision;
      persistGuest(stateRef.current);
    },
    [bumpPlanEpoch, markSaved, persistGuest, setPlannerState],
  );

  const syncConflictRef = useRef<SyncConflict | null>(null);
  useEffect(() => {
    syncConflictRef.current = syncView.conflict;
  }, [syncView.conflict]);

  const settleSyncConflict = useCallback(
    async (choice: SyncConflictChoice): Promise<boolean> => {
      const sync = syncRef.current;
      if (!sync || !syncConflictRef.current) return false;
      // Other edits go into the outbox first, so taking the latest of one document can't drop them.
      if (!(await runSync((current) => current.save(readPlanner), { saving: true }))) return false;
      const { conflict: open } = await sync.status(readPlanner);
      if (!open || syncRef.current !== sync) return false;
      let settle: ConflictChoice;
      if (choice.kind === "answers") {
        settle = { kind: "keep", body: choice.body };
      } else if (choice.kind === "use-latest") {
        settle = { kind: "use-latest" };
      } else if (open.latest === null) {
        settle = { kind: "keep", body: open.mine };
      } else {
        // Schedules are never merged in v1. This side goes to Schedules, where it can be opened or restored.
        const kept = createSavedPlanStore().savePlan({ state: stateRef.current, name: keptCopyName(new Date()) });
        if (!kept.ok) {
          toast({ message: "Couldn't keep a copy, so nothing changed. Try again.", tone: "error" });
          return false;
        }
        toast(`Kept your version in Schedules as "${kept.value.name}"`);
        settle = { kind: "use-latest" };
      }
      const settled = await runSync(async (current) => showDocuments(await current.resolve(open, settle, readPlanner), false));
      void runSync((current) => current.drain());
      return settled;
    },
    [readPlanner, runSync, showDocuments],
  );

  // An edit made while a conflict is open isn't stored until the student chooses, so leaving asks first.
  useEffect(() => {
    if (!syncView.conflictUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [syncView.conflictUnsaved]);

  /**
   * Once the account's documents have been read from the server, settles
   * what this browser kept outside them, in this order: the ownerless pre-#77
   * planner key, the account's own #77 preferences key, then the guest's work
   * (docs/architecture/guest-sync.md). Each needs the server's copy first, so
   * nothing here runs after an offline load until a pull succeeds.
   */
  const afterFirstSync = useCallback(
    async (sync: PlannerSync) => {
      const current = () => syncRef.current === sync;
      // Kept for the account only when it equals the account's plan, quarantined otherwise (planner-store.ts).
      localStoreRef.current.migrateLegacy(stateRef.current);
      const storage = browserStorage();
      if (!storage || !userId) return;

      // Step 4 of the migration: settings this browser kept for this account (#77 keys them by account) are
      // offered once, as an ordinary preferences write, while the account's are still the defaults the
      // migration started them with. Settings saved since, on any device, win.
      const ownKey = preferencesKey({ kind: "user", id: userId });
      const own = readStoredPreferences(storage, ownKey);
      if (own.kind === "ok" && equal(preferencesRef.current, defaultSchedulePreferences(stateRef.current.optimization))) {
        adoptPreferences(own.preferences);
        // Removed only once the write is in this device's outbox.
        if (await runSync((s) => s.save(readPlanner), { saving: true })) storage.removeItem(ownKey);
        void runSync((s) => s.drain());
      }
      if (!current()) return;

      // A matching old or legacy stamp is not enough to identify the current visitor. Ask before reading or
      // moving any guest store; choosing "Bring it in" only unlocks this sign-in attempt.
      let handoverAllowed = false;
      const handover = guestWorkHandover();
      if (handover.needsConfirmation) {
        setGuestHandover({ writtenAt: handover.writtenAt });
        const choice = await new Promise<"bring" | "leave" | null>((resolve) => {
          guestHandoverAnswer.current = resolve;
        });
        guestHandoverAnswer.current = null;
        setGuestHandover(null);
        if (choice !== "bring" || !current()) return;
        handoverAllowed = true;
      }

      // Only work a guest wrote in this browser session (lib/guest-session.ts): older work may be someone else's.
      if (!guestWorkIsThisSession() || (!handoverAllowed && guestWorkHandover().needsConfirmation)) return;
      const library = createSavedPlanStore(storage, userId);
      const stamp = shortDate(new Date());
      const copies: { guest?: ReturnType<typeof library.savePlan>; account?: ReturnType<typeof library.savePlan> } = {};

      /** This browser's guest work against the account as it is now; null once nothing is left to settle. */
      /**
       * This session's guest work against the account as the planner holds it now, the same copy the answer
       * is written over; null once nothing is left to settle. A part an earlier visitor left is not read.
       */
      const read = () => {
        const planStamped = guestWorkIsThisSession("plan");
        const prefsStamped = guestWorkIsThisSession("preferences");
        const guestPlan = createPlannerStateStore(storage, null).read();
        if (!guestPlan.ok) return null;
        const guestId = storage.getItem(GUEST_ID_KEY);
        const prefsKey = guestId ? preferencesKey({ kind: "guest", id: guestId }) : null;
        const prefs = prefsKey && prefsStamped ? readStoredPreferences(storage, prefsKey) : ({ kind: "absent" } as const);
        const clear = () => {
          if (planStamped) clearPlannerIdentity(null);
          if (prefsStamped && prefsKey) storage.removeItem(prefsKey);
          forgetGuestWork([...(planStamped ? ["plan" as const] : []), ...(prefsStamped ? ["preferences" as const] : [])]);
        };
        const ownState = planStamped ? guestPlan.state : null;
        if (!ownState && prefs.kind !== "ok") {
          clear();
          return null;
        }
        const state = ownState ?? getInitialPlannerState();
        const now = splitPlanner(stateRef.current, preferencesRef.current, planningTerm.id);
        const signIn = planGuestSignIn({ state, preferences: initialPreferences(prefs, state.optimization) }, now, planningTerm.id);
        if (!signIn) {
          clear();
          return null;
        }
        return { state, signIn, clear, now };
      };

      /** Writes the choice, keeping in Schedules what it leaves out. False when nothing changed. */
      const apply = async (found: NonNullable<ReturnType<typeof read>>, choice: GuestChoice): Promise<boolean> => {
        const { signIn, state } = found;
        // A copy made on an attempt that then failed is reused, so trying again doesn't save it twice.
        const keep = (which: "guest" | "account", save: () => ReturnType<typeof library.savePlan>) => {
          const made = copies[which];
          if (made) return made;
          const saved = save();
          if (saved.ok) copies[which] = saved;
          return saved;
        };
        const keptGuest =
          dropsGuestWork(signIn, choice) && hasCopyableWork(signIn) ? keep("guest", () => library.savePlan({ state, name: `From this browser, ${stamp}` })) : null;
        const keptAccount =
          signIn.schedule === "ask" && choice.schedule === "guest"
            ? keep("account", () => library.savePlan({ state: stateRef.current, name: `Main from your account, ${stamp}` }))
            : null;
        if (keptGuest?.ok === false || keptAccount?.ok === false) {
          toast({ message: "Couldn't keep a copy in Schedules, so nothing changed. Try again.", tone: "error" });
          return false;
        }
        showDocuments(applyGuestSignIn(signIn, choice, found.now, stateRef.current.activeDay), false);
        const saved = await runSync((s) => s.save(readPlanner), { saving: true });
        void runSync((s) => s.drain());
        if (!current()) return false;
        if (!saved) {
          toast({ message: "Couldn't save your choice on this device, so nothing changed. Try again.", tone: "error" });
          return false;
        }
        found.clear();
        toast(
          keptAccount?.ok
            ? `Using this browser's schedule. Your account's Main is in Schedules as "${keptAccount.value.name}"`
            : keptGuest?.ok
              ? `Kept this browser's version in Schedules as "${keptGuest.value.name}"`
              : "Saved your choices",
        );
        return true;
      };

      // One tab reads and writes at a time; the question itself waits outside the lock, so the sheet can show
      // in every signed-in tab and the first answer settles it for all of them.
      let asked: GuestSignIn | null = null;
      for (;;) {
        const outcome = await oneTabAtATime("untangle-guest-sign-in", async (): Promise<"done" | GuestSignIn> => {
          if (!current()) return "done";
          if (asked === null && (guestWorkIsThisSession("plan") || guestWorkIsThisSession("library"))) {
            // Library entries this session saved, or that go with this session's plan, move whole (every
            // SavedPlanSnapshot field) before anything is decided.
            const guestLibrary = createSavedPlanStore(storage, null).list();
            if (guestLibrary.ok && guestLibrary.doc.plans.length > 0) {
              if (!library.addSnapshots(guestLibrary.doc.plans).ok) return "done";
              // Entries this version can't read stay, with the guest's recovery notice.
              if (guestLibrary.doc.unreadable.length === 0) clearSavedPlansIdentity(null);
            }
            forgetGuestWork(["library"]);
          }
          const found = read();
          if (!found || !current()) return "done";
          const choice = pendingChoice.current;
          pendingChoice.current = null;
          if (!asksStudent(found.signIn)) {
            await carryOver(found);
            return "done";
          }
          if (choice && asked !== null && sameQuestions(asked, found.signIn)) {
            if (await apply(found, choice)) return "done";
            if (!current()) return "done";
            // Not stored: the account goes back on screen, the guest work stays, and the student is asked again.
            showDocuments(joinPlanner(found.now, stateRef.current.activeDay), false);
            return found.signIn;
          }
          return found.signIn;
        });
        if (outcome === "done") return;
        // Ask (again, when the account changed while the sheet was open): nothing is written or cleared until
        // the student answers, so closing the page asks again on the next load.
        asked = outcome;
        setGuestSignIn(outcome);
        const choice = await new Promise<GuestChoice | "recheck" | null>((resolve) => {
          guestAnswer.current = resolve;
        });
        guestAnswer.current = null;
        setGuestSignIn(null);
        if (choice === null || !current()) return;
        pendingChoice.current = choice === "recheck" ? null : choice;
        if (choice === "recheck") asked = null;
      }

      /** No question: the guest's work goes into the account, with Undo. */
      async function carryOver(found: NonNullable<ReturnType<typeof read>>) {
        const { signIn, state, now: before } = found;
        showDocuments(applyGuestSignIn(signIn, { schedule: "guest", answers: {}, preferences: "guest" }, before, stateRef.current.activeDay), false);
        if (!(await runSync((s) => s.save(readPlanner), { saving: true })) || !current()) return;
        void runSync((s) => s.drain());
        found.clear();
        const carried = (["schedule", "academic-record", "preferences"] as const).filter((kind) =>
          kind === "schedule" ? signIn.schedule === "save" : kind === "preferences" ? signIn.preferences === "save" : signIn.record === "save",
        );
        const words = carried.map((kind) => ({ schedule: "schedule", "academic-record": "courses", preferences: "preferences" })[kind]);
        toast({
          message: `Saved your ${words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0]} to your account`,
          action: {
            label: "Undo",
            onClick: () => {
              if (!current()) return;
              // The carried parts go back to how the account had them; other parts keep any edits made since.
              const kept = hasCopyableWork(signIn) ? library.savePlan({ state, name: `From this browser, ${stamp}` }) : null;
              if (kept?.ok === false) {
                toast({ message: "Couldn't keep this browser's work in Schedules, so nothing changed.", tone: "error" });
                return;
              }
              const latest = splitPlanner(stateRef.current, preferencesRef.current, planningTerm.id);
              const restored = { ...latest, ...Object.fromEntries(carried.map((kind) => [kind, before[kind]])) } as typeof latest;
              showDocuments(joinPlanner(restored, stateRef.current.activeDay), false);
              void runSync((s) => s.save(readPlanner), { saving: true }).then(() => runSync((s) => s.drain()));
              toast(
                kept?.ok
                  ? `Your account is back to how it was. This browser's work is in Schedules as "${kept.value.name}"`
                  : "Your account's preferences are back to how they were",
              );
            },
          },
        });
      }
    },
    [adoptPreferences, readPlanner, runSync, showDocuments, userId],
  );
  useEffect(() => {
    afterFirstSyncRef.current = afterFirstSync;
  }, [afterFirstSync]);

  // A confirmed guest's saved schedules are this session's guest work too. The library writes outside the
  // planner, so its changes are watched here: a higher revision means a write, not an identity change.
  useEffect(() => {
    if (!prepared || userId) return;
    const storage = browserStorage();
    if (!storage) return;
    // The raw revision: reading through the library store would run its one-time legacy migration here and
    // take the notice that migration leaves for the Schedules view.
    const revision = () => {
      try {
        const doc: unknown = JSON.parse(storage.getItem(savedPlansKey(null)) ?? "null");
        return typeof doc === "object" && doc !== null && "revision" in doc && typeof doc.revision === "number" ? doc.revision : 0;
      } catch {
        return 0;
      }
    };
    let seen = revision();
    return subscribeSavedPlans(() => {
      const now = revision();
      if (now > seen && guestConfirmed.current) stampGuestWork("library");
      seen = now;
    });
  }, [prepared, userId]);

  const settleGuestHandover = useCallback((choice: "bring" | "leave") => guestHandoverAnswer.current?.(choice), []);
  const settleGuestSignIn = useCallback((choice: GuestChoice) => guestAnswer.current?.(choice), []);

  // Another tab settled or cleared the guest work: this tab's open question is stale, so it checks again.
  useEffect(() => {
    if (!guestSignIn) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PLANNER_STATE_STORE_KEY || event.key.startsWith(STAMP_PREFIX)) guestAnswer.current?.("recheck");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [guestSignIn]);

  const prepareSignOut = useCallback(async () => {
    const sync = syncRef.current;
    // Signed in without a document store, every edit lives only in this tab.
    if (!sync) return { unsynced: syncProblemRef.current === "storage", forget: async () => {} };
    // A stalled request must not hold the sign-out: after a few seconds the student is asked instead.
    // 4 seconds is an unmeasured starting value.
    let stop = () => {};
    await Promise.race([saveDocuments(), new Promise<void>((resolve) => { const timer = setTimeout(resolve, 4000); stop = () => clearTimeout(timer); })]);
    stop();
    const now = await sync.status(readPlanner);
    // Waiting in the outbox, or never reached it: an edit held by an open conflict, or one that couldn't be stored.
    const unsynced = now.unsynced || !now.clean || now.conflictUnsaved || syncProblemRef.current === "save-failed";
    return { unsynced, forget: (discardPending: boolean) => sync.clearLocalData(discardPending) };
  }, [readPlanner, saveDocuments]);

  const value = useMemo<PlannerContextValue>(() => {
    const normalized = normalizedState;
    const scheduleEvents = buildScheduleEvents(sectionPlan);
    /** An edit before bootstrap finishes must not be overwritten by the stored plan. An inert instance drops the edit. */
    const noteEarlyEdit = () => {
      if (!hydrated && instanceActive.current) {
        mutatedBeforeBootstrap.current = true;
      }
    };
    /** Drops picks that are unlocked and resolve, so the goal re-plans them; a pick needing review is kept. */
    const releaseResolvedPicks = (current: PlannerState) => {
      const locks = normalizePlannerState(current).lockedSections ?? {};
      const resolved = new Set(
        sectionPlanRef.current.courses.filter((course) => course.state === "chosen").map((course) => course.code),
      );
      return Object.fromEntries(
        Object.entries(current.selectedSections).filter(([code, id]) => locks[code] === id || !resolved.has(code)),
      );
    };
    const lockedCourses = new Set<string>(
      courses
        .filter((course) => isCourseLocked(normalized, course.code))
        .map((course) => course.code),
    );
    // `Saved` describes one exact state. If the state on screen has moved on
    // since the acknowledgement, its save is still ahead of it.
    // Only a lookup that failed is "not confirmed"; one still in flight is ordinary loading.
    const accountSaveState: PlannerSaveState =
      syncProblem === "outdated"
        ? { status: "not-saved", label: SAVE_LABELS["not-saved"], detail: "UNTangle was updated. Reload to keep editing.", reason: "server" }
        : syncProblem === "storage"
          ? { status: "not-saved", label: SAVE_LABELS["not-saved"], detail: "This browser can't store your schedule, so edits stay in this tab and don't sync.", reason: "storage" }
          : syncProblem === "save-failed" || syncView.refused
            ? {
                status: "not-saved",
                label: SAVE_LABELS["not-saved"],
                detail: syncView.refused
                  ? "UNTangle refused your last change. It stays on this device and is sent again the next time UNTangle loads. If it's refused again, undo that change."
                  : "Your last change couldn't be stored on this device. Reload to try again.",
                reason: "server",
              }
            : syncSaveState(syncView.status, syncProblem === "offline" || syncProblem === "signed-out" ? syncProblem : null);
    const storedSaveState = isRegistered ? accountSaveState : saveState;
    const shownSaveState = sessionUnknown && !sessionPending
      ? saveStateOf("not-saved", "Your session has not been confirmed. This plan is not synced to an account.", "session")
      : storedSaveState.status === "saved" && savedFingerprint !== workingStateFingerprint(plannerState)
        ? SAVING
        : storedSaveState;
    return {
      identityReady: prepared,
      hydrated,
      isRegistered,
      isAuthPending: sessionPending,
      plannerState: { ...normalized, selectedSections: sectionPlan.selections },
      sectionPicks: plannerState.selectedSections,
      sectionPlan,
      sectionCatalog: sectionStore.catalog,
      catalogVersion,
      evidenceHundredths: shownEvidenceHundredths,
      candidateFilter,
      loadSections: sectionStore.ensure,
      routeStops: routeStopsOf(scheduleEvents),
      scheduleEvents,
      lockedCourses,
      isLocked: (courseCode: string) => lockedCourses.has(courseCode),
      setCourseStatus: (courseCode, status) => {
        noteEarlyEdit();
        setPlannerState((current) => ({
          ...current,
          courseStatuses: {
            ...current.courseStatuses,
            [courseCode]: status,
          },
          transcriptRecords:
            status === "completed"
              ? (current.transcriptRecords ?? []).map((record) =>
                  record.code === courseCode
                    ? {
                        ...record,
                        prerequisiteSatisfied: true,
                        reviewRequired: false,
                        rationale: record.rationale.includes("Manually marked done in course review.")
                          ? record.rationale
                          : `${record.rationale} Manually marked done in course review.`,
                      }
                    : record,
                )
              : current.transcriptRecords,
          updatedAt: new Date().toISOString(),
        }));
      },
      updateCoursePlan: (update) => {
        noteEarlyEdit();
        setPlannerState((current) => {
          const coursePlan = current.coursePlan ?? { manualCredit: [], autoPlanned: [], lastAuto: null };
          const next = update({ courseStatuses: current.courseStatuses, coursePlan });
          return {
            ...current,
            courseStatuses: next.courseStatuses ?? current.courseStatuses,
            coursePlan: next.coursePlan ?? coursePlan,
            updatedAt: new Date().toISOString(),
          };
        });
      },
      setCoursePlan: (coursePlan) => {
        noteEarlyEdit();
        setPlannerState((current) => ({ ...current, coursePlan, updatedAt: new Date().toISOString() }));
      },
      applyTranscriptRecords: (records) => {
        noteEarlyEdit();
        setPlannerState((current) => {
          const courseStatuses = { ...current.courseStatuses };

          records.forEach((record) => {
            if (record.appliedStatus === "completed") {
              courseStatuses[record.code] = "completed";
              return;
            }

            if (
              record.appliedStatus === "inProgress" &&
              (courseStatuses[record.code] ?? "notTaken") !== "completed"
            ) {
              courseStatuses[record.code] = "inProgress";
            }
          });

          return {
            ...current,
            courseStatuses,
            transcriptRecords: mergeTranscriptRecords(current.transcriptRecords ?? [], records),
            updatedAt: new Date().toISOString(),
          };
        });
      },
      setOptimization: (optimization) => {
        noteEarlyEdit();
        setPlannerState((current) => ({
          ...current,
          optimization,
          selectedSections: releaseResolvedPicks(current),
          updatedAt: new Date().toISOString(),
        }));
        // A goal set from outside the Week rail (a plan restore) brings its weights along.
        setSchedulePreferences((current) => withGoalWeights(current, optimization));
      },
      optimizeSchedule: () => {
        noteEarlyEdit();
        setPlannerState((current) => ({
          ...current,
          selectedSections: releaseResolvedPicks(current),
          updatedAt: new Date().toISOString(),
        }));
      },
      schedulePreferences,
      setSchedulePreferences,
      preferencesReady: hydrated && preferencesFor === identityTag,
      preferencesStorage,
      planEpoch,
      applySchedule: (byCourse, goal) => {
        noteEarlyEdit();
        setPlannerState((current) => {
          const locked = normalizePlannerState(current).lockedSections ?? {};
          // Never move a locked section, even if a stale option asks to; the page checks first.
          if (Object.entries(locked).some(([code, id]) => code in byCourse && byCourse[code] !== id)) {
            return current;
          }
          // Like a hand pick, using an option edits those courses' sections, so a
          // pending Auto run that planned them can no longer be undone.
          // Compare with what the page shows: an Auto-planned course whose
          // recommended section the option keeps is not "changed".
          const shown = sectionPlanRef.current.selections;
          const changed = Object.keys(byCourse).filter((code) => shown[code] !== byCourse[code]);
          return {
            ...current,
            selectedSections: { ...current.selectedSections, ...byCourse },
            optimization: goal ?? current.optimization,
            coursePlan: current.coursePlan && changed.length > 0 ? takeFromAutoRun(current.coursePlan, changed) : current.coursePlan,
            updatedAt: new Date().toISOString(),
          };
        });
      },
      restoreSchedule: ({ sections: restored, goal }) => {
        noteEarlyEdit();
        setPlannerState((current) => ({
          ...current,
          selectedSections: { ...restored },
          optimization: goal,
          updatedAt: new Date().toISOString(),
        }));
      },
      setSectionLock: (courseCode, locked) => {
        noteEarlyEdit();
        setPlannerState((current) => {
          const normalizedCurrent = normalizePlannerState(current);
          // The section the page shows, which may be a recommendation: locking makes it the pick.
          const sectionId = normalizedCurrent.selectedSections[courseCode] ?? sectionPlanRef.current.selections[courseCode];
          const selectedSections = { ...normalizedCurrent.selectedSections };
          const lockedSections = { ...(normalizedCurrent.lockedSections ?? {}) };
          if (locked) {
            if (!sectionId) {
              // The lock control only renders for scheduled sections.
              return current;
            }
            selectedSections[courseCode] = sectionId;
            lockedSections[courseCode] = sectionId;
          } else {
            delete lockedSections[courseCode];
          }
          return {
            ...current,
            selectedSections,
            lockedSections,
            updatedAt: new Date().toISOString(),
          };
        });
      },
      setSection: (courseCode, sectionId) => {
        noteEarlyEdit();
        setPlannerState((current) => ({
          ...current,
          selectedSections: {
            ...current.selectedSections,
            [courseCode]: sectionId,
          },
          // Picking a section by hand for a locked course moves the lock with
          // it: the user's explicit choice is what stays pinned.
          lockedSections:
            current.lockedSections?.[courseCode] !== undefined
              ? { ...current.lockedSections, [courseCode]: sectionId }
              : current.lockedSections,
          // A section picked by hand is an edit to that course, so a pending
          // Auto run that planned it can no longer be undone.
          coursePlan: current.coursePlan ? takeFromAutoRun(current.coursePlan, [courseCode]) : current.coursePlan,
          updatedAt: new Date().toISOString(),
        }));
      },
      setActiveDay: (day) => {
        noteEarlyEdit();
        setPlannerState((current) => ({
          ...current,
          activeDay: day,
          updatedAt: new Date().toISOString(),
        }));
      },
      setSelectedMajor: (id) => {
        noteEarlyEdit();
        setPlannerState((current) => ({
          ...current,
          selectedMajor: id,
          updatedAt: new Date().toISOString(),
        }));
      },
      resetPlanner: () => {
        noteEarlyEdit();
        setPlannerState(getInitialPlannerState());
        // Weights follow the goal: a restore resets first and only re-sets a
        // goal that differs from the default, so the reset must carry the default's.
        setSchedulePreferences((current) => withGoalWeights(current, getInitialPlannerState().optimization));
        bumpPlanEpoch();
      },
      saveState: shownSaveState,
      retrySave,
      guestStorageAvailable,
      syncConflict: syncView.conflict,
      settleSyncConflict,
      clientOutdated: syncProblem === "outdated",
      guestSignIn,
      guestHandover,
      settleGuestHandover,
      settleGuestSignIn,
      prepareSignOut,
      conflict,
      resolveConflict,
      tookNewerVersion,
      dismissNewerVersionNotice: () => setTookNewerVersion(false),
      afterHydration,
      storeNotices,
      transact: <R,>(fn: (current: PlannerState, meta: { runEdits: number }) => PlanTransaction<R>, stamp: PlanStamp) =>
        new Promise<TransactionOutcome<R>>((resolve) => {
          if (!instanceActive.current) {
            resolve({ status: getSavedPlanIdentity() !== userId ? "identity_changed" : "cancelled" });
            return;
          }
          if (!hydrated) {
            mutatedBeforeBootstrap.current = true;
          }
          const id = ++lastTransactionId.current;
          // The reducer's receipt carries fn's result typed as unknown; this resolver is the one that asked for R.
          transactionWaiters.current.set(id, resolve as (outcome: TransactionOutcome<unknown>) => void);
          setPlannerState(new TransactionRequest(id, stamp, fn, new Date().toISOString(), new Set(settledTransactions.current)));
        }),
      planStamp: { identity: transactionIdentity, epoch: planBox.epoch },
    };
  }, [
    afterHydration,
    planBox.epoch,
    transactionIdentity,
    setPlannerState,
    catalogVersion,
    normalizedState,
    sectionPlan,
    shownEvidenceHundredths,
    candidateFilter,
    sectionStore,
    conflict,
    guestStorageAvailable,
    hydrated,
    isRegistered,
    plannerState,
    resolveConflict,
    retrySave,
    saveState,
    savedFingerprint,
    bumpPlanEpoch,
    identityTag,
    userId,
    planEpoch,
    prepared,
    preferencesFor,
    preferencesStorage,
    schedulePreferences,
    syncView,
    syncProblem,
    guestSignIn,
    guestHandover,
    settleGuestHandover,
    settleGuestSignIn,
    settleSyncConflict,
    prepareSignOut,
    setSchedulePreferences,
    sessionPending,
    sessionUnknown,
    storeNotices,
    tookNewerVersion,
  ]);

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner() {
  const value = useContext(PlannerContext);
  if (!value) {
    throw new Error("usePlanner must be used within PlannerProvider");
  }
  return value;
}

/* ---------- Toast ---------- */

type Toast = { id: number; message: string };
type ToastContextValue = { toast: (message: string) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string) => {
    const id = ++idRef.current;
    setToasts((current) => [...current, { id, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 2400);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return value;
}
