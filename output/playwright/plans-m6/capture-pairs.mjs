#!/usr/bin/env node
// Before/after captures for the PR: the same guest steps against one build.
// Run from a directory with playwright installed: node capture-pairs.mjs <baseUrl> <outDir> <before|after>
import { chromium } from "playwright";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const [base, out, prefix] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const vp of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const shot = (name) => page.screenshot({ path: join(out, `${prefix}-${vp.name}-${name}.png`), animations: "disabled" });
  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await shot("schedule-fresh");
  await page.getByRole("link", { name: /Courses/ }).first().click();
  await page.waitForURL(/\/courses/);
  // Matched by text: on 625af0e this dialog has no accessible name.
  const major = page.locator('[role="dialog"]', { hasText: "What are you studying?" });
  if (await major.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) {
    await major.getByRole("button", { name: /Undeclared/ }).click();
    await major.getByRole("button", { name: "Confirm" }).click();
    await major.waitFor({ state: "detached" });
  }
  for (const code of ["ANTH 1010", "CSCE 1030"]) {
    await page.getByLabel("Search courses").fill(code);
    await page.locator("article.course-row", { hasText: code }).first().getByRole("button", { name: "Taking", exact: true }).click();
  }
  await page.getByRole("link", { name: /Schedule/ }).first().click();
  await page.waitForURL(/\/schedule/);
  await page.waitForTimeout(1500);
  await shot("schedule-two-courses");
  await page.getByRole("link", { name: /Plans/ }).first().click();
  await page.waitForURL(/\/plans/);
  await page.waitForTimeout(1000);
  await shot("plans");
  await ctx.close();
}
await browser.close();
console.log(`captured ${prefix}`);
