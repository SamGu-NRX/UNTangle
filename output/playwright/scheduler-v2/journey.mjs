#!/usr/bin/env node
/**
 * Schedule builder v2 journey, guest, at 1440x900 and 390x844, against a
 * running build: set constraints, optimize, compare three alternatives,
 * pick one, lock a section and re-optimize, see a stale result refuse a
 * pick, hit an impossible case and apply its one-click fix, then reload and
 * check the pick and the lock survived. axe runs at each state, and a
 * PerformanceObserver for `longtask` records main-thread blocking from each
 * Optimize click until its search settles. Any serious or critical axe
 * finding, any long task of 50 ms or more, or any failed check exits 1.
 *
 * On phones the constraints live in a bottom sheet opened by the view
 * header's "Optimize" button; desktop has them in the left rail.
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
const report = { base, startedAt: new Date().toISOString(), checks: [], axe: [], longtasks: [] };
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

// Long tasks are recorded from page start; each Optimize reads the ones that began after its click.
const LONGTASK_OBSERVER = () => {
  window.__longtasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__longtasks.push({ start: entry.startTime, duration: entry.duration });
  }).observe({ type: "longtask", buffered: true });
};

for (const vp of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  await ctx.addInitScript(LONGTASK_OBSERVER);
  const page = await ctx.newPage();
  const shot = (name) => page.screenshot({ path: join(out, `${vp.name}-${name}.png`), fullPage: vp.name === "mobile", animations: "disabled" });
  const tag = vp.name;
  const phone = vp.name === "mobile";
  const sheet = page.getByRole("dialog", { name: "Constraints" });
  // The constraints: the rail on desktop, the sheet on phones (opened on demand).
  const constraints = async () => {
    if (!phone) return page.getByRole("group", { name: "Schedule constraints" });
    if (!(await sheet.isVisible().catch(() => false))) {
      await page.locator("main").getByRole("button", { name: "Optimize", exact: true }).click();
      await sheet.waitFor();
      await page.waitForTimeout(320);
    }
    return sheet;
  };

  /** Clicks Optimize week and returns the longest main-thread task from the click until the search settled. */
  async function optimizeMeasured(label, regionName) {
    const rail = await constraints();
    const clickedAt = await page.evaluate(() => performance.now());
    await rail.getByRole("button", { name: "Optimize week" }).click();
    const region = page.getByRole("region", { name: regionName });
    await region.waitFor({ timeout: 10000 });
    // Wait for the follow-up search when the first answer was not proven (up to its 3 s cap).
    await page.waitForFunction(() => !document.querySelector('[data-refining="true"]'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(150);
    const tasks = await page.evaluate((t0) => window.__longtasks.filter((t) => t.start >= t0), clickedAt);
    const max = tasks.reduce((m, t) => Math.max(m, t.duration), 0);
    report.longtasks.push({ viewport: tag, label, count: tasks.length, maxMs: Math.round(max) });
    check(`${tag}: no main-thread task of 50 ms or more during Optimize (${label})`, max < 50, `${tasks.length} long tasks, max ${Math.round(max)} ms`);
    return region;
  }

  await page.goto(`${base}/courses`, { waitUntil: "networkidle" });
  const major = page.locator('[role="dialog"]', { hasText: "What are you studying?" });
  if (await major.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) {
    await major.getByRole("button", { name: /Undeclared/ }).click();
    await major.getByRole("button", { name: "Confirm" }).click();
    await major.waitFor({ state: "detached" });
  }
  // Plan each course from its detail panel (Courses UI #33: status is inferred, plans are added per course).
  for (const code of ["ANTH 1010", "ENGL 1310", "PSYC 1630", "BIOL 1710"]) {
    const [subject, number] = code.split(" ");
    await page.goto(`${base}/courses/${subject.toLowerCase()}/${number}`, { waitUntil: "networkidle" });
    const add = page.getByRole("button", { name: /^Add to / }).first();
    await add.waitFor({ timeout: 10000 });
    await add.click();
    await page.getByRole("button", { name: /Remove from plan/ }).first().waitFor({ timeout: 5000 }).catch(() => {});
  }
  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check(`${tag}: inside the app shell`, (await page.locator(".shell main#main").count()) === 1);
  check(`${tag}: no page headline`, (await page.getByText("Shape the semester around one planning goal.").count()) === 0);
  // Real Spring 2027 sections since the planner switched from samples; samples only as a labeled fallback.
  check(`${tag}: provenance tag shown`, (await page.locator("main header").getByRole("button", { name: /^(Sample( sections)?|Real\b.+)$/ }).count()) === 1);
  await shot("01-week");
  await axe(page, `${tag} week`);

  // Constraints: start at 9 AM or later, Thursdays off, a work block, 15-credit cap.
  // (ANTH 1010 meets only MWF in the sample data, so a MWF day off is impossible; that case comes later.)
  let rail = await constraints();
  const start = rail.getByRole("slider", { name: "Classes start at or after" });
  await start.focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowRight");
  check(`${tag}: earliest start set to 9:00 AM`, (await start.getAttribute("aria-valuetext")) === "9:00 AM");
  await rail.getByRole("group", { name: "Days off" }).getByRole("button", { name: /Thu/ }).click();
  await rail.getByRole("button", { name: "Block time" }).click();
  check(`${tag}: work block added`, (await rail.getByText("Tue 1:00 PM–5:00 PM").count()) === 1);
  // Sol 8: clearing a time disables Block time.
  const from = rail.getByLabel("From", { exact: true });
  await from.fill("");
  check(`${tag}: Block time needs both times`, await rail.getByRole("button", { name: "Block time" }).isDisabled());
  await from.fill("13:00");
  await rail.getByRole("combobox", { name: "Max credits" }).click();
  await page.getByRole("option", { name: "15", exact: true }).click();
  check(`${tag}: max credits set to 15`, /15/.test((await rail.getByRole("combobox", { name: "Max credits" }).textContent()) ?? ""));
  await shot("02-constraints");

  let region = await optimizeMeasured("first run", /schedules to compare|schedule fits/);
  const options = region.getByRole("article");
  const optionCount = await options.count();
  check(`${tag}: three alternatives shown`, optionCount === 3, `${optionCount}`);
  const breakdownText = await options.first().textContent();
  check(`${tag}: breakdown in human units`, /Days on campus/.test(breakdownText) && /Time between classes/.test(breakdownText) && /Walking/.test(breakdownText) && /Earliest – latest/.test(breakdownText));
  const standing = (await region.getByRole("status").first().textContent()) ?? "";
  check(`${tag}: result says how far it is proven`, /Ranked by your preferences|Best possible|Best found within the time limit|Best so far/.test(standing), standing.trim());
  const meetings = await options.first().getByRole("list", { name: "Option A classes" }).getByRole("listitem").allTextContents();
  // One lock toggle per scheduled course in "In this plan".
  const courseCount = await page.getByRole("button", { name: /^Lock [A-Z]+ \d{4} section/ }).count();
  check(
    `${tag}: option A lists each class's days and times for screen readers`,
    meetings.length === courseCount && meetings.every((m) => /section \d{3}( \+ \d{3})*: .+ [AP]M to /.test(m)), // real linked options read "section 110 + 111"
    `${meetings.length} of ${courseCount} courses; ${meetings[0]}`,
  );
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
  check(`${tag}: the page never scrolls sideways with alternatives shown`, widths.scroll <= widths.view, `${widths.scroll} px wide in a ${widths.view} px viewport`);
  if (!phone) {
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
  check(`${tag}: picking option B changes the week`, canUseB && JSON.stringify(before) !== JSON.stringify(afterPick), `${afterPick.length} events`);
  check(`${tag}: no Thursday classes after picking`, (await page.locator('[data-day="Thu"] button').count()) === 0);
  check(`${tag}: Undo offered after the pick`, (await page.getByRole("button", { name: "Undo" }).count()) === 1);

  // Lock the first planned section and re-optimize: the locked course never moves.
  const lockButton = page.getByRole("button", { name: /^Lock ANTH 1010 section/ });
  await lockButton.click();
  check(`${tag}: lock pressed`, (await lockButton.getAttribute("aria-pressed")) === "true");
  check(`${tag}: Undo withdrawn once a lock changes`, (await page.getByRole("button", { name: "Undo" }).count()) === 0);
  region = await optimizeMeasured("locked re-run", /schedules to compare|schedule fits/);
  const moveTexts = await region.getByRole("article").allTextContents();
  check(`${tag}: locked course never moves in the alternatives`, moveTexts.every((text) => !/Moves[^.]*ANTH 1010/.test(text)), `${moveTexts.length} options`);
  await shot("04-locked-reoptimize");

  // Sol 1: changing a lock after a run makes its options stale; none can be used.
  const otherLock = page.getByRole("button", { name: /^Lock ENGL 1310 section/ });
  await otherLock.click();
  const useButtons = region.getByRole("button", { name: /^Use option/ });
  const useCount = await useButtons.count();
  const allDisabled = useCount === 0 || (await Promise.all(Array.from({ length: useCount }, (_, i) => useButtons.nth(i).isDisabled()))).every(Boolean);
  check(`${tag}: options found before a lock change cannot be used`, allDisabled && (await region.getByText("Your settings changed after these were found.").count()) === 1, `${useCount} use buttons`);
  await otherLock.click();
  check(`${tag}: undoing the lock change makes the options usable again`, (await region.getByText("Your settings changed after these were found.").count()) === 0);

  // Impossible: Mondays off too, but the locked ANTH 1010 section meets on Mondays.
  rail = await constraints();
  await rail.getByRole("group", { name: "Days off" }).getByRole("button", { name: /Mon/ }).click();
  const infeasible = await optimizeMeasured("infeasible", "Nothing fits these settings");
  const sentence = (await infeasible.getByRole("alert").locator("p").first().textContent()) ?? "";
  check(`${tag}: infeasible explanation names the cause`, /off/.test(sentence) && /(No section of|Your locked)/.test(sentence), sentence.slice(0, 160));
  await infeasible.scrollIntoViewIfNeeded();
  await shot("05-infeasible");
  await axe(page, `${tag} infeasible`);
  const suggestion = infeasible.getByRole("alert").getByRole("button").first();
  // ui Button draws its label twice (idle and loading); read the idle one.
  const suggestionLabel = ((await suggestion.locator(".ui-btn__label").first().textContent()) ?? "").trim();
  await suggestion.click();
  await page.waitForTimeout(900);
  const relaxedRegion = page.getByRole("region", { name: /Nothing fits these settings|schedules to compare|schedule fits/ });
  check(`${tag}: a relax suggestion applies in one click and re-optimizes`, (await relaxedRegion.count()) === 1 && suggestionLabel.length > 0, suggestionLabel);
  await shot("06-after-relax");

  // Save and reload: the picked schedule and the lock persist.
  await relaxedRegion.getByRole("button", { name: "Close" }).click().catch(() => {});
  const saved = await weekEvents(page);
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const reloaded = await weekEvents(page);
  check(`${tag}: schedule persists across reload`, JSON.stringify(saved) === JSON.stringify(reloaded), `${reloaded.length} events`);
  check(`${tag}: lock persists across reload`, (await page.getByRole("button", { name: /^Lock ANTH 1010 section/ }).getAttribute("aria-pressed")) === "true");
  rail = await constraints();
  const thu = rail.getByRole("group", { name: "Days off" }).getByRole("button", { name: /Thu/ });
  check(`${tag}: constraints persist across reload`, (await thu.getAttribute("aria-pressed")) === "true");
  if (phone) await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await shot("07-after-reload");
  await ctx.close();
}

await browser.close();
report.finishedAt = new Date().toISOString();
const maxLongtask = report.longtasks.reduce((m, t) => Math.max(m, t.maxMs), 0);
report.maxLongtaskMs = maxLongtask;
writeFileSync(join(out, "journey-report.json"), JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.ok);
console.log(`max long task during Optimize: ${maxLongtask} ms`);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
