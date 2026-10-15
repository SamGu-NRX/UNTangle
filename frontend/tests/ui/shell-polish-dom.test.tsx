import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { click, installDom, mount, press, removeDom } from "./dom";

// Where focus lands when a sheet opens, and what the schedule pill shows.

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

describe("BottomSheet opening focus", () => {
  async function openSheet(
    content: (close: () => void) => React.ReactNode,
    extra: { initialFocus?: React.RefObject<HTMLElement | null>; detents?: string[] } = {},
  ) {
    const { useState } = await import("react");
    const { BottomSheet } = await import("@/components/ui/BottomSheet");
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-opener="" onClick={() => setOpen(true)}>
            Open
          </button>
          <BottomSheet open={open} onOpenChange={setOpen} title="Spring 2027 schedules" detents={["52%", "92%"]} {...(extra as object)}>
            {content(() => setOpen(false))}
          </BottomSheet>
        </>
      );
    }
    const view = await mount(<Harness />);
    await click(view.container.querySelector("[data-opener]")!);
    const handle = document.querySelector<HTMLButtonElement>(".ui-sheet__handle")!;
    return { view, handle };
  }

  test("goes to the sheet's heading, not the resize handle", async () => {
    const { view, handle } = await openSheet((close) => (
      <>
        <h2>Spring 2027 schedules</h2>
        <button type="button" onClick={close}>
          Close
        </button>
      </>
    ));
    try {
      expect(document.activeElement?.tagName).toBe("H2");
      expect(document.activeElement?.textContent).toBe("Spring 2027 schedules");
      // The handle is still a keyboard stop, so Tab reaches it and draws its ring.
      expect(handle.tagName).toBe("BUTTON");
      expect(handle.tabIndex).toBe(0);
      expect(document.activeElement).not.toBe(handle);
    } finally {
      await view.unmount();
    }
  });

  test("without a heading, goes to the first control after the handle", async () => {
    const { view, handle } = await openSheet(() => (
      <button type="button" data-first="">
        Keep this section
      </button>
    ));
    try {
      expect(document.activeElement).toBe(document.querySelector("[data-first]"));
      expect(document.activeElement).not.toBe(handle);
    } finally {
      await view.unmount();
    }
  });

  test("an explicit initialFocus still wins", async () => {
    const { createRef } = await import("react");
    const target = createRef<HTMLInputElement>();
    const { view } = await openSheet(
      () => (
        <>
          <h2>Rename</h2>
          <input ref={target} aria-label="Name" />
        </>
      ),
      { initialFocus: target },
    );
    try {
      expect(document.activeElement).toBe(target.current);
    } finally {
      await view.unmount();
    }
  });
  test("skips headings and controls that are hidden or belong to a nested dialog", async () => {
    const { view } = await openSheet(() => (
      <>
        <div hidden>
          <h2>Last term</h2>
        </div>
        <div role="dialog" aria-label="Rename">
          <h2>Rename</h2>
        </div>
        <h3 data-real="">Sections this term</h3>
      </>
    ));
    try {
      expect(document.activeElement).toBe(document.querySelector("[data-real]"));
    } finally {
      await view.unmount();
    }
  });

  test("Shift+Tab from a heading before every stop wraps to the last stop, and Tab from one after them wraps to the first", async () => {
    // One detent: the handle is decoration, so the heading comes before every stop.
    const first = await openSheet(
      () => (
        <>
          <h2>Constraints</h2>
          <button type="button">No Fridays</button>
          <button type="button" data-last="">
            Done
          </button>
        </>
      ),
      { detents: ["92%"] },
    );
    try {
      expect(document.activeElement?.tagName).toBe("H2");
      await press(document.activeElement!, "Tab", { shiftKey: true });
      expect(document.activeElement).toBe(document.querySelector("[data-last]"));
    } finally {
      await first.view.unmount();
    }

    const second = await openSheet(
      () => (
        <>
          <button type="button">No Fridays</button>
          <h2>Constraints</h2>
        </>
      ),
      { detents: ["92%"] },
    );
    try {
      expect(document.activeElement?.tagName).toBe("H2");
      await press(document.activeElement!, "Tab");
      expect(document.activeElement?.textContent).toBe("No Fridays");
    } finally {
      await second.view.unmount();
    }
  });

  test("an opening heading below the half-height detent raises the sheet once it has been placed", async () => {
    const { act } = await import("react");
    const real = HTMLElement.prototype.getBoundingClientRect;
    // happy-dom has no layout: place the heading far down the sheet, as a long header above it would.
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const rect = real.call(this);
      return this.hasAttribute("data-far") ? ({ ...rect.toJSON?.(), top: 4980, bottom: 5000, height: 20 } as DOMRect) : rect;
    };
    try {
      const { view } = await openSheet(() => <h2 data-far="">Sections this term</h2>);
      try {
        await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
        expect(document.activeElement?.hasAttribute("data-far")).toBe(true);
        expect(document.querySelector(".ui-sheet")?.hasAttribute("data-expanded")).toBe(true);
      } finally {
        await view.unmount();
      }
      const near = await openSheet(() => <h2>Sections this term</h2>);
      try {
        await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
        expect(document.querySelector(".ui-sheet")?.hasAttribute("data-expanded")).toBe(false);
      } finally {
        await near.view.unmount();
      }
    } finally {
      HTMLElement.prototype.getBoundingClientRect = real;
    }
  });
});

describe("Schedule pill text", () => {
  async function render(showTerm: boolean) {
    const { PillText } = await import("@/components/shell/SchedulePill");
    const { PLANNING_TERM } = await import("@/lib/terms");
    const { SCHEDULE_NAME } = await import("@/components/shell/plan-status");
    const view = await mount(
      <span data-pill="">
        <PillText showTerm={showTerm} status="Saved on this device" />
      </span>,
    );
    const pill = view.container.querySelector("[data-pill]")!;
    const visible = Array.from(pill.querySelectorAll(".shell-pill__term, .shell-pill__name")).map((el) => el.textContent);
    return { view, pill, visible, term: PLANNING_TERM.name, name: SCHEDULE_NAME };
  }

  test("on phones the pill shows the schedule name alone and keeps the term in its accessible name", async () => {
    const { view, pill, visible, term, name } = await render(false);
    try {
      expect(visible).toEqual([name]);
      const label = pill.textContent!.replace(/\s+/g, " ").trim();
      expect(label.startsWith(name)).toBe(true);
      expect(label).toContain(term);
    } finally {
      await view.unmount();
    }
  });

  test("on desktop the pill shows the term, then the name", async () => {
    const { view, pill, visible, term, name } = await render(true);
    try {
      expect(visible).toEqual([term, name]);
      expect(pill.textContent!.replace(/\s+/g, " ").trim().startsWith(`${term} ${name}`)).toBe(true);
    } finally {
      await view.unmount();
    }
  });
});
