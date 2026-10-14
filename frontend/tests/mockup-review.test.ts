import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window, type HTMLElement as HappyHTMLElement } from "happy-dom";
import { createContext, runInContext } from "node:vm";

const windows: Window[] = [];
afterEach(() => { for (const window of windows.splice(0)) window.close(); });

function mockup(name: string, query = "") {
  const html = readFileSync(new URL(`../../docs/design/untangle-v3-opus/${name}.html`, import.meta.url), "utf8");
  const window = new Window({ url: `http://mockup.local/${name}.html${query}`, width: 1440, height: 900,
    settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  windows.push(window);
  window.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
  const context = createContext({
    window, document: window.document, location: window.location, history: window.history,
    innerWidth: 1440, innerHeight: 900,
    matchMedia: window.matchMedia.bind(window),
    addEventListener: window.addEventListener.bind(window),
    // These checks observe DOM state; browser animation frames are not advanced.
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    performance, URLSearchParams,
    ResizeObserver: window.ResizeObserver, CSS: window.CSS,
  });
  const page = Object.assign(window, { evaluate: (source: string) => runInContext(source, context) });
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) page.evaluate(match[1]);
  return page;
}

test("a later toast is exposed before its live-region text changes", () => {
  const window = mockup("06-sign-in");
  window.evaluate('toast("First", "Dismiss", () => {})');
  window.document.querySelector<HappyHTMLElement>(".toast-x")!.click();
  const toast = window.document.querySelector<HappyHTMLElement>(".toast")!;
  expect(toast.inert).toBe(true);
  const exposures: boolean[] = [];
  const innerHTML = Object.getOwnPropertyDescriptor(window.Element.prototype, "innerHTML")!;
  Object.defineProperty(toast, "innerHTML", {
    set(value: string) { exposures.push(!toast.inert); innerHTML.set!.call(toast, value); },
    get() { return innerHTML.get!.call(toast); },
  });
  window.evaluate('toast("Second", "Dismiss", () => {})');
  expect(toast.textContent).toContain("Second");
  expect(exposures).toEqual([true]);
  expect(toast.getAttribute("role")).toBe("status");
});

test.each(["", "?state=password"])("the sign-in email autocomplete matches shipped auth at %s", query => {
  const window = mockup("06-sign-in", query);
  const emails = [...window.document.querySelectorAll('input[type="email"]')];
  expect(emails).toHaveLength(2);
  expect(emails.map(input => input.getAttribute("autocomplete"))).toEqual(["email", "email"]);
});

test("the link loading state says Sending", () => {
  const window = mockup("06-sign-in", "?state=loading");
  expect(window.document.querySelector(".dialog-wrap [data-submit]")!.textContent).toContain("Sending");
});

test("adding a section keeps focus on its unavailable selected control", () => {
  const window = mockup("02-courses");
  window.evaluate('openDetail("MATH 3680", true)');
  const add = window.document.querySelector<HappyHTMLElement>('#panel [data-addsec]:not([disabled]):not([aria-disabled])')!;
  const identity = add.getAttribute("data-addsec");
  expect(identity).toMatch(/^MATH 3680\|/);
  add.focus(); add.click();
  const selected = window.document.querySelector<HappyHTMLElement>(`#panel [data-addsec="${identity}"]`)!;
  expect(selected.getAttribute("aria-disabled")).toBe("true");
  expect(selected.getAttribute("aria-label")).toMatch(/is in Spring 2027/);
  expect(window.document.activeElement).toBe(selected);
  const content = window.document.querySelector("#panel")!.textContent;
  selected.click();
  expect(window.document.querySelector("#panel")!.textContent).toBe(content);
});
