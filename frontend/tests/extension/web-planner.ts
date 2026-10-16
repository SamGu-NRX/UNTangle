/**
 * What the signed-in web planner shows for a term, read through its own code:
 * PlannerSync pulls the account's documents into a fresh device store and
 * adopts them, as planner-provider.tsx does on load. The extension tests use
 * it to check that an add lands in the Main Week reads, not in a document
 * only the extension sees.
 */
import { MemoryStore } from "@untangle/sync";
import { defaultSchedulePreferences, getInitialPlannerState, getPlanningTermCourseCodes } from "@/lib/planner";
import { PlannerSync, type PlannerSyncIO } from "@/lib/sync/planner-sync";

export async function webPlannerView(io: PlannerSyncIO, userId: string, termId: string) {
  const initialPlan = getInitialPlannerState();
  const initial = { state: initialPlan, preferences: defaultSchedulePreferences(initialPlan.optimization) };
  const sync = new PlannerSync(new MemoryStore(), userId, termId, io, initial);
  try {
    const outcome = await sync.refresh();
    if (outcome !== "synced") throw new Error(`The web planner couldn't pull the account's documents: ${outcome}`);
    const view = await sync.adopt(() => initial);
    if (!view) throw new Error("The web planner held unsaved edits, so it didn't show the documents.");
    return { planned: getPlanningTermCourseCodes(view.state), picks: view.state.selectedSections };
  } finally {
    sync.close();
  }
}
