import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { afterStalePop } from "@/components/ui/back-close";
import { click, installDom, mount, press, removeDom } from "./dom";

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

describe("Back after a sheet closed without giving back its history entry", () => {
  const stale = { id: "sheet-3", href: "http://localhost/courses" };

  test("landing on the stale entry itself keeps waiting", () => {
    expect(afterStalePop(stale, "sheet-3", stale.href)).toEqual({ stale, back: false });
  });

  test("stepping off it onto the same page skips one more step", () => {
    expect(afterStalePop(stale, undefined, stale.href)).toEqual({ stale: null, back: true });
  });

  test("anywhere else forgets it", () => {
    expect(afterStalePop(stale, undefined, "http://localhost/schedule")).toEqual({ stale: null, back: false });
    expect(afterStalePop(stale, "sheet-9", stale.href)).toEqual({ stale: null, back: false });
  });
});

describe("ContextPanel on desktop", () => {
  async function setup() {
    const { useState } = await import("react");
    const { ContextPanel } = await import("@/components/ui/ContextPanel");
    function Harness() {
      const [picked, setPicked] = useState<string | null>(null);
      return (
        <>
          {["CSCE 2110", "MATH 2700"].map((code) => (
            <button key={code} type="button" onClick={() => setPicked(code)}>
              {code}
            </button>
          ))}
          <ContextPanel open={picked !== null} onClose={() => setPicked(null)} title={picked ?? ""}>
            <a href="#sections">Sections for {picked}</a>
          </ContextPanel>
        </>
      );
    }
    const view = await mount(<Harness />);
    const row = (code: string) => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === code)!;
    const panel = () => view.container.querySelector<HTMLElement>("aside.ui-context");
    return { view, row, panel };
  }

  test("renders nothing until something is selected, then a labelled panel", async () => {
    const { view, row, panel } = await setup();
    expect(panel()).toBeNull();
    row("CSCE 2110").focus();
    await click(row("CSCE 2110"));
    expect(panel()?.getAttribute("data-state")).toBe("open");
    expect(panel()?.querySelector("h2")?.textContent).toBe("CSCE 2110");
    await view.unmount();
  });

  test("picking another item swaps the content in place", async () => {
    const { view, row, panel } = await setup();
    await click(row("CSCE 2110"));
    const first = panel();
    await click(row("MATH 2700"));
    expect(panel()).toBe(first);
    expect(panel()?.textContent).toContain("Sections for MATH 2700");
    await view.unmount();
  });

  test("Escape closes it and focus returns to the selected item", async () => {
    const { view, row, panel } = await setup();
    row("MATH 2700").focus();
    await click(row("MATH 2700"));
    panel()!.querySelector<HTMLElement>("a")!.focus();
    await press(document.activeElement!, "Escape");
    expect(panel()?.getAttribute("data-state")).toBe("closed");
    expect(document.activeElement).toBe(row("MATH 2700"));
    await view.unmount();
  });

  test("Escape that a dialog on top already handled leaves the panel open", async () => {
    const { view, row, panel } = await setup();
    await click(row("CSCE 2110"));
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    await press(document.body, "Escape");
    expect(panel()?.getAttribute("data-state")).toBe("open");
    dialog.remove();
    await view.unmount();
  });

  test("the close button names what it closes and unmounts after the exit", async () => {
    const { view, row, panel } = await setup();
    await click(row("CSCE 2110"));
    const close = panel()!.querySelector<HTMLButtonElement>('button[aria-label="Close CSCE 2110"]')!;
    await click(close);
    const { act } = await import("react");
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 200)));
    expect(panel()).toBeNull();
    await view.unmount();
  });
});
