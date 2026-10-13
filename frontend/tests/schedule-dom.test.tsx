/**
 * The Week view's panels through the DOM: what a stale result, an unknown
 * walk and an option's meetings look like to a user and a screen reader,
 * and what the rail's controls change. Review findings Sol 1, 5, 6, 7, 8,
 * 10 and Astra 7.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { click, installDom, mount, removeDom } from "./ui/dom";
import type { RunState } from "@/components/schedule/run-state";
import { sampleOption } from "@/lib/planner-sections";
import type { OptimizeResult } from "@/lib/optimizer/types";
import type { SchedulePreferences } from "@/lib/types";

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

const FIVE = ["ANTH 1010", "BIOL 1710", "ENGL 1310", "MATH 1710", "PSYC 1630"];
const findSample = (_: string, id: string) => sampleOption(id);

async function realResult(): Promise<OptimizeResult> {
  const { buildOptimizeRequest, defaultSchedulePreferences, getInitialPlannerState } = await import("@/lib/planner");
  const { optimize } = await import("@/lib/optimizer/optimize");
  const initial = getInitialPlannerState();
  const state = {
    ...initial,
    courseStatuses: { ...initial.courseStatuses, ...Object.fromEntries(FIVE.map((c) => [c, "inProgress" as const])) },
    selectedSections: {},
  };
  return optimize(buildOptimizeRequest(state, defaultSchedulePreferences("compact")));
}

const shownState = (result: OptimizeResult, status: RunState["status"] = "done"): RunState => ({
  id: 1,
  inputKey: "k",
  status,
  result,
  resultKey: "k",
  error: null,
});

async function renderAlternatives(state: RunState, stale: boolean) {
  const { AlternativesCompare } = await import("@/components/schedule/AlternativesCompare");
  const used: string[] = [];
  const view = await mount(
    <AlternativesCompare
      state={state}
      stale={stale}
      current={{}}
      find={findSample}
      tag={null}
      courseOrder={FIVE}
      onUse={(_, letter) => used.push(letter)}
      onPreview={() => {}}
      onRelax={() => used.push("relax")}
      onClose={() => {}}
      onRetry={() => {}}
    />,
  );
  return { view, used };
}

// ui Button draws its label twice (idle and loading stacks); the first stack is the visible label.
const label = (b: HTMLButtonElement) => b.querySelector(".ui-btn__label")?.textContent ?? b.textContent ?? "";
const buttonsNamed = (root: Element, pattern: RegExp) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>("button")).filter((b) => pattern.test(label(b)));

describe("AlternativesCompare", () => {
  test("Sol 1: a stale result keeps its cards but nothing in it can be used", async () => {
    const result = await realResult();
    const fresh = await renderAlternatives(shownState(result), false);
    const use = buttonsNamed(fresh.view.container, /^Use option/);
    expect(use.length).toBe(3);
    expect(use.every((b) => !b.disabled)).toBe(true);
    await fresh.view.unmount();

    const stale = await renderAlternatives(shownState(result), true);
    const staleUse = buttonsNamed(stale.view.container, /^Use option/);
    expect(staleUse.every((b) => b.disabled)).toBe(true);
    await click(staleUse[0]);
    expect(stale.used).toEqual([]);
    expect(stale.view.container.textContent).toContain("Your settings changed after these were found.");
    await stale.view.unmount();
  });

  test("Sol 1: stale relax suggestions are disabled too", async () => {
    const infeasible: OptimizeResult = {
      status: "infeasible",
      schedules: [],
      stats: { nodes: 0, elapsedMs: 0, candidates: {}, minDifferentCourses: 1 },
      explanation: {
        members: [{ kind: "maxCredits" }],
        minimal: true,
        sentence: "These courses need more than 9 credits.",
        suggestions: [{ relaxation: { kind: "maxCredits", to: 24 }, label: "Allow 24 credits", resolves: true }],
      },
    };
    const { view, used } = await renderAlternatives(shownState(infeasible), true);
    const allow = buttonsNamed(view.container, /^Allow 24 credits$/)[0];
    expect(allow.disabled).toBe(true);
    await click(allow);
    expect(used).toEqual([]);
    await view.unmount();
  });

  test("Sol 5: an unknown walk is labelled and never shown as fitting", async () => {
    const result = await realResult();
    if (result.status !== "optimal") throw new Error(`expected optimal, got ${result.status}`);
    const withUnknown: OptimizeResult = {
      ...result,
      schedules: result.schedules.map((s, i) => (i === 0 ? { ...s, breakdown: { ...s.breakdown, unknownWalks: 2 } } : s)),
    };
    const { view } = await renderAlternatives(shownState(withUnknown), false);
    const first = view.container.querySelector('article[aria-label="Option A"]')!;
    const terms = Array.from(first.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(terms).toContain("Walk time unknown");
    expect(first.textContent).toContain("2 walks");
    expect(view.container.textContent).toContain("Each counts as 10 minutes, an estimate, so the break may not be enough.");
    expect(view.container.textContent).not.toMatch(/fits the break/i);
    const second = view.container.querySelector('article[aria-label="Option B"]')!;
    expect(Array.from(second.querySelectorAll("dt")).map((dt) => dt.textContent)).not.toContain("Walk time unknown");
    await view.unmount();
  });

  test("Sol 6: every option lists its classes, days and times for screen readers", async () => {
    const result = await realResult();
    const { view } = await renderAlternatives(shownState(result), false);
    for (const letter of ["A", "B", "C"]) {
      const list = view.container.querySelector(`ul[aria-label="Option ${letter} classes"]`)!;
      const items = Array.from(list.querySelectorAll("li")).map((li) => li.textContent ?? "");
      expect(items).toHaveLength(FIVE.length);
      expect(items[0]).toMatch(/^ANTH 1010 section \d{3}: (Mon|Tue|Wed|Thu|Fri)( (Mon|Tue|Wed|Thu|Fri))* \d{1,2}:\d{2} [AP]M to \d{1,2}:\d{2} [AP]M/);
    }
    await view.unmount();
  });

  test("feasible while refining reads Best so far; when settled, best within the time limit", async () => {
    const result = await realResult();
    const unproven = { ...result, status: "feasible" as const };
    const refining = await renderAlternatives(shownState(unproven, "refining"), false);
    expect(refining.view.container.textContent).toContain("Best so far. Still searching for better ones.");
    await refining.view.unmount();
    const done = await renderAlternatives(shownState(unproven, "done"), false);
    expect(done.view.container.textContent).toContain("Best found within the time limit; a better one may exist.");
    await done.view.unmount();
  });

  test("Astra 7: the one-course fallback is stated", async () => {
    const result = await realResult();
    const fallback = { ...result, stats: { ...result.stats, minDifferentCourses: 1 } };
    const { view } = await renderAlternatives(shownState(fallback), false);
    expect(view.container.textContent).toContain("Only one course has other times, so these differ in one course.");
    await view.unmount();
  });

  test("Sol 4: a failed run shows the error with a way to try again", async () => {
    const { view } = await renderAlternatives({ ...shownState(await realResult()), result: null, status: "error", error: "boom" }, false);
    const alert = view.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Optimizing stopped before it finished: boom");
    expect(buttonsNamed(alert, /^Try again$/)).toHaveLength(1);
    await view.unmount();
  });
});

describe("ConstraintRail", () => {
  async function renderRail(initial: SchedulePreferences) {
    const { ConstraintRail } = await import("@/components/schedule/ConstraintRail");
    let prefs = initial;
    const ui = () => (
      <ConstraintRail
        preferences={prefs}
        onChange={(update) => {
          prefs = update(prefs);
        }}
        onOptimize={() => {}}
        running={false}
        dirty
        disabled={false}
        storage="stored"
      />
    );
    const view = await mount(ui());
    return { view, get: () => prefs, refresh: () => view.rerender(ui()) };
  }

  test("Sol 7: the Short walks chip patches only the walking weight", async () => {
    const { defaultSchedulePreferences } = await import("@/lib/planner");
    const base = defaultSchedulePreferences("compact");
    const tuned = { ...base, weights: { ...base.weights, rating: 2, mornings: 1 } };
    const rail = await renderRail(tuned);
    const chip = buttonsNamed(rail.view.container, /^Short walks$/)[0];
    await click(chip);
    expect(rail.get().weights).toEqual({ ...tuned.weights, walking: 4 });
    await rail.view.unmount();
  });

  test("Sol 8: clearing a time disables Block time and says what is missing", async () => {
    const { defaultSchedulePreferences } = await import("@/lib/planner");
    const { act } = await import("react");
    const rail = await renderRail(defaultSchedulePreferences("compact"));
    const block = buttonsNamed(rail.view.container, /^Block time$/)[0];
    expect(block.disabled).toBe(false);
    const from = Array.from(rail.view.container.querySelectorAll<HTMLInputElement>('input[type="time"]'))[0];
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(from, "");
      from.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(block.disabled).toBe(true);
    // The message sits under the field it is about, tied to it for screen readers.
    expect(from.getAttribute("aria-invalid")).toBe("true");
    const described = (from.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain("Enter when the blocked time starts.");
    await rail.view.unmount();
  });

  test("Sol 10: a 24-credit cap shows as 24, not as a missing value", async () => {
    const { defaultSchedulePreferences } = await import("@/lib/planner");
    const base = defaultSchedulePreferences("compact");
    const rail = await renderRail({ ...base, constraints: { ...base.constraints, maxCredits: 24 } });
    const combos = Array.from(rail.view.container.querySelectorAll<HTMLElement>('[role="combobox"]'));
    const credits = combos.find((c) => /24/.test(c.textContent ?? ""));
    expect(credits).toBeDefined();
    await rail.view.unmount();
  });
});
