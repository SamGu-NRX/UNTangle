#!/usr/bin/env node
/**
 * WebMCP tools in a real page, against a production build (`next start`).
 *
 * No shipping browser exposes WebMCP without an origin-trial token or a
 * flag, so the page gets a stub `document.modelContext` (the 13 October
 * 2026 draft's shape) that records registrations and lets this script call
 * a tool's `execute` the way a browser agent would. The guest plan comes
 * from localStorage: CSCE 1040, ENGL 1310 and PSYC 1630 (sample sections).
 *
 * Checks: without the stub, no script the page loads contains the tools;
 * with it, the eleven tools register once the plan loads; get_schedule
 * reads the plan; build_schedule finds an alternative that moves sections;
 * apply_alternative opens the confirmation, changes nothing when the
 * student cancels, and applies once when they confirm; Undo in the toast
 * puts the old sections back; the dialog and toast move by CSS transitions
 * (opacity plus scale or rise), and with reduced motion the dialog only
 * fades; axe finds no serious or critical violations with the dialog open
 * (desktop and phone). Any failed check exits 1.
 *
 * Env: UNTANGLE_BASE_URL, UNTANGLE_OUT (screenshots and report),
 * UNTANGLE_E2E_MODULES (a node_modules with playwright and axe-core).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

const report = { startedAt: new Date().toISOString(), base: BASE, checks: [], axe: [], calls: [] };
const check = (name, passed, detail = null) => {
  report.checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const plannerDoc = {
  storeSchemaVersion: 1,
  revision: 1,
  savedAt: new Date().toISOString(),
  state: {
    courseStatuses: { "MATH 1710": "completed", "CSCE 1040": "inProgress", "ENGL 1310": "inProgress", "PSYC 1630": "inProgress" },
    selectedSections: {},
    lockedSections: {},
    optimization: "clusterMorning",
    activeDay: "Mon",
    selectedMajor: "cs",
    transcriptRecords: [],
    updatedAt: new Date().toISOString(),
  },
};

/** Runs in the page before its scripts: a model context that records what registers. */
function installStub(doc) {
  if (!window.localStorage.getItem("untangle.planner-state.v1")) {
    window.localStorage.setItem("untangle.planner-state.v1", JSON.stringify(doc));
  }
  const tools = new Map();
  const log = [];
  const modelContext = {
    registerTool(tool, options) {
      tools.set(tool.name, tool);
      log.push(`register ${tool.name}`);
      options?.signal?.addEventListener("abort", () => {
        tools.delete(tool.name);
        log.push(`unregister ${tool.name}`);
      });
      return Promise.resolve();
    },
  };
  Object.defineProperty(Document.prototype, "modelContext", { configurable: true, get: () => modelContext });
  window.__webmcp = {
    tools,
    log,
    pending: null,
    call(name, input) {
      const tool = tools.get(name);
      if (!tool) return Promise.resolve({ missing: name });
      return tool.execute(input, { signal: new AbortController().signal });
    },
  };
}

const call = async (page, name, input = {}) => {
  const result = await page.evaluate(([n, i]) => window.__webmcp.call(n, i), [name, input]);
  report.calls.push({ name, input, result });
  return result;
};
/** Starts a call that waits for the student, without waiting for it. */
const start = (page, name, input) =>
  page.evaluate(([n, i]) => {
    window.__webmcp.pending = window.__webmcp.call(n, i);
  }, [name, input]);
const finish = async (page, name, input) => {
  const result = await page.evaluate(() => window.__webmcp.pending);
  report.calls.push({ name, input, result });
  return result;
};
/** Each course's section as get_schedule names it. */
const sectionsOf = (schedule) => Object.fromEntries(schedule.courses.map((course) => [course.code, course.section]));
/** Sections and states together: a recommendation and the same section picked by hand differ. */
const planOf = (schedule) => JSON.stringify(schedule.courses.map((course) => [course.code, course.section, course.state]));

async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
  const all = result.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`);
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  report.axe.push({ label, violations: all });
  check(`axe zero serious/critical: ${label}`, blocking.length === 0, all.join(" | ") || null);
}

/** How an element moves: CSS transitions (interruptible) and no keyframe animation. */
const motionOf = (page, selector) =>
  page.evaluate((sel) => {
    const style = getComputedStyle(document.querySelector(sel));
    return { transition: style.transitionProperty, animation: style.animationName };
  }, selector);
const byTransition = (motion, properties) => motion.animation === "none" && motion.transition === properties;

async function openWeek(browser, viewport, options = {}) {
  const context = await browser.newContext({ viewport, ...options });
  await context.addInitScript(installStub, plannerDoc);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__webmcp.tools.size === 11, null, { timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  return { context, page, errors };
}

async function desktop(browser) {
  const { context, page, errors } = await openWeek(browser, { width: 1440, height: 900 });
  const names = await page.evaluate(() => [...window.__webmcp.tools.keys()].sort());
  check("eleven tools registered after the plan loaded", names.length === 11, names.join(", "));

  const before = await call(page, "get_schedule");
  check("get_schedule reads the seeded plan", before.ok && before.courses.length === 3, JSON.stringify(sectionsOf(before)));

  const built = await call(page, "build_schedule", { goal: "compact" });
  const option = built.alternatives?.find((alt) => alt.changes > 0);
  check("build_schedule returns an alternative that moves sections", Boolean(option), option?.id);

  await start(page, "apply_alternative", { id: option.id });
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  check("apply_alternative asks the student first", await dialog.isVisible(), await dialog.innerText());
  const dialogMotion = await motionOf(page, ".ui-dialog");
  check("the dialog moves by transition: opacity and scale", byTransition(dialogMotion, "opacity, transform"), JSON.stringify(dialogMotion));
  await page.screenshot({ path: join(OUT, "desktop-confirm.png") });
  await axe(page, "desktop confirmation");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const declined = await finish(page, "apply_alternative", { id: option.id });
  check("cancel answers declined", declined.reason === "declined", JSON.stringify(declined));
  const afterCancel = await call(page, "get_schedule");
  check("cancel leaves the plan as it was", planOf(afterCancel) === planOf(before));

  await page.waitForTimeout(300);
  await start(page, "apply_alternative", { id: option.id });
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByRole("button", { name: /^Use option/ }).click();
  const applied = await finish(page, "apply_alternative", { id: option.id });
  check("confirm applies the alternative", applied.ok && applied.changed === option.changes, JSON.stringify(applied));
  const afterApply = await call(page, "get_schedule");
  const moved = Object.entries(sectionsOf(afterApply)).filter(([code, id]) => sectionsOf(before)[code] !== id).length;
  check("the plan now holds the alternative's sections", moved === option.changes, `${moved} moved`);
  const undo = page.locator(".ui-toast").getByRole("button", { name: "Undo" });
  await undo.waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "desktop-applied.png") });
  const toastMotion = await motionOf(page, ".ui-toast");
  check("the toast moves by transition, not keyframes: opacity and rise", byTransition(toastMotion, "opacity, transform"), JSON.stringify(toastMotion));

  await undo.click();
  await page.waitForTimeout(400);
  const afterUndo = await call(page, "get_schedule");
  check("Undo restores the previous sections", planOf(afterUndo) === planOf(before), planOf(afterUndo));

  const log = await page.evaluate(() => window.__webmcp.log);
  check("each tool registered exactly once", log.filter((line) => line.startsWith("register")).length === 11, `${log.length} log lines`);
  check("no page errors", errors.length === 0, errors.join(" | ") || null);
  await context.close();
}

async function phone(browser) {
  // Reduced motion on the phone: the dialog keeps its fade and drops its scale.
  const { context, page, errors } = await openWeek(browser, { width: 390, height: 844 }, { reducedMotion: "reduce" });
  await call(page, "build_schedule", { goal: "compact" });
  await start(page, "remove_course", { code: "PSYC 1630" });
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "phone-confirm.png") });
  const reducedMotion = await motionOf(page, ".ui-dialog");
  check("with reduced motion the dialog only fades", byTransition(reducedMotion, "opacity"), JSON.stringify(reducedMotion));
  await axe(page, "phone confirmation");
  await page.keyboard.press("Escape");
  const declined = await finish(page, "remove_course", { code: "PSYC 1630" });
  check("Escape declines on a phone", declined.reason === "declined", JSON.stringify(declined));
  check("no page errors (phone)", errors.length === 0, errors.join(" | ") || null);
  await context.close();
}

/** Without WebMCP the page must not even download the tools. */
async function unsupported(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((doc) => window.localStorage.setItem("untangle.planner-state.v1", JSON.stringify(doc)), plannerDoc);
  const page = await context.newPage();
  const scripts = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.push(response.text().catch(() => ""));
  });
  await page.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  const bodies = await Promise.all(scripts);
  check("without WebMCP no loaded script contains the tools", bodies.length > 0 && !bodies.some((body) => body.includes("check_eligibility")), `${bodies.length} scripts`);
  await context.close();
}

const browser = await chromium.launch();
try {
  await unsupported(browser);
  await desktop(browser);
  await phone(browser);
} catch (error) {
  check("journey ran to the end", false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}
report.finishedAt = new Date().toISOString();
report.passed = report.checks.filter((c) => c.passed).length;
report.total = report.checks.length;
writeFileSync(join(OUT, "journey-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.passed}/${report.total} checks passed`);
process.exit(report.passed === report.total ? 0 : 1);
