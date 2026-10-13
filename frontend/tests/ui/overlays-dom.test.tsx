import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installDom, mount, press, removeDom } from "./dom";

// Overlays that stack: Escape closes the innermost first; toasts that carry
// an error wait for the reader, and every message reaches the live region.

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Select inside a Dialog", () => {
  test("Escape closes the open listbox first, then the dialog", async () => {
    const { Dialog } = await import("@/components/ui/Dialog");
    const { Select } = await import("@/components/ui/Select");
    const { useState } = await import("react");
    const { act } = await import("react");
    let open = true;
    function Harness() {
      const [isOpen, setOpen] = useState(true);
      open = isOpen;
      return (
        <Dialog open={isOpen} onOpenChange={setOpen} title="Export calendar">
          <Select label="Reminder" options={[{ value: "10", label: "10 minutes" }, { value: "15", label: "15 minutes" }]} defaultValue="10" />
        </Dialog>
      );
    }
    const view = await mount(<Harness />);
    const combo = document.querySelector<HTMLElement>('[role="combobox"]')!;
    await act(async () => combo.focus());
    await press(combo, "ArrowDown");
    expect(combo.getAttribute("aria-expanded")).toBe("true");

    await press(combo, "Escape");
    expect(combo.getAttribute("aria-expanded")).toBe("false");
    expect(open).toBe(true);

    await press(combo, "Escape");
    expect(open).toBe(false);
    await view.unmount();
  });
});

describe("Toaster", () => {
  test("a plain toast leaves on its own; an error stays with a Dismiss button", async () => {
    const { Toaster, toast, dismissToast } = await import("@/components/ui/Toast");
    const { act } = await import("react");
    const view = await mount(<Toaster />);
    const live = () => document.querySelector('[data-ui-live]');
    const visible = () => document.querySelector(".ui-toast");

    await act(async () => {
      toast({ message: "Saved a copy.", duration: 40 });
    });
    expect(live()?.textContent).toBe("Saved a copy.");
    expect(visible()?.textContent).toContain("Saved a copy.");
    await act(async () => {
      await sleep(260);
    });
    expect(visible()).toBeNull();

    await act(async () => {
      toast({ message: "Browser storage is full.", tone: "error", duration: 40 });
    });
    await act(async () => {
      await sleep(260);
    });
    expect(visible()?.textContent).toContain("Browser storage is full.");
    expect(document.querySelector('.ui-toast [aria-label="Dismiss"]')).not.toBeNull();
    expect(live()?.textContent).toBe("Browser storage is full.");

    await act(async () => {
      dismissToast();
      await sleep(200);
    });
    expect(visible()).toBeNull();
    await view.unmount();
  });

  test("the announcement region holds text only, so it can stay outside a modal's inert set", async () => {
    const { Toaster, toast } = await import("@/components/ui/Toast");
    const { act } = await import("react");
    const view = await mount(<Toaster />);
    await act(async () => {
      toast({ message: "Optimized", action: { label: "Undo", onClick: () => {} } });
    });
    const live = document.querySelector('[data-ui-live]')!;
    expect(live.querySelector("button")).toBeNull();
    expect(document.querySelector(".ui-toaster")!.hasAttribute("data-ui-live")).toBe(false);
    await view.unmount();
  });
});
