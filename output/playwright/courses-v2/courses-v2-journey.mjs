#!/usr/bin/env node
/**
 * Courses v2 browser journey (HANDOFF steps 4-5) at 1440x900 and 390x844,
 * against a production build. Each viewport runs in a fresh guest context:
 *   1. pick a major in the custom picker
 *   2. try the sample transcript, press Auto-fill, see statuses (one covered
 *      through a prerequisite) and the AutoNote
 *   3. undo Auto-fill
 *   4. open CSCE 1030, switch instructor, check link-out hrefs (never followed)
 *   5. add a course to the plan through search (⌘K on desktop, the search
 *      sheet on the phone)
 * plus Undo after a reload and its refusal after an edit, the phone sheet's
 * detents and Escape stacking, the deep link with grade history down, an
 * unknown course code, reduced motion, a keyboard-only pass, and axe on
 * every state. Grade history comes from the untgrades.app adapter routes
 * (/api/grades/*), intercepted so the run never calls upstream: CSCE 1030
 * gets a fixture in the adapter's shape, every other course gets the
 * adapter's "unavailable" answer.
 * MATH 1720 and CSCE 1030 sections replay a recorded Spring 2027 snapshot
 * through the same /api/sections endpoints the app's client reads.
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
const sectionsFixture = JSON.parse(readFileSync(new URL("./fixtures/spring-2027-sections.json", import.meta.url), "utf8"));
mkdirSync(OUT, { recursive: true });

const report = { startedAt: new Date().toISOString(), base: BASE, checks: [], axe: [], notes: [], sectionsFixture: sectionsFixture.fixture, sectionFixtureRequests: [] };
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
const unavailable = {
  status: "unavailable",
  source: "untgrades.app",
  data: null,
  error: { reason: "upstream", message: "Simulated: upstream did not answer." },
};
const routeGrades = (page) =>
  page.route("**/api/grades/courses/**", (route) =>
    route.fulfill({ json: route.request().url().endsWith("/CSCE/1030") ? fixture : unavailable }),
  );

async function routeSections(page) {
  for (const [path, json] of Object.entries(sectionsFixture.responses)) {
    await page.route(`**${path}`, (route) => {
      report.sectionFixtureRequests.push(path);
      return route.fulfill({ json, headers: { "Cache-Control": "no-store" } });
    });
  }
}


const rowOf = (page, id) => page.locator(`[data-row-open="${id}"]`).locator("xpath=..");
const rowStatus = (page, id) => rowOf(page, id).locator("[data-row-status]").innerText();
const rowMeta = (page, id) => rowOf(page, id).locator("[data-row-meta]").innerText();
const visible = (locator) => locator.filter({ visible: true });

async function chooseMajor(page, phone) {
  const picker = visible(page.getByRole("combobox", { name: "Major" }));
  if (phone) await picker.tap();
  else {
    await picker.focus();
    await page.keyboard.press("ArrowDown");
  }
  await page.getByRole("listbox", { name: "Major" }).waitFor();
  return picker;
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
  await routeGrades(page);
  await routeSections(page);
  const tag = viewport.name;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const panelFor = (id) =>
    phone ? page.getByRole("dialog", { name: `${id} details` }) : page.locator("aside[aria-labelledby=course-panel-title]");
  const tap = (locator) => (phone ? locator.tap() : locator.click());

  // ---------- 1. major picker ----------
  await page.goto(`${BASE}/courses`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Start with what you've taken" }).waitFor();
  check(`${tag}: a fresh guest sees the empty state`, true);
  check(`${tag}: no visible native select`, (await page.locator("select:not([hidden])").count()) === 0);
  check(`${tag}: no visible page headline`, (await page.locator("h1").evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height > 2).length)) === 0);
  const picker = await chooseMajor(page, phone);
  check(`${tag}: the picker opens a listbox`, (await picker.getAttribute("aria-expanded")) === "true");
  await page.waitForTimeout(250);
  await shoot(page, `${tag}-01-major-picker`);
  await axe(page, `${tag}: major picker open`);
  if (phone) await page.getByRole("option", { name: /Computer Science/ }).first().tap();
  else {
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
  }
  check(`${tag}: major chosen`, (await picker.innerText()).includes("Computer Science"));
  check(`${tag}: the picker closes after choosing`, (await picker.getAttribute("aria-expanded")) === "false");

  // ---------- 2. sample transcript + Auto ----------
  await tap(visible(page.getByRole("button", { name: "More Auto-fill options" })));
  await tap(page.getByRole("menuitem", { name: "Try the sample transcript" }));
  await page.locator('[data-row-open="CSCE 1030"]').waitFor();
  await tap(visible(page.getByRole("button", { name: "Auto-fill", exact: true })));
  const noteBox = page.locator("[data-autonote]");
  await noteBox.waitFor();
  const noteText = await noteBox.innerText();
  // 1461c03 treats concurrent permission as an annotation, making CSCE 2100 the second Auto course.
  check(`${tag}: the AutoNote reports the fill`, /Filled 5 courses from your transcript, 1 through prerequisites\. Planned 2 for Spring 2027\./.test(noteText), noteText.replace(/\s+/g, " "));
  check(`${tag}: CSCE 1030 covered through CSCE 1040`, (await rowStatus(page, "CSCE 1030")) === "Covered" && (await rowMeta(page, "CSCE 1030")).includes("Via CSCE 1040"));
  check(`${tag}: CSCE 1040 done from the transcript`, (await rowStatus(page, "CSCE 1040")) === "Done" && (await rowMeta(page, "CSCE 1040")).includes("Grade A"));
  check(`${tag}: MATH 1720 planned by Auto`, (await rowStatus(page, "MATH 1720")) === "Planned" && (await rowMeta(page, "MATH 1720")).includes("Spring 2027"));
  // 1461c03 clears CSCE 2100 for this transcript without an advisor-only companion requirement.
  check(`${tag}: CSCE 2100 eligible and planned by Auto`, (await rowStatus(page, "CSCE 2100")) === "Planned" && (await rowMeta(page, "CSCE 2100")).includes("Spring 2027"));
  const coreHeader = await page.locator("#group-core").innerText();
  check(`${tag}: the group header carries one fact, how much is done`, /2 of 5 done/.test(coreHeader) && !/covered/.test(coreHeader), coreHeader.replace(/\s+/g, " "));
  const rowHeight = await rowOf(page, "CSCE 1030").evaluate((el) => el.getBoundingClientRect().height);
  check(`${tag}: row height`, phone ? rowHeight >= 52 : Math.round(rowHeight) === 44, `${rowHeight}px`);
  if (!phone) {
    const codeFont = await page.locator('[data-row-open="CSCE 1030"] [class*=code]').evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.fontFamily.split(",")[0]} ${style.fontSize} ${style.fontWeight}`;
    });
    check(`${tag}: row code set in Syne 13 bold`, /syne/i.test(codeFont) && codeFont.includes("13px") && codeFont.includes("700"), codeFont);
    const available = await page.locator("[data-status=available] [data-row-open]").first().getAttribute("data-row-open");
    await page.locator(`[data-row-open="${available}"]`).hover();
    const plusPlan = rowOf(page, available).getByRole("button", { name: /\+ Plan/ });
    check(`${tag}: hover on an available row reveals + Plan`, (await plusPlan.evaluate((el) => getComputedStyle(el.parentElement).opacity)) === "1", available);
    const unknownLinks = await rowOf(page, "CSCE 3020").locator("[data-row-meta] a").count();
    check(`${tag}: a needed course outside the catalog is text, not a link`, (await rowMeta(page, "CSCE 3020")).includes("CSCE 3010") && unknownLinks === 0);
    await page.mouse.move(5, 5);
  }
  await shoot(page, `${tag}-02-after-auto`);
  await axe(page, `${tag}: after Auto-fill`);

  // ---------- 3. undo, after a reload ----------
  await page.reload({ waitUntil: "networkidle" });
  await noteBox.waitFor();
  check(`${tag}: the Auto run and its Undo survive a reload`, (await noteBox.getByRole("button", { name: "Undo" }).count()) === 1);
  await tap(noteBox.getByRole("button", { name: "Undo" }));
  await noteBox.waitFor({ state: "detached" });
  check(`${tag}: Undo removes the auto plan`, (await rowStatus(page, "MATH 1720")) === "Available");
  check(`${tag}: inferred statuses stay after Undo`, (await rowStatus(page, "CSCE 1030")) === "Covered");
  if (!phone) {
    // A second run, then a hand edit to a course it planned: Undo must refuse rather than overwrite it.
    await page.getByRole("button", { name: "Auto-fill", exact: true }).click();
    await noteBox.waitFor();
    await page.locator('[data-row-open="MATH 1720"]').hover();
    await rowOf(page, "MATH 1720").getByRole("button", { name: /Remove/ }).click();
    const blocked = noteBox.locator("[data-undo-blocked]");
    await blocked.waitFor();
    check(`${tag}: Undo is refused after an edit to a course it touched`, (await blocked.innerText()).includes("You changed MATH 1720 after Auto-fill."));
    await noteBox.getByRole("button", { name: "Dismiss note" }).click();
    await noteBox.waitFor({ state: "detached" });
  }

  // ---------- 4. detail panel ----------
  await tap(page.locator('[data-row-open="MATH 1710"]'));
  let panel = panelFor("MATH 1710");
  await panel.getByText(/Couldn.t load grade history from untgrades\.app/).waitFor();
  check(`${tag}: grade history down shows the unavailable state`, true);
  check(`${tag}: the catalog text still shows`, (await panel.innerText()).includes("Calculus I"));
  if (phone) {
    await page.getByRole("button", { name: "Close MATH 1710 details" }).tap();
    await panel.waitFor({ state: "detached" });
  }

  await tap(page.locator('[data-row-open="CSCE 1030"]'));
  panel = panelFor("CSCE 1030");
  await panel.getByText("Grade history from untgrades.app").waitFor();
  if (!phone) {
    const width = await panel.evaluate((el) => el.getBoundingClientRect().width);
    check(`${tag}: the panel is 520px`, Math.round(width) === 520, `${width}px`);
    check(`${tag}: no scrim behind the desktop panel`, (await page.locator(".ui-sheet-scrim, .ui-palette-scrim").count()) === 0);
    const listRight = await page.locator("[data-course-list]").evaluate((el) => el.getBoundingClientRect().right);
    const panelLeft = await panel.evaluate((el) => el.getBoundingClientRect().left);
    check(`${tag}: the list narrows beside the panel`, listRight <= panelLeft, `${listRight} <= ${panelLeft}`);
    const top = await panel.evaluate((el) => el.getBoundingClientRect().top);
    const bar = await page.locator(".shell-topbar").evaluate((el) => el.getBoundingClientRect().bottom);
    check(`${tag}: the panel starts at or below the top bar`, top >= bar - 1, `${top} >= ${bar}`);
  } else {
    check(`${tag}: the sheet has a drag handle`, await page.getByRole("dialog", { name: "CSCE 1030 details" }).getByRole("button", { name: "Resize sheet" }).isVisible());
  }
  const bars = await panel.locator("[data-grade-bar]").evaluateAll((els) => els.map((el) => ({ bg: getComputedStyle(el).backgroundColor, opacity: getComputedStyle(el).opacity })));
  const greens = new Set(bars.map((b) => b.bg));
  check(`${tag}: the bars are one green ramp`, greens.size === 1 && [...greens][0] === "rgb(0, 81, 43)" && bars.map((b) => b.opacity).join() === "1,0.8,0.6,0.45,0.35,0.25", JSON.stringify(bars.map((b) => b.opacity)));
  const source = panel.locator("[data-linkout=source]");
  check(`${tag}: Data source link`, (await source.getAttribute("href")) === "https://www.untgrades.app/" && (await source.getAttribute("target")) === "_blank");

  const instructor = panel.getByRole("combobox", { name: "Instructor" });
  const studentsBefore = await panel.locator("[data-fig]").nth(1).innerText();
  await tap(instructor);
  await tap(page.getByRole("option", { name: /Haili Wang/ }));
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
    // Drag down to the half detent; then Tab into the content opens the sheet fully again.
    const sheet = page.getByRole("dialog", { name: "CSCE 1030 details" });
    const grip = page.getByRole("dialog", { name: "CSCE 1030 details" }).getByRole("button", { name: "Resize sheet" });
    const box = await grip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(box.x + box.width / 2, box.y + 4 + step * 30);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const offset = await sheet.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
    const expected = (0.92 - 0.5) * viewport.height;
    check(`${tag}: a drag settles the sheet at the half detent`, Math.abs(offset - expected) < 3, `${offset.toFixed(1)}px vs ${expected}px`);
    await grip.focus();
    await page.keyboard.press("Tab");
    await page.waitForTimeout(400);
    check(`${tag}: moving focus into the half-height sheet opens it fully`, (await sheet.getAttribute("data-expanded")) !== null);
    // ⌘K over the sheet, then Escape from a palette button: only the palette closes.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Search courses" });
    await palette.waitFor();
    await palette.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });
    check(`${tag}: Escape in the palette leaves the sheet under it open`, await sheet.isVisible());
    await page.getByRole("button", { name: "Close CSCE 1030 details" }).tap();
    await sheet.waitFor({ state: "detached" });
  }

  // ---------- 5. add a course through search ----------
  if (!phone) {
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Search courses" });
    await palette.waitFor();
    const animations = await palette.evaluate((el) => el.getAnimations({ subtree: true }).length);
    check(`${tag}: ⌘K opens with no animation`, animations === 0, `${animations} running animations`);
    check(`${tag}: the header has no search button of its own`, (await page.locator("[data-course-list]").locator("xpath=../..").getByRole("button", { name: "Search courses" }).count()) === 0);
    await page.keyboard.type("1720");
    const first = palette.getByRole("option").first();
    await first.waitFor();
    check(`${tag}: the major's core course ranks first`, (await first.innerText()).includes("MATH 1720"), (await first.innerText()).replace(/\s+/g, " "));
    await shoot(page, `${tag}-04-palette`);
    await axe(page, `${tag}: search palette`);
    await page.keyboard.press("Meta+Enter");
    await page.getByText("Planned MATH 1720 for Spring 2027.").first().waitFor();
    check(`${tag}: ⌘↵ plans the course and keeps the palette open`, await palette.isVisible());
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });
  } else {
    await page.locator("[class*=phoneHead]").getByRole("button", { name: "Search courses" }).tap();
    const palette = page.getByRole("dialog", { name: "Search courses" });
    await palette.waitFor();
    await page.keyboard.type("1720");
    await palette.getByRole("option", { name: /MATH 1720/ }).tap();
    const sheet = page.getByRole("dialog", { name: "MATH 1720 details" });
    await sheet.waitFor();
    await page.waitForTimeout(350);
    await shoot(page, `${tag}-04-search-to-sheet`);
    await sheet.getByRole("button", { name: "Add to Spring 2027" }).tap();
    await sheet.getByRole("button", { name: "Remove from plan" }).waitFor();
    await axe(page, `${tag}: course sheet`);
    await page.getByRole("button", { name: "Close MATH 1720 details" }).tap();
    await sheet.waitFor({ state: "detached" });
  }
  check(`${tag}: MATH 1720 planned through search`, (await rowStatus(page, "MATH 1720")) === "Planned");

  // Pin MATH 1720 to §501 (MW 1:00-3:20 PM in UNT's Spring 2027 schedule); CSCE 1030 §400 + 301 has a
  // Monday 10:40 AM-1:30 PM lab, so it must show a conflict. Real sections replaced the samples here.
  await tap(page.locator('[data-row-open="MATH 1720"]'));
  const mathPanel = panelFor("MATH 1720");
  await tap(mathPanel.getByRole("button", { name: /Show all \d+ sections/ }));
  await tap(mathPanel.locator("label", { hasText: "§501" }));
  check(`${tag}: choosing a section radio updates the plan`, await mathPanel.locator("label", { hasText: "§501" }).locator("input").isChecked());
  if (phone) {
    await page.getByRole("button", { name: "Close MATH 1720 details" }).tap();
    await mathPanel.waitFor({ state: "detached" });
  }
  await tap(page.locator('[data-row-open="CSCE 1030"]'));
  const csPanel = panelFor("CSCE 1030");
  const clash = csPanel.locator("label", { hasText: "§400 + 301" }).locator("[data-conflict=true]");
  await clash.waitFor();
  const clashText = await clash.innerText();
  // --c-danger is the shell's --danger when it exists, else DESIGN.md's #b3261e.
  const [clashColor, dangerColor] = await clash.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--c-danger)";
    el.parentElement.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).color, resolved];
  });
  check(`${tag}: a clashing section says so in --danger`, clashText.includes("conflicts with MATH 1720") && clashColor === dangerColor && clashColor !== "rgb(88, 110, 88)", `${clashText}, ${clashColor}`);
  await page.waitForTimeout(300);
  await shoot(page, `${tag}-05-planned`);

  // ---------- deep links ----------
  const response = await page.goto(`${BASE}/courses/CSCE/2100`, { waitUntil: "networkidle" });
  check(`${tag}: the deep link renders with grade history down`, response.status() === 200, String(response.status()));
  const deepPanel = panelFor("CSCE 2100");
  await deepPanel.getByText(/Couldn.t load grade history/).waitFor();
  const deepText = await deepPanel.innerText();
  // 1461c03 removes the unparsed concurrent-permission warning; desktop kept the second Auto plan.
  check(`${tag}: the deep link shows catalog text and the history state`, deepText.includes("Foundations of Computing") && (await rowStatus(page, "CSCE 2100")) === (phone ? "Available" : "Planned"));
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
    await routeGrades(page);
    await routeSections(page);
    await page.goto(`${BASE}/courses`, { waitUntil: "networkidle" });
    await chooseMajor(page, false);
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await page.locator('[data-row-open="CSCE 1010"]').click();
    const transform = await page.locator("aside[aria-labelledby=course-panel-title]").evaluate((el) => getComputedStyle(el).transform);
    check("reduced motion: the panel enters without moving", transform === "none", transform);
    await context.close();
  } catch (error) {
    check("reduced motion pass completed", false, String(error).split("\n")[0]);
  }

  // Keyboard only: Tab through the Courses view; every stop must show a focus indicator.
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await routeGrades(page);
    await routeSections(page);
    await page.goto(`${BASE}/courses`, { waitUntil: "networkidle" });
    await chooseMajor(page, false);
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await page.locator('[data-row-open="CSCE 1030"]').waitFor();
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
    check("keyboard: every stop shows a focus ring", stops.every((stop) => stop.ring), stops.map((stop) => `${stop.name}${stop.ring ? "" : " (no ring)"}`).join(" → "));
    await context.close();
  } catch (error) {
    check("keyboard pass completed", false, String(error).split("\n")[0]);
  }

  const page = await browser.newPage();
  for (const [path, label] of [
    ["/courses/ZZZZ/9999", "an unknown course code"],
    ["/courses/CSCE/3010", "a code outside the catalog"],
    ["/courses/%25/1030", "a percent-encoded segment"],
  ]) {
    const response = await page.goto(`${BASE}${path}`);
    check(`${label} is a 404, not a 500`, response.status() === 404, `${path} → ${response.status()}`);
  }
  await page.goto(`${BASE}/instructors/123`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/courses", { timeout: 15000 });
  check("an old instructor link redirects instead of 404", new URL(page.url()).pathname === "/courses", page.url());
  const serverRedirect = await fetch(`${BASE}/instructors/123`, { redirect: "manual" });
  const location = serverRedirect.headers.get("location");
  // Keep the server redirect defect visible even when hydration navigates to Courses.
  check("an old instructor link returns a server 307 redirect to Courses", serverRedirect.status === 307 && location !== null && new URL(location, BASE).pathname === "/courses", `HTTP ${serverRedirect.status}, Location ${location ?? "missing"}`);
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
report.passed = report.checks.filter((c) => c.passed).length;
report.failed = report.checks.filter((c) => !c.passed).length;
writeFileSync(`${OUT}/courses-v2-report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.passed}/${report.checks.length} checks passed`);
process.exit(report.failed === 0 ? 0 : 1);
