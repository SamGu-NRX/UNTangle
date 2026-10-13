/**
 * happy-dom globals for one UI test file, plus a React mount helper that
 * renders inside `act` so assertions see committed DOM. `installDom()` must
 * run before importing React DOM or any component module.
 */
import { Window } from "happy-dom";

const KEYS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "Text",
  "DocumentFragment",
  "Event",
  "CustomEvent",
  "StorageEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
] as const;

let installed: { win: Window; previous: Map<string, unknown> } | null = null;

export function installDom(): Window {
  if (installed) return installed.win;
  const win = new Window({ url: "http://localhost:3000/dev/controls", width: 1440, height: 900 });
  const scope = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<string, unknown>();
  for (const key of KEYS) {
    previous.set(key, scope[key]);
    const value = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
    scope[key] = typeof value === "function" && !/^[A-Z]/.test(key) ? value.bind(win) : value;
  }
  previous.set("IS_REACT_ACT_ENVIRONMENT", scope.IS_REACT_ACT_ENVIRONMENT);
  scope.IS_REACT_ACT_ENVIRONMENT = true;
  installed = { win, previous };
  return win;
}

export function removeDom() {
  if (!installed) return;
  const scope = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of installed.previous) {
    if (value === undefined) delete scope[key];
    else scope[key] = value;
  }
  installed.win.close();
  installed = null;
}

export async function mount(node: React.ReactNode) {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    rerender: (next: React.ReactNode) => act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** Dispatches a keydown on `target` inside act. */
export async function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const { act } = await import("react");
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

export async function click(target: Element) {
  const { act } = await import("react");
  await act(async () => {
    (target as HTMLElement).click();
  });
}
