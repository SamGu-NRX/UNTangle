"use client";

import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { authClient } from "@/lib/auth-client";
import {
  buildScheduleEvents,
  getInProgressCourseCodes,
  getInitialPlannerState,
  normalizePlannerState,
  readPlannerStateFromSessionStorage,
  recommendSections,
  serializePlannerPayload,
  writePlannerStateToSessionStorage,
} from "@/lib/planner";
import type { CourseStatus, OptimizationKey, PlannerState, WeekDay } from "@/lib/types";

type PlannerContextValue = {
  hydrated: boolean;
  isRegistered: boolean;
  isAuthPending: boolean;
  plannerState: PlannerState;
  routeStops: ReturnType<typeof serializePlannerPayload>["routeStops"];
  scheduleEvents: ReturnType<typeof buildScheduleEvents>;
  setCourseStatus: (courseCode: string, status: CourseStatus) => void;
  setOptimization: (optimization: OptimizationKey) => void;
  setSection: (courseCode: string, sectionId: string) => void;
  setActiveDay: (day: WeekDay) => void;
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
    return {
      hydrated,
      isRegistered,
      isAuthPending: sessionResult.isPending,
      plannerState: normalized,
      routeStops: serializePlannerPayload(normalized).routeStops,
      scheduleEvents: buildScheduleEvents(normalized),
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
          selectedSections: recommendSections(optimization, getInProgressCourseCodes(current)),
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
