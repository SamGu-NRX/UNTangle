import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { click, installDom, mount, press, removeDom } from "./dom";

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

describe("ContextPanel on desktop", () => {
  async function setup() {
    const { useState } = await import("react");
    const { ContextPanel } = await import("@/components/ui/ContextPanel");
    function Harness() {
      const [picked, setPicked] = useState<string | null>(null);
      return (
        <>
          {["CSCE 2110", "MATH 2700", "Elsewhere"].map((code) => (
            <button key={code} type="button" data-pick={code} onClick={() => setPicked(code)}>
              {code}
            </button>
          ))}
          <ContextPanel
            open={picked !== null}
            onClose={() => setPicked(null)}
            title={picked ?? ""}
            returnFocus={() => (picked ? document.querySelector<HTMLElement>(`[data-pick="${picked}"]`) : null)}
          >
            <a href="#sections">Sections for {picked}</a>
          </ContextPanel>
        </>
      );
    }
    // The shell's <main>, which the panel marks so the page can make room.
    const main = document.createElement("main");
    main.id = "main";
    document.body.appendChild(main);
    const view = await mount(<Harness />);
    const row = (code: string) => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === code)!;
    const panel = () => document.querySelector<HTMLElement>("aside.ui-context");
    const unmount = async () => {
      await view.unmount();
      main.remove();
    };
    return { view: { unmount }, row, panel, main };
  }

  test("renders nothing until something is selected, then a labelled panel, and marks the page", async () => {
    const { view, row, panel, main } = await setup();
    expect(panel()).toBeNull();
    expect(main.hasAttribute("data-context-host")).toBe(true);
    expect(main.hasAttribute("data-context-open")).toBe(false);
    await click(row("CSCE 2110"));
    expect(panel()?.getAttribute("data-state")).toBe("open");
    expect(panel()?.querySelector("h2")?.textContent).toBe("CSCE 2110");
    expect(main.hasAttribute("data-context-open")).toBe(true);
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

  test("Escape closes it without animating, and focus returns to the selected item", async () => {
    const { view, row, panel, main } = await setup();
    await click(row("MATH 2700"));
    // Focus wanders to another control and then into the panel; the selection is still MATH 2700.
    row("Elsewhere").focus();
    panel()!.querySelector<HTMLElement>("a")!.focus();
    await press(document.activeElement!, "Escape");
    expect(panel() === null || panel()!.hasAttribute("data-instant")).toBe(true);
    expect(main.hasAttribute("data-context-open")).toBe(false);
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
