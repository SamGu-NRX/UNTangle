// Counts the visible text items above the fold on each lens at 1440x900, the measure the
// simplification rules in ../../untangle-v3.md are judged by.
// A text item is one non-blank text node whose box intersects the viewport and whose element is
// visible. Map canvas labels (.map) and mockup furniture (.mock-note) are left out on both sides.
// Run from ~/.cache/untangle8/e2e:  node "<this folder>/count.mjs" [root folder, default ..]
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(join(process.cwd(), "noop.js"));
const { chromium } = require("playwright");

const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), ".."));
const LENSES = [
  ["Courses", "02-courses.html?state=after&quiet=1"],
  ["Week (UNTangle)", "03-schedule-builder.html"],
  ["Week (vsb)", "03-schedule-builder.html?host=vsb"],
  ["Day", "04-day-map.html"],
  ["Schedules", "05-schedules-library.html"],
];
const browser = await chromium.launch();
for (const [name, p] of LENSES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const [file, q = ""] = p.split("?");
  await page.goto(pathToFileURL(join(root, file)).href + (q ? "?" + q : ""));
  await page.waitForTimeout(1100);
  const n = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let count = 0;
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement;
      if (!t.textContent.trim() || !el || el.closest("script, style, .map, .mock-note")) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const r = document.createRange(); r.selectNodeContents(t);
      const box = r.getBoundingClientRect();
      if (box.width && box.height && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth) count++;
    }
    return count;
  });
  console.log(`${name}\t${n}`);
  await page.close();
}
await browser.close();
