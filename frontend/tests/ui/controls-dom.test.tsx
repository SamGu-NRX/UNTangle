import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { click, installDom, mount, press, removeDom } from "./dom";

// Behaviour through the DOM the user drives: roles, names, keys, values.

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

const OPTIONS = [
  { value: "all", label: "All instructors", meta: "14 sections" },
  { value: "okafor", label: "R. Okafor", meta: "4 sections" },
  { value: "delgado", label: "M. Delgado", disabled: true },
  { value: "whitfield", label: "S. Whitfield", meta: "2 sections" },
];

const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]');
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

describe("Select", () => {
  test("is a custom combobox with a hidden value carrier, never a visible native select", async () => {
    const { Select } = await import("@/components/ui/Select");
    const view = await mount(<Select label="Instructor" options={OPTIONS} defaultValue="okafor" />);
    const combo = view.container.querySelector<HTMLElement>('[role="combobox"]')!;
    expect(combo.tagName).toBe("BUTTON");
    expect(combo.getAttribute("aria-labelledby")).toBe(view.container.querySelector("label")!.id);
    expect(combo.textContent).toContain("R. Okafor");
    const native = view.container.querySelector("select")!;
    expect(native.hidden).toBe(true);
    expect(native.getAttribute("aria-hidden")).toBe("true");
    expect(native.tabIndex).toBe(-1);
    await view.unmount();
  });

  test("keyboard: ↓ opens on the selected option with a check, arrows skip disabled, Enter picks", async () => {
    const { Select } = await import("@/components/ui/Select");
    const picks: string[] = [];
    const view = await mount(
      <Select label="Instructor" options={OPTIONS} defaultValue="okafor" onValueChange={(v) => picks.push(v)} />,
    );
    const combo = view.container.querySelector<HTMLElement>('[role="combobox"]')!;
    combo.focus();
    await press(combo, "ArrowDown");
    expect(combo.getAttribute("aria-expanded")).toBe("true");
    expect(listbox()).not.toBeNull();

    const selected = options().find((o) => o.getAttribute("aria-selected") === "true")!;
    expect(selected.textContent).toContain("R. Okafor");
    expect(selected.querySelector(".ui-option__check")).not.toBeNull();
    expect(combo.getAttribute("aria-activedescendant")).toBe(selected.id);

    await press(combo, "ArrowDown"); // skips disabled M. Delgado
    expect(document.getElementById(combo.getAttribute("aria-activedescendant")!)!.textContent).toContain("S. Whitfield");

    await press(combo, "Enter");
    expect(picks).toEqual(["whitfield"]);
    expect(combo.getAttribute("aria-expanded")).toBe("false");
    expect(combo.textContent).toContain("S. Whitfield");
    expect(view.container.querySelector("select")!.value).toBe("whitfield");
    await view.unmount();
  });

  test("Escape closes without changing the value; typing jumps to a match", async () => {
    const { Select } = await import("@/components/ui/Select");
    const picks: string[] = [];
    const view = await mount(<Select label="Instructor" options={OPTIONS} defaultValue="all" onValueChange={(v) => picks.push(v)} />);
    const combo = view.container.querySelector<HTMLElement>('[role="combobox"]')!;
    combo.focus();
    await press(combo, "s"); // typeahead opens on the match
    expect(combo.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(combo.getAttribute("aria-activedescendant")!)!.textContent).toContain("S. Whitfield");
    await press(combo, "Escape");
    expect(combo.getAttribute("aria-expanded")).toBe("false");
    expect(picks).toEqual([]);
    await view.unmount();
  });

  test("v1 callers with <option> children and onChange receive a real change event", async () => {
    const { Select } = await import("@/components/ui/Select");
    const seen: string[] = [];
    const view = await mount(
      <Select label="Department" defaultValue="ANTH" onChange={(event) => seen.push(event.target.value)}>
        <option value="ANTH">Anthropology</option>
        <option value="CSCE">Computer Science</option>
      </Select>,
    );
    const combo = view.container.querySelector<HTMLElement>('[role="combobox"]')!;
    await click(combo);
    const target = options().find((o) => o.textContent?.includes("Computer Science"))!;
    await click(target);
    expect(seen).toEqual(["CSCE"]);
    expect(combo.textContent).toContain("Computer Science");
    await view.unmount();
  });
});

describe("Segmented", () => {
  test("a radio group: arrows move and select, wrapping past the ends, skipping disabled", async () => {
    const { Segmented } = await import("@/components/ui/Segmented");
    const { useState } = await import("react");
    function Harness() {
      const [value, setValue] = useState("Mon");
      return (
        <Segmented
          label="Day"
          value={value}
          onValueChange={setValue}
          options={[
            { value: "Mon", label: "Mon" },
            { value: "Tue", label: "Tue" },
            { value: "Fri", label: "Fri", disabled: true },
          ]}
        />
      );
    }
    const view = await mount(<Harness />);
    const radios = () => Array.from(view.container.querySelectorAll<HTMLElement>('[role="radio"]'));
    expect(view.container.querySelector('[role="radiogroup"]')!.getAttribute("aria-label")).toBe("Day");
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1]);

    await press(radios()[0], "ArrowRight");
    expect(radios()[1].getAttribute("aria-checked")).toBe("true");
    await press(radios()[1], "ArrowRight"); // Fri is disabled: wraps to Mon
    expect(radios()[0].getAttribute("aria-checked")).toBe("true");

    const pill = view.container.querySelector<HTMLElement>(".ui-seg__pill")!;
    expect(pill.style.transform).toBe("translateX(0%)");
    await press(radios()[0], "End");
    expect(radios()[1].getAttribute("aria-checked")).toBe("true");
    expect(pill.style.transform).toBe("translateX(100%)");
    await view.unmount();
  });
});

describe("Slider", () => {
  test("role slider with value text; arrows step, Shift steps five", async () => {
    const { Slider } = await import("@/components/ui/Slider");
    const { useState } = await import("react");
    function Harness() {
      const [v, setV] = useState(10);
      return <Slider label="Max walk" min={2} max={20} value={v} onValueChange={setV} formatValue={(n) => `${n} min`} />;
    }
    const view = await mount(<Harness />);
    const thumb = view.container.querySelector<HTMLElement>('[role="slider"]')!;
    expect(thumb.getAttribute("aria-valuetext")).toBe("10 min");
    await press(thumb, "ArrowRight");
    expect(thumb.getAttribute("aria-valuenow")).toBe("11");
    await press(thumb, "ArrowLeft", { shiftKey: true });
    expect(thumb.getAttribute("aria-valuenow")).toBe("6");
    await press(thumb, "End");
    expect(thumb.getAttribute("aria-valuenow")).toBe("20");
    await view.unmount();
  });
});

describe("Menu", () => {
  test("Enter opens on the first item; arrows wrap; Escape closes back to the trigger", async () => {
    const { Menu } = await import("@/components/ui/Menu");
    const chosen: string[] = [];
    const view = await mount(
      <Menu
        label="Plan"
        items={[
          { id: "copy", label: "Save a copy", onSelect: () => chosen.push("copy") },
          { kind: "separator", id: "s" },
          { id: "off", label: "Export", disabled: true },
          { id: "lib", label: "Open library", onSelect: () => chosen.push("lib") },
        ]}
        trigger={(props) => (
          <button {...props} type="button">
            Plan
          </button>
        )}
      />,
    );
    const trigger = view.container.querySelector("button")!;
    trigger.focus();
    await press(trigger, "Enter");
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.getAttribute("aria-label")).toBe("Plan");
    expect(document.activeElement?.textContent).toContain("Save a copy");

    await press(document.activeElement!, "ArrowDown"); // skips disabled Export
    expect(document.activeElement?.textContent).toContain("Open library");
    await press(document.activeElement!, "ArrowDown"); // wraps
    expect(document.activeElement?.textContent).toContain("Save a copy");

    await press(document.activeElement!, "Escape");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    await press(trigger, "ArrowUp"); // opens on the last item
    expect(document.activeElement?.textContent).toContain("Open library");
    await press(document.activeElement!, "Enter");
    expect(chosen).toEqual(["lib"]);
    await view.unmount();
  });
});
