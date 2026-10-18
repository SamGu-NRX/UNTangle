#!/usr/bin/env node
/**
 * Courses acceptance journey, updated for the v3 lens (docs/design/untangle-v3-opus
 * HANDOFF §5) and the degree audit as the source of what's left, at 1440x900
 * and 390x844 against a production build. Each viewport runs in a fresh
 * guest context:
 *   1. try the sample transcript, then pick a major in the degree dialog; see
 *      the credits left and what's left by area, and open one requirement
 *   2. press Auto, see the result line, the term tray and the groups' facts
 *      (CSCE 1030, covered through a prerequisite, asks an advisor)
 *   3. undo Auto
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


// v3 Courses (HANDOFF §5): a row is a stretched button with its action beside it; a list row is
// data-flip="row:<id>" and the same course in the term tray is data-flip="tray:<id>".
const rowOf = (page, id) => page.locator(`[data-flip="row:${id}"]`);
const trayRow = (page, id) => page.locator(`[data-flip="tray:${id}"]`);
const rowStatus = (page, id) => rowOf(page, id).getAttribute("data-status");
const rowFact = (page, id) => rowOf(page, id).locator("[data-row-open]").innerText();
const visible = (locator) => locator.filter({ visible: true });

/** Opens a group by its header when it is closed (Taking now, Later and Done start closed). */
async function openGroup(page, title) {
  const head = page.getByRole("button", { name: new RegExp(`^${title}`) });
  if ((await head.getAttribute("aria-expanded")) === "false") await head.click();
}

/** The degree dialog: a search list of majors, not a dropdown. */
async function chooseMajor(page, phone, name = "Computer Science") {
  const trigger = page.getByRole("button", { name: /Choose your major|Computer Science|Mathematics|Undeclared/ }).filter({ has: page.locator("svg") }).first();
  if (phone) await trigger.tap();
  else await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Your degree" });
  await dialog.waitFor();
  return { trigger, dialog, pick: async () => {
    const option = dialog.getByRole("button", { name, exact: true });
    if (phone) await option.tap();
    else await option.click();
    await dialog.waitFor({ state: "detached" });
  } };
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
  const panelFor = (id) => (phone ? page.getByRole("dialog", { name: id, exact: true }) : page.locator("aside.ui-context"));
  const closeDetail = (id) => page.getByRole("button", { name: `Close ${id}` });
  const tap = (locator) => (phone ? locator.tap() : locator.click());

  // ---------- 1. sample transcript, then the major ----------
  await page.goto(`${BASE}/courses`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Start with what you've taken" }).waitFor();
  check(`${tag}: a fresh guest sees the empty state`, true);
  check(`${tag}: no visible native select`, (await page.locator("select:not([hidden])").count()) === 0);
  check(`${tag}: no visible page headline`, (await page.locator("h1").evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height > 2).length)) === 0);
  await tap(page.getByRole("button", { name: /Try a sample transcript/ }));
  const { dialog: degree, pick } = await chooseMajor(page, phone);
  check(`${tag}: the degree opens as a dialog with a search field`, await degree.getByRole("searchbox", { name: "Search majors" }).isVisible());
  await page.waitForTimeout(250);
  await shoot(page, `${tag}-01-major-picker`);
  await axe(page, `${tag}: degree dialog open`);
  await pick();
  check(`${tag}: major chosen`, (await page.getByRole("button", { name: /^Computer Science/ }).first().innerText()).includes("Computer Science"));
  // The degree audit answers first: transcript credits left (9 finished, ENGL 1320's 3 in progress), then what's left by area.
  const left = page.locator('section[aria-labelledby="left-title"]');
  await left.waitFor();
  const leftTitle = await left.getByRole("heading", { level: 2 }).innerText();
  check(`${tag}: the credits left come from the transcript`, leftTitle === "108 credits left", leftTitle);
  check(`${tag}: the degree line no longer counts catalog credits`, (await page.locator("[class*=progress]").count()) === 0);
  // Planning first: the credits left, then the term card with Auto, then what's left by area, then the advisor's list.
  const top = async (locator) => (await locator.boundingBox())?.y ?? Number.NaN;
  const heads = page.locator('section[aria-labelledby^="left-"] > h2 button');
  const trayTop = await top(page.locator('section[aria-labelledby="tray-title"]'));
  check(`${tag}: the credits left, then the term, then what's left`, (await top(left)) < trayTop && trayTop < (await top(heads.first())), `${await top(left)} < ${trayTop} < ${await top(heads.first())}`);
  // textContent reads the hidden ", " between a title and its summary, as the accessible name does.
  const areas = (await heads.allTextContents()).map((head) => head.replace(/\s+/g, " ").trim());
  // The sample's ENGL 1320 is in progress, so the core's communication area needs nothing more.
  const expectedAreas = phone
    ? ["Computer Science, BS, 20 courses, 12 credits left", "University Core Curriculum, 33 credits left"]
    : ["Computer Science, BS", "University Core Curriculum"];
  check(
    `${tag}: what's left reads by area, ${phone ? "closed with what each needs" : "open"}, then the advisor's list`,
    JSON.stringify(areas.slice(0, 2)) === JSON.stringify(expectedAreas) && /^\d+ things to check with an advisor$/.test(areas[2] ?? ""),
    JSON.stringify(areas),
  );
  const advisorHead = page.locator("#left-advisor");
  check(`${tag}: the advisor's list starts closed`, (await advisorHead.getAttribute("aria-expanded")) === "false" && (await page.locator('[data-requirement="advisor"]').count()) === 0);
  await tap(advisorHead);
  check(`${tag}: the advisor's disclosure opens the items with their reasons`, (await page.locator('[data-requirement="advisor"]').count()) > 0);
  await tap(advisorHead);
  if (phone) await tap(page.locator("#left-major"));
  const required = page.getByRole("button", { name: /^Required courses/ });
  check(`${tag}: a requirement row says what it needs`, (await required.innerText()).replace(/\s+/g, " ").includes("16 courses"), (await required.innerText()).replace(/\s+/g, " "));
  await tap(required);
  const reqPanel = phone ? page.getByRole("dialog", { name: "Required courses", exact: true }) : page.locator("aside.ui-context");
  await reqPanel.getByText("Still needed", { exact: true }).waitFor();
  check(
    `${tag}: the requirement's detail cites the catalog heading it comes from`,
    (await reqPanel.innerText()).includes("Computer Science, BS lists this under Major requirements") &&
      (await reqPanel.getByRole("link", { name: /Open in the catalog/ }).getAttribute("href")) === "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227#MajorRequirements",
  );
  await page.waitForTimeout(phone ? 400 : 300);
  await shoot(page, `${tag}-01b-requirement`);
  await axe(page, `${tag}: requirement detail`);
  if (phone) await tap(page.getByRole("button", { name: "Close Required courses" }));
  else await page.keyboard.press("Escape");
  await reqPanel.waitFor({ state: phone ? "detached" : "hidden" });

  // ---------- 2. Auto ----------
  // CSCE 2100 leads You can take: it unlocks the most of what the degree still needs.
  await rowOf(page, "CSCE 2100").waitFor();
  await tap(page.getByRole("button", { name: "Auto", exact: true }));
  const result = page.locator('[data-flip="result"]');
  await result.waitFor();
  const resultText = await result.innerText();
  const trayIds = (await page.locator('[data-flip^="tray:"]').evaluateAll((els) => els.map((el) => el.dataset.flip.slice(5)))).sort();
  check(`${tag}: the result line says what Auto did`, new RegExp(`Planned ${trayIds.length} course`).test(resultText) && trayIds.length > 0, resultText.replace(/\s+/g, " "));
  // Only what the degree still needs, ranked by what each unlocks: three required CSCE courses, MATH 1720 for the
  // Component Area Option, PHYS 1410 for Laboratory science. Alpha plans PSYC 1630 here; edge's catalog puts PHYS 1410
  // ahead (frontend/tests/courses/plan-edits.test.ts).
  check(`${tag}: Auto planned what the degree still needs`, JSON.stringify(trayIds) === JSON.stringify(["CSCE 1010", "CSCE 2100", "CSCE 2110", "MATH 1720", "PHYS 1410"]), trayIds.join(", "));
  check(`${tag}: CSCE 2100 left its group for the tray`, (await trayRow(page, "CSCE 2100").count()) === 1 && (await rowOf(page, "CSCE 2100").count()) === 0);
  const toCheck = page.locator('[data-status=check][data-flip^="row:"]').first();
  // The fact starts with a visually hidden ", " for screen readers, so the text is matched after it.
  const reason = (await toCheck.locator("[data-tone=attention]").innerText()).replace(/^,\s*/, "");
  check(`${tag}: a To check row says why, in attention`, /^(Needs|Take with|Catalog rule|Transcript|Ask an advisor)/.test(reason), reason);
  const doneHead = await page.getByRole("button", { name: /^Done/ }).innerText();
  check(`${tag}: a closed group shows its count`, /Done\s*3/.test(doneHead), doneHead.replace(/\s+/g, " "));
  check(`${tag}: an open group shows no count`, !/\d/.test(await page.getByRole("button", { name: /^To check/ }).innerText()));
  // The degree still lists CSCE 1030, so covered for planning is a question for an advisor, not Done.
  check(`${tag}: CSCE 1030 asks an advisor whether it is waived`, (await rowStatus(page, "CSCE 1030")) === "check" && (await rowFact(page, "CSCE 1030")).includes("Ask an advisor if it's waived"));
  await openGroup(page, "Done");
  check(`${tag}: CSCE 1030 is not in Done`, (await page.locator('section[aria-labelledby="group-done"] [data-flip="row:CSCE 1030"]').count()) === 0);
  check(`${tag}: CSCE 1040 done from the transcript`, (await rowStatus(page, "CSCE 1040")) === "done" && (await rowFact(page, "CSCE 1040")).includes("Grade A"));
  const rowHeight = await rowOf(page, "CSCE 1030").evaluate((el) => el.getBoundingClientRect().height);
  check(`${tag}: row height`, phone ? rowHeight >= 52 : Math.round(rowHeight) === 48, `${rowHeight}px`);
  check(`${tag}: no row joins facts with a mid dot`, !(await page.locator("[data-row-open]").allInnerTexts()).some((text) => text.includes("·")));
  if (!phone) {
    const codeFont = await rowOf(page, "CSCE 1030").locator("[class*=code]").evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.fontFamily.split(",")[0]} ${style.fontSize} ${style.fontWeight}`;
    });
    // Syne is for the wordmark only (Sam, Oct 14); codes are DM Sans 600.
    check(`${tag}: row code set in DM Sans 13 semibold`, /dm[ _]?sans/i.test(codeFont) && !/syne/i.test(codeFont) && codeFont.includes("13px") && codeFont.includes("600"), codeFont);
    const available = await page.locator('[data-status=available][data-flip^="row:"]').first().getAttribute("data-flip");
    const id = available.slice(4);
    check(`${tag}: an available row has its + beside the button, not inside it`, (await rowOf(page, id).locator("[data-row-open] button").count()) === 0 && (await rowOf(page, id).getByRole("button", { name: `Add ${id} to Spring 2027` }).count()) === 1, id);
    await openGroup(page, "Later");
    const later = page.locator('[data-status=locked][data-flip^="row:"]').first();
    check(`${tag}: a Later row says what it needs, as text`, /^Needs /m.test(await later.locator("[class*=fact]").innerText()) && (await later.locator("a").count()) === 0);
  }
  await shoot(page, `${tag}-02-after-auto`);
  await axe(page, `${tag}: after Auto`);

  // ---------- 3. undo, after a reload ----------
  // "load", not "networkidle": with no database the sections route holds each planned course's request
  // until the browser's 15s timeout, so a page with planned courses never goes idle (verified with a network probe).
  await page.reload({ waitUntil: "load" });
  await result.waitFor();
  check(`${tag}: the Auto run and its Undo survive a reload`, (await result.getByRole("button", { name: "Undo" }).count()) === 1);
  await tap(result.getByRole("button", { name: "Undo" }));
  await result.waitFor({ state: "detached" });
  await page.waitForTimeout(400);
  check(`${tag}: Undo removes the auto plan`, (await rowStatus(page, "CSCE 2100")) === "available" && (await page.locator('[data-flip^="tray:"]').count()) === 0);
  await openGroup(page, "Done");
  check(`${tag}: inferred statuses stay after Undo`, (await rowStatus(page, "CSCE 1030")) === "check");
  if (!phone) {
    // A second run, then a hand edit to a course it planned: Undo goes away rather than overwrite it.
    await page.getByRole("button", { name: "Auto", exact: true }).click();
    await result.waitFor();
    await page.getByRole("button", { name: "Remove MATH 1720 from Spring 2027" }).click();
    await result.waitFor({ state: "detached" });
    check(`${tag}: Undo is withdrawn after an edit to a course it touched`, true);
    await page.waitForTimeout(400);
    // The tray's ⋯ takes out what that run still owns, so step 5's plan is MATH 1720 alone, as before Auto planned five.
    await page.getByRole("button", { name: "More for Spring 2027" }).click();
    await page.getByRole("menuitem", { name: "Remove the 4 courses Auto added" }).click();
    await page.locator('[data-flip^="tray:"]').first().waitFor({ state: "detached" });
    check(`${tag}: ⋯ removes the courses Auto added`, (await page.locator('[data-flip^="tray:"]').count()) === 0);
  }

  // ---------- 4. detail ----------
  await tap(rowOf(page, "MATH 1710").locator("[data-row-open]"));
  let panel = panelFor("MATH 1710");
  await panel.getByText(/Couldn.t load grade history from untgrades\.app/).waitFor();
  check(`${tag}: grade history down shows the unavailable state`, true);
  check(`${tag}: the catalog text still shows`, (await panel.innerText()).includes("Calculus I"));
  if (phone) {
    await closeDetail("MATH 1710").tap();
    await panel.waitFor({ state: "detached" });
  }

  await tap(rowOf(page, "CSCE 1030").locator("[data-row-open]"));
  panel = panelFor("CSCE 1030");
  await panel.getByText(/UNT grade records/).waitFor();
  if (!phone) {
    await page.waitForTimeout(300);
    const width = await panel.evaluate((el) => el.getBoundingClientRect().width);
    check(`${tag}: the panel is 440px`, Math.round(width) === 440, `${width}px`);
    check(`${tag}: no scrim behind the desktop panel`, (await page.locator(".ui-sheet-scrim, .ui-palette-scrim").count()) === 0);
    const listRight = await rowOf(page, "CSCE 1030").evaluate((el) => el.getBoundingClientRect().right);
    const panelLeft = await panel.evaluate((el) => el.getBoundingClientRect().left);
    check(`${tag}: the page moves aside so the selected row stays beside the panel`, listRight <= panelLeft, `${listRight} <= ${panelLeft}`);
    const top = await panel.evaluate((el) => el.getBoundingClientRect().top);
    const bar = await page.locator(".shell-topbar").evaluate((el) => el.getBoundingClientRect().bottom);
    check(`${tag}: the panel starts at or below the top bar`, top >= bar - 1, `${top} >= ${bar}`);
  } else {
    check(`${tag}: the sheet has a drag handle`, await panel.getByRole("button", { name: "Resize sheet" }).isVisible());
    // v3: the detail sheet opens at its half detent (MOTION.md §5); Tab into the content opens it fully.
    await page.waitForTimeout(400);
    const offset = await panel.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
    const expected = (0.92 - 0.52) * viewport.height;
    check(`${tag}: the sheet opens at the half detent`, Math.abs(offset - expected) < 3, `${offset.toFixed(1)}px vs ${expected}px`);
    // The handle raises it to full height, where the body scrolls to the grades below.
    await panel.getByRole("button", { name: "Resize sheet" }).tap();
    await page.waitForTimeout(500);
    check(`${tag}: the handle opens the sheet fully`, (await panel.getAttribute("data-expanded")) !== null);
  }
  const bars = await panel.locator("[data-grade-bar]").evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  check(`${tag}: the bars are one green`, bars.length === 6 && new Set(bars).size === 1 && bars[0] === "rgb(0, 81, 43)", bars.join());
  const source = panel.locator("[data-linkout=source]");
  check(`${tag}: Data source link`, (await source.getAttribute("href")) === "https://www.untgrades.app/" && (await source.getAttribute("target")) === "_blank");
  check(`${tag}: no instructor select, chips instead`, (await panel.getByRole("combobox").count()) === 0 && (await panel.getByRole("group", { name: "Instructor" }).count()) === 1);

  const studentsBefore = await panel.locator("[class*=figures] > div").nth(1).innerText();
  await tap(panel.getByRole("group", { name: "Instructor" }).getByRole("button", { name: "Haili Wang", exact: true }));
  await page.waitForTimeout(300);
  const studentsAfter = await panel.locator("[class*=figures] > div").nth(1).innerText();
  check(`${tag}: picking an instructor redraws the figures`, studentsBefore !== studentsAfter, `${studentsBefore.replace(/\s+/g, " ")} -> ${studentsAfter.replace(/\s+/g, " ")}`);
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
  await axe(page, `${tag}: detail`);

  if (!phone) {
    // ↑/↓ retargets the open panel; it must not re-animate.
    await rowOf(page, "CSCE 1030").locator("[data-row-open]").focus();
    const nextId = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("[data-row-open]")];
      return buttons[buttons.findIndex((button) => button.dataset.rowOpen === "CSCE 1030") + 1]?.dataset.rowOpen;
    });
    const states = [];
    await page.keyboard.press("ArrowDown");
    for (let i = 0; i < 6; i++) {
      states.push(await panel.getAttribute("data-state"));
      await page.waitForTimeout(30);
    }
    const heading = await panel.locator("h2").innerText();
    check(`${tag}: ↓ moves the panel to the next course`, Boolean(nextId) && heading.includes(nextId), `${heading.replace(/\s+/g, " ")} (next row ${nextId})`);
    check(`${tag}: the panel stays open while retargeting`, states.every((s) => s === "open"), states.join(","));
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    check(`${tag}: Esc closes the panel`, true);
  } else {
    const sheet = panel;
    // ⌘K over the sheet, then Escape from a palette button: only the palette closes.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Search courses" });
    await palette.waitFor();
    await palette.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });
    check(`${tag}: Escape in the palette leaves the sheet under it open`, await sheet.isVisible());
    await closeDetail("CSCE 1030").tap();
    await sheet.waitFor({ state: "detached" });
  }

  // ---------- 5. add a course through search ----------
  if (!phone) {
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Search courses" });
    await palette.waitFor();
    const animations = await palette.evaluate((el) => el.getAnimations({ subtree: true }).length);
    check(`${tag}: ⌘K opens with no animation`, animations === 0, `${animations} running animations`);
    check(`${tag}: the page has no visible search button of its own`, (await visible(page.locator("[class*=phoneSearch]").getByRole("button")).count()) === 0);
    await page.keyboard.type("1720");
    const first = palette.getByRole("option").first();
    await first.waitFor();
    // Both 1720s count toward the degree (Laboratory science, the Component Area Option); they outrank the rest by code.
    check(`${tag}: a course the degree still needs ranks first`, /BIOL 1720|MATH 1720/.test(await first.innerText()), (await first.innerText()).replace(/\s+/g, " "));
    await shoot(page, `${tag}-04-palette`);
    await axe(page, `${tag}: search palette`);
    await page.keyboard.type(" calculus");
    await palette.getByRole("option").first().filter({ hasText: "MATH 1720" }).waitFor();
    await page.keyboard.press("Meta+Enter");
    await page.getByText("Added MATH 1720 to Spring 2027").first().waitFor();
    check(`${tag}: ⌘↵ adds the course and keeps the palette open`, await palette.isVisible());
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });
  } else {
    await page.locator("[class*=phoneSearch]").getByRole("button", { name: "Search courses" }).tap();
    const palette = page.getByRole("dialog", { name: "Search courses" });
    await palette.waitFor();
    await page.keyboard.type("1720");
    await palette.getByRole("option", { name: /MATH 1720/ }).tap();
    const sheet = panelFor("MATH 1720");
    await sheet.waitFor();
    await page.waitForTimeout(350);
    await shoot(page, `${tag}-04-search-to-sheet`);
    await sheet.getByRole("button", { name: "Add to Spring 2027" }).tap();
    await sheet.getByRole("button", { name: "Remove from Spring 2027" }).waitFor();
    await axe(page, `${tag}: course sheet`);
    await closeDetail("MATH 1720").tap();
    await sheet.waitFor({ state: "detached" });
  }
  check(`${tag}: MATH 1720 planned through search`, (await trayRow(page, "MATH 1720").count()) === 1);

  // Pin MATH 1720 to §501 (MW 1:00-3:20 PM in UNT's Spring 2027 schedule); CSCE 1030 §400 + 301 has a
  // Monday 10:40 AM-1:30 PM lab, so it must show a conflict. Real sections replaced the samples here.
  await tap(trayRow(page, "MATH 1720").locator("[data-row-open]"));
  const mathPanel = panelFor("MATH 1720");
  await tap(mathPanel.getByRole("button", { name: /Show all \d+ sections/ }));
  await tap(mathPanel.getByRole("button", { name: /^Add §501 to Spring 2027/ }));
  check(`${tag}: choosing a section updates the plan`, (await mathPanel.getByRole("button", { name: "§501 is in your plan" }).count()) === 1);
  if (phone) {
    await closeDetail("MATH 1720").tap();
    await mathPanel.waitFor({ state: "detached" });
  }
  await openGroup(page, "Done");
  await tap(rowOf(page, "CSCE 1030").locator("[data-row-open]"));
  const csPanel = panelFor("CSCE 1030");
  const sectionsList = csPanel.getByRole("list", { name: "Sections of CSCE 1030" });
  const showAll = csPanel.getByRole("button", { name: /Show all \d+ sections/ });
  if (await showAll.count()) await tap(showAll);
  const clash = sectionsList.locator("li", { hasText: "§400 + 301" }).locator("[class*=conflict]");
  await clash.waitFor();
  const clashText = await clash.innerText();
  const [clashColor, dangerColor] = await clash.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--danger)";
    el.parentElement.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).color, resolved];
  });
  check(`${tag}: a clashing section says so in --danger`, clashText.includes("Overlaps MATH 1720") && clashColor === dangerColor, `${clashText}, ${clashColor}`);
  await page.waitForTimeout(300);
  await shoot(page, `${tag}-05-planned`);

  // ---------- deep links ----------
  const response = await page.goto(`${BASE}/courses/CSCE/2100`, { waitUntil: "load" });
  check(`${tag}: the deep link renders with grade history down`, response.status() === 200, String(response.status()));
  const deepPanel = panelFor("CSCE 2100");
  await deepPanel.getByText(/Couldn.t load grade history/).waitFor();
  // Desktop removed what its second Auto run added; the phone undid its only run.
  const deepStatus = "You can take this";
  // The detail opens on the first render from the catalog, before the planner has read the saved plan:
  // that read waits for the session lookup to prepare an identity. Grade history is answered locally and can
  // arrive first, so wait for the status the saved plan gives rather than reading the panel once.
  const statusShown = await deepPanel
    .getByText(deepStatus, { exact: true })
    .waitFor({ timeout: 15000 })
    .then(() => true, () => false);
  const deepText = await deepPanel.innerText();
  check(
    `${tag}: the deep link shows catalog text and the status`,
    statusShown && deepText.includes("Foundations of Computing") && deepText.includes(deepStatus),
    statusShown ? null : `status never read "${deepStatus}": ${deepText.replace(/\s+/g, " ").slice(0, 160)}`,
  );
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
    await (await chooseMajor(page, false)).pick();
    await page.locator('[data-row-open="CSCE 1010"]').click();
    const transform = await page.locator("aside.ui-context").evaluate((el) => getComputedStyle(el).transform);
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
    await (await chooseMajor(page, false)).pick();
    await page.locator('[data-row-open="CSCE 1010"]').waitFor();
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
