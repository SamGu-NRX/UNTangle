// Runs axe-core (WCAG 2.1 A/AA) and a keyboard Tab pass on each mockup at both sizes.
// Run from ~/.cache/untangle8/e2e:  node "<this folder>/axe.mjs"
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const require = createRequire(join(process.cwd(), "noop.js"));
const { chromium } = require("playwright");
const axeSrc = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["01-first-visit-import.html", "02-courses.html?state=detail", "03-schedule-builder.html", "03-schedule-builder.html?state=options", "03-schedule-builder.html?state=prefs", "03-schedule-builder.html?host=vsb", "04-day-map.html?stop=2", "05-schedules-library.html", "05-schedules-library.html?state=compare", "06-sign-in.html", "06-sign-in.html?state=sent", "06-sign-in.html?state=password", "07-phone-navigation.html"];
const browser = await chromium.launch();
let bad = 0;
for (const p of PAGES) for (const [n, vp] of [["desk", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp, hasTouch: n === "phone" });
  const [file, q = ""] = p.split("?");
  await page.goto(pathToFileURL(join(root, file)).href + (q ? "?" + q : ""));
  await page.waitForTimeout(900);
  await page.addScriptTag({ content: axeSrc });
  const res = await page.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.length} (${v.nodes.slice(0, 2).map((x) => x.target.join(" ")).join(" | ")})`));
  // keyboard: tab 25 times, record anything focused without a visible indicator. An indicator is
  // an outline on the element, or a box-shadow/outline/background that focus changes on the element
  // or one of its three nearest ancestors (the inputs' box-shadow ring, the search field's
  // :focus-within ring). Blurring and refocusing is how the unfocused look is read.
  const noRing = [];
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) return null;
      const chain = [el]; for (let n = el.parentElement; n && chain.length < 4; n = n.parentElement) chain.push(n);
      const look = () => chain.map((n) => { const c = getComputedStyle(n); return [c.boxShadow, c.outlineStyle, c.outlineWidth, c.backgroundColor].join("|"); });
      const focused = look(); el.blur(); const resting = look(); el.focus({ preventScroll: true });
      return focused.some((v, k) => v !== resting[k]) ? null : (el.className || el.tagName).toString().slice(0, 40);
    });
    if (r) noRing.push(r);
  }
  if (res.length || noRing.length) bad++;
  console.log(`${p} [${n}] axe: ${res.length ? "\n  " + res.join("\n  ") : "clean"}${noRing.length ? `\n  focus without ring: ${[...new Set(noRing)].join(", ")}` : ""}`);
  await page.close();
}
await browser.close();
process.exitCode = bad ? 1 : 0;
