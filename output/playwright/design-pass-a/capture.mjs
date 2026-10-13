#!/usr/bin/env node
// Same-state captures of the pass-A screens for before/after pairs: the
// Connect entry (/connect), the plan library, sign-in and password reset, at
// 1440x900 and 390x844, fresh guest.
//   node capture.mjs <baseUrl> <outDir> <prefix>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [base, out, prefix] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const vp of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "phone", width: 390, height: 844, mobile: true },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const route of ["/connect", "/plans", "/auth", "/forgot-password"]) {
      await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(out, `${prefix}-${vp.name}-${route.slice(1)}.png`) });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
