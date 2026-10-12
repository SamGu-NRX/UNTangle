"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { authClient } from "@/lib/auth-client";
import {
  buildScheduleEvents,
  getActiveCourseCodes,
  getInitialPlannerState,
  isCourseLocked,
  mergeTranscriptRecords,
  normalizePlannerState,
  recommendSections,
  serializePlannerPayload,
} from "@/lib/planner";
import { createPlannerStateStore } from "@/lib/planner-store";
import type { PlannerStoreIncoming } from "@/lib/planner-store";
import {
  loadPlannerStateFromServer,
  savePlannerStateToServer,
} from "@/lib/planner-save";
import { workingStateFingerprint } from "@/lib/saved-plans/restore-adapter";
import { notifySessionExpired, onSessionRestored } from "@/lib/session-events";
import { courses } from "@/lib/seed-data";
import type {
  CourseStatus,
  MajorId,
  OptimizationKey,
  PlannerState,
  TranscriptCourseRecord,
  WeekDay,
} from "@/lib/types";

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
  applyTranscriptRecords: (records: TranscriptCourseRecord[]) => void;
  setOptimization: (optimization: OptimizationKey) => void;
  setSection: (courseCode: string, sectionId: string) => void;
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
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const sessionResult = authClient.useSession();
  const [plannerState, setPlannerState] = useState<PlannerState>(getInitialPlannerState());
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

  const bootstrappedFor = useRef<"guest" | "registered" | null>(null);
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

  const guestStore = useMemo(() => createPlannerStateStore(), []);
  const isRegistered = Boolean(sessionResult.data?.user);
  const stateRef = useRef(plannerState);
  useEffect(() => {
    stateRef.current = plannerState;
  }, [plannerState]);

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
      try {
        let current = state;
        for (;;) {
          const outcome = await savePlannerStateToServer(current, serverRevision.current);
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
    const loaded = await loadPlannerStateFromServer();
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
    setTookNewerVersion(true);
    markSaved(storedFingerprint);
  }, [enterSignedOut, markSaved, persistServer, raiseConflict]);

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

  // Bootstrap is keyed on the registration state: it runs once per session
  // phase (guest → registered → guest re-runs on in-app sign-in/out) so the
  // planner always loads the right stored state for who is signed in.
  useEffect(() => {
    if (sessionResult.isPending) {
      return;
    }
    const registered = Boolean(sessionResult.data?.user);
    const needed = registered ? "registered" : "guest";
    if (bootstrappedFor.current === needed) {
      return;
    }
    bootstrappedFor.current = needed;
    mutatedBeforeBootstrap.current = false;
    lastPersistedFingerprint.current = null;
    sessionExpired.current = false;
    serverLoadPending.current = false;
    pendingServerSave.current = null;
    hydratedRef.current = false;

    startTransition(async () => {
      setHydrated(false);
      setSavedFingerprint(null);
      if (registered) {
        const loaded = await loadPlannerStateFromServer();
        if (loaded.kind === "loaded") {
          setServerPersistent(loaded.persistent);
          serverRevision.current = loaded.revision;
          const mutated = mutatedBeforeBootstrap.current;
          if (loaded.state && !mutated) {
            setPlannerState(loaded.state);
          }
          // Mutated before hydration: null forces the save effect to write
          // those edits on top of the loaded revision.
          lastPersistedFingerprint.current = mutated
            ? null
            : workingStateFingerprint(loaded.state ?? stateRef.current);
          if (!loaded.persistent) {
            // Reachable server but non-persistent storage: the plan is NOT
            // durably saved. Say so instead of claiming Saved.
            setSaveState(
              saveStateOf(
                "not-saved",
                "Server storage is not persisting schedules right now; your plan stays in this browser until that changes.",
                "storage",
              ),
            );
          } else if (loaded.state && !mutated) {
            // A stored plan was actually read: that is what Saved means.
            markSaved(workingStateFingerprint(loaded.state));
          } else {
            // Persistent, but no plan stored yet (or unsaved early edits).
            setSaveState(PENDING);
          }
        } else if (loaded.kind === "signed-out") {
          // Never claim Saved and never POST a default over a load that did
          // not happen. Show this browser's mirror so the user is not dropped
          // to defaults; the server is re-read once the session is restored.
          serverLoadPending.current = true;
          const mirror = guestStore.read();
          if (mirror.ok && mirror.state && !mutatedBeforeBootstrap.current) {
            setPlannerState(mirror.state);
          }
          lastPersistedFingerprint.current = workingStateFingerprint(
            mirror.ok && mirror.state && !mutatedBeforeBootstrap.current ? mirror.state : stateRef.current,
          );
          enterSignedOut(loaded.message);
        } else {
          setServerPersistent(false);
          // Server unreachable at load: fall back to this browser's mirror so
          // a returning user does not start from defaults. Later saves still
          // carry revision 0, so they cannot overwrite a stored row unseen.
          const mirror = guestStore.read();
          if (mirror.ok && mirror.state && !mutatedBeforeBootstrap.current) {
            setPlannerState(mirror.state);
            lastPersistedFingerprint.current = workingStateFingerprint(mirror.state);
          }
          setSaveState(saveStateOf("not-saved", loaded.message, "server"));
        }
      } else {
        const read = guestStore.read();
        if (read.ok) {
          baseRevision.current = read.revision;
          setGuestStorageAvailable(true);
          setStoreNotices(read.notices);
          const mutated = mutatedBeforeBootstrap.current;
          if (read.state && !mutated) {
            setPlannerState(read.state);
          }
          lastPersistedFingerprint.current = mutated
            ? null
            : workingStateFingerprint(read.state ?? stateRef.current);
          if (read.state && !mutated) {
            // The loaded state survived a previous session: it is durable.
            markSaved(workingStateFingerprint(read.state));
          } else {
            setSaveState(PENDING);
          }
        } else {
          setGuestStorageAvailable(false);
          setSaveState(saveStateOf("not-saved", read.failure.message, "storage"));
        }
      }

      hydratedRef.current = true;
      setHydrated(true);
      hydrationWaiters.current.forEach((resolve) => resolve());
      hydrationWaiters.current = [];
    });
  }, [enterSignedOut, guestStore, markSaved, sessionResult.data, sessionResult.isPending]);

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
      setTookNewerVersion(true);
      markSaved(incomingFingerprint);
    },
    [markSaved, raiseConflict],
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
      void loadPlannerStateFromServer().then((loaded) => {
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
    [guestStore, markSaved, persistGuest, persistServer],
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
          selectedSections: recommendSections(optimization, getActiveCourseCodes(current)),
          updatedAt: new Date().toISOString(),
        }));
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
    };
  }, [
    afterHydration,
    conflict,
    guestStorageAvailable,
    hydrated,
    isRegistered,
    plannerState,
    resolveConflict,
    retrySave,
    saveState,
    savedFingerprint,
    serverPersistent,
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
