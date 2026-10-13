/**
 * The state planner-provider keeps for the plan, and the reducer it runs,
 * so that a transaction (planner-provider's `transact`) is checked,
 * applied and acknowledged inside React state rather than beside it.
 *
 * - `epoch` counts plan replacements: setting a whole plan (a load, a
 *   reset, another tab's version) moves it; an update function does not.
 * - `runEdits` counts updates that changed a status or section of a course
 *   in the pending Auto-fill run. The run records only its first hand edit
 *   (`invalidatedBy`); this counter sees every later one, including a change
 *   that is changed back.
 * - `receipts` holds each transaction's outcome in the state that carries
 *   its effect. The provider resolves a transaction only when a committed
 *   state holds its receipt, so a render React discards acknowledges nothing.
 *
 * Pure: React may run a reducer twice (StrictMode) or again on a new base.
 */
import { normalizePlannerState } from "@/lib/planner";
import type { PlannerState } from "@/lib/types";

/** What a transaction expects of the plan: who is signed in ("user:<id>" or "guest") and which plan it is. */
export type PlanStamp = { identity: string; epoch: number };
export type PlanTransaction<R> = { next?: PlannerState; result: R };
export type TransactionOutcome<R> =
  | { status: "committed"; result: R; runEdits: number }
  | { status: "identity_changed" | "plan_replaced" | "cancelled" };

export type PlannerBox = {
  plan: PlannerState;
  epoch: number;
  runEdits: number;
  receipts: ReadonlyArray<{ id: number; outcome: TransactionOutcome<unknown> }>;
};

/** A transaction as a reducer action. A class, so the reducer can tell it from a plan value. */
export class TransactionRequest {
  constructor(
    readonly id: number,
    readonly stamp: PlanStamp,
    readonly fn: (plan: PlannerState, meta: { runEdits: number }) => PlanTransaction<unknown>,
    readonly updatedAt: string,
    /** Receipts already resolved, which this update drops. */
    readonly settled: ReadonlySet<number>,
  ) {}
}

/** Anything setState accepts, or a transaction. */
export type PlannerAction = PlannerState | ((current: PlannerState) => PlannerState) | TransactionRequest;

export const plannerBox = (plan: PlannerState): PlannerBox => ({ plan, epoch: 0, runEdits: 0, receipts: [] });

/** True when `after` changed a status or section of a course the pending Auto-fill run planned. */
export function touchesAutoRun(before: PlannerState, after: PlannerState): boolean {
  const run = after.coursePlan?.lastAuto ?? before.coursePlan?.lastAuto;
  return Boolean(
    run?.changes.some(
      ({ code }) => before.courseStatuses[code] !== after.courseStatuses[code] || before.selectedSections[code] !== after.selectedSections[code],
    ),
  );
}

/** `identity` is the identity of the render running the reducer, so a transaction sees a sign-in the moment React does. */
export function reducePlannerBox(box: PlannerBox, action: PlannerAction, identity: string): PlannerBox {
  if (action instanceof TransactionRequest) {
    const receipts = box.receipts.filter((receipt) => !action.settled.has(receipt.id));
    const refusal = action.stamp.identity !== identity ? "identity_changed" : action.stamp.epoch !== box.epoch ? "plan_replaced" : null;
    if (refusal) return { ...box, receipts: [...receipts, { id: action.id, outcome: { status: refusal } }] };
    const { next, result } = action.fn(normalizePlannerState(box.plan), { runEdits: box.runEdits });
    const plan = next ? { ...next, updatedAt: action.updatedAt } : box.plan;
    const runEdits = box.runEdits + (touchesAutoRun(box.plan, plan) ? 1 : 0);
    return { ...box, plan, runEdits, receipts: [...receipts, { id: action.id, outcome: { status: "committed", result, runEdits } }] };
  }
  const plan = typeof action === "function" ? action(box.plan) : action;
  if (plan === box.plan) return box;
  return {
    ...box,
    plan,
    epoch: typeof action === "function" ? box.epoch : box.epoch + 1,
    runEdits: box.runEdits + (touchesAutoRun(box.plan, plan) ? 1 : 0),
  };
}
