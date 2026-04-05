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
  normalizePlannerState,
  readPlannerStateFromSessionStorage,
  recommendSections,
  serializePlannerPayload,
  writePlannerStateToSessionStorage,
} from "@/lib/planner";
import { courses } from "@/lib/seed-data";
import type { CourseStatus, MajorId, OptimizationKey, PlannerState, WeekDay } from "@/lib/types";

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
  setOptimization: (optimization: OptimizationKey) => void;
  setSection: (courseCode: string, sectionId: string) => void;
  setActiveDay: (day: WeekDay) => void;
  setSelectedMajor: (id: MajorId | null) => void;
  resetPlanner: () => void;
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const sessionResult = authClient.useSession();
  const [plannerState, setPlannerState] = useState<PlannerState>(getInitialPlannerState());
  const [hydrated, setHydrated] = useState(false);
  const hasBootstrapped = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRegistered = Boolean(sessionResult.data?.user);

  useEffect(() => {
    if (sessionResult.isPending || hasBootstrapped.current) {
      return;
    }

    hasBootstrapped.current = true;
    startTransition(async () => {
      if (sessionResult.data?.user) {
        try {
          const response = await fetch("/api/planner", { cache: "no-store" });
          if (response.ok) {
            const payload = (await response.json()) as { state: PlannerState | null };
            if (payload.state) {
              setPlannerState(normalizePlannerState(payload.state));
            }
          }
        } catch {
          setPlannerState(getInitialPlannerState());
        }
      } else {
        setPlannerState(readPlannerStateFromSessionStorage() ?? getInitialPlannerState());
      }

      setHydrated(true);
    });
  }, [sessionResult.data, sessionResult.isPending]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    saveTimer.current = setTimeout(() => {
      if (sessionResult.data?.user) {
        void fetch("/api/planner", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(plannerState),
        });
      } else {
        writePlannerStateToSessionStorage(plannerState);
      }
    }, 350);

    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [hydrated, plannerState, sessionResult.data]);

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
        setPlannerState((current) => ({
          ...current,
          courseStatuses: {
            ...current.courseStatuses,
            [courseCode]: status,
          },
          updatedAt: new Date().toISOString(),
        }));
      },
      setOptimization: (optimization) => {
        setPlannerState((current) => ({
          ...current,
          optimization,
          selectedSections: recommendSections(optimization, getActiveCourseCodes(current)),
          updatedAt: new Date().toISOString(),
        }));
      },
      setSection: (courseCode, sectionId) => {
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
        setPlannerState((current) => ({
          ...current,
          activeDay: day,
          updatedAt: new Date().toISOString(),
        }));
      },
      setSelectedMajor: (id) => {
        setPlannerState((current) => ({
          ...current,
          selectedMajor: id,
          updatedAt: new Date().toISOString(),
        }));
      },
      resetPlanner: () => {
        setPlannerState(getInitialPlannerState());
      },
    };
  }, [hydrated, isRegistered, plannerState, sessionResult.isPending]);

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
