#!/usr/bin/env node
// Design pass A journey (HANDOFF steps 8 and 9) at 1440x900 (fine pointer)
// and 390x844 (touch), against `next start` and the mock myUNT server
// (tools/mock-myunt, port 4317), which stands in for myUNT's transcript page
// and serves the synthetic transcript PDF.
//   Connect: plan menu -> Open myUNT (popup) -> close -> "Use the downloaded
//            PDF" (stubbed picker) -> review -> save; the page-wide drop;
//            popups blocked; Back/Forward and focus; phones end at the
//            native file chooser and survive a reload at /connect.
//   Plans:   save a plan, change the working plan (mark a course as credit on
//            Courses), compare (diff rows), restore.
//   Auth:    sign-in by emailed link and by password, errors under each
//            field; reset; the emailed link's landing page (no token use
//            until its button is pressed).
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
  await page.getByLabel("Plan name (optional)").fill("Before import");
  await page.getByRole("button", { name: "Save current schedule" }).click();
  await page.getByText("Before import", { exact: true }).waitFor();
  check(size, "plans: the view header replaces the headline", (await page.getByRole("heading", { level: 1, name: "Plan library" }).count()) === 1);
}

const SHEET = "Import from myUNT";
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

// v3 Courses: Connect opens from the empty state's "Import your transcript",
// or, once there is a plan, from the degree dialog behind the degree line.
async function openConnectFromCourses(page) {
  const fromEmpty = page.getByRole("button", { name: /Import your transcript/ });
  if (await fromEmpty.isVisible().catch(() => false)) await fromEmpty.click();
  else {
    await page.locator("[data-degree]").click();
    await page.getByRole("dialog", { name: "Your degree" }).getByRole("button", { name: /^Import/ }).click();
  }
  const sheet = page.getByRole("region", { name: SHEET });
  await sheet.waitFor();
  await page.waitForTimeout(350);
  return sheet;
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
// -> review with a flagged row -> breakpoint crossed after approving -> save.
async function connectPopup(page, size) {
  await toCourses(page);
  const sheet = await openConnectFromCourses(page);
  check(size, "connect: the Courses menu opens the sheet over Courses at /connect", page.url().endsWith("/connect"), page.url());
  const text = await sheet.innerText();
  check(size, "connect: the start lists Reads / Removes / Keeps", /Reads/.test(text) && /Removes/.test(text) && /Keeps/.test(text));
  check(size, "connect: no extension anywhere in the flow", !/extension/i.test(text));
  const open = sheet.getByRole("link", { name: /Open myUNT/ });
  check(size, "connect: one primary action, Open myUNT", (await sheet.locator(".ui-btn--primary").count()) === 1 && /ui-btn--primary/.test(await open.getAttribute("class")));
  await shot(page, size, "connect-start");
  await axe(page, size, "Connect start");

  const [popup] = await Promise.all([page.waitForEvent("popup"), open.click()]);
  // The window opens blank, is cut off from this page, then navigates.
  await popup.waitForURL(/^https:\/\/my\.unt\.edu\//);
  check(size, "connect: Open myUNT opens the transcript page in a separate window", popup.url().startsWith("https://my.unt.edu/"), popup.url());
  check(size, "connect: the myUNT window can't reach back to UNTangle", (await popup.evaluate(() => window.opener)) === null);
  check(size, "connect: while away the sheet waits calmly", await sheet.getByText("Download your transcript as a PDF, then come back.").isVisible());
  check(size, "connect: the trip is remembered for a reload", await flagSet(page));
  await shot(page, size, "connect-away");
  await axe(page, size, "Connect waiting for myUNT");

  await popup.close();
  await sheet.getByText("Choose the transcript PDF you just downloaded.").waitFor();
  await page.waitForTimeout(100);
  const use = sheet.getByRole("button", { name: "Use the downloaded PDF" });
  check(size, "connect: closing myUNT makes 'Use the downloaded PDF' the primary action", /ui-btn--primary/.test(await use.getAttribute("class")));
  check(size, "connect: it takes focus", await use.evaluate((el) => el === document.activeElement));
  check(size, "connect: it is not pressed for the student (the picker needs a gesture)", (await page.evaluate(() => window.__pickerCalls.length)) === 0);
  await shot(page, size, "connect-back");
  await axe(page, size, "Connect back from myUNT");

  await use.click();
  await page.getByRole("heading", { name: "Review your courses" }).waitFor();
  const options = await page.evaluate(() => window.__pickerCalls[0]);
  check(size, "connect: the picker opens in Downloads for one PDF", options?.startIn === "downloads" && JSON.stringify(options.types[0].accept) === JSON.stringify({ "application/pdf": [".pdf"] }), JSON.stringify(options));
  check(size, "connect: choosing the file ends the trip", !(await flagSet(page)));
  await page.waitForTimeout(200);
  const review = page.getByRole("region", { name: "Review your courses" });
  check(size, "connect: progress and review never say 'AI'", !/\bAI\b/.test(await review.innerText()));
  const flaggedRows = await page.locator("li[data-flagged]").count();
  const flaggedSelects = await page.locator('li[data-flagged] [role="combobox"]').count();
  check(size, "connect: every row that needs a decision is tinted and carries a ui Select", flaggedRows > 0 && flaggedSelects === flaggedRows && (await page.locator("select:visible").count()) === 0, `${flaggedRows} flagged rows, ${flaggedSelects} Selects`);
  await shot(page, size, "connect-review");
  await axe(page, size, "Connect review");

  // Crossing the phone breakpoint (rotation, zoom) must not remount the sheet and drop approvals.
  const include = page.getByRole("checkbox", { name: "Include CSCE 1030", exact: true });
  await include.check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const kept = (await review.count()) === 1 && (await include.isChecked());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  check(size, "connect: crossing the phone breakpoint after approving a row keeps the review and the approval", kept && (await include.isChecked()));

  await page.getByRole("button", { name: "Save 1 course" }).click();
  await page.getByText("1 course added to your plan.", { exact: true }).waitFor();
  await shot(page, size, "connect-done");
  await axe(page, size, "Connect done");
  await page.getByRole("button", { name: "Go to courses" }).click();
  await page.waitForURL(/\/courses$/);
  await page.waitForTimeout(400);
  check(size, "connect: 'Go to courses' closes the sheet on Courses", (await page.getByRole("region", { name: /Import from myUNT|Your courses/ }).count()) === 0);
}

// Desktop: the page-wide drop target, from Courses with the sheet closed.
async function connectDrop(page, size) {
  await toCourses(page);
  await drag(page, "start", null);
  await page.waitForTimeout(150);
  check(size, "drop: a text drag shows no drop target", (await overlay(page).count()) === 0);
  await drag(page, "drop", null);

  await drag(page, "start", [["unofficial-transcript.pdf", "application/pdf"]]);
  await overlay(page).waitFor();
  check(size, "drop: dragging a file over the app shows the full-window target", await overlay(page).isVisible());
  await page.waitForTimeout(250); // past the 120ms fade-in
  await shot(page, size, "drop-overlay");
  await drag(page, "dragleave", null);
  await page.waitForTimeout(100);
  check(size, "drop: leaving the window hides it", (await overlay(page).count()) === 0);

  // Drop, then cross the breakpoint while the PDF is still being read.
  await drag(page, "start", [["unofficial-transcript.pdf", "application/pdf"]]);
  await drag(page, "drop", null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Review your courses" }).waitFor({ timeout: 15000 });
  check(size, "drop: a PDF dropped with the sheet closed opens it and imports, through a breakpoint crossing mid-read", page.url().endsWith("/connect"), page.url());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  await drag(page, "start", [["a.pdf", "application/pdf"], ["b.pdf", "application/pdf"]]);
  await drag(page, "drop", null);
  // Scoped to the dialog: Next's route announcer is an alert too.
  const alert = page.getByRole("dialog").getByRole("alert");
  await alert.waitFor();
  check(size, "drop: two files are refused with a reason", /2 files/.test(await alert.innerText()), await alert.innerText());
  await shot(page, size, "drop-two-files");
  await drag(page, "start", [["photo.png", "image/png"]]);
  await drag(page, "drop", null);
  await page.getByText("“photo.png” isn't a PDF", { exact: false }).waitFor();
  check(size, "drop: a non-PDF is refused by name", true);
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: /Import from myUNT|That file/ }).waitFor({ state: "detached" });
  check(size, "connect: closing leaves no trip flag behind", !(await flagSet(page)));
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
    await toCourses(page);
    const sheet = await openConnectFromCourses(page);
    const [tab] = await Promise.all([ctx.waitForEvent("page"), sheet.getByRole("link", { name: /Open myUNT/ }).click()]);
    await tab.waitForURL(/^https:\/\/my\.unt\.edu\//);
    check(size, "blocked: with popups blocked, myUNT opens in a new tab", tab.url().startsWith("https://my.unt.edu/"), tab.url());
    check(size, "blocked: the sheet still waits for the return", await sheet.getByText("Download your transcript as a PDF, then come back.").isVisible());
    await page.bringToFront();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await sheet.getByText("Choose the transcript PDF you just downloaded.").waitFor();
    check(size, "blocked: coming back to the tab leads with 'Use the downloaded PDF'", /ui-btn--primary/.test(await sheet.getByRole("button", { name: "Use the downloaded PDF" }).getAttribute("class")));
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
  const sheet = await openConnectFromCourses(page);
  await shot(page, size, "connect-start");
  await axe(page, size, "Connect start");
  const [popup] = await Promise.all([page.waitForEvent("popup"), sheet.getByRole("link", { name: /Open myUNT/ }).click()]);
  await popup.close();
  await sheet.getByText("Choose the transcript PDF you just downloaded.").waitFor();
  // The trip to Safari can reload this tab.
  await page.reload({ waitUntil: "networkidle" });
  const again = page.getByRole("region", { name: SHEET });
  await again.waitFor();
  check(size, "connect: after a reload the sheet reopens on 'Use the downloaded PDF'", await again.getByRole("button", { name: "Use the downloaded PDF" }).isVisible());
  check(size, "connect: the restored trip consumed its flag", !(await flagSet(page)));
  await shot(page, size, "connect-back");
  await axe(page, size, "Connect back from myUNT");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), again.getByRole("button", { name: "Use the downloaded PDF" }).click()]);
  check(size, "connect: without the picker, the native file chooser opens for one PDF", !chooser.isMultiple());
  await chooser.setFiles(file);
  await page.getByRole("heading", { name: "Review your courses" }).waitFor();
  await page.waitForTimeout(200);
  await shot(page, size, "connect-review");
  await axe(page, size, "Connect review");
  await page.locator('li[data-flagged] [role="combobox"]').first().click();
  await page.getByRole("listbox").waitFor();
  await page.waitForTimeout(250);
  await shot(page, size, "connect-review-select");
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox", { name: "Include CSCE 1030", exact: true }).check();
  await page.getByRole("button", { name: "Save 1 course" }).click();
  await page.getByText("1 course added to your plan.", { exact: true }).waitFor();
  await shot(page, size, "connect-done");
  await axe(page, size, "Connect done");
  await page.getByRole("button", { name: "Go to courses" }).click();
  await page.waitForURL(/\/courses$/);
}

/** The import adds transcript records, not statuses: mark a course as credit so Plans has a course-level diff. */
async function markACourseDone(page) {
  // "load", not "networkidle": since #39, the test server has a database URL it
  // can't reach, and this page's network didn't go idle within 30 s.
  await page.goto(`${base}/courses/math/1650`, { waitUntil: "load" });
  // v3 Courses: the course detail offers it as a button, not a status menu.
  await page.getByRole("button", { name: "I have credit for this" }).first().click();
  await page.waitForTimeout(400);
}

// Opening over a view and the history it leaves: Back closes, Forward
// reopens, closing then still returns to the view; focus returns to the
// opener; a cold /courses/import load opens the sheet over Courses.
async function connectHistory(page, size) {
  await toCourses(page);
  const sheet = await openConnectFromCourses(page);
  await sheet.waitFor();
  await page.goBack();
  await sheet.waitFor({ state: "detached" });
  check(size, "connect: Back closes the sheet and stays on Courses", page.url().endsWith("/courses"), page.url());
  await page.goForward();
  await sheet.waitFor();
  await page.getByRole("button", { name: "Not now" }).click();
  await sheet.waitFor({ state: "detached" });
  check(size, "connect: after Back/Forward, closing still returns to Courses", page.url().endsWith("/courses"), page.url());
  await openConnectFromCourses(page);
  await sheet.waitFor();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el && el !== document.body ? el.getAttribute("aria-label") || el.className || el.tagName : "body";
  });
  check(size, "connect: closing returns focus to the menu button that opened it", focused === "More Auto-fill options", focused);
  await page.goto(`${base}/courses/import`, { waitUntil: "networkidle" });
  await sheet.waitFor();
  check(size, "connect: a cold /courses/import opens the sheet at /connect", page.url().endsWith("/connect"), page.url());
  await page.getByRole("button", { name: "Not now" }).click();
  await sheet.waitFor({ state: "detached" });
  check(size, "connect: closing it lands on Courses", page.url().endsWith("/courses"), page.url());
}

async function plansCompareRestore(page, size) {
  await page.goto(`${base}/schedules`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "More actions for Before import" }).click();
  await page.getByRole("menuitem", { name: "Compare with working schedule" }).click();
  const diff = page.locator(".plans-diff");
  await diff.waitFor();
  const code = diff.locator(".ui-code").first();
  const font = await code.evaluate((el) => getComputedStyle(el).fontFamily);
  check(size, "plans: diff rows set course codes in Syne", /Syne/i.test(font), `${await code.innerText()} in ${font.split(",")[0]}`);
  await page.waitForTimeout(300); // let the menu finish closing before the shot
  await shot(page, size, "plans-diff");
  await axe(page, size, "Plans with a comparison");
  await page.getByRole("button", { name: "Restore", exact: true }).first().click();
  await page.getByRole("dialog", { name: /Restore “Before import”/ }).waitFor();
  await page.waitForTimeout(250);
  await shot(page, size, "plans-restore");
  await axe(page, size, "Plans restore preview");
  await page.getByRole("button", { name: "Restore this plan" }).click();
  await page.waitForURL(/\/schedule$/);
  check(size, "plans: restoring goes to the Week view", page.url().endsWith("/schedule"));
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
