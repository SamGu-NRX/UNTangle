import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { buildMarker } from "../src/content-ui";
import { extensionTokens } from "@untangle/tokens/extension";
test("an isolated marker has no API details, uses shared tokens and only proposes a section", () => {
  const dom = new Window();
  const previous = globalThis.document;
  // SAFETY: happy-dom supplies the browser Document API at this test boundary.
  globalThis.document = dom.document as unknown as Document;
  try {
    let proposals = 0;
    const marker = buildMarker("row-1", () => { proposals++; });
    const root = marker.host.querySelector("span")!.shadowRoot!;
    expect(root.querySelector("style")?.textContent).toContain(extensionTokens);
    expect(root.querySelector("button")?.textContent).toBe("Cannot check");
    marker.update("conflict");
    expect(root.querySelector("button")?.textContent).toBe("Conflict");
    expect(root.querySelectorAll("button")).toHaveLength(1);
    root.querySelector("button")!.click();
    expect(proposals).toBe(1);
    expect(marker.host.textContent).toBe("");
    marker.update("Work on Monday");
    expect(root.querySelector("button")?.textContent).toBe("Cannot check");
  }
  finally {
    globalThis.document = previous;
    void dom.happyDOM.close();
  }
});
