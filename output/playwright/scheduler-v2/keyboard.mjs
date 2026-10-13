// Keyboard-only and reduced-motion pass over /schedule. Usage: node keyboard.mjs <baseUrl>
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const [base] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const seen = [];
  let invisible = 0;
  for (let i = 0; i < 70; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring = cs.outlineStyle !== "none" && cs.outlineWidth !== "0px";
      const shadow = cs.boxShadow && cs.boxShadow !== "none";
      return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).replace(/\s+/g, " ").trim().slice(0, 40), visible: ring || shadow };
    });
    if (!info) continue;
    seen.push(info.name);
    if (!info.visible) { invisible += 1; seen.push("NOFOCUS:" + info.name); }
  }
  // Optimize by keyboard only.
  await page.getByRole("button", { name: "Optimize week" }).focus();
  await page.keyboard.press("Enter");
  const region = page.getByRole("region", { name: /schedules to compare|schedule fits|Nothing fits/ });
  const ok = await region.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  const anims = await page.evaluate(() => document.getAnimations().map((a) => a.animationName ?? a.transitionProperty ?? "?"));
  console.log(JSON.stringify({ width: vp.width, tabStops: seen.length, withoutVisibleFocus: invisible, missing: seen.filter((s) => s.startsWith("NOFOCUS")), optimizeByKeyboard: ok, runningAnimations: anims }));
  await ctx.close();
}
await browser.close();
