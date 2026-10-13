#!/usr/bin/env node
// Design pass A journey (HANDOFF steps 8 and 9) at 1440x900 (fine pointer)
// and 390x844 (touch), against `next start` and the mock myUNT server
// (tools/mock-myunt, port 4317) for the synthetic transcript PDF.
//   Connect: plan menu -> request -> upload fallback (manual handoff) ->
//            review -> save -> done -> Courses; the phone sheet survives a
//            reload at /connect.
//   Plans:   save a plan, change the working plan (mark a course done on
//            Courses), compare (diff rows), restore.
//   Auth:    sign-in and reset error states, each under its field.
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
  await page.goto(`${base}/plans`, { waitUntil: "networkidle" });
  await page.getByLabel("Plan name (optional)").fill("Before import");
  await page.getByRole("button", { name: "Save current schedule" }).click();
  await page.getByText("Before import", { exact: true }).waitFor();
  check(size, "plans: the view header replaces the headline", (await page.getByRole("heading", { level: 1, name: "Plan library" }).count()) === 1);
}

async function connect(page, size, phone) {
  await page.goto(`${base}/courses`, { waitUntil: "networkidle" });
  // The Courses view may open its major dialog first; answer it so the bar is reachable.
  const major = page.locator('[role="dialog"]', { hasText: "What are you studying?" });
  if (await major.isVisible().catch(() => false)) {
    await major.getByRole("button", { name: /Undeclared/ }).evaluate((el) => el.click());
    await major.getByRole("button", { name: "Confirm" }).evaluate((el) => el.click());
    await major.waitFor({ state: "detached" });
  }
  await page.locator(".shell-planchip").click();
  await page.getByRole("menuitem", { name: "Import courses from myUNT" }).click();
  const sheet = page.getByRole("region", { name: "Connect myUNT" });
  await sheet.waitFor();
  await page.waitForTimeout(350);
  check(size, "connect: the plan menu opens the sheet over Courses at /connect", page.url().endsWith("/connect"), page.url());
  await shot(page, size, "connect-request");
  if (!phone) {
    const access = await sheet.innerText();
    check(size, "connect: request lists Reads / Removes / Keeps", /Reads/.test(access) && /Removes/.test(access) && /Keeps/.test(access));
    check(size, "connect: 'Upload a PDF instead' is visible in request", await sheet.getByText("Upload a PDF instead").isVisible());
    await axe(page, size, "Connect request");
    await sheet.getByRole("button", { name: "No extension? Download the PDF yourself" }).click();
  } else {
    check(size, "connect: on touch the request leads with myUNT and the PDF", await sheet.getByRole("link", { name: /Open myUNT/ }).isVisible());
  }
  check(size, "connect: handoff shows the myUNT browser card", await sheet.getByText("my.unt.edu", { exact: false }).first().isVisible());
  await shot(page, size, "connect-handoff");
  await axe(page, size, "Connect handoff");

  if (phone) {
    // The trip to Safari: opening myUNT, then this tab reloading.
    const [popup] = await Promise.all([page.waitForEvent("popup").catch(() => null), sheet.getByRole("link", { name: /Open myUNT/ }).click()]);
    await popup?.close();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("region", { name: "Connect myUNT" }).waitFor();
    check(size, "connect: after a reload the sheet reopens on 'Choose the PDF'", await page.getByText("Choose the PDF").isVisible());
  }

  await page.getByLabel("Upload transcript PDF", { exact: true }).setInputFiles(file);
  await page.getByRole("heading", { name: "Review your courses" }).waitFor();
  await page.waitForTimeout(200);
  const text = await page.getByRole("region", { name: "Review your courses" }).innerText();
  check(size, "connect: progress and review never say 'AI'", !/\bAI\b/.test(text));
  const flaggedRows = await page.locator("li[data-flagged]").count();
  const flaggedSelects = await page.locator('li[data-flagged] [role="combobox"]').count();
  check(
    size,
    "connect: every row that needs a decision is tinted and carries a ui Select",
    flaggedRows > 0 && flaggedSelects === flaggedRows && (await page.locator("select:visible").count()) === 0,
    `${flaggedRows} flagged rows, ${flaggedSelects} Selects`,
  );
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
  await page.waitForTimeout(400);
  check(size, "connect: 'Go to courses' closes the sheet on Courses", (await page.getByRole("region", { name: /Connect myUNT|Your courses/ }).count()) === 0);
  // The import adds transcript records, not course statuses; mark one course
  // done so the plan comparison has a course-level row to show.
  // A DOM click: on phones the Courses row hides this switch behind its layout.
  await page.locator('[aria-label^="Mark "][aria-label$=" as done"]:not([disabled])').first().evaluate((el) => el.click());
}

// Opening over a view and the history it leaves: Back closes, Forward
// reopens, closing then still returns to the view; focus returns to the
// opener; a cold /courses/import load opens the sheet over Courses.
async function connectHistory(page, size) {
  await page.goto(`${base}/plans`, { waitUntil: "networkidle" });
  const chip = page.locator(".shell-planchip");
  await chip.click();
  await page.getByRole("menuitem", { name: "Import courses from myUNT" }).click();
  const sheet = page.getByRole("region", { name: "Connect myUNT" });
  await sheet.waitFor();
  await page.goBack();
  await sheet.waitFor({ state: "detached" });
  check(size, "connect: Back closes the sheet and stays on Plans", page.url().endsWith("/plans"), page.url());
  await page.goForward();
  await sheet.waitFor();
  await page.getByRole("button", { name: "Not now" }).click();
  await sheet.waitFor({ state: "detached" });
  check(size, "connect: after Back/Forward, closing still returns to Plans", page.url().endsWith("/plans"), page.url());
  await chip.click();
  await page.getByRole("menuitem", { name: "Import courses from myUNT" }).click();
  await sheet.waitFor();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el && el !== document.body ? el.className || el.tagName : "body";
  });
  check(size, "connect: closing returns focus to the plan menu button", /shell-planchip/.test(focused), focused);
  await page.goto(`${base}/courses/import`, { waitUntil: "networkidle" });
  await sheet.waitFor();
  check(size, "connect: a cold /courses/import opens the sheet at /connect", page.url().endsWith("/connect"), page.url());
  await page.getByRole("button", { name: "Not now" }).click();
  await sheet.waitFor({ state: "detached" });
  check(size, "connect: closing it lands on Courses", page.url().endsWith("/courses"), page.url());
}

async function plansCompareRestore(page, size) {
  await page.goto(`${base}/plans`, { waitUntil: "networkidle" });
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

async function auth(page, size) {
  await page.goto(`${base}/auth`, { waitUntil: "networkidle" });
  check(size, "auth: no magic-link copy remains", !/sign-in link|magic/i.test(await page.locator("body").innerText()));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const email = page.getByRole("textbox", { name: "UNT email" });
  check(size, "auth: a missing UNT email errors under Email and takes focus", (await email.getAttribute("aria-invalid")) === "true" && (await email.evaluate((el) => el === document.activeElement)));
  await email.fill("sam@gmail.com");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const emailHelp = await page.locator(`#${await email.getAttribute("aria-describedby")}`).innerText();
  check(size, "auth: a non-UNT email names the accepted domains", /unt\.edu/.test(emailHelp), emailHelp);
  await shot(page, size, "auth-email-error");
  await email.fill("eagle@my.unt.edu");
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("short");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  check(size, "auth: a short password errors under Password", (await password.getAttribute("aria-invalid")) === "true");
  await password.fill("long enough password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-invalid="true"]'), null, { timeout: 15000 });
  const serverHelp = await page.locator('[aria-invalid="true"]').first().evaluate((el) => document.getElementById(el.getAttribute("aria-describedby"))?.textContent ?? "");
  check(size, "auth: a server sign-in error shows as help text under a field", serverHelp.length > 0, serverHelp);
  await shot(page, size, "auth-server-error");
  await axe(page, size, "Sign in with errors");
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
    const page = await ctx.newPage();
    try {
      await plansSave(page, vp.size);
      await connect(page, vp.size, vp.phone);
      if (!vp.phone) await connectHistory(page, vp.size);
      await plansCompareRestore(page, vp.size);
      await auth(page, vp.size);
    } catch (error) {
      check(vp.size, "journey ran to the end", false, String(error).split("\n")[0]);
      await page.screenshot({ path: join(out, `${vp.size}-failure.png`) }).catch(() => {});
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "report.json"), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
