import { describe, expect, test } from "bun:test";
import { normalizePlannerState, getInitialPlannerState } from "@/lib/planner";

describe("harness", () => {
  test("planner module loads through tsconfig paths", () => {
    const state = getInitialPlannerState();
    expect(typeof state.optimization).toBe("string");
    expect(Array.isArray(state.transcriptRecords)).toBe(true);
  });

  test("normalize passes valid optimization through", () => {
    const state = normalizePlannerState({ ...getInitialPlannerState(), optimization: "compact" });
    expect(state.optimization).toBe("compact");
  });
});
