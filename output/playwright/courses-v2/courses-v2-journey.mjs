#!/usr/bin/env node
/**
 * Courses v2 acceptance journey (HANDOFF steps 4-5) at 1440x900 and 390x844,
 * against a production build. Each viewport runs in a fresh guest context:
 *   1. pick a major in the custom picker
 *   2. try the sample transcript, press Auto-fill, see statuses (one covered
 *      through a prerequisite) and the AutoNote
 *   3. undo Auto-fill
 *   4. open CSCE 1030, switch instructor, check link-out hrefs (never followed)
 *   5. add a course to the plan through search (⌘K on desktop, the search
 *      sheet on the phone)
 * plus the deep link with the grade backend down, and axe on every state.
 * Grade history for step 4 is a fixture in the untgrades.app adapter's shape
 * (PR #30), served by intercepting the history request; the unavailable state
 * is checked against the real, absent backend.
 *
 * Env: UNTANGLE_BASE_URL (default http://127.0.0.1:3123), PLAYWRIGHT_MODULE,
 * AXE_PATH, OUT_DIR (default: this script's directory).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.UNTANGLE_BASE_URL ?? "http://127.0.0.1:3123";
const OUT = process.env.OUT_DIR ?? here;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const axeSource = readFileSync(process.env.AXE_PATH ?? "node_modules/axe-core/axe.min.js", "utf8");
mkdirSync(OUT, { recursive: true });

const report = { startedAt: new Date().toISOString(), base: BASE, checks: [], axe: [], notes: [] };
const check = (name, passed, detail = null) => {
  report.checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const note = (text) => {
  report.notes.push(text);
  console.log(`note: ${text}`);
};
const shoot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
const axe = async (page, label) => {
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
  const all = result.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`);
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  report.axe.push({ label, violations: all, blocking: blocking.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) })) });
  check(`axe no serious/critical: ${label}`, blocking.length === 0, all.join(", ") || null);
};

const gradesOf = (a, b, c, d, f, w) => ({
  gradeA: a, gradeB: b, gradeC: c, gradeD: d, gradeF: f, gradeP: 0, gradeNP: 0, gradeW: w, gradeWF: 0,
  gradeI: 0, gradePR: 0, gradeNPR: 0, gradeZ: 0, gradeSuppressed: 0, totalEnroll: a + b + c + d + f + w,
});
const sec = (number, first, last, grades) => ({
  sectionNumber: number,
  instructor: { id: `${last},${first}`, firstName: first, lastName: last, name: `${first} ${last}` },
  counts: {}, total: grades.totalEnroll, grades,
});
const fixture = {
  status: "ok",
  source: "untgrades.app",
  data: {
    course: { subject: "CSCE", number: "1030", title: "Computer Science I" },
    terms: [
      { term: "Fall", year: "2023", counts: {}, total: 0, grades: gradesOf(0, 0, 0, 0, 0, 0), sections: [sec("001", "Beilei", "Jiang", gradesOf(48, 30, 14, 5, 6, 9)), sec("003", "Haili", "Wang", gradesOf(20, 26, 22, 9, 10, 8))] },
      { term: "Spring", year: "2024", counts: {}, total: 0, grades: gradesOf(0, 0, 0, 0, 0, 0), sections: [sec("002", "Beilei", "Jiang", gradesOf(40, 28, 12, 4, 5, 6)), sec("005", "Pradhumna", "Shrestha", gradesOf(31, 24, 15, 6, 4, 5))] },
    ],
    sectionCount: 4,
    gpa: null,
    counts: {},
    total: 0,
    grades: gradesOf(139, 108, 63, 24, 25, 28),
  },
};
fixture.data.total = fixture.data.grades.totalEnroll;

const DANGER = "rgb(179, 38, 30)";

async function rowStatus(page, id) {
  return page.locator(`[data-row-open="${id}"]`).locator("xpath=..").locator("[data-row-status]").innerText();
}
async function rowMeta(page, id) {
  return page.locator(`[data-row-open="${id}"]`).locator("xpath=..").locator("[data-row-meta]").innerText();
}

async function journey(browser, viewport) {
  const phone = viewport.name === "phone";
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: phone,
    hasTouch: phone,
  });
  const page = await context.newPage();
  const tag = viewport.name;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // ---------- 1. major picker ----------
  await page.goto(`${BASE}/courses`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Start with what you've taken" }).waitFor();
  check(`${tag}: guest sees the empty state`, true);
  check(`${tag}: no native select on the page`, (await page.locator("select").count()) === 0);
  const picker = page.getByRole("combobox", { name: "Major" }).filter({ visible: true });
  if (phone) {
    await picker.tap();
  } else {
    await picker.focus();
    await page.keyboard.press("ArrowDown");
  }
  const listbox = page.getByRole("listbox", { name: "Major" }).filter({ visible: true });
  await listbox.waitFor();
  check(`${tag}: picker opens a listbox`, await picker.getAttribute("aria-expanded") === "true");
  await page.waitForTimeout(250);
  await shoot(page, `${tag}-01-major-picker`);
  await axe(page, `${tag}: major picker open`);
  if (phone) {
    await listbox.getByRole("option", { name: /Computer Science/ }).tap();
  } else {
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
  }
  check(`${tag}: major chosen`, (await picker.innerText()).includes("Computer Science"));
  check(`${tag}: picker closed after choosing`, await picker.getAttribute("aria-expanded") === "false");

  // ---------- 2. sample transcript + Auto ----------
  await page.getByRole("button", { name: /Try a sample transcript/ }).click();
  await page.locator('[data-row-open="CSCE 1030"]').waitFor();
  await page.getByRole("button", { name: "Auto-fill", exact: true }).filter({ visible: true }).click();
  const note1 = page.locator("[data-autonote]");
  await note1.waitFor();
  const noteText = await note1.innerText();
  check(`${tag}: AutoNote reports the fill`, /Filled 5 courses from your transcript, 1 through prerequisites\. Planned 1 for Spring 2027\./.test(noteText), noteText.replace(/\s+/g, " "));
  check(`${tag}: CSCE 1030 covered through CSCE 1040`, (await rowStatus(page, "CSCE 1030")) === "Covered" && (await rowMeta(page, "CSCE 1030")).includes("Via CSCE 1040"));
  check(`${tag}: CSCE 1040 done from transcript`, (await rowStatus(page, "CSCE 1040")) === "Done" && (await rowMeta(page, "CSCE 1040")).includes("Spring 2026 · A"));
  check(`${tag}: MATH 1720 planned by Auto`, (await rowStatus(page, "MATH 1720")) === "Planned" && (await rowMeta(page, "MATH 1720")).includes("Spring 2027 · auto"));
  check(`${tag}: CSCE 2100 left for an advisor`, (await rowStatus(page, "CSCE 2100")) === "Check");
  const rowHeight = await page.locator('[data-row-open="CSCE 1030"]').locator("xpath=..").evaluate((el) => el.getBoundingClientRect().height);
  check(`${tag}: row height`, phone ? rowHeight >= 52 : Math.round(rowHeight) === 44, `${rowHeight}px`);
  if (!phone) {
    const codeFont = await page.locator('[data-row-open="CSCE 1030"] [class*=code]').evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.fontFamily.split(",")[0]} ${style.fontSize} ${style.fontWeight}`;
    });
    check(`${tag}: row code set in Syne 13 bold`, /syne/i.test(codeFont) && codeFont.includes("13px") && codeFont.includes("700"), codeFont);
    await page.locator('[data-row-open="MATH 2700"]').hover().catch(() => {});
    const available = await page.locator("[data-status=available] [data-row-open]").first().getAttribute("data-row-open");
    await page.locator(`[data-row-open="${available}"]`).hover();
    const plusPlan = page.locator(`[data-row-open="${available}"]`).locator("xpath=..").getByRole("button", { name: /\+ Plan/ });
    check(`${tag}: hover on an available row reveals + Plan`, (await plusPlan.evaluate((el) => getComputedStyle(el.parentElement).opacity)) === "1", available);
  }
  await page.mouse.move(5, 5);
  await shoot(page, `${tag}-02-after-auto`);
  await axe(page, `${tag}: after Auto-fill`);

  // ---------- 3. undo ----------
  await note1.getByRole("button", { name: "Undo" }).click();
  await note1.waitFor({ state: "detached" });
  check(`${tag}: undo removes the auto plan`, (await rowStatus(page, "MATH 1720")) === "Available");
  check(`${tag}: inferred statuses stay after undo`, (await rowStatus(page, "CSCE 1030")) === "Covered");

  // ---------- 4. detail panel ----------
  // Real backend first: it is down, so the panel must say so and still show catalog text.
  await page.locator('[data-row-open="MATH 1710"]').click();
  const panel = phone ? page.getByRole("dialog", { name: /details/ }) : page.locator("aside[aria-labelledby=course-panel-title]");
  await panel.getByText(/Couldn.t load grade history/).waitFor();
  check(`${tag}: grade backend down shows the unavailable state`, true);
  check(`${tag}: catalog text still shows`, (await panel.innerText()).includes("Calculus I"));
  if (phone) {
    await page.getByRole("button", { name: /Close MATH 1710 details/ }).tap();
    await panel.waitFor({ state: "detached" });
  }

  await page.route("**/courses/CSCE/1030/history", (route) => route.fulfill({ json: fixture }));
  await page.locator('[data-row-open="CSCE 1030"]').click();
  await panel.getByText("Grade history from untgrades.app").waitFor();
  if (!phone) {
    const width = await panel.evaluate((el) => el.getBoundingClientRect().width);
    check(`${tag}: panel is 520px`, Math.round(width) === 520, `${width}px`);
    const scrims = await page.locator("[class*=scrim]").count();
    check(`${tag}: no scrim behind the desktop panel`, scrims === 0);
    const listRight = await page.locator("[data-course-list]").evaluate((el) => el.getBoundingClientRect().right);
    const panelLeft = await panel.evaluate((el) => el.getBoundingClientRect().left);
    check(`${tag}: the list narrows beside the panel`, listRight <= panelLeft, `${listRight} <= ${panelLeft}`);
  } else {
    const grip = page.getByRole("button", { name: /Shrink sheet|Expand sheet/ });
    check(`${tag}: sheet has a drag handle`, await grip.isVisible());
  }
  const bars = await panel.locator("[data-grade-bar]").evaluateAll((els) =>
    els.map((el) => ({ bg: getComputedStyle(el).backgroundColor, opacity: getComputedStyle(el).opacity })),
  );
  const greens = new Set(bars.map((b) => b.bg));
  check(`${tag}: bars are one green ramp`, greens.size === 1 && [...greens][0] === "rgb(0, 81, 43)" && bars.map((b) => b.opacity).join() === "1,0.8,0.6,0.45,0.35,0.25", JSON.stringify(bars.map((b) => b.opacity)));
  const source = panel.locator("[data-linkout=source]");
  check(`${tag}: Data source link`, (await source.getAttribute("href")) === "https://www.untgrades.app/" && (await source.getAttribute("target")) === "_blank");

  const instructor = panel.getByRole("combobox", { name: "Instructor" });
  const studentsBefore = await panel.locator("[data-fig]").nth(1).innerText();
  if (phone) await instructor.tap();
  else await instructor.click();
  await panel.getByRole("option", { name: /Haili Wang/ }).click();
  await page.waitForTimeout(40);
  const crossfading = await panel.locator("[data-motion=out]").count();
  await page.waitForTimeout(250);
  const studentsAfter = await panel.locator("[data-fig]").nth(1).innerText();
  check(`${tag}: switching instructor redraws the chart`, studentsBefore !== studentsAfter, `${studentsBefore.replace(/\s+/g, " ")} -> ${studentsAfter.replace(/\s+/g, " ")}`);
  check(`${tag}: the old bars crossfade out`, crossfading === 1, `${crossfading} outgoing layer`);
  const links = await panel.locator("a[data-linkout]:not([data-linkout=source])").evaluateAll((els) =>
    els.map((el) => ({ key: el.dataset.linkout, href: el.getAttribute("href"), target: el.getAttribute("target"), rel: el.getAttribute("rel") })),
  );
  const want = {
    rmp: "https://www.ratemyprofessors.com/search/professors/1252?q=Haili%20Wang",
    syllabi: "https://facultyinfo.unt.edu/faculty-search?name=Haili%20Wang",
    spot: "https://facultyinfo.unt.edu/faculty-search?name=Haili%20Wang&course=CSCE%201030",
  };
  for (const [key, href] of Object.entries(want)) {
    const link = links.find((l) => l.key === key);
    check(`${tag}: ${key} link follows the chosen instructor`, link?.href === href && link?.target === "_blank" && link?.rel?.includes("noopener"), link?.href);
  }
  await shoot(page, `${tag}-03-panel-instructor`);
  await axe(page, `${tag}: detail panel`);

  if (!phone) {
    // ↑/↓ retargets the open panel; it must not re-animate.
    await page.locator('[data-row-open="CSCE 1030"]').focus();
    const states = [];
    await page.keyboard.press("ArrowDown");
    for (let i = 0; i < 6; i++) {
      states.push(await panel.getAttribute("data-state"));
      await page.waitForTimeout(30);
    }
    const heading = await panel.locator("#course-panel-title").innerText();
    check(`${tag}: ↓ moves the panel to the next course`, heading.includes("Computer Science II"), heading);
    check(`${tag}: the panel stays open while retargeting`, states.every((s) => s === "open"), states.join(","));
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    check(`${tag}: Esc closes the panel`, true);
  } else {
    // A downward drag on the handle settles at the half detent.
    const sheet = page.getByRole("dialog", { name: /details/ });
    const grip = page.getByRole("button", { name: /Shrink sheet/ });
    const box = await grip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 10);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(box.x + box.width / 2, box.y + 10 + step * 30);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const offset = await sheet.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
    const expected = (0.92 - 0.5) * viewport.height;
    check(`${tag}: drag settles the sheet at the half detent`, Math.abs(offset - expected) < 2, `${offset.toFixed(1)}px vs ${expected}px`);
    await page.getByRole("button", { name: /Close CSCE 1030 details/ }).tap();
    await sheet.waitFor({ state: "detached" });
  }

  // ---------- 5. add a course through search ----------
  if (!phone) {
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Search courses" });
    await palette.waitFor();
    const animations = await palette.evaluate((el) => el.getAnimations({ subtree: true }).length);
    check(`${tag}: ⌘K opens with no animation`, animations === 0, `${animations} running animations`);
    await page.keyboard.type("1720");
    await palette.getByRole("option", { name: /MATH 1720/ }).waitFor();
    await shoot(page, `${tag}-04-palette`);
    await axe(page, `${tag}: search palette`);
    await page.keyboard.press("Meta+Enter");
    // The confirmation is a visually hidden live region, so wait on its text rather than its visibility.
    await palette.locator('[role="status"]').filter({ hasText: "Planned MATH 1720 for Spring 2027." }).waitFor({ state: "attached" });
    check(`${tag}: ⌘↵ plans the active result and announces it`, true);
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });
  } else {
    await page.getByRole("button", { name: "Search courses" }).filter({ visible: true }).tap();
    const palette = page.getByRole("dialog", { name: "Search courses" });
    await palette.waitFor();
    await page.keyboard.type("1720");
    await palette.getByRole("option", { name: /MATH 1720/ }).tap();
    const sheet = page.getByRole("dialog", { name: /MATH 1720 details/ });
    await sheet.waitFor();
    await page.waitForTimeout(350);
    await shoot(page, `${tag}-04-search-to-sheet`);
    await sheet.getByRole("button", { name: "Add to Spring 2027" }).tap();
    await sheet.getByRole("button", { name: "Remove from plan" }).waitFor();
    await axe(page, `${tag}: course sheet`);
    await page.getByRole("button", { name: /Close MATH 1720 details/ }).tap();
    await sheet.waitFor({ state: "detached" });
  }
  check(`${tag}: MATH 1720 planned through search`, (await rowStatus(page, "MATH 1720")) === "Planned");

  // A planned course now occupies sections; look for a conflict row drawn in --danger.
  await page.locator('[data-row-open="CSCE 1030"]').click();
  const panel2 = phone ? page.getByRole("dialog", { name: /CSCE 1030 details/ }) : page.locator("aside[aria-labelledby=course-panel-title]");
  await panel2.waitFor();
  const more = panel2.getByRole("button", { name: /Show all \d+ sections/ });
  if (await more.count()) await more.click();
  const conflictColors = await panel2.locator("[data-conflict=true]").evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
  if (conflictColors.length > 0) check(`${tag}: section conflicts are drawn in --danger`, conflictColors.every((c) => c === "rgb(179, 38, 30)"), `${conflictColors.length} conflict rows`);
  else note(`${tag}: no CSCE 1030 sample section overlaps MATH 1720's chosen section, so no conflict row to check`);
  await page.waitForTimeout(300);
  await shoot(page, `${tag}-05-planned`);

  // ---------- deep link with the backend down ----------
  const response = await page.goto(`${BASE}/courses/CSCE/2100`, { waitUntil: "networkidle" });
  check(`${tag}: deep link renders (no 404 with the backend down)`, response.status() === 200, String(response.status()));
  const deepPanel = phone ? page.getByRole("dialog", { name: /CSCE 2100 details/ }) : page.locator("aside[aria-labelledby=course-panel-title]");
  await deepPanel.getByText(/Couldn.t load grade history/).waitFor();
  const deepText = await deepPanel.innerText();
  check(`${tag}: deep link shows catalog text and the history state`, deepText.includes("Foundations of Computing") && deepText.includes("Check with an advisor"));
  await page.waitForTimeout(350);
  await shoot(page, `${tag}-06-deep-link`);
  await axe(page, `${tag}: deep link`);

  check(`${tag}: no uncaught page errors`, errors.length === 0, errors.join(" | ") || null);
  await context.close();
}

const browser = await chromium.launch();
try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    try {
      await journey(browser, viewport);
    } catch (error) {
      check(`${viewport.name}: journey completed`, false, String(error?.stack ?? error).split("\n").slice(0, 4).join(" | "));
    }
  }
  // Reduced motion: the panel fades but does not slide.
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${BASE}/courses`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Pick courses by hand/ }).click();
    await page.getByRole("listbox", { name: "Major" }).filter({ visible: true }).waitFor();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await page.locator('[data-row-open="CSCE 1010"]').click();
    const transform = await page.locator("aside[aria-labelledby=course-panel-title]").evaluate((el) => getComputedStyle(el).transform);
    check("reduced motion: the panel enters without moving", transform === "none", transform);
    await context.close();
  } catch (error) {
    check("reduced motion pass completed", false, String(error).split("\n")[0]);
  }

  // Keyboard only: Tab from the top of the Courses view; every stop must show a focus indicator.
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/courses`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Pick courses by hand/ }).click();
    await page.getByRole("listbox", { name: "Major" }).filter({ visible: true }).waitFor();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await page.locator("h1").first().evaluate((el) => {
      el.setAttribute("tabindex", "-1");
      el.focus();
    });
    const stops = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          const style = getComputedStyle(el);
          const after = getComputedStyle(el, "::after");
          const ring = style.boxShadow !== "none" || (style.outlineStyle !== "none" && style.outlineWidth !== "0px") || after.boxShadow !== "none";
          return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40), ring };
        }),
      );
    }
    const ours = stops.filter((stop) => !/^(Sign in|Courses|Schedule|Map|Plans|UNTangle|01|02|03|04)/.test(stop.name));
    check("keyboard: every Courses control shows a focus ring", ours.every((stop) => stop.ring), ours.map((stop) => `${stop.name}${stop.ring ? "" : " (no ring)"}`).join(" → "));
    await context.close();
  } catch (error) {
    check("keyboard pass completed", false, String(error).split("\n")[0]);
  }

  const unknown = await (await browser.newPage()).goto(`${BASE}/courses/ZZZZ/9999`);
  check("unknown course code is a 404", unknown.status() === 404, String(unknown.status()));
  const legacy = await browser.newPage();
  await legacy.goto(`${BASE}/instructors/123`, { waitUntil: "domcontentloaded" });
  check("old instructor link redirects instead of 404", new URL(legacy.url()).pathname === "/courses", legacy.url());
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
report.passed = report.checks.filter((c) => c.passed).length;
report.failed = report.checks.filter((c) => !c.passed).length;
writeFileSync(`${OUT}/courses-v2-report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.passed}/${report.checks.length} checks passed`);
process.exit(report.failed === 0 ? 0 : 1);
