#!/usr/bin/env node
/**
 * Week and its Preferences popover at 1440, 390 and 360, with a seeded guest
 * week: four courses added through Week's own search, one tap each.
 *
 * "before" shoots Week and the old Preferences panel. "after" also drives the
 * popover the way a student would: sun knob to 9 AM, Fridays off, paint Tue
 * and Thu 3–5 PM and name it Work, raise Short walks, lock a section, open
 * More settings, then close and shoot the week behind it.
 *
 * Usage: node capture.mjs <baseUrl> <outDir> <before|after>
 * Env: PLAYWRIGHT_MODULE (path to playwright-core's index.mjs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const [base, out, phase] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const SEED = "/tmp/v3-week-seed.json";
const COURSES = ["ANTH 1010", "ENGL 1310", "PSYC 1630", "BIOL 1710"];

async function seed() {
  if (existsSync(SEED)) return JSON.parse(readFileSync(SEED, "utf8"));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  for (const code of COURSES) {
    await page.getByRole("button", { name: "Search courses or class numbers" }).click();
    const find = page.locator("aside", { has: page.getByRole("heading", { name: "Find courses", exact: true }) });
    await find.waitFor();
    await find.getByRole("searchbox", { name: "Search courses" }).fill(code);
    await find.getByRole("button", { name: new RegExp(`^${code}`) }).first().click();
    const add = find.getByRole("button", { name: /^Add section [^,]+$/ }).first();
    await add.waitFor({ timeout: 20000 });
    await add.click();
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  const data = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("untangle")).map((k) => [k, localStorage.getItem(k)])));
  writeFileSync(SEED, JSON.stringify(data));
  await ctx.close();
  return data;
}

const data = await seed();
const only = process.env.WIDTHS?.split(",").map(Number);

for (const vp of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
  { name: "360", width: 360, height: 780 },
].filter((v) => !only || only.includes(v.width))) {
  const phone = vp.width < 600;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript((d) => {
    if (sessionStorage.getItem("__seeded")) return;
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
    sessionStorage.setItem("__seeded", "1");
  }, data);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`${vp.name} pageerror: ${e.message}`));
  const shot = (name) => page.screenshot({ path: join(out, `${vp.name}-${name}.png`) });
  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await shot("week");
  await page.getByRole("button", { name: /^Preferences/ }).first().click();
  await page.waitForTimeout(900);
  await shot("preferences");
  if (phase === "after") {
    const dlg = phone ? page.locator(".ui-sheet") : page.getByRole("dialog", { name: "Preferences" });
    const sun = dlg.getByRole("slider", { name: "Earliest class start" });
    await sun.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await dlg.getByRole("button", { name: "Fri off" }).click();
    const grid = dlg.getByRole("application");
    await grid.scrollIntoViewIfNeeded();
    const box = await grid.boundingBox();
    const y = (m) => box.y + ((m - 480) / 840) * box.height;
    const x = (d) => box.x + (d + 0.5) * (box.width / 5);
    if (phone) {
      // Touch: tap half hours one at a time (a hold-then-drag needs real touch input).
      for (const d of [1, 3]) for (const m of [915, 945, 975, 1005]) await page.touchscreen.tap(x(d), y(m));
    } else {
      await page.mouse.move(x(1), y(905));
      await page.mouse.down();
      await page.mouse.move(x(2), y(960), { steps: 4 });
      await page.mouse.move(x(3), y(1015), { steps: 4 });
      await page.mouse.up();
      // Starting on blocked time frees: take Wednesday back out.
      await page.mouse.move(x(2), y(905));
      await page.mouse.down();
      await page.mouse.move(x(2), y(1015), { steps: 4 });
      await page.mouse.up();
    }
    const name = dlg.getByRole("textbox", { name: "Name this busy time" }).first();
    if (await name.count()) {
      await name.fill("Work");
      await name.press("Enter");
    }
    await page.waitForTimeout(300);
    await dlg.getByRole("heading", { name: "Preferences" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot("preferences-painted");
    await dlg.getByRole("button", { name: /^Short walks/ }).first().click();
    await page.waitForTimeout(350);
    const slider = dlg.getByRole("slider", { name: "How much it matters" });
    await slider.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    await slider.evaluate((el) => el.closest("[role=region]").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    await shot("preferences-leaning");
    await dlg.getByRole("button", { name: "Lock a section" }).click();
    await page.waitForTimeout(250);
    await dlg.getByRole("group", { name: "Lock a section" }).getByRole("button").first().click();
    await page.waitForTimeout(400);
    await dlg.getByRole("button", { name: "More settings" }).click();
    await page.waitForTimeout(500);
    await dlg.getByRole("heading", { name: "Courses and sections" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot("preferences-courses");
    await dlg.getByRole("button", { name: "More settings" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot("preferences-more");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    await shot("week-after-prefs");
  }
  await ctx.close();
}
await browser.close();
