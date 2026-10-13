import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installDom, mount, press, removeDom } from "./dom";

// Regression tests for the re-review of the merged foundation (764a016).

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

describe("popovers inside the top modal layer", () => {
  test("closing a lower dialog keeps the open listbox in the upper dialog live", async () => {
    const { Dialog } = await import("@/components/ui/Dialog");
    const { Select } = await import("@/components/ui/Select");
    const { useState } = await import("react");
    const controls: { setA?: (open: boolean) => void; setB?: (open: boolean) => void } = {};
    function Harness() {
      const [a, setA] = useState(false);
      const [b, setB] = useState(false);
      controls.setA = setA;
      controls.setB = setB;
      return (
        <>
          <Dialog open={a} onOpenChange={setA} title="Dialog A">
            <p>A</p>
          </Dialog>
          <Dialog open={b} onOpenChange={setB} title="Dialog B">
            <Select label="Reminder" options={[{ value: "10", label: "10 minutes" }, { value: "15", label: "15 minutes" }]} defaultValue="10" />
          </Dialog>
        </>
      );
    }
    const view = await mount(<Harness />);
    await act(() => controls.setA!(true));
    await act(() => controls.setB!(true));

    const combo = document.querySelector<HTMLElement>('[role="combobox"]')!;
    await act(() => combo.focus());
    await press(combo, "ArrowDown");
    const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]');
    expect(combo.getAttribute("aria-expanded")).toBe("true");
    expect(listbox()?.closest("[inert]")).toBeNull();

    // Close the lower dialog through state while the listbox is open.
    await act(() => controls.setA!(false));
    expect(combo.getAttribute("aria-expanded")).toBe("true");
    expect(listbox()).not.toBeNull();
    expect(listbox()!.closest("[inert]")).toBeNull();

    await act(() => controls.setB!(false));
    await act(() => sleep(200));
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    await view.unmount();
  });
});

describe("Select validation after the value changes", () => {
  test("a required Select validated at '' drops its built-in error once given a value", async () => {
    const { Select } = await import("@/components/ui/Select");
    const options = [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ];
    const field = (value: string, error?: string) => (
      <Select label="Term" options={options} value={value} onChange={() => {}} required error={error} />
    );
    const view = await mount(field(""));
    const combo = () => view.container.querySelector<HTMLElement>('[role="combobox"]')!;
    const native = view.container.querySelector("select")!;
    await act(() => {
      native.checkValidity();
    });
    expect(combo().getAttribute("aria-invalid")).toBe("true");
    expect(view.container.textContent).toContain("Choose an option.");

    await view.rerender(field("a"));
    expect(combo().getAttribute("aria-invalid")).toBeNull();
    expect(view.container.textContent).not.toContain("Choose an option.");

    // Emptied again, it stays quiet until the next failed check.
    await view.rerender(field(""));
    expect(view.container.textContent).not.toContain("Choose an option.");

    // A caller's own error always shows.
    await view.rerender(field("a", "Term is closed for registration."));
    expect(combo().getAttribute("aria-invalid")).toBe("true");
    expect(view.container.textContent).toContain("Term is closed for registration.");
    await view.unmount();
  });
});

describe("Select: an explicit empty option is still a missing value", () => {
  // Native `required`: a select whose value is "" fails, even when an option
  // such as "Choose term" carries that empty value.
  async function expectMissingThenValid(field: (value: string) => React.ReactElement) {
    const view = await mount(field(""));
    const combo = () => view.container.querySelector<HTMLElement>('[role="combobox"]')!;
    const native = view.container.querySelector("select")!;
    expect(combo().textContent).toContain("Choose term");
    let valid = true;
    await act(() => {
      valid = native.reportValidity();
    });
    expect(valid).toBe(false);
    expect(combo().getAttribute("aria-invalid")).toBe("true");
    expect(view.container.textContent).toContain("Choose an option.");
    expect(document.activeElement).toBe(combo());

    await view.rerender(field("a"));
    expect(combo().getAttribute("aria-invalid")).toBeNull();
    expect(view.container.textContent).not.toContain("Choose an option.");
    await view.unmount();
  }

  test("through the options prop", async () => {
    const { Select } = await import("@/components/ui/Select");
    const options = [
      { value: "", label: "Choose term" },
      { value: "a", label: "Spring 2027" },
    ];
    await expectMissingThenValid((value) => (
      <Select label="Term" options={options} value={value} onChange={() => {}} required />
    ));
  });

  test("through legacy <option> children", async () => {
    const { Select } = await import("@/components/ui/Select");
    await expectMissingThenValid((value) => (
      <Select label="Term" value={value} onChange={() => {}} required>
        <option value="">Choose term</option>
        <option value="a">Spring 2027</option>
      </Select>
    ));
  });
});
