import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { installDom, removeDom } from "../planner/test-dom";

// The component's class names do not matter here; this keeps the test off the CSS loader.
mock.module("@/components/courses/courses.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

const options = [
  { value: "cs", label: "Computer Science" },
  { value: "ce", label: "Computer Engineering" },
  { value: "math", label: "Mathematics" },
  { value: "other", label: "Undeclared" },
];

async function mount(initial: string | null) {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { Listbox } = await import("@/components/courses/Listbox");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const changes: string[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Listbox label="Major" options={options} value={initial} onChange={(value) => changes.push(value)} placeholder="Choose your major" />);
  });
  const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  const key = (k: string) =>
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { view: { container }, trigger, key, changes, cleanup };
}

test("closed trigger names the field and shows the placeholder", async () => {
  const { trigger, cleanup } = await mount(null);
  expect(trigger.getAttribute("aria-label")).toBe("Major");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.textContent).toContain("Choose your major");
  cleanup();
});

test("arrow keys open and move the active option; Enter chooses and closes", async () => {
  const { trigger, key, changes, cleanup } = await mount("cs");
  key("ArrowDown");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const active = () => document.getElementById(trigger.getAttribute("aria-activedescendant") ?? "")?.textContent;
  expect(active()).toContain("Computer Science");
  key("ArrowDown");
  key("ArrowDown");
  expect(active()).toContain("Mathematics");
  key("End");
  expect(active()).toContain("Undeclared");
  key("Home");
  key("ArrowDown");
  key("Enter");
  expect(changes).toEqual(["ce"]);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  cleanup();
});

test("Escape closes without choosing", async () => {
  const { trigger, key, changes, cleanup } = await mount("cs");
  key("ArrowDown");
  key("ArrowDown");
  key("Escape");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(changes).toEqual([]);
  cleanup();
});

test("typing jumps to the matching label", async () => {
  const { trigger, key, changes, cleanup } = await mount("cs");
  key("u");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const activeId = trigger.getAttribute("aria-activedescendant") ?? "";
  expect(document.getElementById(activeId)?.textContent).toContain("Undeclared");
  key(" ");
  expect(changes).toEqual(["other"]);
  cleanup();
});

test("the selected option is marked for assistive tech", async () => {
  const { key, view, cleanup } = await mount("math");
  key("ArrowDown");
  const selected = [...view.container.querySelectorAll('[role="option"][aria-selected="true"]')].map((element) => element.textContent);
  expect(selected).toHaveLength(1);
  expect(selected[0]).toContain("Mathematics");
  cleanup();
});
