#!/usr/bin/env node
/**
 * The first-time student fixes from the UX walk (October 2026), in a real
 * page against a production build (`next start`), at 1440x900 and 390x844.
 *
 * Network: GET /api/sections answers MATH 1710 from
 * fixtures/math-1710-spring-2027.json (vsb.untgrades.app's real Spring 2027
 * answer as this app served it on 16 Oct 2026, cut to section 6059, MWF
 * 10:10 and Tue 9:35 in Wooten Hall) and 503 for every other course, which
 * is what the app answers when vsb or the abuse limiter is down. Grades and
 * campus events answer empty. Nothing reaches the internet.
 *
 * Checks:
 * - Day in October, with a Spring 2027 plan: it opens on the plan's first
 *   class day, Monday, dated ("On Monday, Jan 11, ..."), with no "Today";
 *   the campus events it settles on are for Jan 11; "Print this
 *   day" stays on one line. On the first class day itself Day says Today.
 * - Find courses with real sections unavailable: the samples carry the
 *   Sample tag and a sentence saying they're made up, before one is added.
 * - The landing's "Pick courses by hand" opens the major choice in Courses,
 *   the address loses ?start=major, and closing the choice focuses the
 *   major line.
 * - Set up Auto's time picture: at "As early as I can" and "As late as I
 *   can" the sun or moon covers neither "8 AM" nor "10 PM".
 * - CSCE 1030's detail quotes its unreadable rule without the rule's own
 *   closing period.
 * - axe finds no serious or critical violations on Day and in Find courses.
 * Any failed check exits 1.
 *
 * Env: UNTANGLE_BASE_URL, UNTANGLE_OUT (screenshots and report),
 * UNTANGLE_E2E_MODULES (a node_modules with playwright and axe-core),
 * UNTANGLE_CHROMIUM (optional executablePath for Chromium).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.UNTANGLE_BASE_URL ?? "http://127.0.0.1:3217";
const OUT = process.env.UNTANGLE_OUT;
const MODULES = process.env.UNTANGLE_E2E_MODULES;
if (!OUT || !MODULES) {
  console.error("Set UNTANGLE_OUT and UNTANGLE_E2E_MODULES");
  process.exit(2);
}
const require = createRequire(join(MODULES, "noop.js"));
const { chromium } = require("playwright");
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
mkdirSync(OUT, { recursive: true });

const report = { startedAt: new Date().toISOString(), base: BASE, checks: [], axe: [] };
const check = (name, passed, detail = null) => {
  report.checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const pause = (page, ms) => page.waitForTimeout(ms);

const MATH_1710 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "math-1710-spring-2027.json"), "utf8");
const SECTION = "vsb:spring-2027:MATH 1710:6059";

const plannerDoc = () => ({
  storeSchemaVersion: 1,
  revision: 1,
  savedAt: new Date().toISOString(),
  state: {
    courseStatuses: { "MATH 1710": "inProgress" },
    selectedSections: { "MATH 1710": SECTION },
    lockedSections: {},
    optimization: "clusterMorning",
    activeDay: "Mon",
    selectedMajor: "cs",
    transcriptRecords: [],
    updatedAt: new Date().toISOString(),
  },
});

/** Offline answers for the app's data routes; returns the events requests' `from` values. */
async function stub(context) {
  const eventsFrom = [];
  await context.route("**/api/sections/**", (route) => {
    const url = route.request().url();
    if (url.includes("/spring-2027/MATH/1710")) return route.fulfill({ status: 200, contentType: "application/json", body: MATH_1710 });
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Abuse prevention unavailable. Try again later." }) });
  });
  await context.route("**/api/grades/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await context.route("**/api/v1/events?**", (route) => {
    eventsFrom.push(new URL(route.request().url()).searchParams.get("from"));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ range: null, building: null, q: null, events: [] }) });
  });
  return eventsFrom;
}

async function newContext(browser, width, { clock = null, plan = false } = {}) {
  const phone = width < 600;
  const context = await browser.newContext({
    viewport: { width, height: phone ? 844 : 900 },
    deviceScaleFactor: phone ? 2 : 1,
    hasTouch: phone,
    isMobile: phone,
    timezoneId: "America/Chicago",
  });
  const eventsFrom = await stub(context);
  if (clock) await context.clock.setFixedTime(new Date(clock));
  if (plan) {
    await context.addInitScript((doc) => {
      if (!window.localStorage.getItem("untangle.planner-state.v1:guest")) {
        window.localStorage.setItem("untangle.planner-state.v1:guest", JSON.stringify(doc));
      }
    }, plannerDoc());
  }
  return { context, eventsFrom };
}

async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
  const all = result.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("; ")}`);
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  report.axe.push({ label, violations: all });
  check(`axe zero serious/critical: ${label}`, blocking.length === 0, all.join(" | ") || null);
}

async function openDay(page) {
  await page.goto(`${BASE}/day`, { waitUntil: "domcontentloaded" });
  await page.locator(".mv-stop").first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".mv-hero[aria-busy]"), null, { timeout: 30000 });
  await pause(page, 800);
}

/* ---------- Day before the plan's term ---------- */

async function dayBeforeTerm(browser, width) {
  // Friday 16 October 2026, 10:00 in Denton: planning Spring 2027.
  const { context, eventsFrom } = await newContext(browser, width, { clock: "2026-10-16T10:00:00-05:00", plan: true });
  const page = await context.newPage();
  await openDay(page);
  const heading = (await page.locator(".mv-stepper__day").textContent())?.trim();
  check(`${width}: Day before Spring opens on the first class day, not Today`, heading === "Monday", heading);
  const label = (await page.locator(".mv-hero__label").textContent())?.trim();
  check(`${width}: the hero dates that day`, label === "On Monday, Jan 11, the first class is at", label);
  const stops = await page.locator(".mv-stop").allTextContents();
  check(`${width}: Monday lists MATH 1710`, stops.some((text) => text.includes("MATH 1710")), stops.join(" | "));
  await pause(page, 600);
  // An earlier request for today may go out while sections load; the one Day settles on is for the term.
  check(`${width}: campus events are asked for the Spring date shown`, eventsFrom.at(-1)?.startsWith("2027-01-11T") ?? false, eventsFrom.join(", "));
  if (width >= 600) {
    const lines = await page.locator(".mv-foot .mv-link").evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    check(`${width}: "Print this day" stays on one line`, lines === 1, `${lines} lines`);
  }
  await page.screenshot({ path: join(OUT, `day-before-term-${width}.png`) });
  await axe(page, `Day before the term, ${width}`);
  await context.close();

  // On the first class day itself, Day is about today again.
  const inTerm = await newContext(browser, width, { clock: "2027-01-11T07:30:00-06:00", plan: true });
  const termPage = await inTerm.context.newPage();
  await openDay(termPage);
  const today = (await termPage.locator(".mv-stepper__day").textContent())?.trim();
  check(`${width}: on Jan 11 Day says Today`, today === "Today", today);
  await inTerm.context.close();
}

/* ---------- Find courses with sample sections ---------- */

async function sampleSections(browser, width) {
  const { context } = await newContext(browser, width);
  const page = await context.newPage();
  await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
  const setup = page.getByRole("dialog", { name: "Set up Auto" });
  await setup.waitFor({ timeout: 20000 });
  await page.keyboard.press("Escape");
  await setup.waitFor({ state: "hidden" });
  const opener = page.getByRole("button", { name: "Search courses" });
  if (width >= 600) await opener.last().click();
  else await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search courses" }).fill("CSCE 1040");
  await page.getByRole("button", { name: /^CSCE 1040/ }).first().click();
  const sections = page.getByRole("list", { name: "CSCE 1040 sections" });
  await sections.waitFor({ timeout: 20000 });
  const panel = page.locator("[aria-expanded='true'] + div");
  const note = (await panel.locator("p").first().textContent())?.trim() ?? "";
  check(`${width}: sample sections say so before one is added`, note.startsWith("Sample sections.") && note.includes("made up"), note);
  await page.screenshot({ path: join(OUT, `find-courses-samples-${width}.png`) });
  await axe(page, `Find courses with sample sections, ${width}`);
  await context.close();
}

/* ---------- Landing to the major choice ---------- */

async function landingByHand(browser, width) {
  const { context } = await newContext(browser, width);
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /Pick courses by hand/ }).click();
  const dialog = page.getByRole("dialog", { name: "Your degree" });
  const opened = await dialog.waitFor({ timeout: 15000 }).then(() => true, () => false);
  check(`${width}: "Pick courses by hand" opens the major choice`, opened);
  await page.waitForURL((url) => !url.search.includes("start="), { timeout: 5000 }).catch(() => undefined);
  const url = new URL(page.url());
  check(`${width}: the address is plain /courses again`, url.pathname === "/courses" && url.search === "", page.url());
  await page.screenshot({ path: join(OUT, `landing-by-hand-${width}.png`) });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const focused = await page.evaluate(() => document.activeElement?.hasAttribute("data-degree") ?? false);
  check(`${width}: closing it focuses the major line, not the page`, focused);
  await context.close();
}

/* ---------- Set up Auto's time picture ---------- */

async function sunLabels(browser, width) {
  const { context } = await newContext(browser, width);
  const page = await context.newPage();
  await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
  const setup = page.getByRole("dialog", { name: "Set up Auto" });
  await setup.waitFor({ timeout: 20000 });
  for (const answer of ["As early as I can", "As late as I can"]) {
    await setup.getByRole("radio", { name: answer }).click();
    await pause(page, 500); // the picture glides for 300 ms
    const overlaps = await setup.evaluate((root) => {
      const svg = root.querySelector("[class*='picbox'] svg");
      const box = (el) => el.getBoundingClientRect();
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const marks = [...svg.querySelectorAll("circle")].map(box);
      return [...svg.querySelectorAll("text")].filter((text) => marks.some((mark) => hit(mark, box(text)))).map((text) => text.textContent);
    });
    check(`${width}: "${answer}" leaves both time labels readable`, overlaps.length === 0, overlaps.join(", ") || null);
  }
  await page.screenshot({ path: join(OUT, `setup-time-${width}.png`) });
  await context.close();
}

/* ---------- Course detail ---------- */

async function unreadableRule(browser, width) {
  const { context } = await newContext(browser, width);
  const page = await context.newPage();
  await page.goto(`${BASE}/courses/CSCE/1030`, { waitUntil: "domcontentloaded" });
  const quote = page.locator("q").filter({ hasText: "CSCE 1010" }).first();
  await quote.waitFor({ timeout: 20000 });
  const text = (await quote.textContent())?.trim() ?? "";
  check(`${width}: the quoted rule leaves the period to the sentence`, text.endsWith("C or better"), text);
  await context.close();
}

const browser = await chromium.launch({ executablePath: process.env.UNTANGLE_CHROMIUM || undefined });
try {
  for (const width of [1440, 390]) {
    await dayBeforeTerm(browser, width);
    await sampleSections(browser, width);
    await landingByHand(browser, width);
    await sunLabels(browser, width);
    await unreadableRule(browser, width);
  }
} catch (error) {
  check("journey ran to the end", false, String(error).split("\n")[0]);
} finally {
  await browser.close();
}
report.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.passed);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
