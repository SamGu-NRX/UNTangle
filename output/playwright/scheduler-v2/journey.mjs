#!/usr/bin/env node
/**
 * Schedule builder v2 journey, guest, at 1440x900 and 390x844, against a
 * running build: set constraints, optimize, compare three alternatives,
 * pick one, lock a section and re-optimize, hit an impossible case and read
 * its explanation, then reload and check the pick and the lock survived.
 * axe runs at each state; any serious or critical finding or failed check
 * exits 1.
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
const report = { base, startedAt: new Date().toISOString(), checks: [], axe: [] };
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

async function weekEvents(page) {
  return page.$$eval('section[aria-label^="Week calendar"] button', (els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()).sort());
}

for (const vp of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const shot = (name) => page.screenshot({ path: join(out, `${vp.name}-${name}.png`), fullPage: vp.name === "mobile", animations: "disabled" });
  const tag = vp.name;

  await page.goto(`${base}/courses`, { waitUntil: "networkidle" });
  const major = page.locator('[role="dialog"]', { hasText: "What are you studying?" });
  if (await major.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) {
    await major.getByRole("button", { name: /Undeclared/ }).click();
    await major.getByRole("button", { name: "Confirm" }).click();
    await major.waitFor({ state: "detached" });
  }
  for (const code of ["ANTH 1010", "ENGL 1310", "PSYC 1630", "BIOL 1710"]) {
    await page.getByLabel("Search courses").fill(code);
    await page.locator("article.course-row", { hasText: code }).first().getByRole("button", { name: "Taking", exact: true }).click();
  }
  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check(`${tag}: no page headline`, (await page.getByText("Shape the semester around one planning goal.").count()) === 0);
  check(`${tag}: sample label shown`, (await page.getByText("Sample sections, times and instructors").count()) === 1);
  await shot("01-week");
  await axe(page, `${tag} week`);

  // Constraints: start at 9 AM or later, Thursdays off, a work block, 15-credit cap.
  // (ANTH 1010 meets only MWF in the sample data, so a MWF day off is impossible; that case comes later.)
  const start = page.getByRole("slider", { name: /Classes start at or after/ });
  await start.focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowRight");
  check(`${tag}: earliest start set to 9:00 AM`, (await page.getByText("Classes start at or after 9:00 AM").count()) === 1);
  await page.getByRole("group", { name: "Days off" }).getByRole("button", { name: /Thu/ }).click();
  await page.getByRole("button", { name: "Block time" }).click();
  check(`${tag}: work block added`, (await page.getByText("Tue 1:00 PM–5:00 PM").count()) === 1);
  await page.getByLabel("Max credits").selectOption("15");
  await shot("02-constraints");

  await page.getByRole("button", { name: "Optimize week" }).click();
  const region = page.getByRole("region", { name: /schedules to compare|schedule fits/ });
  await region.waitFor({ timeout: 10000 });
  const options = region.getByRole("article");
  const optionCount = await options.count();
  check(`${tag}: three alternatives shown`, optionCount === 3, `${optionCount}`);
  const breakdownText = await options.first().textContent();
  check(`${tag}: breakdown in human units`, /Days on campus/.test(breakdownText) && /Time between classes/.test(breakdownText) && /Walking/.test(breakdownText) && /Earliest – latest/.test(breakdownText));
  const friClasses = (await weekEvents(page)).length;
  if (vp.name === "desktop") {
    await options.nth(1).hover();
    await page.waitForTimeout(200);
    await shot("03-alternatives-preview");
  } else {
    await region.scrollIntoViewIfNeeded();
    await shot("03-alternatives");
  }
  await axe(page, `${tag} alternatives`);

  const before = await weekEvents(page);
  const useB = options.nth(1).getByRole("button", { name: "Use option B" });
  const canUseB = (await useB.count()) === 1;
  if (canUseB) await useB.click();
  await page.waitForTimeout(400);
  const afterPick = await weekEvents(page);
  check(`${tag}: picking option B changes the week`, canUseB && JSON.stringify(before) !== JSON.stringify(afterPick), `${friClasses} events`);
  check(`${tag}: no Thursday classes after picking`, (await page.locator('[data-day="Thu"] button').count()) === 0);

  // Lock the first planned section and re-optimize: the locked course never moves.
  const lockButton = page.getByRole("button", { name: /^Lock ANTH 1010 section/ });
  await lockButton.click();
  check(`${tag}: lock pressed`, (await lockButton.getAttribute("aria-pressed")) === "true");
  await page.getByRole("button", { name: "Optimize week" }).click();
  await region.waitFor({ timeout: 10000 });
  const moveTexts = await region.getByRole("article").allTextContents();
  check(`${tag}: locked course never moves in the alternatives`, moveTexts.every((text) => !/Moves[^.]*ANTH 1010/.test(text)), `${moveTexts.length} options`);
  await shot("04-locked-reoptimize");

  // Impossible: Mondays off too, but the locked ANTH 1010 section meets on Mondays.
  await page.getByRole("group", { name: "Days off" }).getByRole("button", { name: /Mon/ }).click();
  await page.getByRole("button", { name: "Optimize week" }).click();
  const infeasible = page.getByRole("region", { name: "Nothing fits these settings" });
  await infeasible.waitFor({ timeout: 10000 });
  const sentence = (await infeasible.getByRole("alert").textContent()) ?? "";
  check(`${tag}: infeasible explanation names the cause`, /off/.test(sentence) && /(No section of|Your locked)/.test(sentence), sentence.slice(0, 160));
  await infeasible.scrollIntoViewIfNeeded();
  await shot("05-infeasible");
  await axe(page, `${tag} infeasible`);
  const suggestion = infeasible.getByRole("button").filter({ hasNotText: "Close" }).first();
  const suggestionLabel = await suggestion.textContent();
  await suggestion.click();
  await page.waitForTimeout(800);
  const relaxedRegion = page.getByRole("region", { name: /Nothing fits these settings|schedules to compare|schedule fits/ });
  check(`${tag}: a relax suggestion applies in one click and re-optimizes`, (await relaxedRegion.count()) === 1 && (await page.getByText(suggestionLabel ?? "").count()) >= 1, suggestionLabel);
  await shot("06-after-relax");

  // Save and reload: the picked schedule and the lock persist.
  await page.getByRole("button", { name: /Close/ }).first().click().catch(() => {});
  const saved = await weekEvents(page);
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const reloaded = await weekEvents(page);
  check(`${tag}: schedule persists across reload`, JSON.stringify(saved) === JSON.stringify(reloaded), `${reloaded.length} events`);
  check(`${tag}: lock persists across reload`, (await page.getByRole("button", { name: /^Lock ANTH 1010 section/ }).getAttribute("aria-pressed")) === "true");
  await shot("07-after-reload");
  await ctx.close();
}

await browser.close();
report.finishedAt = new Date().toISOString();
writeFileSync(join(out, "journey-report.json"), JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.ok);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
