/** Browse all's run state (components/schedule/run-state.ts): what a stale list keeps, and which replies count. */
import { describe, expect, test } from "bun:test";
import { BROWSE_IDLE, browseReducer, isStale, type BrowseState } from "@/components/schedule/run-state";
import type { EnumerateResult } from "@/lib/optimizer/enumerate";

const listed = (total: number): EnumerateResult => ({ status: "listed", schedules: [], total, totalExact: true, stats: { rankNodes: 0, countNodes: 0, elapsedMs: 0, candidates: {} } });
const run = (state: BrowseState, ...actions: Parameters<typeof browseReducer>[1][]) => actions.reduce(browseReducer, state);

describe("browseReducer", () => {
  test("a reply belongs to the inputs its job started with", () => {
    const state = run(BROWSE_IDLE, { type: "start", id: 1, inputKey: "A" }, { type: "reply", reply: { id: 1, phase: "browse", result: listed(4), settled: true } });
    expect(state).toMatchObject({ status: "done", resultKey: "A" });
    expect(isStale(state, "A")).toBe(false);
    expect(isStale(state, "B")).toBe(true);
  });

  test("a new run keeps the old list, stale, until its own reply; an error keeps it too, and stays an error", () => {
    const shown = run(BROWSE_IDLE, { type: "start", id: 1, inputKey: "A" }, { type: "reply", reply: { id: 1, phase: "browse", result: listed(4), settled: true } });
    const rerun = browseReducer(shown, { type: "start", id: 2, inputKey: "B" });
    expect(rerun).toMatchObject({ status: "running", result: listed(4), resultKey: "A" });
    const failed = browseReducer(rerun, { type: "reply", reply: { id: 2, phase: "error", message: "stopped" } });
    expect(failed).toMatchObject({ status: "error", error: "stopped", result: listed(4), resultKey: "A" });
    // Week searches again only after a list arrived (status done), so this error waits for Try again.
    expect(isStale(failed, "B") && failed.status === "done").toBe(false);
  });

  test("a reply to a job that isn't the newest, or after close, changes nothing", () => {
    const started = run(BROWSE_IDLE, { type: "start", id: 1, inputKey: "A" }, { type: "start", id: 2, inputKey: "B" });
    expect(browseReducer(started, { type: "reply", reply: { id: 1, phase: "browse", result: listed(9), settled: true } })).toBe(started);
    const closed = browseReducer(started, { type: "close" });
    expect(closed).toBe(BROWSE_IDLE);
    expect(browseReducer(closed, { type: "reply", reply: { id: 2, phase: "browse", result: listed(9), settled: true } })).toBe(BROWSE_IDLE);
  });
});
