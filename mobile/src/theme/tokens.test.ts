import { color, hues } from "./tokens";

// The phone and the web are one product: every color the phone uses must be
// the value globals.css declares, so a change on the web fails here first.
// Jest runs from mobile/, and this package carries no Node types, so fs comes through requireActual.
const fs = jest.requireActual<{ readFileSync: (path: string, encoding: "utf8") => string }>("fs");
const css = fs.readFileSync("../frontend/src/app/globals.css", "utf8");

function cssVar(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`globals.css has no --${name}`);
  return match[1].trim().toLowerCase();
}

const pairs: Array<[keyof typeof color, string]> = [
  ["ground", "ground"],
  ["paper", "paper"],
  ["paper2", "paper-2"],
  ["paper3", "paper-3"],
  ["line", "line"],
  ["line2", "line-2"],
  ["ink", "ink"],
  ["ink2", "ink-2"],
  ["ink3", "ink-3"],
  ["ink4", "ink-4"],
  ["brand", "brand"],
  ["brand2", "brand-2"],
  ["brandSoft", "brand-soft"],
  ["accent", "accent"],
  ["attention", "attention"],
  ["attentionSoft", "attention-soft"],
  ["danger", "danger"],
  ["dangerSoft", "danger-soft"],
];

describe("tokens", () => {
  it.each(pairs)("color.%s matches --%s", (key, name) => {
    expect(color[key].toLowerCase()).toBe(cssVar(name));
  });

  it.each([1, 2, 3, 4, 5, 6] as const)("course hue %i matches --c%i and its tint", (hue) => {
    expect(hues[hue].solid.toLowerCase()).toBe(cssVar(`c${hue}`));
    expect(hues[hue].tint.toLowerCase()).toBe(cssVar(`c${hue}t`));
  });
});
