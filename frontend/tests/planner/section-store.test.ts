/**
 * Loading real sections in the browser: one request per course, the
 * labeled-sample fallback when the route fails, the provenance tag, and the
 * planner provider resolving a saved real pick after a reload.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { provenanceText, summarizeProvenance } from "@/components/sections-provenance";
import { retryMs } from "@/lib/sections/config";
import { createSectionStore } from "@/lib/section-store";
import type { CourseSections } from "@/lib/sections";
import { courseAs, fixtureCatalog, fixtureInput, renumber } from "../sections/real-term";
import { FakePlannerServer, flushSaves, installDom, mountPlanner, removeDom, setSession, waitFor } from "./test-dom";

const MATH_ID = "vsb:spring-2027:MATH 1680:6862+6863";

/** A loader over the fixture that counts calls and can be told to fail. */
function fixtureLoader(catalog = fixtureCatalog()) {
  const calls: string[] = [];
  let failing = false;
  const load = async (_term: string, courseCode: string): Promise<CourseSections> => {
    calls.push(courseCode);
    if (failing) throw new Error("Sections for spring-2027: HTTP 502");
    const answer = catalog(courseCode);
    if (answer.status !== "ready") throw new Error("fixture loading");
    return answer.result;
  };
  return { load, calls, fail: (value: boolean) => (failing = value) };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the browser's section store", () => {
  test("asks once per course however many views ask, and answers from cache after", async () => {
    const loader = fixtureLoader();
    const store = createSectionStore("spring-2027", loader.load);
    store.ensure(["MATH 1680", "ACCT 5120"]);
    store.ensure(["MATH 1680"]);
    expect(store.catalog("MATH 1680")).toEqual({ status: "loading" });
    await settled();
    store.ensure(["MATH 1680"]);
    expect(loader.calls).toEqual(["MATH 1680", "ACCT 5120"]);
    const math = store.catalog("MATH 1680");
    expect(math.status === "ready" && math.result.sections[0].id).toBe(MATH_ID);
    expect(store.version()).toBe(2);
  });

  test("a failed request falls back to labeled samples without throwing, and is retried later", async () => {
    const loader = fixtureLoader();
    let now = 0;
    const store = createSectionStore("spring-2027", loader.load, () => now);
    loader.fail(true);
    store.ensure(["MATH 1680"]);
    await settled();
    const fallback = store.catalog("MATH 1680");
    expect(fallback.status).toBe("ready");
    if (fallback.status !== "ready") return;
    expect(fallback.result).toMatchObject({
      status: "unavailable",
      availability: "sample",
      provenance: { kind: "sample" },
      diagnostic: { code: "upstream_error", message: "Sections for spring-2027: HTTP 502" },
    });

    loader.fail(false);
    store.ensure(["MATH 1680"]);
    expect(loader.calls).toHaveLength(1); // too soon to ask again
    now += retryMs;
    store.ensure(["MATH 1680"]);
    await settled();
    const real = store.catalog("MATH 1680");
    expect(real.status === "ready" && real.result.provenance.kind).toBe("real");
  });
});

describe("the provenance tag", () => {
  const ready = (code: string) => {
    const answer = fixtureCatalog()(code);
    if (answer.status !== "ready") throw new Error("loading");
    return answer.result;
  };

  test("real sections name the term and vsb's data date", () => {
    const real = summarizeProvenance([ready("MATH 1680"), ready("ACCT 5120")]);
    expect(real).toEqual({ kind: "real", updatedAt: "2026-10-04T19:02:54.758921+00:00", checkedAt: "2026-10-13T19:00:00.000Z" });
    expect(provenanceText(real!)).toBe("Real · Spring 2027 · updated Oct 4");
    expect(provenanceText(real!, true)).toBe("Real · Oct 4");
  });

  test("samples keep the Sample tag, even beside real sections", () => {
    expect(provenanceText(summarizeProvenance([ready("MATH 1680"), ready("MATH 1710")])!, true)).toBe("Sample");
    expect(summarizeProvenance([ready("MATH 1680")], true)).toEqual({ kind: "sample" });
  });

  test("a course vsb lists with no classes is not offered", () => {
    expect(provenanceText(summarizeProvenance([ready("AARS 6810")])!)).toBe("Not offered in Spring 2027");
  });

  test("nothing loaded, nothing to label", () => {
    expect(summarizeProvenance([])).toBeNull();
  });
});

describe("the planner with real sections", () => {
  let previousFetch: typeof fetch;
  const mounted: Array<() => Promise<void>> = [];
  beforeAll(() => {
    installDom();
  });
  afterAll(() => {
    removeDom();
  });
  beforeEach(() => {
    window.localStorage.clear();
    previousFetch = globalThis.fetch;
    globalThis.fetch = new FakePlannerServer().fetch as typeof fetch;
    setSession(null);
  });
  afterEach(async () => {
    while (mounted.length) await mounted.pop()!();
    globalThis.fetch = previousFetch;
  });

  async function mount(catalog = fixtureCatalog()) {
    const planner = await mountPlanner(undefined, createSectionStore("spring-2027", fixtureLoader(catalog).load));
    mounted.push(planner.unmount);
    await planner.get().afterHydration();
    await waitFor(() => planner.get().hydrated, "hydrated");
    return planner;
  }

  test("a planned course loads its options, gets a real recommendation, and a pick survives a reload by id", async () => {
    const first = await mount();
    await first.run((p) => p.setCourseStatus("MATH 1680", "inProgress"));
    await waitFor(() => first.get().sectionPlan.courses[0]?.state === "recommended", "recommended");
    expect(first.get().plannerState.selectedSections).toEqual({ "MATH 1680": MATH_ID });

    await first.run((p) => p.setSectionLock("MATH 1680", true));
    await flushSaves();
    await first.unmount();
    mounted.length = 0;

    // vsb renumbered the option since: the saved pick needs review and is not swapped.
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "MATH 1680", (row) => renumber(row, ["7000", "7001"]));
    const second = await mount(fixtureCatalog(input));
    await waitFor(() => second.get().sectionPlan.courses[0]?.state === "needs-review", "needs review");
    expect(second.get().plannerState.selectedSections).toEqual({ "MATH 1680": MATH_ID });
    expect(second.get().plannerState.lockedSections).toEqual({ "MATH 1680": MATH_ID });
    expect(second.get().scheduleEvents).toEqual([]);
  });

  test("changing the goal re-plans resolved picks but keeps one that needs review", async () => {
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "MATH 1680", (row) => renumber(row, ["7000", "7001"]));
    const planner = await mount(fixtureCatalog(input));
    await planner.run((p) => {
      p.setCourseStatus("MATH 1680", "inProgress");
      p.setSection("MATH 1680", MATH_ID);
    });
    await waitFor(() => planner.get().sectionPlan.courses[0]?.state === "needs-review", "needs review");
    await planner.run((p) => p.setOptimization("clusterNight"));
    expect(planner.get().plannerState.selectedSections).toEqual({ "MATH 1680": MATH_ID });
  });
});
