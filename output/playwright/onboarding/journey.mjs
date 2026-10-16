#!/usr/bin/env node
/**
 * Set up Auto journey, guest, at 1440x900 and 390x844 (a touch phone),
 * against a running build.
 *
 * Complete: a new guest's first visit to Week opens the setup by itself;
 * each answer shows on Week's Preferences button at once; the shape step's
 * grid takes Fridays off and a 10 AM start; Ready lists them; Done saves
 * them with Undo, Preferences shows every answer, and a reload doesn't
 * open the setup again. Skip: closing it marks it seen, so a reload doesn't
 * open it even with no preferences saved, and Preferences' "Set up Auto"
 * opens it again with the answers Auto follows now. Focus stays inside
 * while it is open and returns to Preferences when it closes. axe runs on
 * every step at both sizes; any serious or critical finding, or any failed
 * check, exits 1.
 *
 * Usage: node journey.mjs <baseUrl> <outDir>
 * Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), AXE_PATH (axe.min.js),
 * CHROMIUM_PATH (optional executable).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const AXE = readFileSync(process.env.AXE_PATH, "utf8");
const report = { base, startedAt: new Date().toISOString(), checks: [], axe: [], hydration: [] };
const check = (name, ok, detail = null) => {
  report.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
  const all = result.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}`);
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  report.axe.push({ label, violations: all, blocking: blocking.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) })) });
  check(`axe zero serious/critical: ${label}`, blocking.length === 0, all.join(", ") || null);
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, phone: false },
  { name: "mobile", width: 390, height: 844, phone: true },
];

async function open(vp, options = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.phone, isMobile: vp.phone, ...options });
  const page = await ctx.newPage();
  const errors = [];
  // The dev server reports a hydration mismatch in the shell's AccountMenu on some reloads, a
  // known defect outside this feature. It is listed in the report, not counted as this journey's error.
  page.on("pageerror", (error) => {
    if (error.message.startsWith("Hydration failed")) report.hydration.push(error.message.split("\n")[0]);
    else errors.push(error.message);
  });
  const setup = page.getByRole("dialog", { name: "Set up Auto" });
  const main = page.locator("main");
  const prefsButton = main.getByRole("button", { name: /^Preferences/ });
  const prefsDialog = page.getByRole("dialog", { name: "Preferences" });
  // The sheet springs open on phones; let it settle before reading or shooting it.
  const settle = () => page.waitForTimeout(vp.phone ? 600 : 300);
  const shot = (name) => page.screenshot({ path: join(out, `${vp.name}-${name}.png`), animations: "disabled" });
  /** The count on Week's Preferences button: how many choices differ from the defaults. */
  const prefCount = () => prefsButton.evaluate((el) => Number(el.querySelector("span")?.textContent ?? 0));
  const heading = () => setup.locator("h2").textContent();
  return { ctx, page, errors, setup, main, prefsButton, prefsDialog, settle, shot, prefCount, heading };
}

for (const vp of VIEWPORTS) {
  const tag = vp.name;

  /* ───────── Complete it ───────── */
  {
    const { ctx, page, errors, setup, prefsButton, prefsDialog, settle, shot, prefCount, heading } = await open(vp);
    await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
    await setup.waitFor({ timeout: 15000 });
    await settle();
    check(`${tag}: a new guest's first visit to Week opens Set up Auto`, await setup.isVisible());
    check(`${tag}: it opens on the first question`, (await heading()) === "When do you like your classes?", await heading());
    check(`${tag}: Continue waits for an answer`, await setup.getByRole("button", { name: "Continue", exact: true }).isDisabled());
    await shot("01-time");
    await axe(page, `${tag} step 1, time of day`);

    // Focus stays inside: Tab around the dialog and back.
    let inside = true;
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      inside &&= await setup.evaluate((el) => el.contains(document.activeElement));
    }
    check(`${tag}: Tab never leaves the setup`, inside);

    const before = await prefCount();
    await setup.getByRole("radio", { name: "Mornings, if they fit" }).click();
    await page.waitForTimeout(400);
    check(`${tag}: an answer shows on Week's Preferences button at once`, (await prefCount()) === before + 1, `${before} to ${await prefCount()}`);
    // The caption under the picture, and the same words announced once for the pick.
    check(`${tag}: the picture says what Auto does with it`, (await setup.locator("p", { hasText: "Auto leans toward morning sections." }).count()) === 1);
    check(`${tag}: the pick is announced`, (await setup.locator('[aria-live="polite"]', { hasText: "Auto leans toward morning sections." }).count()) === 1);
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForTimeout(350);

    check(`${tag}: step 2 asks about fewer days`, (await heading()) === "How much do fewer days on campus matter?", await heading());
    await setup.getByRole("radio", { name: "A lot" }).click();
    await shot("02-fewer-days");
    await axe(page, `${tag} step 2, fewer days`);
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForTimeout(350);

    check(`${tag}: step 3 asks about short walks`, (await heading()) === "How much do short walks between classes matter?", await heading());
    await shot("03-walks");
    await axe(page, `${tag} step 3, short walks`);
    await setup.getByRole("button", { name: "Skip this question" }).click();
    await page.waitForTimeout(350);

    check(`${tag}: step 4 asks about instructors`, (await heading()) === "How much do well\u2011rated instructors matter?", await heading());
    await setup.getByRole("radio", { name: "Some" }).click();
    await shot("04-rating");
    await axe(page, `${tag} step 4, instructors`);
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForTimeout(350);

    check(`${tag}: step 5 is the shape of the days`, (await heading()) === "When can you have class?", await heading());
    await setup.getByRole("button", { name: "Fridays off" }).click();
    const sun = setup.getByRole("slider", { name: "Earliest class start" });
    await sun.focus();
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(300);
    check(`${tag}: the grid takes Fridays off and a 10 AM start`, (await setup.getByText("Fridays off", { exact: true }).count()) === 1 && (await setup.getByText("No class before 10 AM").count()) === 1);
    await shot("05-shape");
    await axe(page, `${tag} step 5, shape of your days`);
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForTimeout(350);

    check(`${tag}: Ready says what Auto will follow`, (await heading()) === "What Auto will follow", await heading());
    const ready = await setup.textContent();
    check(`${tag}: Ready lists every answer`, ["Earlier", "A lot", "Some", "Fridays off", "No class before 10 AM"].every((t) => ready.includes(t)), ready.slice(0, 200));
    await shot("06-ready");
    await axe(page, `${tag} step 6, ready`);
    // No course on the week yet, so there is nothing to build: Done.
    await setup.getByRole("button", { name: "Done", exact: true }).click();
    await setup.waitFor({ state: "hidden", timeout: 5000 });
    await page.waitForTimeout(300);
    check(`${tag}: Done closes it and offers Undo`, (await page.locator(".ui-toast", { hasText: "Saved your answers to Preferences" }).getByRole("button", { name: "Undo" }).count()) === 1);
    check(`${tag}: focus returns to Preferences`, await prefsButton.evaluate((el) => el === document.activeElement));
    await shot("07-done");

    // Week's Preferences shows every answer.
    await page.locator(".ui-toast").getByRole("button", { name: "Dismiss" }).click();
    await prefsButton.click();
    await prefsDialog.waitFor();
    await settle();
    const prefs = await prefsDialog.textContent();
    check(
      `${tag}: Preferences shows the answers`,
      ["Earlier", "A lot", "Fridays off", "No class before 10 AM"].every((t) => prefs.includes(t)) && (await prefsDialog.getByRole("button", { name: /^Well-rated instructors/ }).textContent()).includes("Some"),
    );
    await shot("08-preferences");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    check(`${tag}: a reload doesn't open it again`, (await setup.count()) === 0);
    check(`${tag}: the answers survive the reload`, (await prefCount()) === before + 5, `${await prefCount()} changed`);
    check(`${tag}: no page errors`, errors.length === 0, errors.join(" | ") || null);
    await ctx.close();
  }

  /* ───────── Skip it, then open it from Preferences ───────── */
  {
    const { ctx, page, errors, setup, prefsButton, prefsDialog, settle, shot, heading } = await open(vp, { reducedMotion: "reduce" });
    await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
    await setup.waitFor({ timeout: 15000 });
    await settle();
    await setup.getByRole("radio", { name: "No preference" }).click();
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForTimeout(200);
    const animation = await setup.locator("h2").evaluate((h) => getComputedStyle(h.parentElement).animationName);
    check(`${tag}: with reduced motion a new step only fades`, /pane-fade/.test(animation), animation);
    await setup.getByRole("button", { name: "Back" }).click();
    await setup.getByRole("button", { name: "Skip this question" }).click();
    // Skipping the question put it back: nothing is changed, so closing is a plain skip.
    await setup.getByRole("button", { name: vp.phone ? "Skip setup" : "Close", exact: true }).click();
    await setup.waitFor({ state: "hidden", timeout: 5000 });
    await page.waitForTimeout(300);
    check(`${tag}: skipping says so and offers it again`, (await page.locator(".ui-toast", { hasText: "Skipped setup" }).getByRole("button", { name: "Show setup again" }).count()) === 1);
    await shot("09-skipped");

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    check(`${tag}: after a skip, a reload doesn't open it again`, (await setup.count()) === 0);

    await prefsButton.click();
    await prefsDialog.waitFor();
    await settle();
    await prefsDialog.getByRole("button", { name: "Set up Auto" }).click();
    await setup.waitFor({ timeout: 5000 });
    await settle();
    check(`${tag}: Preferences opens it again`, (await heading()) === "When do you like your classes?");
    check(
      `${tag}: opened again, it shows the answer Auto follows now`,
      (await setup.getByRole("radio", { name: "As early as I can" }).getAttribute("aria-checked")) === "true",
    );
    await shot("10-again");
    await axe(page, `${tag} opened again from Preferences`);
    await page.keyboard.press("Escape");
    await setup.waitFor({ state: "hidden", timeout: 5000 });
    check(`${tag}: Escape closes it, back on Preferences`, await prefsButton.evaluate((el) => el === document.activeElement));
    check(`${tag}: no page errors (skip)`, errors.length === 0, errors.join(" | ") || null);
    await ctx.close();
  }
}

await browser.close();
report.finishedAt = new Date().toISOString();
writeFileSync(join(out, "journey-report.json"), JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.ok);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
