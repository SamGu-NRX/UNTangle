// Failing-first MapClient state tests. These pin the desired behaviors for
// M1-M3: useful empty-day recovery, single-stop messaging, duplicate-stop
// explanation, unavailable-building labeling, and day-tab keyboard navigation.
// At M0 exactly these five fail on the current UI while the populated-day
// sanity test passes; each M1/M2 milestone flips its share of them green.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  duplicateStopMondayPicks,
  multiStopMondayPicks,
  plannerStateFromPicks,
  singleStopMondayPicks,
  unresolvedStopMondayPicks,
  type PickedSection,
} from "./fixtures/map-fixtures";

const noop = () => {};

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: noop,
    replace: noop,
    back: noop,
    forward: noop,
    refresh: noop,
    prefetch: noop,
  }),
  usePathname: () => "/map",
  useSearchParams: () => new URLSearchParams(),
}));

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false, error: null }),
  },
}));

function MapLeafletCanvas(_props: unknown) {
  return <div data-testid="map-canvas-stub" />;
}

mock.module("@/components/map-leaflet-canvas", () => ({
  MapLeafletCanvas,
}));

import { MapClient } from "@/components/map-client";
import { PlannerProvider } from "@/components/planner-provider";

function seedGuestPlanner(picks: PickedSection[]) {
  window.sessionStorage.setItem(
    "untangle-planner-state",
    JSON.stringify(plannerStateFromPicks("Mon", picks)),
  );
}

async function flushAsyncWork(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function renderMapClient() {
  return render(
    <PlannerProvider>
      <MapClient />
    </PlannerProvider>,
  );
}

/*
 * Failing-first client-state tests for /map.
 *
 * The five `testFails` cases describe itinerary behaviors that do not exist
 * yet (M1/M2 will add them). They report green today precisely because the
 * behaviors are missing; when a behavior is implemented, flip its test from
 * `testFails` to `test` — a green test still wrapped in `testFails` fails
 * loudly with the instruction to flip it.
 */
function testFails(name: string, fn: () => Promise<void> | void) {
  test(name, async () => {
    let failed = false;
    try {
      await fn();
    } catch {
      failed = true; // expected while the behavior is missing
    }
    if (!failed) {
      throw new Error(
        `"${name}" now PASSES — the behavior exists. Flip this test from testFails to test and keep the assertions.`,
      );
    }
  });
}

describe("MapClient itinerary states", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.removeItem("untangle-planner-state");
  });

  test("renders the populated Monday itinerary with stop cards", async () => {
    seedGuestPlanner(multiStopMondayPicks());
    renderMapClient();
    await flushAsyncWork();

    const stopItems = document.querySelectorAll(".stop-item");
    expect(stopItems.length).toBe(3);
    expect(screen.getByText("3 stops")).toBeTruthy();
    expect(screen.getByTestId("map-canvas-stub")).toBeTruthy();
  });

  testFails("empty days offer a one-click recovery to the nearest populated day", async () => {
    seedGuestPlanner(multiStopMondayPicks());
    renderMapClient();
    await flushAsyncWork();

    fireEvent.click(screen.getByRole("tab", { name: "Tue" }));
    await flushAsyncWork();

    expect(screen.getByText("No classes scheduled on Tue.")).toBeTruthy();
    const jump = screen.queryByRole("button", { name: /show monday/i });
    expect(jump).toBeTruthy();
    fireEvent.click(jump!);
    await flushAsyncWork();
    expect(screen.getByText("3 stops")).toBeTruthy();
  });

  testFails("single-stop days do not render placeholder dash chips", async () => {
    seedGuestPlanner(singleStopMondayPicks());
    renderMapClient();
    await flushAsyncWork();

    expect(screen.getByText("1 stop")).toBeTruthy();
    const dashes = Array.from(document.querySelectorAll("span")).filter(
      (el) => el.textContent === "-",
    );
    expect(dashes.length).toBe(0);
  });

  testFails("duplicate same-building stops explain the collapsed route", async () => {
    seedGuestPlanner(duplicateStopMondayPicks());
    renderMapClient();
    await flushAsyncWork();

    expect(screen.getByText("3 stops")).toBeTruthy();
    const explanation = screen.queryByText(/same building/i);
    expect(explanation).toBeTruthy();
  });

  testFails("unavailable buildings are labeled with a reason, not a bare lookup chip", async () => {
    seedGuestPlanner(unresolvedStopMondayPicks());
    renderMapClient();
    await flushAsyncWork();

    const stopItems = document.querySelectorAll(".stop-item");
    expect(stopItems.length).toBe(2);
    const lookupOnly = screen.queryByText("lookup");
    expect(lookupOnly).toBeNull();
    expect(screen.getByText(/outside mapped campus/i)).toBeTruthy();
  });

  testFails("day tabs move focus with arrow keys", async () => {
    seedGuestPlanner(multiStopMondayPicks());
    renderMapClient();
    await flushAsyncWork();

    const monTab = screen.getByRole("tab", { name: "Mon" }) as HTMLElement;
    monTab.focus();
    fireEvent.keyDown(monTab, { key: "ArrowRight" });

    const tueTab = screen.getByRole("tab", { name: "Tue" }) as HTMLElement;
    expect(document.activeElement === tueTab).toBe(true);
  });
});
