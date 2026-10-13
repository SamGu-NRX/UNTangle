#!/usr/bin/env node
// Short real-time recordings of the shell for the PR: desktop (switch views,
// ⌘K, plan menu, a Select) and phone (tabs, the bottom sheet's detents).
// Run from a directory with playwright installed:
//   node record-shell.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const pause = (page, ms) => page.waitForTimeout(ms);
const browser = await chromium.launch();
try {
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await pause(page, 900);
    // ⌘K and the plan menu run on Map: the Courses view opens its own
    // "choose your major" dialog on a first visit, which covers the bar.
    for (const name of ["Week", "Map"]) {
      await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name }).click();
      await page.waitForLoadState("networkidle");
      await pause(page, 900);
    }
    await page.keyboard.press("Meta+k");
    await pause(page, 300);
    await page.keyboard.type("data str", { delay: 70 });
    await pause(page, 500);
    await page.keyboard.press("ArrowDown");
    await pause(page, 400);
    await page.keyboard.press("Escape");
    await pause(page, 400);
    await page.locator(".shell-planchip").click();
    await pause(page, 1100);
    await page.keyboard.press("Escape");
    await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Courses" }).click();
    await page.waitForLoadState("networkidle");
    await pause(page, 900);
    await page.goto(`${base}/dev/controls`, { waitUntil: "networkidle" });
    await pause(page, 600);
    await page.getByRole("combobox", { name: "Instructor" }).click();
    await pause(page, 700);
    await page.getByRole("option", { name: /S\. Whitfield/ }).click();
    await pause(page, 500);
    await page.getByRole("radio", { name: "Map" }).click();
    await pause(page, 400);
    await page.getByRole("radio", { name: "Week" }).click();
    await pause(page, 700);
    const video = page.video();
    await ctx.close();
    renameSync(await video.path(), join(out, "shell-desktop.webm"));
  }
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      recordVideo: { dir: out, size: { width: 390, height: 844 } },
    });
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await pause(page, 800);
    for (const name of ["Week", "Map", "Courses"]) {
      await page.locator(".shell-tabs").getByRole("link", { name }).tap();
      await page.waitForLoadState("networkidle");
      await pause(page, 800);
    }
    await page.goto(`${base}/dev/controls`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Open sheet" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Open sheet" }).click();
    await pause(page, 800);
    const handle = page.getByRole("button", { name: "Resize sheet" });
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 24; i += 1) {
      await page.mouse.move(x, y - i * 16);
      await pause(page, 16);
    }
    await pause(page, 120);
    await page.mouse.up();
    await pause(page, 900);
    const top = await handle.boundingBox();
    await page.mouse.move(x, top.y + 2);
    await page.mouse.down();
    for (let i = 1; i <= 4; i += 1) {
      await page.mouse.move(x, top.y + 2 + i * 18);
      await pause(page, 8);
    }
    await page.mouse.up();
    await pause(page, 900);
    await page.locator(".ui-sheet-scrim").click({ position: { x: 20, y: 20 } });
    await pause(page, 700);
    const video = page.video();
    await ctx.close();
    renameSync(await video.path(), join(out, "shell-phone.webm"));
  }
} finally {
  await browser.close();
}
