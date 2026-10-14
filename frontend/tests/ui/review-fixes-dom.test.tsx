import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { click, installDom, mount, press, removeDom } from "./dom";

// Regression tests for the independent review of the foundation (PR #31).

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function act(fn: () => void | Promise<void>) {
  const react = await import("react");
  await react.act(async () => {
    await fn();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("modal layer stack", () => {
  async function mountTwoDialogs() {
    const { Dialog } = await import("@/components/ui/Dialog");
    const { useEffect, useState } = await import("react");
    const controls: { setA?: (open: boolean) => void; setB?: (open: boolean) => void } = {};
    function Harness() {
      const [a, setA] = useState(false);
      const [b, setB] = useState(false);
      // Handed out after render, where the React compiler allows writing outside the component.
      useEffect(() => {
        controls.setA = setA;
        controls.setB = setB;
      }, []);
      return (
        <>
          <button type="button">Page button</button>
          <Dialog open={a} onOpenChange={setA} title="Dialog A">
            <button type="button">Inside A</button>
          </Dialog>
          <Dialog open={b} onOpenChange={setB} title="Dialog B">
            <button type="button">Inside B</button>
          </Dialog>
        </>
      );
    }
    const view = await mount(<Harness />);
    const layer = (title: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(".ui-dialog-layer")).find((el) => el.textContent?.includes(title))!;
    return { view, controls, layer };
  }

  test("closing the lower dialog first keeps the upper one live and the page locked", async () => {
    const { view, controls, layer } = await mountTwoDialogs();
    await act(() => controls.setA!(true));
    await act(() => controls.setB!(true));
    expect(layer("Dialog A").hasAttribute("inert")).toBe(true);
    expect(layer("Dialog B").hasAttribute("inert")).toBe(false);

    await act(() => controls.setA!(false));
    expect(layer("Dialog B").hasAttribute("inert")).toBe(false);
    expect(view.container.hasAttribute("inert")).toBe(true);
    expect(document.documentElement.style.overflow).toBe("hidden");

    await act(() => controls.setB!(false));
    expect(view.container.hasAttribute("inert")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
    await act(() => sleep(200));
    await view.unmount();
  });

  test("closing in the usual order restores everything too", async () => {
    const { view, controls, layer } = await mountTwoDialogs();
    await act(() => controls.setA!(true));
    await act(() => controls.setB!(true));
    await act(() => controls.setB!(false));
    expect(layer("Dialog A").hasAttribute("inert")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("hidden");
    await act(() => controls.setA!(false));
    expect(view.container.hasAttribute("inert")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
    await act(() => sleep(200));
    await view.unmount();
  });
});

describe("Select values and validation", () => {
  const OPTIONS = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ];

  test("an unmatched controlled value is 'nothing selected' on both sides", async () => {
    const { Select } = await import("@/components/ui/Select");
    const view = await mount(<Select label="Pick" options={OPTIONS} value="zzz" onChange={() => {}} />);
    const combo = view.container.querySelector<HTMLElement>('[role="combobox"]')!;
    const native = view.container.querySelector("select")!;
    expect(combo.textContent).toContain("Choose…");
    expect(native.value).toBe("");
    await view.unmount();
  });

  test("required reaches the visible trigger, and a failed check focuses it with a message", async () => {
    const { Select } = await import("@/components/ui/Select");
    const view = await mount(<Select label="Term" options={OPTIONS} value="" onChange={() => {}} required />);
    const combo = view.container.querySelector<HTMLElement>('[role="combobox"]')!;
    const native = view.container.querySelector("select")!;
    expect(combo.getAttribute("aria-required")).toBe("true");
    let valid = true;
    await act(() => {
      valid = native.checkValidity();
    });
    expect(valid).toBe(false);
    expect(combo.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(combo);
    const describedBy = combo.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toBe("Choose an option.");
    await view.unmount();
  });
});

describe("SearchTrigger", () => {
  test("keeps its name when the visible text is hidden by layout CSS, and when compact", async () => {
    const { SearchTrigger } = await import("@/components/ui/SearchField");
    // The "pure" entry skips registering global cleanup hooks from inside a test.
    const { within } = await import("@testing-library/react/pure");
    const style = document.createElement("style");
    style.textContent = ".ui-search-trigger__visible { display: none; }";
    document.head.appendChild(style);
    const view = await mount(
      <>
        <SearchTrigger />
        <SearchTrigger compact />
      </>,
    );
    // The stylesheet really hides the visible text, as the shell's does.
    const visible = view.container.querySelector(".ui-search-trigger__visible")!;
    expect(getComputedStyle(visible).display).toBe("none");
    expect(within(view.container).getAllByRole("button", { name: "Search courses" })).toHaveLength(2);
    style.remove();
    await view.unmount();
  });
});

describe("Segmented", () => {
  test("a disabled selected segment hands the tab stop to an enabled one", async () => {
    const { Segmented } = await import("@/components/ui/Segmented");
    const view = await mount(
      <Segmented
        label="Day"
        value="Fri"
        onValueChange={() => {}}
        options={[
          { value: "Thu", label: "Thu" },
          { value: "Fri", label: "Fri", disabled: true },
        ]}
      />,
    );
    const radios = Array.from(view.container.querySelectorAll<HTMLElement>('[role="radio"]'));
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1]);
    await view.unmount();
  });
});

describe("ViewTabs", () => {
  test("a pending press does not resurface after Back", async () => {
    const { ViewTabs } = await import("@/components/shell/ViewTabs");
    const view = await mount(<ViewTabs lens="courses" />);
    const pill = () => view.container.querySelector<HTMLElement>(".ui-seg__pill")!.style.transform;
    const week = Array.from(view.container.querySelectorAll("a")).find((a) => a.textContent === "Week")!;
    // Pressing Week moves the pill at once; stop the anchor's own navigation.
    week.addEventListener("click", (event) => event.preventDefault());
    await click(week);
    expect(pill()).toBe("translateX(100%)");
    await view.rerender(<ViewTabs lens="week" />); // the route commits
    await view.rerender(<ViewTabs lens="courses" />); // browser Back
    expect(pill()).toBe("translateX(0%)");
    await view.unmount();
  });

  test("a keyboard press moves the pill without animating; a pointer press animates", async () => {
    const { ViewTabs } = await import("@/components/shell/ViewTabs");
    const view = await mount(<ViewTabs lens="courses" />);
    const nav = view.container.querySelector("nav")!;
    const link = (name: string) => Array.from(view.container.querySelectorAll("a")).find((a) => a.textContent === name)!;
    for (const a of view.container.querySelectorAll("a")) a.addEventListener("click", (event) => event.preventDefault());

    // Enter on a link fires a click with detail 0.
    await act(async () => {
      link("Day").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0, button: 0 }));
    });
    expect(nav.hasAttribute("data-instant")).toBe(true);

    await view.rerender(<ViewTabs lens="day" />);
    await act(async () => {
      link("Week").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, button: 0 }));
    });
    expect(nav.hasAttribute("data-instant")).toBe(false);
    await view.unmount();
  });
});

describe("DateInput bounds", () => {
  test("a typed date outside min/max is refused with the limit named", async () => {
    const { DateInput, boundsError } = await import("@/components/ui/DateInput");
    expect(boundsError("2027-01-10", "2027-01-20", "2027-05-07")).toBe("Pick a date from Jan 20, 2027 to May 7, 2027.");
    expect(boundsError("2027-01-10", "2027-01-20")).toBe("Pick a date on or after Jan 20, 2027.");
    expect(boundsError("2027-06-01", undefined, "2027-05-07")).toBe("Pick a date on or before May 7, 2027.");
    expect(boundsError("2027-02-01", "2027-01-20", "2027-05-07")).toBeNull();

    const changes: Array<string | null> = [];
    const view = await mount(
      <DateInput label="First day" value={null} onChange={(v) => changes.push(v)} min="2027-01-20" max="2027-05-07" today="2027-01-13" />,
    );
    const input = view.container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await act(() => setInputValue(input, "1/10/27"));
    await press(input, "Enter");
    expect(changes).toEqual([]);
    expect(view.container.textContent).toContain("Pick a date from Jan 20, 2027 to May 7, 2027.");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    await act(() => setInputValue(input, "2/1/27"));
    await press(input, "Enter");
    expect(changes).toEqual(["2027-02-01"]);
    await view.unmount();
  });
});

describe("BottomSheet", () => {
  test("new detents while open move the sheet to the new resting place", async () => {
    const { BottomSheet } = await import("@/components/ui/BottomSheet");
    const sheetFor = (detents: number[]) => (
      <BottomSheet open onOpenChange={() => {}} title="Details" detents={detents} initialDetent={0}>
        <p>Body</p>
      </BottomSheet>
    );
    // The settle spring runs on animation frames; give it time to land.
    const settle = () => act(() => sleep(1000));
    const view = await mount(sheetFor([100, 300]));
    const sheet = () => document.querySelector<HTMLElement>(".ui-sheet")!;
    try {
      await settle();
      expect(sheet().style.transform).toBe("translate3d(0, 200px, 0)");
      await view.rerender(sheetFor([150, 300]));
      await settle();
      expect(sheet().style.transform).toBe("translate3d(0, 150px, 0)");
    } finally {
      await view.unmount();
    }
  });
});

describe("saved-plan library notifications", () => {
  test("a write in this tab notifies subscribers; other keys' storage events do not", async () => {
    const { createSavedPlanStore, subscribeSavedPlans, SAVED_PLANS_STORE_KEY } = await import("@/lib/saved-plans/store");
    const { getInitialPlannerState } = await import("@/lib/planner");
    localStorage.clear();
    let calls = 0;
    const unsubscribe = subscribeSavedPlans(() => (calls += 1));
    const saved = createSavedPlanStore(localStorage).savePlan({ state: getInitialPlannerState(), name: "Copy" });
    expect(saved.ok).toBe(true);
    expect(calls).toBe(1);

    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    expect(calls).toBe(1);
    window.dispatchEvent(new StorageEvent("storage", { key: SAVED_PLANS_STORE_KEY }));
    expect(calls).toBe(2);

    unsubscribe();
    createSavedPlanStore(localStorage).savePlan({ state: getInitialPlannerState(), name: "Again" });
    expect(calls).toBe(2);
    localStorage.clear();
  });
});
