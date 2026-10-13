import { and, eq, sql } from "drizzle-orm";
import { db, hasDatabaseUrl } from "@/lib/db";
import { plannerStates } from "@/lib/db/schema";
import { normalizePlannerState, serializePlannerPayload } from "@/lib/planner";
import type { PlannerApiPayload, PlannerState } from "@/lib/types";

export type StoredPlannerState = { state: PlannerApiPayload; revision: number };

export type PlannerSaveResult =
  | { kind: "saved"; state: PlannerApiPayload; revision: number }
  /** The row is at a different revision than the save was based on; nothing was written. */
  | { kind: "conflict"; current: StoredPlannerState | null };

export async function loadPlannerState(userId: string): Promise<StoredPlannerState | null> {
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
    revision: plannerState.revision,
    state: {
      courseStatuses: plannerState.courseStatuses as PlannerState["courseStatuses"],
      selectedSections: plannerState.selectedSections as PlannerState["selectedSections"],
      optimization: plannerState.optimization as PlannerState["optimization"],
      activeDay: plannerState.activeDay as PlannerState["activeDay"],
      selectedMajor: plannerState.selectedMajor as PlannerState["selectedMajor"],
      transcriptRecords: plannerState.transcriptRecords as PlannerState["transcriptRecords"],
      lockedSections: plannerState.lockedSections as Record<string, string>,
      coursePlan: (plannerState.coursePlan ?? undefined) as PlannerState["coursePlan"],
      updatedAt: plannerState.updatedAt.toISOString(),
      routeStops: plannerState.routeStops as PlannerApiPayload["routeStops"],
    },
  };
}

/**
 * Compare-and-set write. `baseRevision` is the revision the client last read
 * or wrote (0 = it saw no row). Each branch is one SQL statement, so two
 * concurrent saves from the same base cannot both succeed.
 */
export async function savePlannerState(
  userId: string,
  state: PlannerState,
  baseRevision: number,
): Promise<PlannerSaveResult | null> {
  if (!hasDatabaseUrl) {
    return null;
  }

  const payload = serializePlannerPayload(normalizePlannerState(state));
  const columns = {
    courseStatuses: payload.courseStatuses,
    selectedSections: payload.selectedSections,
    optimization: payload.optimization,
    activeDay: payload.activeDay,
    selectedMajor: payload.selectedMajor,
    transcriptRecords: payload.transcriptRecords,
    lockedSections: payload.lockedSections ?? {},
    coursePlan: payload.coursePlan ?? null,
    routeStops: payload.routeStops,
    updatedAt: new Date(payload.updatedAt),
  };

  const written =
    baseRevision === 0
      ? await db
          .insert(plannerStates)
          .values({ userId, ...columns, revision: 1 })
          .onConflictDoNothing({ target: plannerStates.userId })
          .returning({ revision: plannerStates.revision })
      : await db
          .update(plannerStates)
          .set({ ...columns, revision: sql`${plannerStates.revision} + 1` })
          .where(and(eq(plannerStates.userId, userId), eq(plannerStates.revision, baseRevision)))
          .returning({ revision: plannerStates.revision });

  if (written.length === 1) {
    return { kind: "saved", state: payload, revision: written[0].revision };
  }

  return { kind: "conflict", current: await loadPlannerState(userId) };
}
