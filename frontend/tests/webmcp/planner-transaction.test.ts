/**
 * The plan reducer's count of included actions, applied the way React
 * applies a hook's queue: in dispatch order, with some actions skipped in
 * one render and the whole queue re-applied from the base in a later one.
 */
import { describe, expect, test } from "bun:test";
import { getInitialPlannerState } from "@/lib/planner";
import { plannerBox, reducePlannerBox, TransactionRequest, type NumberedAction, type PlannerBox } from "@/lib/planner-transaction";
import type { PlannerState, WeekDay } from "@/lib/types";

const IDENTITY = "guest";
const base = plannerBox(getInitialPlannerState());
const stamp = { identity: IDENTITY, epoch: 0 };

const day = (seq: number, to: WeekDay): NumberedAction => ({ seq, action: (plan: PlannerState) => ({ ...plan, activeDay: to }) });
const tx = (seq: number): NumberedAction => ({
  seq,
  action: new TransactionRequest(seq, stamp, (plan) => ({ next: { ...plan, selectedMajor: "math" }, result: `saw ${plan.activeDay}` }), "2026-10-13T00:00:00.000Z", new Set()),
});
const run = (actions: NumberedAction[], from: PlannerBox = base) => actions.reduce((box, action) => reducePlannerBox(box, action, IDENTITY), from);
const receipt = (box: PlannerBox, id: number) => box.receipts.find((r) => r.id === id)?.outcome;

describe("the count of included actions", () => {
  test("every included action adds one, ordinary or transaction", () => {
    const box = run([day(1, "Mon"), tx(2), day(3, "Wed")]);
    expect(box.applied).toBe(3);
    expect(receipt(box, 2)).toMatchObject({ status: "committed", result: "saw Mon" });
  });

  test("an ordinary action after a skipped one does not hide the gap", () => {
    // 1 included, 2 skipped (a waiting transition), 3 ordinary, then transaction 4.
    const box = run([day(1, "Mon"), day(3, "Wed"), tx(4)]);
    expect(box.applied).toBe(2);
    expect(receipt(box, 4)).toBeUndefined();
    expect(box.plan.selectedMajor).not.toBe("math");
  });

  test("a deferred transaction adds nothing, and a later one defers behind it", () => {
    const box = run([day(1, "Mon"), tx(3), tx(4)]);
    expect(box.applied).toBe(1);
    expect(box.receipts).toEqual([]);
  });

  test("re-applied from the base with the skipped action in place, each transaction acts once and counts", () => {
    const skipped = run([day(1, "Mon"), day(3, "Wed"), tx(4), tx(5)]);
    expect(skipped.receipts).toEqual([]);
    const rebased = run([day(1, "Mon"), day(2, "Tue"), day(3, "Wed"), tx(4), tx(5)]);
    expect(rebased.applied).toBe(5);
    expect(receipt(rebased, 4)).toMatchObject({ status: "committed", result: "saw Wed" });
    expect(receipt(rebased, 5)).toMatchObject({ status: "committed", result: "saw Wed" });
  });
});
