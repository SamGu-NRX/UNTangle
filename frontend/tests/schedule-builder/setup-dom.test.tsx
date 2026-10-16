/**
 * Set up Auto through the DOM: when Week opens it by itself, which
 * preference fields each step writes, what Skip puts back, and how closing
 * marks it seen, offers Undo and runs Auto.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { useState } from "react";
import type { BuilderHost, OptionsFeed, WeekCourse } from "@/components/schedule-builder/host";
import type { SetupClose } from "@/components/schedule-builder/SetupAuto";
import type { SchedulePreferences } from "@/lib/types";
import { click, installDom, mount, press, removeDom } from "../ui/dom";
import { meeting, section } from "./fixtures";

beforeAll(() => {
  installDom();
});
afterEach(async () => {
  const { dismissToast } = await import("@/components/ui/Toast");
  dismissToast();
});
afterAll(async () => {
  // Let the dialogs' exit timers and React's last scheduled work finish while the DOM still exists.
  await new Promise((resolve) => setTimeout(resolve, 300));
  removeDom();
});

/** A new student's preferences: the app's defaults for its default goal (mornings 4, compact 1). */
const START: SchedulePreferences = {
  constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walkingBufferMinutes: 0, excludedSections: [], openSeatsOnly: false, otherSites: false },
  weights: { fewerDays: 0, compact: 1, mornings: 4, evenings: 0, walking: 0, rating: 0 },
};

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby]');
const named = (root: ParentNode, selector: string, name: string) =>
  [...root.querySelectorAll<HTMLElement>(selector)].find((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim() === name);
const button = (name: string, root: ParentNode = document) => {
  const found = named(root, "button", name);
  if (!found) throw new Error(`No button named "${name}"`);
  return found as HTMLButtonElement;
};
const radio = (name: string) => {
  const found = named(dialog()!, '[role="radio"]', name);
  if (!found) throw new Error(`No answer "${name}"`);
  return found;
};
const heading = () => dialog()!.querySelector("h2")!.textContent;

/* ───────── The setup on its own, with preferences held the way the host holds them ───────── */

let latest: SchedulePreferences = START;

async function renderSetup(mode: "first" | "again" = "first", initial = START, canBuild = true) {
  const { SetupAuto } = await import("@/components/schedule-builder/SetupAuto");
  const onClose = mock((how: SetupClose) => void how);
  latest = initial;
  let n = 0;
  function Harness() {
    const [p, setP] = useState(initial);
    return (
      <SetupAuto
        open
        mode={mode}
        preferences={p}
        onChange={(update) => setP((q) => (latest = update(q)))}
        newId={() => `busy-${(n += 1)}`}
        canBuild={canBuild}
        phone={false}
        touch={false}
        onClose={onClose}
      />
    );
  }
  const view = await mount(<Harness />);
  return { view, onClose };
}

describe("Set up Auto, step by step", () => {
  test("each answer writes the field its Preferences card writes, the moment it is picked", async () => {
    const { view } = await renderSetup();
    expect(heading()).toBe("When do you like your classes?");
    // Nothing is checked on a first run, so Continue waits for an answer.
    expect(dialog()!.querySelectorAll('[aria-checked="true"]')).toHaveLength(0);
    expect(button("Continue").disabled).toBe(true);

    await click(radio("Mornings, if they fit"));
    expect(latest.weights).toMatchObject({ mornings: 2, evenings: 0 });
    expect(button("Continue").disabled).toBe(false);
    await click(radio("As late as I can"));
    expect(latest.weights).toMatchObject({ mornings: 0, evenings: 4 });
    await click(button("Continue"));

    expect(heading()).toBe("How much do fewer days on campus matter?");
    await click(radio("A lot"));
    expect(latest.weights.fewerDays).toBe(3);
    await click(button("Continue"));

    expect(heading()).toBe("How much do short walks between classes matter?");
    await click(radio("More than anything"));
    expect(latest.weights.walking).toBe(4);
    await click(button("Continue"));

    expect(heading()).toBe("How much do well\u2011rated instructors matter?");
    await click(radio("Some"));
    expect(latest.weights.rating).toBe(2);
    await click(button("Continue"));

    // Shape of your days: the Preferences grid writes the hard limits, the slider the short-gaps leaning.
    expect(heading()).toBe("When can you have class?");
    await click(button("Thursdays off"));
    expect(latest.constraints.daysOff).toEqual(["Thu"]);
    const sun = named(dialog()!, '[role="slider"]', "Earliest class start")!;
    await press(sun, "PageDown");
    expect(latest.constraints.earliestStart).toBe(600);
    const gaps = dialog()!.querySelector<HTMLElement>('.ui-slider [role="slider"]')!;
    await press(gaps, "ArrowRight");
    expect(latest.weights.compact).toBe(2);
    await click(button("Continue"));

    // Ready shows the result as Preferences will: leaning cards and the limits, one fact per row.
    expect(heading()).toBe("What Auto will follow");
    const text = dialog()!.textContent!;
    expect(text).toContain("Thursdays off");
    expect(text).toContain("No class before 10 AM");
    expect(button("Change Fewer days on campus, now A lot")).toBeTruthy();
    expect(latest).toEqual({
      constraints: { ...START.constraints, daysOff: ["Thu"], earliestStart: 600 },
      weights: { mornings: 0, evenings: 4, fewerDays: 3, walking: 4, rating: 2, compact: 2 },
    });
    await view.unmount();
  });

  test("Skip puts back exactly what the step had when the setup opened", async () => {
    // An older saved preference with both time weights set must survive a skipped time question.
    const both: SchedulePreferences = { ...START, weights: { ...START.weights, mornings: 3, evenings: 1 } };
    const { view } = await renderSetup("first", both);
    await click(radio("As late as I can"));
    expect(latest.weights).toMatchObject({ mornings: 0, evenings: 4 });
    await click(button("Skip this question"));
    expect(latest.weights).toMatchObject({ mornings: 3, evenings: 1 });

    for (let i = 0; i < 3; i++) await click(button("Skip this question"));
    expect(heading()).toBe("When can you have class?");
    await click(button("Mondays off"));
    await press(dialog()!.querySelector<HTMLElement>('.ui-slider [role="slider"]')!, "ArrowRight");
    expect(latest.constraints.daysOff).toEqual(["Mon"]);
    await click(button("Skip this step"));
    expect(latest).toEqual(both);
    expect(heading()).toBe("What Auto will follow");
    // A skipped step reads as passed, not answered.
    expect(dialog()!.querySelectorAll('[role="progressbar"] i[data-state="skipped"]')).toHaveLength(5);
    await view.unmount();
  });

  test("Back keeps the answer; Ready's card goes straight to its question", async () => {
    const { view } = await renderSetup();
    await click(radio("No preference"));
    await click(button("Continue"));
    await click(button("Back"));
    expect(heading()).toBe("When do you like your classes?");
    expect(radio("No preference").getAttribute("aria-checked")).toBe("true");
    for (const name of ["Continue", "Skip this question", "Skip this question", "Skip this question", "Continue"]) await click(button(name));
    await click(button("Change Short walks, now Doesn't matter"));
    expect(heading()).toBe("How much do short walks between classes matter?");
    await view.unmount();
  });

  test("opened again from Preferences, each question shows the answer Auto follows now", async () => {
    const { view } = await renderSetup("again", { ...START, weights: { ...START.weights, mornings: 0, evenings: 2 } });
    expect(radio("Afternoons, if they fit").getAttribute("aria-checked")).toBe("true");
    expect(button("Continue").disabled).toBe(false);
    await view.unmount();
  });

  test("Enter on the checked answer continues; arrows move the answer", async () => {
    const { view } = await renderSetup();
    await click(radio("No preference"));
    await press(radio("No preference"), "ArrowDown");
    expect(radio("Afternoons, if they fit").getAttribute("aria-checked")).toBe("true");
    expect(latest.weights).toMatchObject({ mornings: 0, evenings: 2 });
    await press(radio("Afternoons, if they fit"), "Enter");
    expect(heading()).toBe("How much do fewer days on campus matter?");
    await view.unmount();
  });

  test("Ready finishes with Build my week when there is a course, Done when there is none", async () => {
    for (const [canBuild, label] of [
      [true, "Build my week"],
      [false, "Done"],
    ] as const) {
      const { view, onClose } = await renderSetup("first", START, canBuild);
      for (const name of ["Skip this question", "Skip this question", "Skip this question", "Skip this question", "Skip this step"]) await click(button(name));
      await click(button(label));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onClose.mock.calls[0][0]).toMatchObject({ finished: true, before: START });
      await view.unmount();
    }
  });
});

/* ───────── Week: when it opens, and what closing does ───────── */

const csce = section({ courseCode: "CSCE 2110", sectionCode: "001", open: 12, meetings: (["Mon", "Wed", "Fri"] as const).map((day) => meeting({ day, at: "9:00", until: "9:50", building: "gab" })) });
const course: WeekCourse = { code: "CSCE 2110", title: "CSCE 2110", credits: 3, section: csce, state: "placed", locked: false };

function weekHost(setup: BuilderHost["setup"], courses: WeekCourse[] = [course]) {
  const optimizer: OptionsFeed = { runId: null, status: "idle", options: [], stale: false, infeasible: null, error: null, explain: () => [], run: mock(() => {}), close: mock(() => {}) };
  const host = {
    brand: { id: "untangle", primaryLabel: "Auto", primaryShort: "Auto", suggestions: false },
    term: { id: "spring-2027", label: "Spring 2027" },
    courses,
    provenance: "real",
    preferences: START,
    defaults: START,
    setPreferences: mock((update: (p: SchedulePreferences) => SchedulePreferences) => {
      host.preferences = update(host.preferences);
    }),
    preferencesReady: true,
    setup,
    walk: () => null,
    search: { find: () => [], suggestions: () => [], options: () => [csce], load: () => {}, classNumber: async () => null },
    edits: { place: mock(() => {}), remove: mock(() => {}), keep: mock(() => {}), use: mock(() => {}), clear: mock(() => {}), undo: mock(() => {}), canUndo: false },
    optimizer,
    find: () => csce,
    printHref: "/schedule/print",
    shareUrl: (encoded: string) => `http://localhost/schedule?week=${encoded}`,
  } satisfies BuilderHost as BuilderHost;
  return { host, optimizer };
}

async function renderWeek(host: BuilderHost) {
  const { ScheduleBuilder } = await import("@/components/schedule-builder/ScheduleBuilder");
  const { Toaster } = await import("@/components/ui/Toast");
  const node = () => (
    <>
      <ScheduleBuilder host={host} scheduleName="Main" searchRequest={null} shared={null} onSharedSeen={() => {}} />
      <Toaster />
    </>
  );
  const view = await mount(node());
  return { ...view, refresh: () => view.rerender(node()) };
}

const toastText = () => document.querySelector(".ui-toast__message")?.textContent ?? "";

describe("Set up Auto on Week", () => {
  test("opens by itself when the host says it is due, and not otherwise", async () => {
    const due = await renderWeek(weekHost({ due: true, markSeen: () => {} }).host);
    expect(dialog()?.textContent).toContain("When do you like your classes?");
    await due.unmount();

    const seen = await renderWeek(weekHost({ due: false, markSeen: () => {} }).host);
    expect(dialog()).toBeNull();
    await seen.unmount();

    // The standalone builder has no setup, and its Preferences offers none.
    const none = await renderWeek(weekHost(null).host);
    expect(dialog()).toBeNull();
    await click(button("Preferences"));
    expect(named(document, "button", "Set up Auto")).toBeUndefined();
    await none.unmount();
  });

  test("closing without answering marks it seen and offers it again", async () => {
    const markSeen = mock(() => {});
    const { host } = weekHost({ due: true, markSeen });
    const view = await renderWeek(host);
    await press(dialog()!, "Escape");
    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(toastText()).toContain("Skipped setup");
    expect(host.setPreferences).not.toHaveBeenCalled();
    await click(button("Show setup again", document.querySelector(".ui-toast")!));
    expect(dialog()?.textContent).toContain("When do you like your classes?");
    await view.unmount();
  });

  test("finishing runs Auto, keeps the answers, and Undo puts the preferences back", async () => {
    const markSeen = mock(() => {});
    const { host, optimizer } = weekHost({ due: true, markSeen });
    const view = await renderWeek(host);
    await click(radio("Mornings, if they fit"));
    await view.refresh();
    await click(button("Continue"));
    for (const name of ["Skip this question", "Skip this question", "Skip this question", "Skip this step"]) {
      await click(button(name));
      await view.refresh();
    }
    expect(host.preferences.weights).toMatchObject({ mornings: 2, evenings: 0 });
    await click(button("Build my week"));
    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(optimizer.run).toHaveBeenCalledTimes(1);
    expect(toastText()).toContain("Saved your answers to Preferences");
    await click(button("Undo", document.querySelector(".ui-toast")!));
    expect(host.preferences).toEqual(START);
    // The replaced toast leaves (150ms) before the new one shows.
    const { act } = await import("react");
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(toastText()).toBe("Your preferences are back to how they were");
    await view.unmount();
  });

  test("a preference changed after the setup retires its Undo, so Undo can't wipe that change", async () => {
    const { host } = weekHost({ due: true, markSeen: () => {} }, []);
    const view = await renderWeek(host);
    await click(radio("No preference"));
    await view.refresh();
    for (const name of ["Continue", "Skip this question", "Skip this question", "Skip this question", "Skip this step"]) {
      await click(button(name));
      await view.refresh();
    }
    await click(button("Done"));
    expect(toastText()).toBe("Saved your answers to Preferences");
    host.setPreferences((p) => ({ ...p, weights: { ...p.weights, rating: 4 } }));
    await view.refresh();
    const { act } = await import("react");
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(toastText()).toBe("");
    await view.unmount();
  });

  test("an answer changed with the arrow keys doesn't animate", async () => {
    const { view } = await renderSetup();
    const group = dialog()!.querySelector('[role="radiogroup"]')!;
    await click(radio("No preference"));
    await press(radio("No preference"), "ArrowUp");
    expect(group.hasAttribute("data-instant")).toBe(true);
    // Arrows wrap, and Home and End reach the ends.
    await press(radio("Mornings, if they fit"), "End");
    expect(radio("As late as I can").getAttribute("aria-checked")).toBe("true");
    await press(radio("As late as I can"), "ArrowDown");
    expect(radio("As early as I can").getAttribute("aria-checked")).toBe("true");
    await view.unmount();
  });

  test("it waits for a later visit when Preferences or Export opened before preferences loaded", async () => {
    for (const opener of ["Preferences", "Export"]) {
      const { host } = weekHost({ due: true, markSeen: () => {} });
      host.preferencesReady = false;
      const view = await renderWeek(host);
      await click(button(opener));
      host.preferencesReady = true;
      await view.refresh();
      // Only the setup has this progress bar; Export's own dialog doesn't count.
      expect(document.querySelector('[role="progressbar"][aria-label="Setup progress"]') !== null).toBe(false);
      await view.unmount();
    }
  });

  test("Preferences reopens it with the answers Auto follows now", async () => {
    const view = await renderWeek(weekHost({ due: false, markSeen: () => {} }).host);
    await click(button("Preferences"));
    await click(button("Set up Auto"));
    expect(radio("As early as I can").getAttribute("aria-checked")).toBe("true");
    await view.unmount();
  });
});
