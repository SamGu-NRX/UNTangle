import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Hex tokens from the v3 :root block in globals.css (the first block in the file). */
function readTokens(): Record<string, string> {
  const css = readFileSync(path.join(import.meta.dir, "../../src/app/globals.css"), "utf8");
  const block = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, hex]) => [name, hex.toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = readTokens();
const color = (name: string) => {
  const value = tokens[name];
  if (!value) throw new Error(`globals.css has no hex token --${name}`);
  return value;
};

describe("v3 color tokens", () => {
  test("the ratios DESIGN.md §7 states, recomputed from globals.css", () => {
    const stated: Array<[string, string, number]> = [
      ["ink-2", "ground", 5.84],
      ["ink-2", "paper", 6.35],
      ["ink-3", "paper", 4.26],
      ["attention", "attention-soft", 5.01],
      ["danger", "paper", 6.54],
      ["brand", "paper", 9.49],
      ["accent", "paper", 3.12],
    ];
    for (const [fg, bg, ratio] of stated) {
      expect({ pair: `${fg} on ${bg}`, ratio: Number(contrast(color(fg), color(bg)).toFixed(2)) }).toEqual({ pair: `${fg} on ${bg}`, ratio });
    }
  });

  test("every text pair the controls use reaches 4.5:1", () => {
    const text: Array<[string, string]> = [
      ["ink", "ground"],
      ["ink-2", "paper-2"], // search trigger text
      ["ink-2", "paper-3"], // unselected segments
      ["brand-2", "paper"], // quiet buttons
      ["brand", "brand-soft"], // selected chips
      ["paper", "brand"], // primary buttons, building plates
      ["attention", "paper"],
      ["danger", "danger-soft"],
    ];
    for (const [fg, bg] of text) {
      expect({ pair: `${fg} on ${bg}`, pass: contrast(color(fg), color(bg)) >= 4.5 }).toEqual({ pair: `${fg} on ${bg}`, pass: true });
    }
  });

  test("non-text marks reach 3:1 against what they touch", () => {
    // --focus draws the accent ring outside a 2px paper band, so the ring is
    // judged against paper; accent on ground alone is 2.87:1 and would fail.
    expect(contrast(color("accent"), color("paper"))).toBeGreaterThanOrEqual(3);
    expect(contrast(color("ink-3"), color("paper"))).toBeGreaterThanOrEqual(3);
    expect(contrast(color("ink-3"), color("ground"))).toBeGreaterThanOrEqual(3);
  });
});
