#!/usr/bin/env node
/**
 * Week's states for review, at 1440 and 390, as a guest with a real CS plan:
 * empty, the week with a plan, Preferences open (hard limits, then leanings),
 * Auto's result, and a clash.
 *
 * The plan is seeded through Week's own search (CSCE 1040, CSCE 2100,
 * MATH 1720, ENGL 1310: the term after CSCE 1030), then Auto runs once and
 * its first option is used. The seeded localStorage (`untangle.*`, which holds
 * `untangle.planner-state.v1:guest`) is saved and replayed into each width.
 *
 * Usage: node states.mjs <baseUrl> <outDir> [seedFile]
 * Env: PLAYWRIGHT_MODULE (path to playwright-core's index.mjs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const [base, out, seedFile = "/tmp/week-states-seed.json"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const PLAN = ["CSCE 1040", "CSCE 2100", "MATH 1720", "ENGL 1310"];
const log = (...a) => console.log(...a);

const findPanel = (page) => page.locator("aside", { has: page.getByRole("heading", { name: "Find courses", exact: true }) });

async function seed() {
  if (existsSync(seedFile)) return JSON.parse(readFileSync(seedFile, "utf8"));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  for (const code of PLAN) {
    await page.getByRole("button", { name: /^Search courses/ }).first().click();
    const find = findPanel(page);
    await find.waitFor();
    await find.getByRole("searchbox").fill(code);
    await find.getByRole("button", { name: new RegExp(`^${code}`) }).first().click();
    // A section that doesn't clash with what's already on the week, as a student would pick.
    const add = find.getByRole("button", { name: /^Add section [^,]+$/ }).first();
    await add.waitFor({ timeout: 20000 });
    await add.click();
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  // Auto once, and use its first option.
  await page.getByRole("button", { name: /^Auto/ }).first().click();
  const use = page.getByRole("region", { name: "Other weeks Auto found" }).getByRole("button", { name: "Use this" });
  await use.waitFor({ timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Use this" && !b.disabled), null, { timeout: 20000 });
  await use.click();
  await page.waitForTimeout(800);
  const data = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("untangle")).map((k) => [k, localStorage.getItem(k)])));
  if (!Object.keys(data).some((k) => k.endsWith(":guest"))) throw new Error(`No guest planner state saved: ${Object.keys(data).join(", ")}`);
  writeFileSync(seedFile, JSON.stringify(data));
  await ctx.close();
  return data;
}

const data = await seed();
log("seeded", Object.keys(data).join(", "));

for (const vp of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
]) {
  const phone = vp.width < 600;
  const contextOptions = { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone };
  const shotOf = (page) => (name) => page.screenshot({ path: join(out, `${vp.name}-${name}.png`) });

  // Empty: a first visit, nothing stored.
  {
    const ctx = await browser.newContext(contextOptions);
    const page = await ctx.newPage();
    await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Add your first course" }).waitFor();
    await page.waitForTimeout(500);
    await shotOf(page)("01-empty");
    await ctx.close();
  }

  const ctx = await browser.newContext(contextOptions);
  await ctx.addInitScript((d) => {
    if (sessionStorage.getItem("__seeded")) return;
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
    sessionStorage.setItem("__seeded", "1");
  }, data);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log(`${vp.name} pageerror: ${e.message}`));
  const shot = shotOf(page);
  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  await page.locator("[data-event]").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await shot("02-week");

  // Preferences: hard limits as a student sets them, then the leanings.
  await page.getByRole("button", { name: /^Preferences/ }).click();
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await prefs.waitFor();
  await page.waitForTimeout(700);
  const sun = prefs.getByRole("slider", { name: "Earliest class start" });
  await sun.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await prefs.getByRole("button", { name: "Fridays off" }).click();
  const grid = prefs.getByRole("application");
  await grid.scrollIntoViewIfNeeded();
  const box = await grid.boundingBox();
  const y = (m) => box.y + ((m - 480) / 840) * box.height;
  const x = (d) => box.x + (d + 0.5) * (box.width / 5);
  if (phone) {
    for (const d of [1, 3]) for (const m of [1035, 1065, 1095, 1125]) await page.touchscreen.tap(x(d), y(m));
  } else {
    await page.mouse.move(x(1), y(1025));
    await page.mouse.down();
    await page.mouse.move(x(3), y(1135), { steps: 6 });
    await page.mouse.up();
    await page.mouse.move(x(2), y(1025));
    await page.mouse.down();
    await page.mouse.move(x(2), y(1135), { steps: 4 });
    await page.mouse.up();
  }
  const name = prefs.getByRole("textbox", { name: "Name this busy time" }).first();
  if (await name.count()) {
    await name.fill("Work");
    await name.press("Enter");
  }
  await page.waitForTimeout(300);
  // Back to the top of the panel body, as the student sees it on opening.
  await prefs.getByRole("heading", { name: "Times you can't have class" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);
  await shot("03-preferences-limits");
  await prefs.getByRole("button", { name: /^Fewer days on campus/ }).click();
  await page.waitForTimeout(350);
  const slider = prefs.getByRole("slider", { name: "How much it matters" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await prefs.getByRole("heading", { name: "Leanings" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);
  await shot("04-preferences-leanings");
  for (let i = 0; i < 3 && (await prefs.isVisible()); i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(phone ? 500 : 250);
  }

  // Auto under those preferences: one alternative at a time.
  await page.getByRole("button", { name: /^Auto/ }).first().click();
  const strip = page.getByRole("region", { name: "Other weeks Auto found" });
  const nothing = page.getByRole("region", { name: "Auto found nothing" });
  await Promise.race([strip.waitFor({ timeout: 20000 }), nothing.waitFor({ timeout: 20000 })]);
  await page.waitForTimeout(1200);
  await shot("05-auto");
  log(vp.name, "auto:", ((await (await strip.count() ? strip : nothing).textContent()) ?? "").replace(/\s+/g, " ").slice(0, 160));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // A clash: move a course onto a section that overlaps another class, from its own panel.
  const events = page.locator("[data-event]");
  const codes = [...new Set(await events.evaluateAll((els) => els.map((e) => e.getAttribute("data-key")?.split("#")[0])))];
  let clashed = false;
  for (const code of codes) {
    await page.locator(`[data-event][data-key^="${code}#"]`).first().click();
    const panel = phone ? page.getByRole("dialog", { name: code }) : page.locator("aside", { has: page.getByRole("heading", { name: code, exact: true }) });
    await panel.waitFor();
    await page.waitForTimeout(phone ? 600 : 300);
    const overlap = panel.getByRole("button", { name: /overlap/i }).first();
    await page.waitForTimeout(600);
    if (await overlap.count()) {
      await overlap.click();
      clashed = true;
      await page.waitForTimeout(600);
      for (let i = 0; i < 2; i += 1) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      }
      break;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(phone ? 500 : 300);
  }
  log(vp.name, "clash made:", clashed);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await shot("06-conflict");
  await ctx.close();
}
await browser.close();
