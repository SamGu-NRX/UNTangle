import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extensionTokens } from "../src/extension";

function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (!found.has(match[1])) found.set(match[1], match[2].replace(/\s+/g, " ").trim());
  }
  return found;
}

test("every extension token has the web app's value", () => {
  const globals = readFileSync(path.join(import.meta.dir, "../../../frontend/src/app/globals.css"), "utf8");
  const root = globals.slice(globals.indexOf(":root {"), globals.indexOf("}", globals.indexOf(":root {")));
  const app = declarations(root);
  const ours = declarations(extensionTokens);
  expect(ours.size).toBeGreaterThan(0);
  for (const [name, value] of ours) {
    const expected = app.get(name);
    if (expected === undefined) throw new Error(`${name} is not a token in globals.css`);
    // The app's font stacks lead with next/font variables the extension can't load.
    const comparable = name.startsWith("--font-") ? expected.replace(/var\(--font-[a-z-]+\),\s*/g, "") : expected;
    expect(`${name}: ${value}`).toBe(`${name}: ${comparable}`);
  }
});
