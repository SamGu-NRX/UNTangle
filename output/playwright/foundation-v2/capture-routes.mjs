#!/usr/bin/env node
// Same-state captures of the main routes at 1440x900 and 390x844, for the
// before/after pairs in the PR. Fresh guest each time; the courses major
// dialog, when it appears, is answered "Undeclared" so the page underneath
// shows. Run from a directory with playwright installed:
//   node capture-routes.mjs <baseUrl> <outDir> <prefix>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [base, out, prefix] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const vp of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "phone", width: 390, height: 844, isMobile: true, hasTouch: true },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile ?? false,
      hasTouch: vp.hasTouch ?? false,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    for (const route of ["/", "/courses", "/schedule", "/map"]) {
      await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const major = page.locator('[role="dialog"]', { hasText: "What are you studying?" });
      if (await major.isVisible().catch(() => false)) {
        // DOM clicks: at 390px the v1 dialog's header overlaps its own buttons,
        // so a pointer click on "Confirm" is intercepted.
        await major.getByRole("button", { name: /Undeclared/ }).evaluate((el) => el.click());
        await major.getByRole("button", { name: "Confirm" }).evaluate((el) => el.click());
        await major.waitFor({ state: "detached" });
        await page.waitForTimeout(400);
      }
      const name = route === "/" ? "home" : route.slice(1);
      await page.screenshot({ path: join(out, `${prefix}-${vp.name}-${name}.png`), animations: "disabled" });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
