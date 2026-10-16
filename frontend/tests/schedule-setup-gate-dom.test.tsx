/**
 * Set up Auto's gate through the real planner and Week page: a new guest's
 * first visit opens it, the first answer (which saves preferences) leaves it
 * open, Escape records it as seen for that guest id, and the next visit
 * doesn't open it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { GUEST_ID_KEY, PREFERENCES_PREFIX } from "@/components/schedule/preferences-store";
import { setupSeenKey } from "@/components/schedule/setup-store";
import { installDom, mountPlanner, removeDom, setSession, waitFor } from "./planner/test-dom";

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnvironment: boolean | undefined;
beforeAll(() => {
  installDom();
  setSession(null);
  previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  window.localStorage.clear();
  setSession(null);
});
afterEach(async () => {
  const { dismissToast } = await import("@/components/ui/Toast");
  await act(async () => {
    dismissToast();
  });
  window.localStorage.clear();
});
afterAll(() => {
  removeDom();
  if (previousActEnvironment === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
  else environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch: async () => {} };
const shell = { openSearch() {}, setSearchProvider() {}, pageState: new Map<string, unknown>() };
/** The setup's dialog: the one holding its progress bar. */
const setup = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => d.querySelector('[role="progressbar"][aria-label="Setup progress"]'));

async function openWeek() {
  const { WeekPage } = await import("@/app/schedule/week-page");
  const { ShellContext } = await import("@/components/shell/shell-context");
  const planner = await mountPlanner(() => (
    <AppRouterContext.Provider value={router}>
      <ShellContext.Provider value={shell}>
        <WeekPage hostId="untangle" query={null} week={null} />
      </ShellContext.Provider>
    </AppRouterContext.Provider>
  ));
  await planner.get().afterHydration();
  return planner;
}

test("a new guest gets the setup once; answering keeps it open; Escape marks this guest seen", async () => {
  const first = await openWeek();
  try {
    await waitFor(() => Boolean(setup()), "the setup opens on a new guest's first visit");
    const guestId = window.localStorage.getItem(GUEST_ID_KEY)!;
    expect(guestId).toBeTruthy();

    const answer = [...setup()!.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent?.trim() === "No preference")!;
    await act(async () => answer.click());
    // The answer is saved as preferences for this guest, and that doesn't close the setup.
    expect(window.localStorage.getItem(`${PREFERENCES_PREFIX}guest:${guestId}`)).not.toBeNull();
    expect(setup()).toBeTruthy();

    await act(async () => {
      setup()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(window.localStorage.getItem(setupSeenKey({ kind: "guest", id: guestId }))).not.toBeNull();
  } finally {
    await first.unmount();
  }
  // Drop the saved preferences, so only the seen flag can keep the setup closed next time.
  const guestId = window.localStorage.getItem(GUEST_ID_KEY)!;
  window.localStorage.removeItem(`${PREFERENCES_PREFIX}guest:${guestId}`);

  const again = await openWeek();
  try {
    // Give it every chance to open: preferences are ready and the page has settled.
    await act(async () => {
      await Bun.sleep(50);
    });
    expect(again.get().preferencesReady).toBe(true);
    expect(setup()).toBeUndefined();
  } finally {
    await again.unmount();
  }
});
