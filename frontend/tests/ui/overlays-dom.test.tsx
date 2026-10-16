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
    const { useEffect, useState } = await import("react");
    const { act } = await import("react");
    const seen = { open: true };
    function Harness() {
      const [isOpen, setOpen] = useState(true);
      useEffect(() => {
        seen.open = isOpen;
      });
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
    expect(seen.open).toBe(true);

    await press(combo, "Escape");
    expect(seen.open).toBe(false);
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

  test("over a modal sheet the toast waits above the sheet's edge, message only; Undo returns when it closes", async () => {
    const { Toaster, toast, dismissToast } = await import("@/components/ui/Toast");
    const { BottomSheet } = await import("@/components/ui/BottomSheet");
    const { act } = await import("react");
    const Harness = ({ open }: { open: boolean }) => (
      <>
        <BottomSheet open={open} onOpenChange={() => {}} title="Find courses" detents={["52%", "92%"]}>
          <button type="button">Add section 001</button>
        </BottomSheet>
        <Toaster />
      </>
    );
    const view = await mount(<Harness open />);
    await act(async () => {
      toast({ message: "Added CSCE 1030 section 001", action: { label: "Undo", onClick: () => {} } });
    });
    const toaster = () => document.querySelector(".ui-toaster")!;
    // Over the sheet: marked for the strip above it (ui.css), with no buttons it couldn't use (the page is inert).
    expect(toaster().getAttribute("data-covered")).toBe("sheet");
    expect(toaster().hasAttribute("inert")).toBe(true);
    expect(toaster().textContent).toContain("Added CSCE 1030 section 001");
    expect(toaster().querySelector("button")).toBeNull();
    // The sheet opens at 52%: its top edge rests 48% of the way down the 900px window.
    expect(document.documentElement.style.getPropertyValue("--sheet-top")).toBe(`${900 - 0.52 * 900}px`);
    await view.rerender(<Harness open={false} />);
    await act(async () => sleep(200));
    expect(toaster().hasAttribute("data-covered")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--sheet-top")).toBe("");
    expect([...toaster().querySelectorAll("button")].map((b) => b.textContent || b.getAttribute("aria-label"))).toEqual(["Undo", "Dismiss"]);
    await act(async () => dismissToast());
    await view.unmount();
  });

  test("over the search palette or a dialog the toast hides, so it never covers the field or a title", async () => {
    const { Toaster, toast, dismissToast } = await import("@/components/ui/Toast");
    const { SearchPalette } = await import("@/components/ui/SearchPalette");
    const { act } = await import("react");
    const Harness = ({ open }: { open: boolean }) => (
      <>
        <SearchPalette open={open} onOpenChange={() => {}} query="" onQueryChange={() => {}} sections={[]} onSelect={() => {}} />
        <Toaster />
      </>
    );
    const view = await mount(<Harness open={false} />);
    await act(async () => {
      toast({ message: "Planned CSCE 1030", action: { label: "Undo", onClick: () => {} } });
    });
    expect(document.querySelector(".ui-toast")).not.toBeNull();
    await view.rerender(<Harness open />);
    expect(document.querySelector(".ui-toaster")!.getAttribute("data-covered")).toBe("dialog");
    expect(document.querySelector(".ui-toast")).toBeNull();
    // Still said: the announcement region keeps the message.
    expect(document.querySelector("[data-ui-live]")?.textContent).toBe("Planned CSCE 1030");
    await view.rerender(<Harness open={false} />);
    await act(async () => sleep(200));
    expect(document.querySelector(".ui-toast button")?.textContent).toBe("Undo");
    // An error stays in view under a dialog, message only: it may be the only word on what failed.
    await view.rerender(<Harness open />);
    await act(async () => {
      toast({ message: "Couldn't sign out.", tone: "error", action: { label: "Try again", onClick: () => {} } });
    });
    await act(async () => sleep(200));
    expect(document.querySelector(".ui-toast__message")?.textContent).toBe("Couldn't sign out.");
    expect(document.querySelector(".ui-toast button")).toBeNull();
    await view.rerender(<Harness open={false} />);
    await act(async () => dismissToast());
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
