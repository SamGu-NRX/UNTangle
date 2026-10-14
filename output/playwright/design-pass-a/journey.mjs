#!/usr/bin/env node
// Design pass A journey (HANDOFF steps 8 and 9) at 1440x900 (fine pointer)
// and 390x844 (touch), against `next start` and the mock myUNT server
// (tools/mock-myunt, port 4317), which stands in for myUNT's transcript page
// and serves the synthetic transcript PDF.
//   Import:  Courses menu -> /connect -> Open myUNT (popup) -> close -> "Use
//            the downloaded PDF" (stubbed picker) -> review grouped by term
//            with one credit line -> Looks right; the page-wide drop;
//            popups blocked; Back and the old /courses/import address;
//            phones end at the native file chooser and survive a reload.
//   Library: save a copy, change the working plan (mark a course as credit
//            on Courses), compare two schedules, use a copy in Main, Undo.
//   Auth:    the sign-in dialog over a page (focus returns to Sign in);
//            sign-in by emailed link and by password at /auth, errors under
//            each field; reset; the emailed link's landing page (no token
//            use until its button is pressed).
// axe (WCAG 2.0-2.2 A/AA) on every state. Writes screenshots and report.json.
//   node journey.mjs <baseUrl> <mockUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const [base, mock, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const results = [];
const check = (size, name, pass, detail = "") => {
  results.push({ size, name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${size}] ${name}${detail ? ` — ${detail}` : ""}`);
};
async function axe(page, size, label) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, target: v.nodes[0]?.target }));
  });
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(size, `axe: ${label} has no serious or critical findings`, serious.length === 0, JSON.stringify(serious));
}
const shot = (page, size, name) => page.screenshot({ path: join(out, `${size}-${name}.png`) });

// The mock's PDF matches every row to the catalog. Swap one course code for
// one the catalog lacks, at equal length so the PDF's byte offsets hold, to
// get a row that needs a decision.
const mockPdf = Buffer.from(await (await fetch(`${mock}/synthetic-transcript.pdf`)).arrayBuffer()).toString("latin1");
const pdf = Buffer.from(mockPdf.replace("CSCE 1040 Computer Science II", "HIST 9999 Computer Science II"), "latin1");
if (pdf.toString("latin1") === mockPdf) throw new Error("the mock transcript changed; update the swap");
const file = { name: "transcript.pdf", mimeType: "application/pdf", buffer: pdf };

async function plansSave(page, size) {
  await page.goto(`${base}/schedules`, { waitUntil: "networkidle" });
  check(size, "library: one heading, Schedules", (await page.getByRole("heading", { level: 1, name: "Schedules" }).count()) === 1);
  check(size, "library: Main is listed as the active schedule", (await page.getByRole("button", { name: "Open Main, active" }).count()) === 1);
  await page.getByRole("button", { name: "Save a copy" }).first().click();
  const name = page.getByRole("dialog", { name: "Save a copy of Main" }).getByLabel("Name");
  await name.fill("Before import");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Open Before import" }).waitFor();
  check(size, "library: a saved copy is a row with one fact, when it was saved", /Saved just now/.test(await page.locator("li", { has: page.getByRole("button", { name: "Open Before import" }) }).innerText()));
}
const TRIP_KEY = "untangle.connect.trip";
const pdfBase64 = pdf.toString("base64");

/** Stand-in myUNT: the transcript page that "Open myUNT" shows, served by the mock. */
async function routeMyUnt(ctx) {
  const body = await (await fetch(`${mock}/transcript`)).text();
  await ctx.route("https://my.unt.edu/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body }));
}

/** A File System Access picker that hands back the transcript and records its options. */
async function stubPicker(ctx) {
  await ctx.addInitScript((b64) => {
    window.__pickerCalls = [];
    window.showOpenFilePicker = async (options) => {
      window.__pickerCalls.push(options);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return [{ getFile: async () => new File([bytes], "unofficial-transcript.pdf", { type: "application/pdf" }) }];
    };
  }, pdfBase64);
}

async function toCourses(page) {
  await page.goto(`${base}/courses`, { waitUntil: "networkidle" });
  // The Courses view may open its major dialog first; answer it so the bar is reachable.
  const major = page.locator('[role="dialog"]', { hasText: "What are you studying?" });
  if (await major.isVisible().catch(() => false)) {
    await major.getByRole("button", { name: /Undeclared/ }).evaluate((el) => el.click());
    await major.getByRole("button", { name: "Confirm" }).evaluate((el) => el.click());
    await major.waitFor({ state: "detached" });
  }
}

// v3: the import is its own page at /connect; Courses' Auto-fill menu goes there.
async function openConnectFromCourses(page) {
  await page.getByRole("button", { name: "More Auto-fill options" }).filter({ visible: true }).first().click();
  await page.getByRole("menuitem", { name: "Import a transcript" }).click();
  await page.waitForURL(/\/connect$/);
  const stage = page.getByRole("main");
  await stage.getByRole("heading", { level: 1 }).waitFor();
  await page.waitForTimeout(350);
  return stage;
}

/** Drags made in the page: `files` is a list of [name, type] (the PDF bytes for .pdf), or null for a text drag. */
async function drag(page, phase, files) {
  return page.evaluate(
    ({ phase, files, b64 }) => {
      if (phase === "start") {
        const dt = new DataTransfer();
        if (files) {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          for (const [name, type] of files) dt.items.add(new File([type === "application/pdf" ? bytes : "x"], name, { type }));
        } else dt.setData("text/plain", "CSCE 1030");
        window.__dt = dt;
      }
      const target = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 3) ?? document.body;
      const types = phase === "start" ? ["dragenter", "dragover"] : [phase];
      for (const type of types) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
    },
    { phase, files, b64: pdfBase64 },
  );
}
const overlay = (page) => page.locator('[data-testid="pdf-drop-overlay"]');
const flagSet = (page) => page.evaluate((key) => sessionStorage.getItem(key) === "1", TRIP_KEY);

// Desktop: popup window -> close -> "Use the downloaded PDF" (stubbed picker)
// -> review grouped by term, with a row to check -> breakpoint crossed after deciding -> save.
async function connectPopup(page, size) {
  await toCourses(page);
  const stage = await openConnectFromCourses(page);
  check(size, "connect: the Courses menu opens the import page at /connect", page.url().endsWith("/connect"), page.url());
  const text = await stage.innerText();
  check(size, "connect: the first screen says the PDF is read here and nothing is uploaded", /Nothing is uploaded/.test(text));
  check(size, "connect: no extension anywhere in the flow", !/extension/i.test(text));
  const open = stage.getByRole("link", { name: /Open myUNT/ });
  check(size, "connect: one primary action, Open myUNT", (await stage.locator(".ui-btn--primary").count()) === 1 && /ui-btn--primary/.test(await open.getAttribute("class")));
  await shot(page, size, "connect-start");
  await axe(page, size, "Connect start");

  const [popup] = await Promise.all([page.waitForEvent("popup"), open.click()]);
  // The window opens blank, is cut off from this page, then navigates.
  await popup.waitForURL(/^https:\/\/my\.unt\.edu\//);
  check(size, "connect: Open myUNT opens the transcript page in a separate window", popup.url().startsWith("https://my.unt.edu/"), popup.url());
  check(size, "connect: the myUNT window can't reach back to UNTangle", (await popup.evaluate(() => window.opener)) === null);
  check(size, "connect: while away the page waits calmly", await stage.getByRole("heading", { name: "Download your transcript there" }).isVisible());
  check(size, "connect: the trip is remembered for a reload", await flagSet(page));
  await shot(page, size, "connect-away");
  await axe(page, size, "Connect waiting for myUNT");

  await popup.close();
  await stage.getByRole("heading", { name: "Got it downloaded?" }).waitFor();
  await page.waitForTimeout(100);
  const use = stage.getByRole("button", { name: "Use the downloaded PDF" });
  check(size, "connect: closing myUNT makes 'Use the downloaded PDF' the primary action", /ui-btn--primary/.test(await use.getAttribute("class")));
  check(size, "connect: it takes focus", await use.evaluate((el) => el === document.activeElement));
  check(size, "connect: it is not pressed for the student (the picker needs a gesture)", (await page.evaluate(() => window.__pickerCalls.length)) === 0);
  await shot(page, size, "connect-back");
  await axe(page, size, "Connect back from myUNT");

  await use.click();
  await page.getByRole("heading", { name: /courses? found/ }).waitFor();
  const options = await page.evaluate(() => window.__pickerCalls[0]);
  check(size, "connect: the picker opens in Downloads for one PDF", options?.startIn === "downloads" && JSON.stringify(options.types[0].accept) === JSON.stringify({ "application/pdf": [".pdf"] }), JSON.stringify(options));
  check(size, "connect: choosing the file ends the trip", !(await flagSet(page)));
  await page.waitForTimeout(250);
  check(size, "connect: progress and review never say 'AI'", !/\bAI\b/.test(await stage.innerText()));
  await reviewChecks(page, stage, size);
  await shot(page, size, "connect-review");
  await axe(page, size, "Connect review");

  // Crossing the phone breakpoint (rotation, zoom) must keep the review and the decision.
  const done = stage.getByRole("radiogroup", { name: "How to count HIST 9999" }).getByRole("radio", { name: "Done" });
  await done.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const kept = (await done.getAttribute("aria-checked")) === "true";
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  check(size, "connect: crossing the phone breakpoint after deciding a row keeps the review and the decision", kept && (await done.getAttribute("aria-checked")) === "true");

  await stage.getByRole("button", { name: "Looks right" }).click();
  await page.waitForURL(/\/courses$/);
  await page.getByText(/^Added \d+ courses? from your transcript$/).first().waitFor();
  check(size, "connect: 'Looks right' saves and lands on Courses", page.url().endsWith("/courses"));
  await shot(page, size, "connect-done");
}

/** The review: rows to check first, then one heading per term; one fact per row; credits once, in the summary line. */
async function reviewChecks(page, stage, size) {
  const headings = await stage.getByRole("heading", { level: 2 }).allInnerTexts();
  check(size, "review: 'To check' comes first, then the terms", /to check/i.test(headings[0] ?? "") && headings.slice(1).length > 0 && headings.slice(1).every((h) => /^(fall|spring|summer|winter) \d{4}$/i.test(h.trim())), JSON.stringify(headings));
  const summary = await stage.locator("h1 + p").innerText();
  check(size, "review: total credits appear once, in one summary line", /credits? (done|in progress)/.test(summary), summary);
  const rows = (await stage.locator("li:not([data-flagged]) > button").allInnerTexts()).map((r) => r.replace(/\.? ?Change how it counts\s*$/, ""));
  check(size, "review: each row is a code, a title and one fact, with no credits", rows.length > 0 && rows.every((r) => /(Grade [A-Z]+|Taking|Done)\s*$/.test(r) && !/\d\.\d{3}|credit/i.test(r)), JSON.stringify(rows.slice(0, 3)));
  // A settled row opens its correction one step away: Skip leaves it out and the credit line drops.
  const row = stage.locator("li:not([data-flagged]) > button").first();
  await row.click();
  const code = (await row.locator(".ui-code").innerText()).trim();
  await stage.getByRole("radiogroup", { name: `How to count ${code}` }).getByRole("radio", { name: "Skip" }).click();
  const after = await stage.locator("h1 + p").innerText().catch(() => "");
  check(size, "review: a settled row can be corrected, and skipping it lowers the credits", /Skipped/.test(await row.innerText()) && after !== summary, `${summary} -> ${after}`);
  await stage.getByRole("radiogroup", { name: `How to count ${code}` }).getByRole("radio", { name: "Done" }).click();
  await row.click();
  const flagged = await page.locator("li[data-flagged]").count();
  const decisions = await page.locator('li[data-flagged] [role="radiogroup"]').count();
  check(size, "review: every row to check has its reason and a Done, Taking or Skip choice, and no dropdown", flagged > 0 && decisions === flagged && (await page.locator("select:visible, [role=combobox]").count()) === 0, `${flagged} rows, ${decisions} choices`);
  check(size, "review: no mid dots", !/\u00b7/.test(await stage.innerText()));
}

// Desktop: the page-wide drop target, from Courses.
async function connectDrop(page, size) {
  await toCourses(page);
  await drag(page, "start", null);
  await page.waitForTimeout(150);
  check(size, "drop: a text drag shows no drop target", (await overlay(page).count()) === 0);
  await drag(page, "drop", null);

  await drag(page, "start", [["unofficial-transcript.pdf", "application/pdf"]]);
  await overlay(page).waitFor();
  check(size, "drop: dragging a PDF over the app shows the full-window target", /Drop your transcript/.test(await overlay(page).innerText()));
  await page.waitForTimeout(250); // past the 140ms fade-in
  await shot(page, size, "drop-overlay");
  await drag(page, "dragleave", null);
  await page.waitForTimeout(100);
  check(size, "drop: leaving the window hides it", (await overlay(page).count()) === 0);
  await drag(page, "start", [["photo.png", "image/png"]]);
  await overlay(page).waitFor();
  check(size, "drop: a file that isn't a PDF gets the grey target", /Only PDF transcripts work/.test(await overlay(page).innerText()));
  await drag(page, "dragleave", null);

  // Drop on Courses, then cross the breakpoint while the PDF is still being read.
  await drag(page, "start", [["unofficial-transcript.pdf", "application/pdf"]]);
  await drag(page, "drop", null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: /courses? found/ }).waitFor({ timeout: 15000 });
  check(size, "drop: a PDF dropped on Courses goes to /connect and is read there, through a breakpoint crossing", page.url().endsWith("/connect"), page.url());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  await drag(page, "start", [["a.pdf", "application/pdf"], ["b.pdf", "application/pdf"]]);
  await drag(page, "drop", null);
  // Scoped to the page: Next's route announcer is an alert too.
  const alert = page.getByRole("main").getByRole("alert");
  await alert.waitFor();
  check(size, "drop: two files are refused with a reason", /2 files/.test(await alert.innerText()), await alert.innerText());
  await shot(page, size, "drop-two-files");
  await drag(page, "start", [["photo.png", "image/png"]]);
  await drag(page, "drop", null);
  await page.getByText("“photo.png” isn't a PDF", { exact: false }).waitFor();
  check(size, "drop: a non-PDF is refused by name", true);
  await page.goto(`${base}/courses`, { waitUntil: "load" });
  check(size, "connect: leaving the page leaves no trip flag behind", !(await flagSet(page)));
}

// Desktop with popups blocked: myUNT opens in a tab through the link, and
// the same come-back handling applies (simulated: headless tabs keep focus).
async function connectBlocked(browser, size) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await routeMyUnt(ctx);
  await ctx.addInitScript(() => {
    window.open = () => null;
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/connect`, { waitUntil: "networkidle" });
    const stage = page.getByRole("main");
    const [tab] = await Promise.all([ctx.waitForEvent("page"), stage.getByRole("link", { name: /Open myUNT/ }).click()]);
    await tab.waitForURL(/^https:\/\/my\.unt\.edu\//);
    check(size, "blocked: with popups blocked, myUNT opens in a new tab", tab.url().startsWith("https://my.unt.edu/"), tab.url());
    check(size, "blocked: the page says so and waits for the return", await stage.getByText("myUNT opened in a new tab").isVisible());
    await page.bringToFront();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await stage.getByRole("heading", { name: "Got it downloaded?" }).waitFor();
    check(size, "blocked: coming back to the tab leads with 'Use the downloaded PDF'", /ui-btn--primary/.test(await stage.getByRole("button", { name: "Use the downloaded PDF" }).getAttribute("class")));
    await shot(page, size, "blocked-back");
  } catch (error) {
    check(size, "blocked-popup journey ran to the end", false, String(error).split("\n")[0]);
  }
  await ctx.close();
}

// Phone: no File System Access picker, so the button opens the native file
// chooser; the trip survives a reload at /connect.
async function connectPhone(page, size) {
  await toCourses(page);
  const stage = await openConnectFromCourses(page);
  await shot(page, size, "connect-start");
  await axe(page, size, "Connect start");
  const [popup] = await Promise.all([page.waitForEvent("popup"), stage.getByRole("link", { name: /Open myUNT/ }).click()]);
  await popup.close();
  await stage.getByRole("heading", { name: "Got it downloaded?" }).waitFor();
  // The trip to Safari can reload this tab.
  await page.reload({ waitUntil: "networkidle" });
  const again = page.getByRole("main");
  await again.getByRole("heading", { level: 1 }).waitFor();
  check(size, "connect: after a reload the page comes back on 'Use the downloaded PDF'", await again.getByRole("button", { name: "Use the downloaded PDF" }).isVisible());
  check(size, "connect: the restored trip consumed its flag", !(await flagSet(page)));
  await shot(page, size, "connect-back");
  await axe(page, size, "Connect back from myUNT");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), again.getByRole("button", { name: "Use the downloaded PDF" }).click()]);
  check(size, "connect: without the picker, the native file chooser opens for one PDF", !chooser.isMultiple());
  await chooser.setFiles(file);
  await page.getByRole("heading", { name: /courses? found/ }).waitFor();
  await page.waitForTimeout(250);
  await reviewChecks(page, again, size);
  await shot(page, size, "connect-review");
  await axe(page, size, "Connect review");
  await again.getByRole("radiogroup", { name: "How to count HIST 9999" }).getByRole("radio", { name: "Skip" }).click();
  await again.getByRole("button", { name: "Looks right" }).click();
  await page.waitForURL(/\/courses$/);
  await page.getByText(/^Added \d+ courses? from your transcript$/).first().waitFor();
  check(size, "connect: 'Looks right' saves and lands on Courses", true);
  await shot(page, size, "connect-done");
}

/** The import adds transcript records, not statuses: mark a course as credit so the library has a difference. */
async function markACourseDone(page) {
  // "load", not "networkidle": since #39, the test server has a database URL it
  // can't reach, and this page's network didn't go idle within 30 s.
  await page.goto(`${base}/courses/math/1650`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Status options for MATH 1650" }).first().click();
  await page.getByRole("menuitem", { name: "I have credit for this" }).click();
  await page.waitForTimeout(400);
}

// Back from the import page returns to Courses; the old /courses/import address lands on it.
async function connectHistory(page, size) {
  await toCourses(page);
  await openConnectFromCourses(page);
  await page.goBack();
  await page.waitForURL(/\/courses$/);
  check(size, "connect: Back from the import page returns to Courses", page.url().endsWith("/courses"), page.url());
  await page.goto(`${base}/courses/import`, { waitUntil: "networkidle" });
  check(size, "connect: the old /courses/import address goes to /connect", page.url().endsWith("/connect"), page.url());
  await page.getByRole("link", { name: "Browse courses without a transcript" }).click();
  await page.waitForURL(/\/courses$/);
  check(size, "connect: 'Browse courses without a transcript' goes to Courses", page.url().endsWith("/courses"));
}

async function plansCompareRestore(page, size) {
  await page.goto(`${base}/schedules`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.getByRole("button", { name: /^Compare Before import/ }).click();
  await page.getByRole("button", { name: /^Compare Main/ }).click();
  const table = page.getByRole("table");
  await table.waitFor();
  const labels = await table.locator("tbody th").allInnerTexts();
  check(size, "library: the comparison has the five figures", JSON.stringify(labels) === JSON.stringify(["Days on campus", "First class", "Last class ends", "Walking a week", "Tight walks"]), JSON.stringify(labels));
  check(size, "library: A, Both and B are one segmented control", (await page.getByRole("radiogroup", { name: "Show" }).getByRole("radio").count()) === 3);
  // The import and the claimed credit differ: #37's field-level comparison sits one step away.
  await page.getByRole("button", { name: /^More differences/ }).click();
  const more = await page.locator("section", { has: page.getByRole("button", { name: /^More differences/ }) }).locator("li").allInnerTexts();
  check(size, "library: More differences lists what else differs, such as claimed credit", more.some((line) => /MATH 1650/.test(line)), JSON.stringify(more));
  await page.waitForTimeout(300);
  await shot(page, size, "plans-compare");
  await axe(page, size, "Library comparing two schedules");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await page.getByRole("button", { name: "Open Before import" }).click();
  const use = page.getByRole("button", { name: "Use in Main" });
  await use.waitFor();
  await page.waitForTimeout(300);
  await shot(page, size, "plans-detail");
  await axe(page, size, "Library schedule detail");
  // What Main holds, from the guest store, ignoring timestamps (saves land after a short debounce).
  const mainNow = async () => {
    await page.waitForTimeout(1500);
    return page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem("untangle.planner-state.v1") ?? "null");
      const state = doc?.state ?? doc;
      return JSON.stringify({ statuses: state?.courseStatuses, plan: state?.coursePlan, records: state?.transcriptRecords?.length });
    });
  };
  const before = await mainNow();
  await use.click();
  await page.getByText("Main now uses Before import").waitFor();
  check(size, "library: using a copy keeps you in the library and offers Undo", page.url().endsWith("/schedules") && (await page.getByRole("button", { name: "Undo" }).count()) === 1);
  const adopted = await mainNow();
  check(size, "library: using the copy changed Main", adopted !== before);
  await page.getByRole("button", { name: "Undo" }).click();
  const undone = await mainNow();
  check(size, "library: Undo puts Main back as it was", undone === before && (await page.getByText("Main has changed since").count()) === 0, undone === before ? "" : `${before.slice(0, 120)} vs ${undone.slice(0, 120)}`);
}

// The emailed link's landing page: mail scanners may open it, so loading it must not use the
// one-time token. Nothing reaches the verify endpoint until the button is pressed.
async function signInLinkPage(page, size) {
  const verifyRequests = [];
  const onRequest = (request) => {
    if (new URL(request.url()).pathname === "/api/auth/magic-link/verify") verifyRequests.push(request.url());
  };
  page.on("request", onRequest);
  try {
    // The parameters ride in the fragment, which the browser never sends to the server.
    const landing = `${base}/auth/link#token=journey-token-not-real&callbackURL=%2Fcourses&errorCallbackURL=%2Fauth%3Flink%3Dfailed`;
    const pageRequests = [];
    const onPageRequest = (request) => {
      if (new URL(request.url()).pathname === "/auth/link") pageRequests.push(request.url());
    };
    page.on("request", onPageRequest);
    await page.goto(landing, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    check(size, "link page: loading it doesn't redirect", page.url() === landing, page.url());
    check(size, "link page: loading it doesn't touch the token", verifyRequests.length === 0, JSON.stringify(verifyRequests));
    page.off("request", onPageRequest);
    check(size, "link page: the token never reaches the server in the page request", pageRequests.every((u) => !u.includes("journey-token")), JSON.stringify(pageRequests));
    check(size, "link page: it sends no referrer", (await page.locator('meta[name="referrer"]').getAttribute("content")) === "no-referrer");
    check(size, "link page: one button, 'Sign in'", (await page.getByRole("button").count()) === 1 && (await page.getByRole("button", { name: "Sign in" }).isVisible()));
    await shot(page, size, "auth-link-page");
    await axe(page, size, "Sign-in link page");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/link"), { timeout: 15000 });
    const sent = verifyRequests.length ? new URL(verifyRequests[0]) : null;
    check(size, "link page: the button sends the token to the verify endpoint", sent?.searchParams.get("token") === "journey-token-not-real", verifyRequests[0] ?? "none");
    await page.goto(`${base}/auth/link`, { waitUntil: "networkidle" });
    check(size, "link page: without a token it says the link is incomplete", /incomplete/.test(await page.locator("body").innerText()));
  } finally {
    page.off("request", onRequest);
  }
}

// The sign-in dialog over a page: Sign in in the bar opens it, Escape closes it, focus goes back.
async function signInDialog(page, size, phone) {
  await page.goto(`${base}/courses`, { waitUntil: "load" });
  const trigger = page.getByRole("link", { name: "Sign in" }).filter({ visible: true }).first();
  await trigger.waitFor();
  await trigger.click();
  const box = page.getByRole("dialog", { name: "Sign in" });
  await box.waitFor();
  await page.waitForTimeout(400);
  check(size, "sign-in: Sign in opens the form over the current page", page.url().endsWith("/courses"), page.url());
  const email = box.getByRole("textbox", { name: "UNT email" });
  check(size, "sign-in: the email field takes focus, autocomplete username, no autocapitalize", (await email.evaluate((el) => el === document.activeElement)) && (await email.getAttribute("autocomplete")) === "username" && (await email.getAttribute("autocapitalize")) === "none");
  check(size, "sign-in: the emailed link comes first, the password second", (await box.getByRole("button", { name: "Email me a sign-in link" }).isVisible()) && (await box.getByRole("button", { name: "Use a password instead" }).isVisible()));
  check(size, "sign-in: the copy promises nothing about merging a guest's schedules", !/comes with you|merge/i.test(await box.innerText()));
  await shot(page, size, phone ? "sign-in-sheet" : "sign-in-dialog");
  await axe(page, size, "Sign-in dialog");
  await page.keyboard.press("Escape");
  await box.waitFor({ state: "detached" });
  await page.waitForTimeout(100);
  check(size, "sign-in: Escape closes it and focus returns to Sign in", await trigger.evaluate((el) => el === document.activeElement));
  await page.keyboard.press("Tab");
  check(size, "sign-in: the closed dialog isn't tabbable", (await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))) === false && (await page.getByRole("dialog").count()) === 0);
}

async function auth(page, size) {
  await page.goto(`${base}/auth`, { waitUntil: "networkidle" });
  const send = page.getByRole("button", { name: "Email me a sign-in link" });
  check(size, "auth: sign-in leads with the email field and 'Email me a sign-in link'", (await send.isVisible()) && (await page.getByLabel("Password", { exact: true }).count()) === 0);
  check(size, "auth: a configured server shows no server-log note", !/server log/i.test(await page.locator("body").innerText()));
  await shot(page, size, "auth-link");
  await axe(page, size, "Sign in by link");
  await send.click();
  const email = page.getByRole("textbox", { name: "UNT email" });
  check(size, "auth: a missing UNT email errors under Email and takes focus", (await email.getAttribute("aria-invalid")) === "true" && (await email.evaluate((el) => el === document.activeElement)));
  await email.fill("sam@gmail.com");
  await send.click();
  const emailHelp = await page.locator(`#${await email.getAttribute("aria-describedby")}`).innerText();
  check(size, "auth: a non-UNT email names the accepted domains", /unt\.edu/.test(emailHelp), emailHelp);
  await shot(page, size, "auth-email-error");
  // The test server has no database, so the link request fails on the server: its reason goes under Email.
  await email.fill("eagle@my.unt.edu");
  await send.click();
  await page.waitForFunction(() => document.querySelector('[aria-invalid="true"]'), null, { timeout: 15000 });
  const linkHelp = await email.evaluate((el) => document.getElementById(el.getAttribute("aria-describedby"))?.textContent ?? "");
  check(size, "auth: a failed link request shows its reason under Email", linkHelp.length > 0, linkHelp);
  await shot(page, size, "auth-link-error");

  await page.getByRole("button", { name: "Use a password instead" }).click();
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("short");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  check(size, "auth: a short password errors under Password", (await password.getAttribute("aria-invalid")) === "true");
  await password.fill("long enough password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-invalid="true"]'), null, { timeout: 15000 });
  const serverHelp = await page.locator('[aria-invalid="true"]').first().evaluate((el) => document.getElementById(el.getAttribute("aria-describedby"))?.textContent ?? "");
  check(size, "auth: a server password error shows as help text under a field", serverHelp.length > 0, serverHelp);
  await shot(page, size, "auth-server-error");
  await axe(page, size, "Password sign-in with errors");
  await page.goto(`${base}/auth?link=failed&error=EXPIRED_TOKEN`, { waitUntil: "networkidle" });
  check(size, "auth: returning from a dead link says so under Email", /expired or was already used/.test(await page.locator("body").innerText()));
  await page.goto(`${base}/forgot-password`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Send reset link" }).click();
  check(size, "reset: an empty email errors under the field", (await page.getByRole("textbox", { name: "Email" }).getAttribute("aria-invalid")) === "true");
  await shot(page, size, "reset-error");
  await axe(page, size, "Password reset with an error");
}

const browser = await chromium.launch();
try {
  for (const vp of [
    { size: "desktop", width: 1440, height: 900, phone: false },
    { size: "phone", width: 390, height: 844, phone: true },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: 2 });
    await routeMyUnt(ctx);
    if (vp.phone) {
      await ctx.addInitScript(() => {
        // Phone browsers have no File System Access picker.
        window.showOpenFilePicker = undefined;
      });
    } else await stubPicker(ctx);
    const page = await ctx.newPage();
    try {
      await plansSave(page, vp.size);
      if (vp.phone) await connectPhone(page, vp.size);
      else {
        await connectPopup(page, vp.size);
        await connectDrop(page, vp.size);
        await connectHistory(page, vp.size);
      }
      await markACourseDone(page);
      await plansCompareRestore(page, vp.size);
      await signInDialog(page, vp.size, vp.phone);
      await auth(page, vp.size);
      await signInLinkPage(page, vp.size);
    } catch (error) {
      check(vp.size, "journey ran to the end", false, String(error).split("\n")[0]);
      await page.screenshot({ path: join(out, `${vp.size}-failure.png`) }).catch(() => {});
    }
    await ctx.close();
  }
  await connectBlocked(browser, "desktop");
} finally {
  await browser.close();
}
writeFileSync(join(out, "report.json"), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
