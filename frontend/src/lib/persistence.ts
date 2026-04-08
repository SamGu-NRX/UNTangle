import { eq } from "drizzle-orm";
import { db, hasDatabaseUrl } from "@/lib/db";
import { plannerStates } from "@/lib/db/schema";
import { normalizePlannerState, serializePlannerPayload } from "@/lib/planner";
import type { PlannerApiPayload, PlannerState } from "@/lib/types";

export async function loadPlannerState(userId: string): Promise<PlannerApiPayload | null> {
  if (!hasDatabaseUrl) {
    return null;
  }

  const [plannerState] = await db
    .select()
    .from(plannerStates)
    .where(eq(plannerStates.userId, userId))
    .limit(1);

  if (!plannerState) {
    return null;
  }

  return {
    courseStatuses: plannerState.courseStatuses as PlannerState["courseStatuses"],
    selectedSections: plannerState.selectedSections as PlannerState["selectedSections"],
    optimization: plannerState.optimization as PlannerState["optimization"],
    activeDay: plannerState.activeDay as PlannerState["activeDay"],
    selectedMajor: plannerState.selectedMajor as PlannerState["selectedMajor"],
    updatedAt: plannerState.updatedAt.toISOString(),
    routeStops: plannerState.routeStops as PlannerApiPayload["routeStops"],
  };
}

export async function savePlannerState(userId: string, state: PlannerState) {
  if (!hasDatabaseUrl) {
    return null;
  }

  const payload = serializePlannerPayload(normalizePlannerState(state));

  await db
    .insert(plannerStates)
    .values({
      userId,
      courseStatuses: payload.courseStatuses,
      selectedSections: payload.selectedSections,
      optimization: payload.optimization,
      activeDay: payload.activeDay,
      selectedMajor: payload.selectedMajor,
      routeStops: payload.routeStops,
      updatedAt: new Date(payload.updatedAt),
    })
    .onConflictDoUpdate({
      target: plannerStates.userId,
      set: {
        courseStatuses: payload.courseStatuses,
        selectedSections: payload.selectedSections,
        optimization: payload.optimization,
        activeDay: payload.activeDay,
        selectedMajor: payload.selectedMajor,
        routeStops: payload.routeStops,
        updatedAt: new Date(payload.updatedAt),
      },
    });

  return payload;
}
