/**
 * Step 3 of "The migration" in docs/architecture/README.md: a user's legacy
 * planner_state row becomes an academic record, a schedule named "Main" and
 * preferences, once, in the transaction that records the marker. The legacy
 * write path takes the same user row lock and refuses once the marker exists
 * (persistence.ts), so no legacy write can land after its row has moved.
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { documents, plannerMigrations, plannerStates, schema } from "@/lib/db/schema";
import { defaultSchedulePreferences, normalizePlannerState } from "@/lib/planner";
import { firstDocumentId, INSTITUTION_ID, legacyPlanTerm, splitPlanner, type PlannerBodies, type PlannerKind } from "@/lib/planner-documents";
import { planningTerm } from "@/lib/planner-sections";
import type { PlannerApiPayload, PlannerState } from "@/lib/types";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type MigratedDocument = { [K in PlannerKind]: { documentId: string; kind: K; body: PlannerBodies[K] } }[PlannerKind];

/** A planner_state row as the planner's state, for the legacy route and the migration. */
export function plannerStateFromRow(row: typeof plannerStates.$inferSelect): { state: PlannerApiPayload; revision: number } {
  return {
    revision: row.revision,
    state: {
      courseStatuses: row.courseStatuses as PlannerState["courseStatuses"],
      selectedSections: row.selectedSections as PlannerState["selectedSections"],
      optimization: row.optimization as PlannerState["optimization"],
      activeDay: row.activeDay as PlannerState["activeDay"],
      selectedMajor: row.selectedMajor as PlannerState["selectedMajor"],
      transcriptRecords: row.transcriptRecords as PlannerState["transcriptRecords"],
      lockedSections: row.lockedSections as Record<string, string>,
      coursePlan: (row.coursePlan ?? undefined) as PlannerState["coursePlan"],
      updatedAt: row.updatedAt.toISOString(),
      routeStops: row.routeStops as PlannerApiPayload["routeStops"],
    },
  };
}

/**
 * The documents a legacy plan becomes. The row has no term, so the schedule
 * takes its real picks' term. Preferences lived only in the browser, so they
 * start from the defaults for the row's goal; the first signed-in web client
 * offers the student's own local copy as an ordinary write.
 */
export function legacyDocuments(row: PlannerState): MigratedDocument[] {
  const state = normalizePlannerState(row);
  const termId = legacyPlanTerm(state, planningTerm.id);
  const bodies = splitPlanner(state, defaultSchedulePreferences(state.optimization), termId);
  return [
    { documentId: firstDocumentId["academic-record"], kind: "academic-record", body: bodies["academic-record"] },
    { documentId: firstDocumentId.schedule(termId), kind: "schedule", body: bodies.schedule },
    { documentId: firstDocumentId.preferences, kind: "preferences", body: bodies.preferences },
  ];
}

async function isMigrated(reader: Pick<Database, "select">, userId: string): Promise<boolean> {
  const [marker] = await reader.select({ userId: plannerMigrations.userId }).from(plannerMigrations).where(eq(plannerMigrations.userId, userId));
  return marker !== undefined;
}

/** Call inside a transaction that holds the user row lock. Does nothing after the first time. */
async function migrateLegacyPlanner(tx: Transaction, userId: string): Promise<void> {
  if (await isMigrated(tx, userId)) return;
  const [row] = await tx.select().from(plannerStates).where(eq(plannerStates.userId, userId));
  if (row) {
    for (const document of legacyDocuments(plannerStateFromRow(row).state)) {
      // A document that already exists was written through the sync API, so
      // it is newer than the legacy row; the row never overwrites it.
      await tx.insert(documents)
        .values({ userId, id: document.documentId, kind: document.kind, institutionId: INSTITUTION_ID, revision: 1, body: document.body, deleted: false })
        .onConflictDoNothing();
    }
  }
  await tx.insert(plannerMigrations).values({ userId });
}

/** Migrates in its own transaction, taking the lock only when the marker is missing, so a routine request takes none. */
export async function ensureLegacyMigrated(db: Database, userId: string, lockUser: (tx: Transaction) => Promise<boolean>): Promise<void> {
  if (await isMigrated(db, userId)) return;
  await db.transaction(async (tx) => {
    if (await lockUser(tx)) await migrateLegacyPlanner(tx, userId);
  });
}
