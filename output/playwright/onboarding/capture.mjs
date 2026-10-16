#!/usr/bin/env node
/**
 * Set up Auto at 1440 and 390, every step, over a week of four courses, and
 * each step beside the r3 mockup's matching step (docs/design/mockups/r3/
 * onboarding.html). For PR evidence and visual QA; the journey beside it is
 * the test.
 *
 * The seed is a guest who added four courses on Week (and skipped the setup
 * to do it); its "seen" flag and preferences are dropped, so each capture
 * opens Week as that student's first visit with courses already planned.
 *
 * Writes <outDir>/app/<width>-<step>.png, <outDir>/mock/<width>-<step>.png
 * and <outDir>/side/<width>-<step>.png (mockup left, app right).
 *
 * Usage: node capture.mjs <baseUrl> <outDir>
 * Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROMIUM_PATH (optional executable).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const [base, outArg] = process.argv.slice(2);
const out = resolve(outArg);
for (const dir of ["app", "mock", "side"]) mkdirSync(join(out, dir), { recursive: true });
const here = dirname(fileURLToPath(import.meta.url));
const MOCKUP = pathToFileURL(resolve(here, "../../../docs/design/mockups/r3/onboarding.html")).href;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const COURSES = ["ANTH 1010", "ENGL 1310", "PSYC 1630", "BIOL 1710"];
/** App step name, and the mockup's ?step= that draws the same screen. */
const STEPS = [
  ["01-time", 0],
  ["02-fewer-days", 1],
  ["03-walks", 2],
  ["04-rating", 3],
  ["05-shape", 4],
  ["06-ready", 7],
];

async function seed() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  const setup = page.getByRole("dialog", { name: "Set up Auto" });
  await setup.waitFor({ timeout: 15000 });
  await page.keyboard.press("Escape");
  await setup.waitFor({ state: "hidden" });
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
  const data = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("untangle") && !k.startsWith("untangle-setup-auto-seen") && !k.startsWith("untangle-schedule-preferences"))
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  );
  await ctx.close();
  return data;
}

async function app(data, vp) {
  const phone = vp.width < 600;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript((d) => {
    if (sessionStorage.getItem("__seeded")) return;
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
    sessionStorage.setItem("__seeded", "1");
  }, data);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`${vp.width} pageerror: ${e.message.split("\n")[0]}`));
  const shot = (name) => page.screenshot({ path: join(out, "app", `${vp.width}-${name}.png`), animations: "disabled" });
  const setup = page.getByRole("dialog", { name: "Set up Auto" });
  const next = () => setup.getByRole("button", { name: "Continue", exact: true }).click();
  const settle = () => page.waitForTimeout(phone ? 700 : 450);

  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  await setup.waitFor({ timeout: 15000 });
  await settle();
  for (const [answer, name] of [
    ["Mornings, if they fit", "01-time"],
    ["Some", "02-fewer-days"],
    ["A lot", "03-walks"],
    ["Some", "04-rating"],
  ]) {
    await setup.getByRole("radio", { name: answer }).click();
    await page.mouse.move(0, 0);
    await settle();
    await shot(name);
    await next();
    await settle();
  }

  // Shape of your days: 9 AM start, and work Tuesday and Thursday 3 to 5. (No day off: every seeded
  // course meets Monday, Wednesday and Friday, so Auto would find nothing; the journey covers days off.)
  const sun = setup.getByRole("slider", { name: "Earliest class start" });
  await sun.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const grid = setup.getByRole("application");
  await grid.scrollIntoViewIfNeeded();
  const box = await grid.boundingBox();
  const y = (m) => box.y + ((m - 480) / 840) * box.height;
  const x = (d) => box.x + (d + 0.5) * (box.width / 5);
  if (phone) {
    for (const d of [1, 3]) for (const m of [915, 945, 975, 1005]) await page.touchscreen.tap(x(d), y(m));
  } else {
    for (const d of [1, 3]) {
      await page.mouse.move(x(d), y(905));
      await page.mouse.down();
      await page.mouse.move(x(d), y(1015), { steps: 4 });
      await page.mouse.up();
    }
  }
  const nameField = setup.getByRole("textbox", { name: "Name this busy time" }).first();
  if (await nameField.count()) {
    await nameField.fill("Work");
    await nameField.press("Enter");
  }
  await page.mouse.move(0, 0);
  await setup.locator("h2").evaluate((h) => h.closest(".ui-dialog__body, .ui-sheet__body").scrollTo({ top: 0 }));
  await settle();
  await shot("05-shape");
  await setup.getByRole("slider", { name: "Time between classes" }).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await settle();
  await shot("05-shape-gaps");
  await next();
  await settle();
  await shot("06-ready");

  // Build my week runs Auto: its first option previews on the week, with the Undo toast for the answers.
  await setup.getByRole("button", { name: "Build my week", exact: true }).click();
  await page.getByRole("button", { name: "Use this" }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await shot("07-built");
  await page.locator(".ui-toast").getByRole("button", { name: "Dismiss" }).click();
  await page.locator("main").getByRole("button", { name: /^Preferences/ }).click();
  await settle();
  await shot("08-preferences");
  await ctx.close();
}

async function mock() {
  const page = await (await browser.newContext({ viewport: { width: 1840, height: 1100 }, deviceScaleFactor: 2 })).newPage();
  for (const [name, step] of STEPS) {
    await page.goto(`${MOCKUP}?step=${step}&answered=1`);
    await page.waitForTimeout(900);
    await page.locator("#dk").screenshot({ path: join(out, "mock", `1440-${name}.png`) });
    await page.locator(".ph").screenshot({ path: join(out, "mock", `390-${name}.png`) });
  }
  await page.context().close();
}

async function sideBySide() {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
  for (const width of [1440, 390]) {
    for (const [name] of STEPS) {
      const img = (dir) => `data:image/png;base64,${readFileSync(join(out, dir, `${width}-${name}.png`)).toString("base64")}`;
      const h = width === 1440 ? 640 : 760;
      await page.setContent(`<body style="margin:0;padding:16px;background:#e9ece8;font:600 13px system-ui;color:#33463a;display:flex;gap:16px;width:max-content">
        <figure style="margin:0"><figcaption style="margin:0 0 6px">Mockup (r3)</figcaption><img src="${img("mock")}" style="height:${h}px;display:block;border-radius:8px"></figure>
        <figure style="margin:0"><figcaption style="margin:0 0 6px">App, ${width} wide</figcaption><img src="${img("app")}" style="height:${h}px;display:block;border-radius:8px"></figure></body>`);
      await page.waitForTimeout(100);
      await page.locator("body").screenshot({ path: join(out, "side", `${width}-${name}.png`) });
    }
  }
}

const data = await seed();
for (const vp of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) await app(data, vp);
await mock();
await sideBySide();
await browser.close();
console.log(out);
