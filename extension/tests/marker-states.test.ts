import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { buildMarker } from "../src/content-ui";
import { MARKER_STATES, type MarkerState } from "../src/shared/marker-states";
function withDom(run: () => void) {
  const dom = new Window();
  const previous = globalThis.document;
  // SAFETY: happy-dom supplies the browser Document API at this test boundary.
  globalThis.document = dom.document as unknown as Document;
  try {
    run();
  }
  finally {
    globalThis.document = previous;
    void dom.happyDOM.close();
  }
}
test("every state shows one glyph and its word, and names the action", () => {
  withDom(() => {
    const marker = buildMarker("row-1", () => { }, "CSCE 1030 section 001");
    const button = marker.host.querySelector("span")!.shadowRoot!.querySelector("button")!;
    const expected: Record<MarkerState, [string, string]> = {
      conflict: ["Conflict", "Conflict with Main. Review CSCE 1030 section 001 in UNTangle"],
      clear: ["Fits", "Fits Main. Review CSCE 1030 section 001 in UNTangle"],
      unknown: ["Cannot check", "Cannot check against Main. Review CSCE 1030 section 001 in UNTangle"],
      added: ["Added", "Added to Main. Review CSCE 1030 section 001 in UNTangle"],
      pending: ["Not synced", "Not synced to Main yet. Review CSCE 1030 section 001 in UNTangle"],
    };
    for (const [state, [word, name]] of Object.entries(expected)) {
      marker.update(state);
      expect(marker.host.getAttribute("data-unt-marker")).toBe(state);
      expect(button.textContent).toBe(word);
      expect(button.getAttribute("aria-label")).toBe(name);
      expect(button.querySelectorAll("svg")).toHaveLength(1);
      expect(button.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
test("a marker holds its place hidden until the worker answers", () => {
  withDom(() => {
    const marker = buildMarker("row-1", () => { });
    const button = marker.host.querySelector("span")!.shadowRoot!.querySelector("button")!;
    expect(button.hasAttribute("data-waiting")).toBe(true);
    marker.update("clear");
    expect(button.hasAttribute("data-waiting")).toBe(false);
  });
});
test("no glyph carries text the page could read", () => {
  for (const { glyph } of Object.values(MARKER_STATES)) {
    expect(glyph).not.toMatch(/<text|<title|<desc/);
    expect(glyph.replace(/<[^>]*>/g, "")).toBe("");
  }
});
