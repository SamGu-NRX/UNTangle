// Keyboard-only and reduced-motion pass over /schedule: every tab stop shows a focus ring, and Optimize runs
// from the keyboard (on phones the constraints sheet is opened with Enter first). Exits 1 on any miss.
// Usage: node keyboard.mjs <baseUrl>
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const [base] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
let failed = false;
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const seen = [];
  let invisible = 0;
  const tabThrough = async (count) => {
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      // ui text fields draw the ring on their .ui-field wrapper (ui.css, :has(input:focus-visible)).
      const cs = getComputedStyle(el.closest(".ui-field") ?? el);
      const ring = cs.outlineStyle !== "none" && cs.outlineWidth !== "0px" && cs.outlineColor !== "rgba(0, 0, 0, 0)";
      const shadow = cs.boxShadow && cs.boxShadow !== "none";
      return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).replace(/\s+/g, " ").trim().slice(0, 40), visible: ring || shadow };
    });
    if (!info) continue;
    seen.push(info.name);
    if (!info.visible) { invisible += 1; seen.push("NOFOCUS:" + info.name); }
  }
  };
  await tabThrough(70);
  // Optimize by keyboard only. On phones the constraints sheet opens first; its controls get the same focus check.
  if (vp.width < 720) {
    await page.locator("main").getByRole("button", { name: "Optimize", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Constraints" }).waitFor();
    await page.waitForTimeout(300);
    await tabThrough(40);
  }
  await page.getByRole("button", { name: "Optimize week" }).focus();
  await page.keyboard.press("Enter");
  const region = page.getByRole("region", { name: /schedules to compare|schedule fits|Nothing fits|No schedule|Still searching/ });
  const ok = await region.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  const anims = await page.evaluate(() => document.getAnimations().map((a) => a.animationName ?? a.transitionProperty ?? "?"));
  const result = { width: vp.width, tabStops: seen.length, withoutVisibleFocus: invisible, missing: seen.filter((s) => s.startsWith("NOFOCUS")), optimizeByKeyboard: ok, runningAnimations: anims };
  console.log(JSON.stringify(result));
  if (invisible > 0 || !ok) failed = true;
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
