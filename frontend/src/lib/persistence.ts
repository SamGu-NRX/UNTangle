import { and, eq, sql } from "drizzle-orm";
import { db, hasDatabaseUrl } from "@/lib/db";
import { plannerMigrations, plannerStates, users } from "@/lib/db/schema";
import { normalizePlannerState, serializePlannerPayload } from "@/lib/planner";
import { plannerStateFromRow } from "@/lib/document-sync/legacy-migration";
import type { PlannerApiPayload, PlannerState } from "@/lib/types";

export type StoredPlannerState = { state: PlannerApiPayload; revision: number };

export type PlannerSaveResult =
  | { kind: "saved"; state: PlannerApiPayload; revision: number }
  /** The row is at a different revision than the save was based on; nothing was written. */
  | { kind: "conflict"; current: StoredPlannerState | null }
  /** The row has moved into documents, so this client is out of date; nothing was written. */
  | { kind: "upgrade-required" };

type Reader = Pick<typeof db, "select">;

async function readPlannerState(reader: Reader, userId: string): Promise<StoredPlannerState | null> {
  const [row] = await reader.select().from(plannerStates).where(eq(plannerStates.userId, userId)).limit(1);
  return row ? plannerStateFromRow(row) : null;
}

export async function loadPlannerState(userId: string): Promise<StoredPlannerState | null> {
  return hasDatabaseUrl ? readPlannerState(db, userId) : null;
}

/**
 * Compare-and-set write. `baseRevision` is the revision the client last read
 * or wrote (0 = it saw no row).
 *
 * It holds the same user row lock as the document write path, and refuses
 * once the user's row has moved into documents (legacy-migration.ts): a
 * legacy write that landed after the move would be acknowledged and then
 * never read again.
 */
export async function savePlannerState(
  userId: string,
  state: PlannerState,
  baseRevision: number,
  database: typeof db | null = hasDatabaseUrl ? db : null,
): Promise<PlannerSaveResult | null> {
  if (!database) {
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
    // Nothing reads this column back: the client builds its own stops from the sections it loads.
    // The server has none loaded, so these cover synthetic sample picks only.
    routeStops: payload.routeStops,
    updatedAt: new Date(payload.updatedAt),
  };

  return database.transaction(async (tx): Promise<PlannerSaveResult> => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const [migrated] = await tx.select({ userId: plannerMigrations.userId }).from(plannerMigrations).where(eq(plannerMigrations.userId, userId));
    if (migrated) {
      return { kind: "upgrade-required" };
    }
    const written =
      baseRevision === 0
        ? await tx
            .insert(plannerStates)
            .values({ userId, ...columns, revision: 1 })
            .onConflictDoNothing({ target: plannerStates.userId })
            .returning({ revision: plannerStates.revision })
        : await tx
            .update(plannerStates)
            .set({ ...columns, revision: sql`${plannerStates.revision} + 1` })
            .where(and(eq(plannerStates.userId, userId), eq(plannerStates.revision, baseRevision)))
            .returning({ revision: plannerStates.revision });

    if (written.length === 1) {
      return { kind: "saved", state: payload, revision: written[0].revision };
    }
    return { kind: "conflict", current: await readPlannerState(tx, userId) };
  });
}
