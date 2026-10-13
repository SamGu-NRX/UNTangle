/**
 * planner-provider's transact, in the real provider: a transaction is
 * acknowledged only by a committed state that holds its receipt, is
 * refused once another identity is signed in, and never stays open after
 * the provider unmounts. Probes from the Sol review of 65ad03d.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FakePlannerServer, installDom, removeDom, setSession, sleep, waitFor, type PlannerValue } from "../planner/test-dom";
import type { TransactionOutcome } from "@/lib/planner-transaction";
import type { PlannerState, WeekDay } from "@/lib/types";

let previousFetch: typeof fetch;
const unmounts: Array<() => void> = [];
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
  while (unmounts.length) unmounts.pop()!();
  // Let React finish scheduled work before the DOM globals go away.
  await sleep(20);
  globalThis.fetch = previousFetch;
  setSession(null);
});

const day = (to: WeekDay) => (plan: PlannerState) => ({ next: { ...plan, activeDay: to }, result: `${to} committed` });

/** Settles to "open" while the transaction has not been acknowledged. */
const state = <R,>(promise: Promise<TransactionOutcome<R>>) => Promise.race([promise, sleep(50).then(() => "open" as const)]);

/**
 * The real provider in StrictMode. A child suspends while the plan's day is
 * Tuesday and `hold` is set, so a transition that moves to Tuesday cannot
 * commit. `tick` is an update outside the plan that commits on its own.
 */
async function mountStrict() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { PlannerProvider, usePlanner } = await import("@/components/planner-provider");
  let latest: PlannerValue | null = null;
  let tick: () => void = () => {};
  let release = () => {};
  const hold = { promise: new Promise<void>((resolve) => (release = resolve)), active: true };
  // The value as last committed, so every read sees what the page shows.
  function Probe() {
    const value = usePlanner();
    React.useEffect(() => {
      latest = value;
    });
    return null;
  }
  function Day() {
    const { plannerState } = usePlanner();
    if (plannerState.activeDay === "Tue" && hold.active) React.use(hold.promise);
    return <span data-day={plannerState.activeDay} />;
  }
  function Ticker() {
    const [count, setCount] = React.useState(0);
    React.useEffect(() => {
      tick = () => setCount((n) => n + 1);
    }, []);
    return <span data-tick={count} />;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <PlannerProvider>
        <Probe />
        <Ticker />
        <React.Suspense fallback={<span data-day="fallback" />}>
          <Day />
        </React.Suspense>
      </PlannerProvider>
    </React.StrictMode>,
  );
  await waitFor(() => latest !== null, "first render");
  const get = () => latest!;
  await get().afterHydration();
  await waitFor(() => get().hydrated, "hydrated");
  const unmount = () => {
    root.unmount();
    container.remove();
  };
  unmounts.push(unmount);
  return {
    get,
    unmount,
    shownDay: () => container.querySelector("[data-day]")?.getAttribute("data-day"),
    shownTick: () => container.querySelector("[data-tick]")?.getAttribute("data-tick"),
    tick: () => tick(),
    release: () => {
      hold.active = false;
      release();
    },
    startTransition: React.startTransition,
  };
}

describe("transact", () => {
  test("a render React discards acknowledges nothing; the commit that holds the change does", async () => {
    const page = await mountStrict();
    await waitFor(() => page.shownDay() === page.get().plannerState.activeDay, "day shown");
    let pending: Promise<TransactionOutcome<string>> = Promise.resolve({ status: "cancelled" });
    page.startTransition(() => {
      pending = page.get().transact(day("Tue"), page.get().planStamp);
    });
    await sleep(20);
    // An unrelated update commits while the Tuesday render, which ran the transaction, waits on its suspended child.
    const shown = page.shownDay();
    page.tick();
    await waitFor(() => page.shownTick() === "1", "unrelated update committed");
    expect(page.shownDay()).toBe(shown);
    expect(await state(pending)).toBe("open");

    page.release();
    expect(await pending).toMatchObject({ status: "committed", result: "Tue committed" });
    await waitFor(() => page.shownDay() === "Tue", "Tuesday committed");
  });

  test("a call made under one account and processed after a switch to another is refused", async () => {
    setSession({ id: "a", email: "a@my.unt.edu", name: "A" });
    const page = await mountStrict();
    const before = page.get().plannerState.activeDay;
    const pending = page.get().transact(day("Thu"), page.get().planStamp);
    setSession({ id: "b", email: "b@my.unt.edu", name: "B" });
    expect(await pending).toEqual({ status: "identity_changed" });
    expect(page.get().plannerState.activeDay).toBe(before);
  });

  test("a refusal resolves, and an open call is cancelled when the provider unmounts", async () => {
    const page = await mountStrict();
    const stale = { ...page.get().planStamp, epoch: page.get().planStamp.epoch - 1 };
    expect(await page.get().transact(day("Fri"), stale)).toEqual({ status: "plan_replaced" });
    const refused = page.get().transact(day("Fri"), stale);
    page.unmount();
    expect(await state(refused)).toEqual({ status: "cancelled" });
  });
});
