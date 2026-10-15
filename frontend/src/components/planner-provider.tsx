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
import { planningTerm, type SectionCatalog } from "@/lib/planner-sections";
import { createSectionStore, type SectionStore } from "@/lib/section-store";
import {
  initialPreferences,
  preferencesKey,
  readOrCreateGuestId,
  readStoredPreferences,
  withGoalWeights,
  writeStoredPreferences,
  type WriteOutcome,
} from "@/components/schedule/preferences-store";
import { clearPlannerIdentity, createPlannerStateStore } from "@/lib/planner-store";
import { clearSavedPlansIdentity, getSavedPlanIdentity, setSavedPlanIdentity, subscribeSavedPlans } from "@/lib/saved-plans/store";
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
  settleSyncConflict: (choice: SyncConflictChoice) => Promise<void>;
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
    .then((store) => new SyncEngine(store, { kind: "user", id: userId }, httpSyncIO()).clearLocalData({ discardPending: false }))
    .catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith("Unsynced changes")) return;
      console.error("Couldn't delete the signed-out account's documents from this browser", error);
    });
}

/** The name a schedule kept from a conflict gets in Schedules. */
function keptCopyName(now: Date): string {
  return `Kept from this device, ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
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
      return state("not-saved", status, "This schedule changed somewhere else too. Choose which version to keep.", "conflict");
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
  const [syncView, setSyncView] = useState<{ status: SyncStatus | null; conflict: SyncConflict | null; unsynced: boolean }>({
    status: null,
    conflict: null,
    unsynced: false,
  });
  const [syncProblem, setSyncProblem] = useState<"offline" | "signed-out" | "outdated" | "storage" | null>(null);
  const [schedulePreferences, setSchedulePreferencesState] = useState<SchedulePreferences>(() =>
    defaultSchedulePreferences(getInitialPlannerState().optimization),
  );
  const [preferencesStorage, setPreferencesStorage] = useState<PreferencesStorage>("stored");
  const { openSeatsOnly, otherSites } = schedulePreferences.constraints;
  const sectionPlan = useMemo(
    () => resolveSectionPlan(normalizedState, sectionStore.catalog, { openSeatsOnly, otherSites }),
    // catalogVersion is how the catalog says it has more loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalizedState, sectionStore, catalogVersion, openSeatsOnly, otherSites],
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

  const legacyKeySettled = useRef(false);
  const runSyncRef = useRef<((operation: (sync: PlannerSync) => Promise<unknown>) => Promise<void>) | null>(null);
  /**
   * Runs one operation on the account's documents, then shows what they
   * hold (unless this tab has edits still to save) and the state they're in.
   * An unconfirmed write is tried again after 2 seconds, doubling to a minute.
   */
  const runSync = useCallback(
    async (operation: (sync: PlannerSync) => Promise<unknown>) => {
      const sync = syncRef.current;
      if (!sync) return;
      try {
        const outcome = await operation(sync);
        if (outcome === "unavailable") setSyncProblem("offline");
        else if (outcome === "synced") setSyncProblem(null);
        else if (outcome === "signed-out") {
          setSyncProblem("signed-out");
          announceSessionExpired();
        }
        const view = await sync.adopt(readPlanner);
        if (syncRef.current !== sync) return;
        if (view) showDocuments(view, hydratedRef.current);
        if (outcome === "synced" && !legacyKeySettled.current) {
          // The ownerless pre-#77 planner key is settled against the account's plan once it has been read:
          // kept for the account only when it equals that plan, quarantined otherwise (planner-store.ts).
          legacyKeySettled.current = true;
          localStoreRef.current.migrateLegacy(stateRef.current);
        }
        const next = await sync.status(readPlanner);
        if (syncRef.current !== sync) return;
        setSyncView(next);
        setSavedFingerprint(workingStateFingerprint(stateRef.current));
        if (next.status === "Needs sign-in") announceSessionExpired();
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = null;
        if (next.status === "Save not confirmed (retrying)") {
          const delay = retryDelay.current;
          retryDelay.current = Math.min(delay * 2, 60_000);
          retryTimer.current = setTimeout(() => void runSyncRef.current?.((current) => current.drain()), delay);
        } else {
          retryDelay.current = 2000;
        }
      } catch (error) {
        if (syncRef.current !== sync) return;
        if (error instanceof ClientOutdatedError) {
          // Stop: nothing this copy writes may drop what it couldn't read.
          syncRef.current = null;
          setSyncProblem("outdated");
          return;
        }
        console.error("Syncing your schedule failed", error);
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
    setSyncProblem(null);
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
          sync = new PlannerSync(await documentStore(), userId, planningTerm.id, httpSyncIO(), {
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
        // Part 2 settles this browser's guest work against the account here, before the account's
        // documents are shown (docs/architecture/guest-sync.md). Until then guest stores are left alone.
        // What this device already holds shows at once, before the network answers.
        let stored = false;
        await runSync(async (current) => {
          stored = (await current.status(readPlanner)).status !== null;
        });
        if (!isCurrent()) return;
        if (stored) finishHydration();
        await runSync((current) => current.refresh());
        if (!isCurrent()) return;
        // Step 4 of the migration: settings this browser kept for this account (#77 keys them by account)
        // are offered once, as an ordinary preferences write.
        const storage = browserStorage();
        const key = preferencesKey({ kind: "user", id: userId });
        const local = storage ? readStoredPreferences(storage, key) : null;
        if (storage && local?.kind === "ok" && syncRef.current === sync) {
          adoptPreferences(local.preferences);
          await runSync((current) => current.save(readPlanner));
          if (!isCurrent()) return;
          storage.removeItem(key);
          void runSync((current) => current.drain());
        }
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
    await runSync((sync) => sync.save(readPlanner));
    await runSync((sync) => sync.drain());
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
    async (choice: SyncConflictChoice) => {
      const sync = syncRef.current;
      if (!sync || !syncConflictRef.current) return;
      // Other edits are saved first, so taking the latest of one document can't drop them.
      await saveDocuments();
      const { conflict: open } = await sync.status(readPlanner);
      if (!open || syncRef.current !== sync) return;
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
          return;
        }
        toast(`Kept your version in Schedules as "${kept.value.name}"`);
        settle = { kind: "use-latest" };
      }
      await runSync(async (current) => showDocuments(await current.resolve(open, settle, readPlanner), false));
      await runSync((current) => current.drain());
    },
    [readPlanner, runSync, saveDocuments, showDocuments],
  );

  const prepareSignOut = useCallback(async () => {
    const sync = syncRef.current;
    if (!sync) return { unsynced: false, forget: async () => {} };
    // A stalled request must not hold the sign-out: after a few seconds the student is asked instead.
    // 4 seconds is an unmeasured starting value.
    let stop = () => {};
    await Promise.race([saveDocuments(), new Promise<void>((resolve) => { const timer = setTimeout(resolve, 4000); stop = () => clearTimeout(timer); })]);
    stop();
    const { unsynced } = await sync.status(readPlanner);
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
