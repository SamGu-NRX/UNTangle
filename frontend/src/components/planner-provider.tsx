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
 * - `saving` — a save is in flight;
 * - `saved` — the write path CONFIRMED durability (server acknowledged a
 *   persisted row, or the guest localStorage write landed);
 * - `not-saved` — storage is unavailable (browser storage denied, or the
 *   deployment has no server storage): edits stay in memory behind a
 *   persistent warning, with an export option;
 * - `failed` — a server 500, dropped connection or expired session; never
 *   shown as `Saved`, and retryable.
 */
export type PlannerSaveStatus = "saving" | "saved" | "not-saved" | "failed";

export type PlannerSaveState = {
  status: PlannerSaveStatus;
  /** Exact contract label: `Saving…` | `Saved` | `Not saved…` | `Saving failed…`. */
  label: string;
  detail: string | null;
  reason: "server" | "network" | "session" | "storage" | null;
};

export type PlannerConflict = {
  /** This tab's unsaved edits. */
  mine: PlannerState;
  /** The newer version another tab stored. */
  theirs: PlannerState | null;
  theirsRevision: number;
  theirsSavedAt: string | null;
};

const SAVE_LABELS: Record<PlannerSaveStatus, string> = {
  saving: "Saving\u2026",
  saved: "Saved",
  "not-saved": "Not saved\u2026",
  failed: "Saving failed\u2026",
};

function initialSaveState(): PlannerSaveState {
  return {
    status: "not-saved",
    label: SAVE_LABELS["not-saved"],
    detail: "Your schedule has not been saved yet.",
    reason: "storage",
  };
}

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
  /** Unresolved cross-tab conflict over the guest's stored schedule. */
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
  const [saveState, setSaveState] = useState<PlannerSaveState>(initialSaveState);
  const [conflict, setConflict] = useState<PlannerConflict | null>(null);
  const [tookNewerVersion, setTookNewerVersion] = useState(false);
  const [storeNotices, setStoreNotices] = useState<Array<{ message: string; quarantinedTo?: string }>>([]);
  const [guestStorageAvailable, setGuestStorageAvailable] = useState(true);
  const [serverPersistent, setServerPersistent] = useState(true);

  const bootstrappedFor = useRef<"guest" | "registered" | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlight = useRef(false);
  // Fingerprint of the last state whose persistence the write path confirmed.
  // `dirty` = the current state's fingerprint differs from this.
  const lastPersistedFingerprint = useRef<string | null>(null);
  // The stored document revision this tab last loaded or wrote (guest store).
  const baseRevision = useRef(0);
  // True when the user mutated before bootstrap finished: bootstrap must not
  // overwrite those edits with fetched/stored state.
  const mutatedBeforeBootstrap = useRef(false);
  const hydratedRef = useRef(false);
  const hydrationWaiters = useRef<Array<() => void>>([]);

  const guestStore = useMemo(() => createPlannerStateStore(), []);
  const isRegistered = Boolean(sessionResult.data?.user);
  const stateRef = useRef(plannerState);
  useEffect(() => {
    stateRef.current = plannerState;
  }, [plannerState]);

  const markSaved = useCallback((fingerprint: string) => {
    lastPersistedFingerprint.current = fingerprint;
    setSaveState({ status: "saved", label: SAVE_LABELS.saved, detail: null, reason: null });
  }, []);

  const afterHydration = useCallback(() => {
    if (hydratedRef.current) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      hydrationWaiters.current.push(resolve);
    });
  }, []);

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
    hydratedRef.current = false;

    startTransition(async () => {
      setHydrated(false);
      if (registered) {
        const loaded = await loadPlannerStateFromServer();
        if (loaded.kind === "loaded") {
          setServerPersistent(loaded.persistent);
          if (loaded.state) {
            // Never overwrite edits the user made before hydration finished:
            // their work is newer than anything being loaded.
            if (!mutatedBeforeBootstrap.current) {
              setPlannerState(loaded.state);
              lastPersistedFingerprint.current = workingStateFingerprint(loaded.state);
            }
          }
          if (loaded.state === null && !mutatedBeforeBootstrap.current) {
            // Nothing server-side yet; the local mirror (if any) is a stale
            // backup of a previous session, so the fresh default stands and
            // will be saved over it.
            lastPersistedFingerprint.current = workingStateFingerprint(stateRef.current);
          }
          if (!mutatedBeforeBootstrap.current) {
            if (loaded.persistent) {
              // The server confirmed a persisted row for this user's plan.
              setSaveState({
                status: "saved",
                label: SAVE_LABELS.saved,
                detail: null,
                reason: null,
              });
            } else {
              // Reachable server but non-persistent storage: the plan is NOT
              // durably saved. Say so honestly instead of claiming Saved.
              setSaveState({
                status: "not-saved",
                label: SAVE_LABELS["not-saved"],
                detail:
                  "Server storage is not persisting schedules right now; your plan stays in this browser until that changes.",
                reason: "storage",
              });
            }
          }
        } else {
          setServerPersistent(false);
          // Server unreachable at load: fall back to this browser's mirror so
          // a returning user does not start from defaults.
          const mirror = guestStore.read();
          if (mirror.ok && mirror.state && !mutatedBeforeBootstrap.current) {
            setPlannerState(mirror.state);
            lastPersistedFingerprint.current = workingStateFingerprint(mirror.state);
          }
          setSaveState({
            status: "not-saved",
            label: SAVE_LABELS["not-saved"],
            detail: loaded.message,
            reason: "server",
          });
        }
      } else {
        const read = guestStore.read();
        if (read.ok) {
          baseRevision.current = read.revision;
          setGuestStorageAvailable(true);
          setStoreNotices(read.notices);
          if (read.state && !mutatedBeforeBootstrap.current) {
            setPlannerState(read.state);
          }
          if (mutatedBeforeBootstrap.current) {
            // The user edited before hydration finished: those edits are NOT
            // persisted yet — null forces the save effect to write them
            // (on top of the stored revision) instead of skipping as an echo.
            lastPersistedFingerprint.current = null;
          } else {
            lastPersistedFingerprint.current = workingStateFingerprint(
              read.state ?? stateRef.current,
            );
          }
          if (read.state && !mutatedBeforeBootstrap.current) {
            // The loaded state survived a previous session: it is durable.
            setSaveState({
              status: "saved",
              label: SAVE_LABELS.saved,
              detail: null,
              reason: null,
            });
          }
        } else {
          setGuestStorageAvailable(false);
          setSaveState({
            status: "not-saved",
            label: SAVE_LABELS["not-saved"],
            detail: read.failure.message,
            reason: "storage",
          });
        }
      }

      hydratedRef.current = true;
      setHydrated(true);
      hydrationWaiters.current.forEach((resolve) => resolve());
      hydrationWaiters.current = [];
    });
  }, [guestStore, sessionResult.data, sessionResult.isPending]);

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
        setConflict({
          mine: state,
          theirs: incoming.state,
          theirsRevision: incoming.revision,
          theirsSavedAt: incoming.savedAt,
        });
        setSaveState({
          status: "not-saved",
          label: SAVE_LABELS["not-saved"],
          detail: "Another tab saved a newer version. Resolve the conflict to continue saving.",
          reason: "storage",
        });
        return;
      }
      if (result.failure.kind === "storageUnavailable" || result.failure.kind === "quotaExceeded") {
        setGuestStorageAvailable(false);
        setSaveState({
          status: "not-saved",
          label: SAVE_LABELS["not-saved"],
          detail: result.failure.message,
          reason: "storage",
        });
      }
    },
    [guestStore, markSaved],
  );

  const persistServer = useCallback(
    async (state: PlannerState) => {
      saveInFlight.current = true;
      setSaveState({
        status: "saving",
        label: SAVE_LABELS.saving,
        detail: null,
        reason: null,
      });
      const outcome = await savePlannerStateToServer(state);
      saveInFlight.current = false;
      if (outcome.kind === "saved") {
        // Best-effort mirror in this browser: a fallback for the next visit
        // if the server cannot be reached at load time.
        guestStore.writeMirror(state);
        markSaved(workingStateFingerprint(state));
      } else if (outcome.kind === "not-saved") {
        setSaveState({
          status: "not-saved",
          label: SAVE_LABELS["not-saved"],
          detail: outcome.message,
          reason: "storage",
        });
      } else {
        setSaveState({
          status: "failed",
          label: SAVE_LABELS.failed,
          detail: outcome.message,
          reason: outcome.reason,
        });
      }
    },
    [guestStore, markSaved],
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
      const fingerprint = workingStateFingerprint(state);
      if (fingerprint === lastPersistedFingerprint.current && !saveInFlight.current) {
        // Nothing semantically new to persist (echo of an acknowledged state).
        return;
      }
      if (conflict) {
        return;
      }
      if (Boolean(sessionResult.data?.user)) {
        void persistServer(state);
      } else {
        persistGuest(state);
      }
    }, 350);

    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [conflict, hydrated, persistGuest, persistServer, plannerState, sessionResult.data]);

  const retrySave = useCallback(() => {
    const state = stateRef.current;
    if (Boolean(sessionResult.data?.user)) {
      void persistServer(state);
    } else {
      persistGuest(state);
    }
  }, [persistGuest, persistServer, sessionResult.data]);

  // Cross-tab subscription (guests): adopt newer versions when clean, raise a
  // conflict when this tab holds unsaved edits.
  useEffect(() => {
    if (!hydrated || isRegistered) {
      return;
    }
    return guestStore.subscribe(() => {
      const read = guestStore.read();
      if (!read.ok || read.revision === baseRevision.current) {
        return;
      }
      const current = stateRef.current;
      const dirty = workingStateFingerprint(current) !== lastPersistedFingerprint.current;
      if (dirty) {
        setConflict({
          mine: current,
          theirs: read.state,
          theirsRevision: read.revision,
          theirsSavedAt: read.savedAt,
        });
      } else if (read.state) {
        // No unsaved edits: take the newer version and say so.
        baseRevision.current = read.revision;
        lastPersistedFingerprint.current = workingStateFingerprint(read.state);
        setPlannerState(read.state);
        setTookNewerVersion(true);
      } else {
        baseRevision.current = read.revision;
      }
    });
  }, [guestStore, hydrated, isRegistered]);

  const resolveConflict = useCallback(
    (resolution: "keep-mine" | "take-theirs") => {
      const current = conflict;
      setConflict(null);
      if (!current) {
        return;
      }
      if (resolution === "take-theirs") {
        if (current.theirs) {
          baseRevision.current = current.theirsRevision;
          lastPersistedFingerprint.current = workingStateFingerprint(current.theirs);
          setPlannerState(current.theirs);
          setSaveState({
            status: "saved",
            label: SAVE_LABELS.saved,
            detail: null,
            reason: null,
          });
        }
        return;
      }
      // Keep my edits: rebase onto the newest stored revision first, so the
      // write lands on top of it instead of being refused as another conflict.
      baseRevision.current = current.theirsRevision;
      persistGuest(current.mine);
    },
    [conflict, persistGuest],
  );

  const value = useMemo<PlannerContextValue>(() => {
    const normalized = normalizePlannerState(plannerState);
    const lockedCourses = new Set<string>(
      courses
        .filter((course) => isCourseLocked(normalized, course.code))
        .map((course) => course.code),
    );
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
      saveState,
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
