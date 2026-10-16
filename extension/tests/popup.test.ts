import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import type { PanelState } from "../src/shared/panel";

// The panel module draws on import from the worker's answer to panel/status,
// so the state it draws is set before the import.
let state: PanelState;
const dom = new Window();
const saved = { document: globalThis.document, HTMLElement: globalThis.HTMLElement, chrome: (globalThis as { chrome?: unknown }).chrome };
beforeAll(() => {
  const html = readFileSync(join(import.meta.dir, "..", "popup.html"), "utf8");
  dom.document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  // SAFETY: happy-dom supplies the browser Document API at this test boundary.
  globalThis.document = dom.document as unknown as Document;
  globalThis.HTMLElement = dom.HTMLElement as unknown as typeof HTMLElement;
  // SAFETY: the panel calls only runtime.sendMessage and tabs.create.
  (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: async () => state }, tabs: { create: async () => undefined } };
});
afterAll(() => {
  globalThis.document = saved.document;
  globalThis.HTMLElement = saved.HTMLElement;
  (globalThis as { chrome?: unknown }).chrome = saved.chrome;
  void dom.happyDOM.close();
});

test("a class search in a term UNTangle doesn't plan says which term it plans, with no Add", async () => {
  state = {
    signedIn: true, userCode: null, notice: "Review this section before adding.", outcome: "none", pending: 0, discarded: 0, working: false,
    preview: {
      previewId: "preview-1",
      ref: { term: "fall-2027", classNumber: "9000" },
      // The server's reply for this case, as the 2026-10-16 capture recorded it, plus plannedTerms.
      preview: {
        scheduleId: "main", optionId: "9000", revision: 0, title: "9000", conflict: "unknown", unknownReason: "schedule-unavailable",
        details: ["UNTangle plans only Spring 2027 for now. This class search is Fall 2027."], plannedTerms: ["Spring 2027"],
      },
    },
  };
  await import("../src/popup");
  const view = dom.document.querySelector("#view")!;
  for (let i = 0; i < 50 && view.getAttribute("data-view") !== "unplanned-term"; i++)
    await new Promise(resolve => setTimeout(resolve, 10));
  expect(view.getAttribute("data-view")).toBe("unplanned-term");
  expect(view.querySelector("h1")?.textContent).toBe("UNTangle plans only Spring 2027 for now");
  expect(view.querySelector(".lead")?.textContent).toBe("This class search is for Fall 2027. Switch class search to Spring 2027 to check sections against Main.");
  expect(view.textContent).not.toContain("Cannot check");
  expect(dom.document.querySelector("#confirm")).toBeNull();
});
