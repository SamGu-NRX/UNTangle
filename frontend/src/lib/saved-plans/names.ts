import { MAIN_SCHEDULE_NAME } from "@/lib/planner-documents";
import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";

/**
 * Saved-copy names. The list, Compare and "Use in Main" tell schedules apart
 * only by name (PR #62 review), so a new name may be neither "Main", the
 * working schedule's, nor one another copy already has, archived copies
 * included. Names compare trimmed and in any letter case. Copies saved
 * before this rule keep their names: only a new save, rename, duplicate or
 * import is checked.
 */

/** How two names are compared: "Main " and "main" are the same name. */
export const nameKey = (name: string) => name.trim().toLowerCase();

const RESERVED = nameKey(MAIN_SCHEDULE_NAME);

export type NameClash = { kind: "reserved" } | { kind: "taken"; name: string; archived: boolean };

/** Why `name` can't be used for a new or renamed copy, or null when it can. `planId` is the copy being renamed, whose own name doesn't count. */
export function nameClash(name: string, plans: readonly SavedPlanSnapshot[], planId?: string): NameClash | null {
  const key = nameKey(name);
  if (key === RESERVED) return { kind: "reserved" };
  const other = plans.find((plan) => plan.planId !== planId && nameKey(plan.name) === key);
  return other ? { kind: "taken", name: other.name, archived: Boolean(other.archivedAt) } : null;
}

/** The inline message for a refused name. */
export function clashMessage(clash: NameClash): string {
  if (clash.kind === "reserved") return `${MAIN_SCHEDULE_NAME} is your plan. Name this copy something else.`;
  return `You already have ${clash.archived ? "an archived copy" : "a copy"} called ${clash.name}.`;
}

/**
 * `base` when it is free, else `base 2`, `base 3` and so on: how a name
 * nobody typed (a blank save's "Copy of Main", an imported file's, one the
 * app keeps on sign-in) avoids a clash instead of being refused.
 */
export function freeName(base: string, taken: readonly string[]): string {
  const used = new Set([RESERVED, ...taken.map(nameKey)]);
  const trimmed = base.trim();
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? trimmed : `${trimmed} ${n}`;
    if (!used.has(nameKey(name))) return name;
  }
}
