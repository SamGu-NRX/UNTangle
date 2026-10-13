"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { authClient } from "@/lib/auth-client";
import {
  buildScheduleEvents,
  defaultSchedulePreferences,
  getPlanningTermCourseCodes,
  getInitialPlannerState,
  getLockedSelections,
  isCourseLocked,
  mergeTranscriptRecords,
  normalizePlannerState,
  recommendSections,
  serializePlannerPayload,
  takeFromAutoRun,
} from "@/lib/planner";
import {
  initialPreferences,
  preferencesKey,
  readOrCreateGuestId,
  readStoredPreferences,
  withGoalWeights,
  writeStoredPreferences,
  type WriteOutcome,
} from "@/components/schedule/preferences-store";
import { createPlannerStateStore } from "@/lib/planner-store";
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
import {
  loadPlannerStateFromServer,
  savePlannerStateToServer,
} from "@/lib/planner-save";
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
  WeekDay,
} from "@/lib/types";

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

export type PlannerConflict = {
  /** This tab's unsaved edits. */
  mine: PlannerState;
  /** The newer version another tab or device stored. */
  theirs: PlannerState | null;
  theirsRevision: number;
  theirsSavedAt: string | null;
  /** Where the newer version lives: this browser's guest store, or the server. */
  source: "browser" | "server";
};

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
  hydrated: boolean;
  isRegistered: boolean;
  isAuthPending: boolean;
  plannerState: PlannerState;
  routeStops: ReturnType<typeof serializePlannerPayload>["routeStops"];
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
  setActiveDay: (day: WeekDay) => void;
  setSelectedMajor: (id: MajorId | null) => void;
  resetPlanner: () => void;
  /** Save lifecycle for the durable working schedule (guest store or server). */
  saveState: PlannerSaveState;
  retrySave: () => void;
  /** True when the guest's browser storage is unusable (edits stay in memory). */
  guestStorageAvailable: boolean;
  /** True when the deployment persists registered users' schedules server-side. */
  serverPersistent: boolean;
  /** Unresolved conflict between this tab's edits and a newer stored version. */
  conflict: PlannerConflict | null;
  resolveConflict: (resolution: "keep-mine" | "take-theirs") => void;
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

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const sessionResult = authClient.useSession();
  // The plan lives in a reducer (lib/planner-transaction.ts) so transactions are checked and acknowledged in
  // state. Its dispatch takes everything setState did, so every existing setPlannerState call is unchanged.
  const transactionIdentity = sessionResult.data?.user?.id ? `user:${sessionResult.data.user.id}` : "guest";
  const [planBox, dispatchPlan] = useReducer(
    (box: ReturnType<typeof plannerBox>, numbered: NumberedAction) => reducePlannerBox(box, numbered, transactionIdentity),
    undefined,
    () => plannerBox(getInitialPlannerState()),
  );
  // Numbers every action at dispatch, so a transaction can tell whether the state it gets includes all earlier ones.
  const lastActionSeq = useRef(0);
  const setPlannerState = useCallback((action: PlannerAction) => dispatchPlan({ seq: ++lastActionSeq.current, action }), []);
  const plannerState = planBox.plan;
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<PlannerSaveState>(PENDING);
  // Fingerprint the last `saved` acknowledgement covered. `Saved` is only
  // shown while the on-screen state still has this fingerprint.
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PlannerConflict | null>(null);
  const [tookNewerVersion, setTookNewerVersion] = useState(false);
  const [storeNotices, setStoreNotices] = useState<Array<{ message: string; quarantinedTo?: string }>>([]);
  const [guestStorageAvailable, setGuestStorageAvailable] = useState(true);
  const [serverPersistent, setServerPersistent] = useState(true);
  const [schedulePreferences, setSchedulePreferencesState] = useState<SchedulePreferences>(() =>
    defaultSchedulePreferences(getInitialPlannerState().optimization),
  );
  const [preferencesStorage, setPreferencesStorage] = useState<PreferencesStorage>("stored");
  // The identity whose preferences are loaded ("user:<id>" or "guest"); null before the first read.
  const [preferencesFor, setPreferencesFor] = useState<string | null>(null);
  const [planEpoch, setPlanEpoch] = useState(0);
  const bumpPlanEpoch = useCallback(() => setPlanEpoch((n) => n + 1), []);
  const preferencesRef = useRef(schedulePreferences);
  const preferencesKeyRef = useRef<string | null>(null);
  // Revision of the stored entry this tab last read or wrote (0 for none).
  const preferencesRevision = useRef(0);
  const userId = sessionResult.data?.user?.id ?? null;
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
  const saveInFlight = useRef(false);
  /** Newest state waiting to save after the in-flight server request settles. */
  const pendingServerSave = useRef<{ state: PlannerState } | null>(null);
  // Fingerprint of the state the store is known to hold (last loaded or
  // written). `dirty` = the current state's fingerprint differs from this.
  const lastPersistedFingerprint = useRef<string | null>(null);
  // The stored document revision this tab last loaded or wrote (guest store).
  const baseRevision = useRef(0);
  // The server row revision this tab last loaded or wrote (registered).
  const serverRevision = useRef(0);
  // True between a 401 and the session being restored: no server writes.
  const sessionExpired = useRef(false);
  // True when the 401 hit the load itself: a restore must read the server
  // before anything is written, because this tab never saw the stored plan.
  const serverLoadPending = useRef(false);
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
  useEffect(() => {
    const waiters = transactionWaiters.current;
    return () => {
      waiters.forEach((resolve) => resolve({ status: "cancelled" }));
      waiters.clear();
    };
  }, []);

  const guestStore = useMemo(() => createPlannerStateStore(), []);
  const isRegistered = Boolean(sessionResult.data?.user);
  const stateRef = useRef(plannerState);
  useEffect(() => {
    stateRef.current = plannerState;
  }, [plannerState]);

  // Once the plan for this identity has loaded, read that identity's
  // preferences. Declared after the stateRef sync, so the plan's goal is the
  // loaded one when nothing is stored yet.
  useEffect(() => {
    if (!hydrated) return;
    const storage = browserStorage();
    const guestId = !userId && storage ? readOrCreateGuestId(storage, makeGuestId) : null;
    const key = userId ? preferencesKey({ kind: "user", id: userId }) : guestId ? preferencesKey({ kind: "guest", id: guestId }) : null;
    const read = key && storage ? readStoredPreferences(storage, key) : ({ kind: "unavailable" } as const);
    preferencesKeyRef.current = key;
    preferencesRevision.current = read.kind === "ok" ? read.revision : 0;
    adoptPreferences(initialPreferences(read, stateRef.current.optimization));
    setPreferencesStorage(read.kind === "unavailable" ? "not-stored" : "stored");
    setPreferencesFor(userId ? `user:${userId}` : "guest");
  }, [adoptPreferences, hydrated, userId]);

  const markSaved = useCallback((fingerprint: string) => {
    lastPersistedFingerprint.current = fingerprint;
    setSavedFingerprint(fingerprint);
    setSaveState(saveStateOf("saved"));
  }, []);

  const enterSignedOut = useCallback((detail: string) => {
    const firstNotice = !sessionExpired.current;
    sessionExpired.current = true;
    setSaveState(saveStateOf("signed-out", detail, "session"));
    if (firstNotice) {
      notifySessionExpired();
    }
  }, []);

  const raiseConflict = useCallback((next: PlannerConflict) => {
    conflictRef.current = next;
    setConflict(next);
    setSaveState(saveStateOf("not-saved", CONFLICT_DETAIL, "conflict"));
  }, []);

  const afterHydration = useCallback(() => {
    if (hydratedRef.current) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      hydrationWaiters.current.push(resolve);
    });
  }, []);

  const persistServer = useCallback(
    async (state: PlannerState) => {
      if (saveInFlight.current) {
        // Serialize server saves: hold the newest state and send it when the
        // in-flight request settles. A slower, older response can then never
        // land on the server after (or overwrite) a newer save.
        pendingServerSave.current = { state };
        return;
      }
      saveInFlight.current = true;
      setSaveState(SAVING);
      let generation = sessionGeneration.current;
      try {
        let current = state;
        for (;;) {
          const outcome = await savePlannerStateToServer(current, serverRevision.current);
          if (generation !== sessionGeneration.current) {
            // The signed-in identity changed while this request was in
            // flight: its outcome describes the previous user's plan. Drop
            // it, and send anything the new identity queued meanwhile.
            const queued = pendingServerSave.current;
            if (!queued) {
              return;
            }
            pendingServerSave.current = null;
            generation = sessionGeneration.current;
            current = queued.state;
            setSaveState(SAVING);
            continue;
          }
          if (outcome.kind === "saved") {
            serverRevision.current = outcome.revision;
            // A successful write proves the session is valid again.
            sessionExpired.current = false;
            const writtenFingerprint = workingStateFingerprint(current);
            lastPersistedFingerprint.current = writtenFingerprint;
            // Best-effort mirror in this browser: a fallback for the next
            // visit if the server cannot be reached at load time.
            guestStore.writeMirror(current);
            const pending = pendingServerSave.current;
            if (pending) {
              // Newer edits queued while this request was in flight: this
              // acknowledgement covers an older state, so it is not `Saved`.
              pendingServerSave.current = null;
              current = pending.state;
              setSaveState(SAVING);
              continue;
            }
            if (writtenFingerprint === workingStateFingerprint(stateRef.current)) {
              markSaved(writtenFingerprint);
            } else {
              // An edit landed after the request began but before its save
              // was queued; the debounced save will send it.
              setSaveState(SAVING);
            }
            return;
          }

          pendingServerSave.current = null;
          if (outcome.kind === "conflict") {
            const mine = stateRef.current;
            if (outcome.theirs && workingStateFingerprint(outcome.theirs) === workingStateFingerprint(mine)) {
              // Same content already stored elsewhere: nothing to choose.
              serverRevision.current = outcome.revision;
              markSaved(workingStateFingerprint(mine));
              return;
            }
            raiseConflict({
              mine,
              theirs: outcome.theirs,
              theirsRevision: outcome.revision,
              theirsSavedAt: outcome.savedAt,
              source: "server",
            });
            return;
          }
          if (outcome.kind === "not-saved") {
            setSaveState(saveStateOf("not-saved", outcome.message, "storage"));
            return;
          }
          if (outcome.reason === "session") {
            // Keep the edits in memory and in this browser's mirror; the
            // save is retried once the session is restored.
            guestStore.writeMirror(stateRef.current);
            enterSignedOut(outcome.message);
            return;
          }
          setSaveState(saveStateOf("failed", outcome.message, outcome.reason));
          return;
        }
      } finally {
        saveInFlight.current = false;
      }
    },
    [enterSignedOut, guestStore, markSaved, raiseConflict],
  );

  /**
   * Re-read the server after a load that never completed (401 at load).
   * Nothing is written until the stored plan has been seen: if the user
   * edited meanwhile and the server holds something different, both are
   * shown and the user chooses.
   */
  const reloadFromServer = useCallback(async () => {
    const generation = sessionGeneration.current;
    const loaded = await loadPlannerStateFromServer();
    if (generation !== sessionGeneration.current) {
      return;
    }
    if (loaded.kind === "signed-out") {
      serverLoadPending.current = true;
      enterSignedOut(loaded.message);
      return;
    }
    if (loaded.kind === "unavailable") {
      serverLoadPending.current = true;
      setSaveState(saveStateOf("not-saved", loaded.message, "server"));
      return;
    }
    setServerPersistent(loaded.persistent);
    serverRevision.current = loaded.revision;
    const current = stateRef.current;
    const currentFingerprint = workingStateFingerprint(current);
    const dirty = currentFingerprint !== lastPersistedFingerprint.current;
    if (!loaded.persistent) {
      setSaveState(
        saveStateOf(
          "not-saved",
          "Server storage is not persisting schedules right now; your plan stays in this browser until that changes.",
          "storage",
        ),
      );
      return;
    }
    if (!loaded.state) {
      if (dirty) {
        void persistServer(current);
      } else {
        setSaveState(PENDING);
      }
      return;
    }
    const storedFingerprint = workingStateFingerprint(loaded.state);
    if (storedFingerprint === currentFingerprint) {
      markSaved(storedFingerprint);
      return;
    }
    if (dirty) {
      raiseConflict({
        mine: current,
        theirs: loaded.state,
        theirsRevision: loaded.revision,
        theirsSavedAt: loaded.state.updatedAt,
        source: "server",
      });
      return;
    }
    lastPersistedFingerprint.current = storedFingerprint;
    setPlannerState(loaded.state);
    bumpPlanEpoch();
    setTookNewerVersion(true);
    markSaved(storedFingerprint);
  }, [bumpPlanEpoch, enterSignedOut, markSaved, persistServer, raiseConflict, setPlannerState]);

  const handleSessionRestored = useCallback(() => {
    if (!sessionExpired.current) {
      return;
    }
    sessionExpired.current = false;
    if (serverLoadPending.current) {
      serverLoadPending.current = false;
      void reloadFromServer();
      return;
    }
    const state = stateRef.current;
    const fingerprint = workingStateFingerprint(state);
    if (conflictRef.current) {
      setSaveState(saveStateOf("not-saved", CONFLICT_DETAIL, "conflict"));
      return;
    }
    if (fingerprint !== lastPersistedFingerprint.current) {
      // Retry under the revision rules: the save names the revision this tab
      // last saw, so a newer save made meanwhile surfaces as a conflict.
      void persistServer(state);
      return;
    }
    setSaveState(fingerprint === savedFingerprint ? saveStateOf("saved") : PENDING);
  }, [persistServer, reloadFromServer, savedFingerprint]);

  useEffect(() => onSessionRestored(handleSessionRestored), [handleSessionRestored]);

  // Bootstrap is keyed on who is signed in (the user id, or guest): it runs
  // once per identity, including sign-out followed by sign-in as someone
  // else. Each run gets a new generation; any response that arrives after a
  // newer run started belongs to the previous identity and is dropped.
  useEffect(() => {
    if (sessionResult.isPending) {
      return;
    }
    const userId = sessionResult.data?.user?.id ?? null;
    const registered = userId !== null;
    const needed = registered ? `registered:${userId}` : "guest";
    if (bootstrappedFor.current === needed) {
      return;
    }
    bootstrappedFor.current = needed;
    const generation = ++sessionGeneration.current;
    const isCurrent = () => generation === sessionGeneration.current;
    mutatedBeforeBootstrap.current = false;
    lastPersistedFingerprint.current = null;
    sessionExpired.current = false;
    serverLoadPending.current = false;
    pendingServerSave.current = null;
    serverRevision.current = 0;
    conflictRef.current = null;
    hydratedRef.current = false;

    /**
     * Edits made before hydration finished meet a stored plan that differs:
     * neither side may silently replace the other, so show both. Nothing is
     * written until the user chooses (the save effect waits on a conflict).
     */
    const earlyEditsConflict = (
      stored: PlannerState,
      revision: number,
      savedAt: string | null,
      source: PlannerConflict["source"],
    ) => {
      lastPersistedFingerprint.current = workingStateFingerprint(stored);
      raiseConflict({ mine: stateRef.current, theirs: stored, theirsRevision: revision, theirsSavedAt: savedAt, source });
    };

    startTransition(async () => {
      setHydrated(false);
      setSavedFingerprint(null);
      setConflict(null);
      if (registered) {
        const loaded = await loadPlannerStateFromServer();
        if (!isCurrent()) {
          return;
        }
        const mutated = mutatedBeforeBootstrap.current;
        if (loaded.kind === "loaded") {
          setServerPersistent(loaded.persistent);
          const storedDiffers =
            loaded.state !== null && workingStateFingerprint(loaded.state) !== workingStateFingerprint(stateRef.current);
          if (!loaded.persistent) {
            // Reachable server but non-persistent storage: the plan is NOT
            // durably saved. Say so instead of claiming Saved.
            lastPersistedFingerprint.current = mutated ? null : workingStateFingerprint(stateRef.current);
            setSaveState(
              saveStateOf(
                "not-saved",
                "Server storage is not persisting schedules right now; your plan stays in this browser until that changes.",
                "storage",
              ),
            );
          } else if (loaded.state && mutated && storedDiffers) {
            // The base revision stays 0 until the user chooses, so no save
            // can land on top of the stored plan unseen.
            earlyEditsConflict(loaded.state, loaded.revision, loaded.state.updatedAt, "server");
          } else if (loaded.state) {
            serverRevision.current = loaded.revision;
            if (!mutated) {
              setPlannerState(loaded.state);
            }
            // A stored plan was actually read: that is what Saved means.
            markSaved(workingStateFingerprint(loaded.state));
          } else {
            // Persistent, but no plan stored yet. Early edits (if any) are
            // written by the save effect from base revision 0.
            lastPersistedFingerprint.current = mutated ? null : workingStateFingerprint(stateRef.current);
            setSaveState(PENDING);
          }
        } else if (loaded.kind === "signed-out") {
          // Never claim Saved and never POST a default over a load that did
          // not happen. Show this browser's mirror so the user is not dropped
          // to defaults; the server is re-read once the session is restored.
          serverLoadPending.current = true;
          const mirror = guestStore.read();
          if (mirror.ok && mirror.state && !mutated) {
            setPlannerState(mirror.state);
          }
          lastPersistedFingerprint.current = workingStateFingerprint(
            mirror.ok && mirror.state && !mutated ? mirror.state : stateRef.current,
          );
          enterSignedOut(loaded.message);
        } else {
          setServerPersistent(false);
          // Server unreachable at load: fall back to this browser's mirror so
          // a returning user does not start from defaults. Later saves carry
          // revision 0, so they cannot overwrite a stored row unseen.
          const mirror = guestStore.read();
          if (mirror.ok && mirror.state && !mutated) {
            setPlannerState(mirror.state);
            lastPersistedFingerprint.current = workingStateFingerprint(mirror.state);
          }
          setSaveState(saveStateOf("not-saved", loaded.message, "server"));
        }
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
            earlyEditsConflict(read.state, read.revision, read.savedAt, "browser");
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

      hydratedRef.current = true;
      bumpPlanEpoch();
      setHydrated(true);
      hydrationWaiters.current.forEach((resolve) => resolve());
      hydrationWaiters.current = [];
    });
  }, [bumpPlanEpoch, enterSignedOut, guestStore, markSaved, raiseConflict, sessionResult.data, sessionResult.isPending, setPlannerState]);

  // Local bridge until #19 lands: a new session for the same signed-in user
  // (signing in again in this tab) counts as a restore. Idempotent, so #19's
  // own `onSessionRestored` event firing as well is harmless.
  const sessionId = sessionResult.data?.session?.id ?? null;
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

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    saveTimer.current = setTimeout(() => {
      const state = stateRef.current;
      if (conflictRef.current) {
        return;
      }
      if (Boolean(sessionResult.data?.user)) {
        if (sessionExpired.current) {
          // Signed out: no server writes, but every edit stays in this
          // browser's mirror until the session is restored.
          guestStore.writeMirror(state);
          return;
        }
        if (workingStateFingerprint(state) === lastPersistedFingerprint.current && !saveInFlight.current) {
          // Nothing semantically new to persist (echo of an acknowledged state).
          return;
        }
        void persistServer(state);
      } else {
        if (workingStateFingerprint(state) === lastPersistedFingerprint.current) {
          return;
        }
        persistGuest(state);
      }
    }, 350);

    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [conflict, guestStore, hydrated, persistGuest, persistServer, plannerState, sessionResult.data]);

  // An edit made in the last 350 ms before the page goes away (reload, tab
  // close, full navigation) would never reach the debounced save. Flush it on
  // pagehide: synchronously to the guest store, or as a keepalive request for
  // a signed-in user. The keepalive save still names its base revision, so it
  // cannot overwrite a newer save; its outcome is not observed.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const flush = () => {
      const state = stateRef.current;
      if (conflictRef.current || workingStateFingerprint(state) === lastPersistedFingerprint.current) {
        return;
      }
      if (!sessionResult.data?.user) {
        persistGuest(state);
        return;
      }
      guestStore.writeMirror(state);
      if (sessionExpired.current || saveInFlight.current) {
        return;
      }
      void savePlannerStateToServer(state, serverRevision.current, (input, init) =>
        fetch(input, { ...init, keepalive: true }),
      );
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [guestStore, hydrated, persistGuest, sessionResult.data]);

  const retrySave = useCallback(() => {
    const state = stateRef.current;
    if (Boolean(sessionResult.data?.user)) {
      if (sessionExpired.current) {
        // The user may have signed in again elsewhere (another tab): try the
        // restore path, which re-reads or re-saves under the revision rules.
        handleSessionRestored();
        return;
      }
      void persistServer(state);
    } else {
      persistGuest(state);
    }
  }, [handleSessionRestored, persistGuest, persistServer, sessionResult.data]);

  /**
   * Another tab of this browser stored something (guest store, or the
   * registered user's mirror). Adopt it when this tab is clean; when this tab
   * has unsaved edits, show both and let the user choose.
   */
  const adoptOrConflict = useCallback(
    (incoming: { state: PlannerState; revision: number; savedAt: string | null; source: PlannerConflict["source"] }) => {
      const current = stateRef.current;
      const incomingFingerprint = workingStateFingerprint(incoming.state);
      const dirty = workingStateFingerprint(current) !== lastPersistedFingerprint.current;
      const adoptRevision = () => {
        if (incoming.source === "browser") {
          baseRevision.current = incoming.revision;
        } else {
          serverRevision.current = incoming.revision;
        }
      };
      if (incomingFingerprint === workingStateFingerprint(current)) {
        adoptRevision();
        markSaved(incomingFingerprint);
        return;
      }
      if (dirty || saveInFlight.current) {
        raiseConflict({
          mine: current,
          theirs: incoming.state,
          theirsRevision: incoming.revision,
          theirsSavedAt: incoming.savedAt,
          source: incoming.source,
        });
        return;
      }
      adoptRevision();
      lastPersistedFingerprint.current = incomingFingerprint;
      setPlannerState(incoming.state);
      bumpPlanEpoch();
      setTookNewerVersion(true);
      markSaved(incomingFingerprint);
    },
    [bumpPlanEpoch, markSaved, raiseConflict, setPlannerState],
  );

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    return guestStore.subscribe(() => {
      if (conflictRef.current) {
        return;
      }
      if (!isRegistered) {
        const read = guestStore.read();
        if (!read.ok || read.revision === baseRevision.current) {
          return;
        }
        if (!read.state) {
          baseRevision.current = read.revision;
          return;
        }
        adoptOrConflict({ state: read.state, revision: read.revision, savedAt: read.savedAt, source: "browser" });
        return;
      }
      // Registered: the mirror changed because another tab saved (or is
      // holding edits while signed out). The server is the source of truth,
      // so compare against its revision, not the mirror's.
      if (sessionExpired.current) {
        return;
      }
      const generation = sessionGeneration.current;
      void loadPlannerStateFromServer().then((loaded) => {
        if (generation !== sessionGeneration.current) {
          return;
        }
        if (loaded.kind !== "loaded" || !loaded.state || loaded.revision <= serverRevision.current) {
          return;
        }
        if (conflictRef.current) {
          return;
        }
        adoptOrConflict({
          state: loaded.state,
          revision: loaded.revision,
          savedAt: loaded.state.updatedAt,
          source: "server",
        });
      });
    });
  }, [adoptOrConflict, guestStore, hydrated, isRegistered]);

  const resolveConflict = useCallback(
    (resolution: "keep-mine" | "take-theirs") => {
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
          if (current.source === "browser") {
            baseRevision.current = current.theirsRevision;
          } else {
            serverRevision.current = current.theirsRevision;
            guestStore.writeMirror(current.theirs);
          }
          setPlannerState(current.theirs);
          markSaved(workingStateFingerprint(current.theirs));
        }
        return;
      }
      // Keep my edits: rebase onto the newest stored revision first, so the
      // write lands on top of it instead of being refused as another conflict.
      // The newest local state is saved (it includes edits made while the
      // dialog was open).
      const mine = stateRef.current;
      if (current.source === "browser") {
        baseRevision.current = current.theirsRevision;
        persistGuest(mine);
      } else {
        serverRevision.current = current.theirsRevision;
        void persistServer(mine);
      }
    },
    [bumpPlanEpoch, guestStore, markSaved, persistGuest, persistServer, setPlannerState],
  );

  const value = useMemo<PlannerContextValue>(() => {
    const normalized = normalizePlannerState(plannerState);
    const lockedCourses = new Set<string>(
      courses
        .filter((course) => isCourseLocked(normalized, course.code))
        .map((course) => course.code),
    );
    // `Saved` describes one exact state. If the state on screen has moved on
    // since the acknowledgement, its save is still ahead of it.
    const shownSaveState =
      saveState.status === "saved" && savedFingerprint !== workingStateFingerprint(plannerState)
        ? SAVING
        : saveState;
    return {
      hydrated,
      isRegistered,
      isAuthPending: sessionResult.isPending,
      plannerState: normalized,
      routeStops: serializePlannerPayload(normalized).routeStops,
      scheduleEvents: buildScheduleEvents(normalized),
      lockedCourses,
      isLocked: (courseCode: string) => lockedCourses.has(courseCode),
      setCourseStatus: (courseCode, status) => {
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
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
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
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
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
        setPlannerState((current) => ({ ...current, coursePlan, updatedAt: new Date().toISOString() }));
      },
      applyTranscriptRecords: (records) => {
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
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
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
        setPlannerState((current) => ({
          ...current,
          optimization,
          selectedSections: recommendSections(optimization, getPlanningTermCourseCodes(current), getLockedSelections(normalizePlannerState(current))),
          updatedAt: new Date().toISOString(),
        }));
        // A goal set from outside the Week rail (a plan restore) brings its weights along.
        setSchedulePreferences((current) => withGoalWeights(current, optimization));
      },
      optimizeSchedule: () => {
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
        setPlannerState((current) => ({
          ...current,
          selectedSections: recommendSections(
            current.optimization,
            getPlanningTermCourseCodes(current),
            getLockedSelections(normalizePlannerState(current)),
          ),
          updatedAt: new Date().toISOString(),
        }));
      },
      schedulePreferences,
      setSchedulePreferences,
      preferencesReady: hydrated && preferencesFor === identityTag,
      preferencesStorage,
      planEpoch,
      applySchedule: (byCourse, goal) => {
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
        setPlannerState((current) => {
          const locked = normalizePlannerState(current).lockedSections ?? {};
          // Never move a locked section, even if a stale option asks to; the page checks first.
          if (Object.entries(locked).some(([code, id]) => code in byCourse && byCourse[code] !== id)) {
            return current;
          }
          // Like a hand pick, using an option edits those courses' sections, so a
          // pending Auto run that planned them can no longer be undone.
          // Compare with what the page shows (normalized): an Auto-planned course
          // whose section was filled in by normalization is not "changed".
          const shown = normalizePlannerState(current).selectedSections;
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
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
        setPlannerState((current) => ({
          ...current,
          selectedSections: { ...restored },
          optimization: goal,
          updatedAt: new Date().toISOString(),
        }));
      },
      setSectionLock: (courseCode, locked) => {
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
        setPlannerState((current) => {
          const normalizedCurrent = normalizePlannerState(current);
          const sectionId = normalizedCurrent.selectedSections[courseCode];
          const lockedSections = { ...(normalizedCurrent.lockedSections ?? {}) };
          if (locked) {
            if (!sectionId) {
              // The lock control only renders for scheduled sections.
              return current;
            }
            lockedSections[courseCode] = sectionId;
          } else {
            delete lockedSections[courseCode];
          }
          return {
            ...current,
            selectedSections: normalizedCurrent.selectedSections,
            lockedSections,
            updatedAt: new Date().toISOString(),
          };
        });
      },
      setSection: (courseCode, sectionId) => {
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
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
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
        setPlannerState((current) => ({
          ...current,
          activeDay: day,
          updatedAt: new Date().toISOString(),
        }));
      },
      setSelectedMajor: (id) => {
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
        setPlannerState((current) => ({
          ...current,
          selectedMajor: id,
          updatedAt: new Date().toISOString(),
        }));
      },
      resetPlanner: () => {
        if (!hydrated) {
          mutatedBeforeBootstrap.current = true;
        }
        setPlannerState(getInitialPlannerState());
        // Weights follow the goal: a restore resets first and only re-sets a
        // goal that differs from the default, so the reset must carry the default's.
        setSchedulePreferences((current) => withGoalWeights(current, getInitialPlannerState().optimization));
        bumpPlanEpoch();
      },
      saveState: shownSaveState,
      retrySave,
      guestStorageAvailable,
      serverPersistent,
      conflict,
      resolveConflict,
      tookNewerVersion,
      dismissNewerVersionNotice: () => setTookNewerVersion(false),
      afterHydration,
      storeNotices,
      transact: <R,>(fn: (current: PlannerState, meta: { runEdits: number }) => PlanTransaction<R>, stamp: PlanStamp) =>
        new Promise<TransactionOutcome<R>>((resolve) => {
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
    planEpoch,
    preferencesFor,
    preferencesStorage,
    schedulePreferences,
    serverPersistent,
    setSchedulePreferences,
    sessionResult.isPending,
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
