import { afterAll, beforeAll, expect, test } from "bun:test";
import { installDom, mount, removeDom } from "../ui/dom";

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

test("OptionsStrip marks the region busy only while searching", async () => {
  const { OptionsStrip } = await import("@/components/schedule-builder/OptionsStrip");
  const props = {
    count: "1 of 3",
    sentence: "Friday off.",
    better: false,
    instant: true,
    canUse: true,
    hasNext: true,
    onDetails: () => {},
    onShow: () => {},
    onNext: () => {},
    onUse: () => {},
    onClose: () => {},
  };
  const view = await mount(<OptionsStrip {...props} searching={true} />);
  try {
    const region = () => view.container.querySelector('[role="region"][aria-label="Other weeks Auto found"]')!;
    expect(region().getAttribute("aria-busy")).toBe("true");

    await view.rerender(<OptionsStrip {...props} searching={false} />);
    expect(region().hasAttribute("aria-busy")).toBe(false);
  } finally {
    await view.unmount();
  }
});
