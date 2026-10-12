/**
 * Save-then-read-back preflight against a real Postgres, through the app's own
 * persistence module. Run from frontend/ with DATABASE_URL set and the
 * migrations applied:
 *
 *   cp ../output/playwright/plans-m6/pg-preflight.ts .m6-pg-preflight.ts && bun .m6-pg-preflight.ts
 *
 * Creates (or reuses) one synthetic user row, then checks: first save lands at
 * revision 1; read-back equals what was saved; a second save from base 0 is a
 * conflict; a save from the current base lands at revision 2; a stale base is
 * refused with the newer row; the stale attempt changed nothing.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loadPlannerState, savePlannerState } from "@/lib/persistence";
import { getInitialPlannerState } from "@/lib/planner";

const userId = "preflight-8";
const results: Array<{ name: string; passed: boolean; detail?: string }> = [];
const check = (name: string, passed: boolean, detail?: string) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}

await db.execute(sql`delete from planner_state where user_id = ${userId}`);
await db.execute(
  sql`insert into "user" (id, name, email) values (${userId}, 'Preflight', 'preflight-8@my.unt.edu') on conflict (id) do nothing`,
);

const first = { ...getInitialPlannerState(), optimization: "compact" as const, activeDay: "Wed" as const };
const saved = await savePlannerState(userId, first, 0);
check("first save lands at revision 1", saved?.kind === "saved" && saved.revision === 1, JSON.stringify(saved && { kind: saved.kind }));

const loaded = await loadPlannerState(userId);
check(
  "read-back equals the saved plan",
  loaded?.revision === 1 &&
    loaded.state.optimization === "compact" &&
    loaded.state.activeDay === "Wed" &&
    JSON.stringify(loaded.state.selectedSections) === JSON.stringify(saved?.kind === "saved" ? saved.state.selectedSections : null),
);

const blindInsert = await savePlannerState(userId, { ...first, optimization: "clusterNight" }, 0);
check("a second save from base 0 is a conflict", blindInsert?.kind === "conflict" && blindInsert.current?.revision === 1);

const second = await savePlannerState(userId, { ...first, optimization: "maximizeProfessor" }, 1);
check("a save from the current base lands at revision 2", second?.kind === "saved" && second.revision === 2);

const stale = await savePlannerState(userId, { ...first, optimization: "clusterMorning" }, 1);
check(
  "a stale base is refused with the newer row",
  stale?.kind === "conflict" && stale.current?.revision === 2 && stale.current.state.optimization === "maximizeProfessor",
);

const after = await loadPlannerState(userId);
check("the refused saves changed nothing", after?.revision === 2 && after.state.optimization === "maximizeProfessor");

await db.execute(sql`delete from planner_state where user_id = ${userId}`);
await db.execute(sql`delete from "user" where id = ${userId}`);
const failed = results.filter((r) => !r.passed);
console.log(`PREFLIGHT ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
