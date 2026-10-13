// Screenshots every mockup state at 1440x900 and 390x844 into ../screens.
// Run from ~/.cache/untangle8/e2e (where playwright is installed):
//   node "<this folder>/shoot.mjs" [filter]
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(join(process.cwd(), "noop.js"));
const { chromium } = require("playwright");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const SIZES = { desk: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const SHOTS = JSON.parse(process.env.SHOTS || "null") || (await import(pathToFileURL(join(here, "shots.mjs")).href)).default;
const filter = process.argv[2] || "";

const browser = await chromium.launch();
const errors = [];
for (const s of SHOTS.filter((x) => (x.name + x.file).includes(filter))) {
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    if (s.only && s.only !== sizeName) continue;
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: sizeName === "phone", isMobile: sizeName === "phone", reducedMotion: s.reduced ? "reduce" : "no-preference" });
    page.on("pageerror", (e) => errors.push(`${s.name}/${sizeName}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${s.name}/${sizeName}: console ${m.text()}`); });
    await page.goto(pathToFileURL(join(root, s.file)).href + (s.query || ""));
    await page.waitForTimeout(s.wait ?? 700);
    if (s.act) await s.act(page, sizeName);
    await page.screenshot({ path: join(root, "screens", `${s.name}-${sizeName}.png`), fullPage: !!s.full });
    await page.close();
    console.log("shot", s.name, sizeName);
  }
}
await browser.close();
if (errors.length) { console.log("ERRORS:\n" + errors.join("\n")); process.exitCode = 1; }
