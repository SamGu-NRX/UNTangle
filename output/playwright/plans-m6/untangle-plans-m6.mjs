#!/usr/bin/env node
/**
 * M6 browser journey over a production build backed by a real local Postgres.
 *
 * Guest and registered (password sign-up, synthetic UNT address), at 1440x900
 * and 390x844: build, pick a section, optimize; save and reload; each
 * durability rule; restoring an older plan with stale sections (warning
 * first); print; .ics; keyboard-only export; dialog focus; reduced motion;
 * axe with zero serious or critical violations.
 *
 * Every check is recorded; any failed check or serious/critical axe
 * violation exits 1.
 *
 * Env: UNTANGLE_BASE_URL, UNTANGLE_M6_OUT, UNTANGLE_AXE_PATH, DATABASE_URL
 * (read-only checks through psql), UNTANGLE_PSQL (path to psql).
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.UNTANGLE_BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.UNTANGLE_M6_OUT ?? new URL(".", import.meta.url).pathname;
const AXE = readFileSync(process.env.UNTANGLE_AXE_PATH, "utf8");
const DATABASE_URL = process.env.DATABASE_URL;
const PSQL = process.env.UNTANGLE_PSQL ?? "psql";
const EMAIL = process.env.UNTANGLE_M6_EMAIL ?? "accept-8@my.unt.edu";
const PASSWORD = "local-only-password-8";
const TMP = process.env.UNTANGLE_M6_TMP ?? "/tmp/untangle-m6";
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const report = { startedAt: new Date().toISOString(), base: BASE, checks: [], axe: [], notes: [] };
const check = (name, passed, detail = null) => {
  report.checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const note = (message) => {
  report.notes.push(message);
  console.log(`note: ${message}`);
};
const shoot = async (page, name) => {
  await page.screenshot({ path: join(OUT, name), animations: "disabled", fullPage: false });
};
const axe = async (page, label) => {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
  const all = result.violations.map(
    (v) =>
      `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes
        .slice(0, 6)
        .map((n) => `${n.target.join(" ")} [${(n.any[0]?.message ?? "").slice(0, 90)}]`)
        .join("; ")}`,
  );
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  report.axe.push({ label, violations: all });
  check(`axe zero serious/critical: ${label}`, blocking.length === 0, all.join(", ") || null);
};
const sql = (query) => execFileSync(PSQL, [DATABASE_URL, "-At", "-c", query], { encoding: "utf8" }).trim();

/* ---------- page helpers ---------- */

const saveLabel = (page) =>
  page.evaluate(
    () => document.querySelector('[role="status"][aria-label="Save state"] strong')?.textContent?.trim() ?? null,
  );
async function waitLabel(page, expected, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await saveLabel(page);
    if (last === expected) return last;
    await page.waitForTimeout(150);
  }
  return last;
}
const activeOptimization = (page) =>
  page.evaluate(() => document.querySelector('.opt-row[data-active="true"] .opt-row__label')?.textContent?.trim() ?? null);
async function optimize(page, label) {
  await page.locator(".opt-row", { hasText: label }).first().click();
  await page.waitForFunction(
    (wanted) => document.querySelector('.opt-row[data-active="true"] .opt-row__label')?.textContent?.trim() === wanted,
    label,
  );
}
const eventSignature = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".cal-event")]
      .map((el) => el.textContent.replace(/\s+/g, " ").trim())
      .sort()
      .join(" | "),
  );
async function gotoSchedule(page) {
  await page.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await page.locator('[aria-label="Save state"]').waitFor();
  await page.waitForTimeout(500);
}
/** First visit to /courses asks for a major and cannot be dismissed without one. */
async function chooseMajorIfAsked(page) {
  const dialog = page.getByRole("dialog", { name: "What are you studying?" });
  if (await dialog.waitFor({ timeout: 2500 }).then(() => true).catch(() => false)) {
    await dialog.getByRole("button", { name: /Undeclared/ }).click();
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await dialog.waitFor({ state: "detached" });
  }
}
async function markTaking(page, codes) {
  await page.goto(`${BASE}/courses`, { waitUntil: "networkidle" });
  await chooseMajorIfAsked(page);
  for (const code of codes) {
    await page.getByLabel("Search courses").fill(code);
    const row = page.locator("article.course-row", { hasText: code }).first();
    await row.getByRole("button", { name: "Taking", exact: true }).click();
  }
  await page.getByLabel("Search courses").fill("");
}
/** Pick a different section for the first class on the calendar (a manual choice). */
async function pickSection(page) {
  const before = await eventSignature(page);
  // Centered first: the sticky step footer covers the bottom of the viewport.
  const first = page.locator(".cal-event").first();
  await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await first.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const options = dialog.locator("button:not([aria-label='Close']):not([disabled])");
  const count = await options.count();
  for (let i = 0; i < count; i += 1) {
    const option = options.nth(i);
    const style = (await option.getAttribute("style")) ?? "";
    if (!style.includes("var(--brand-500)")) {
      await option.click();
      break;
    }
  }
  await dialog.waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  return before !== (await eventSignature(page));
}
/* Section locks: one toggle per scheduled section, "Lock {COURSE} section {NNN}" + aria-pressed. */
const lockButtons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button.lock-toggle")].map((b) => ({
      name: b.textContent.replace(/\s+/g, " ").trim(),
      pressed: b.getAttribute("aria-pressed"),
    })),
  );
/** "true"/"false" for the named lock toggle, or null when no such toggle exists (its section changed). */
async function lockPressed(page, name) {
  const button = page.getByRole("button", { name, exact: true });
  return (await button.count()) === 1 ? button.getAttribute("aria-pressed") : null;
}
async function tap(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await locator.click();
}
/** Locks the first unlocked section; returns the toggle's accessible name. */
async function lockFirst(page) {
  const unlocked = (await lockButtons(page)).find((b) => b.pressed === "false");
  if (!unlocked) throw new Error("no unlocked section to lock");
  await tap(page.getByRole("button", { name: unlocked.name, exact: true }));
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll("button.lock-toggle")]
        .find((b) => b.textContent.replace(/\s+/g, " ").trim() === name)
        ?.getAttribute("aria-pressed") === "true",
    unlocked.name,
  );
  return unlocked.name;
}
/** Switches goal and runs "Optimize schedule"; returns the lock toggles before and after. */
async function optimizeWithLock(page, goal) {
  const before = await lockButtons(page);
  await optimize(page, goal);
  await tap(page.getByRole("button", { name: "Optimize schedule", exact: true }));
  await page.waitForTimeout(300);
  return { before, after: await lockButtons(page) };
}

// better-auth limits sign-in/sign-up to 3 requests per 10 s per IP by default, and this journey signs in
// repeatedly from one IP. A 429 is the server working as designed, not an app defect: check that the form
// says so, wait out the window, and try once more.
async function signUpOrIn(page, mode, email = EMAIL) {
  try {
    await signUpOrInOnce(page, mode, email);
  } catch (error) {
    if (!(error instanceof RateLimitedError)) throw error;
    check(`sign-${mode} rate limit is shown to the user (429)`, error.shown, error.text.slice(0, 160));
    await page.waitForTimeout(error.retryAfterMs);
    await signUpOrInOnce(page, mode, email);
  }
}
class RateLimitedError extends Error {
  constructor(retryAfterMs, shown, text) {
    super("rate limited");
    this.retryAfterMs = retryAfterMs;
    this.shown = shown;
    this.text = text;
  }
}
async function signUpOrInOnce(page, mode, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Use password instead" }).click();
  if (mode === "signUp") {
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await page.getByLabel("Name").fill("Acceptance Eight");
  }
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  // The mode tabs are also labeled "Log in"/"Sign up"; submit the form itself.
  const response = page
    .waitForResponse((r) => /\/api\/auth\/sign-(in|up)\//.test(r.url()), { timeout: 15000 })
    .catch(() => null);
  await page.locator('form button[type="submit"]', { hasText: mode === "signUp" ? "Create account" : "Log in" }).click();
  const answered = await response;
  if (answered && answered.status() === 429) {
    const seconds = Number(answered.headers()["retry-after"]);
    const shown = await page.evaluate(() => document.querySelector("main, body")?.innerText ?? "");
    throw new RateLimitedError(
      (Number.isFinite(seconds) && seconds > 0 ? seconds : 10) * 1000 + 1000,
      /too many|try again/i.test(shown),
      shown.replace(/\s+/g, " "),
    );
  }
  try {
    await page.waitForURL(/\/courses/, { timeout: 15000 });
  } catch {
    // Evidence for why the app did not navigate: the auth response and what the form shows.
    await page.screenshot({ path: join(TMP, `sign-${mode}-failure.png`) });
    const shown = await page.evaluate(() => document.querySelector("main, body")?.innerText.slice(0, 600) ?? "");
    throw new Error(
      `sign-${mode} for ${email} stayed at ${page.url()}; auth response ${answered ? `${answered.status()} ${(await answered.text().catch(() => "")).slice(0, 200)}` : "none"}; page: ${shown.replace(/\s+/g, " ")}`,
    );
  }
}
async function signOut(page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
}

/* ---------- independent .ics reader ---------- */

function readIcs(raw) {
  const okEndings = raw.endsWith("\r\n") && !/[^\r]\n/.test(raw);
  const physical = raw.slice(0, -2).split("\r\n");
  const okLengths = physical.every((line) => Buffer.byteLength(line) <= 75);
  const logical = [];
  for (const line of physical) {
    if (line.startsWith(" ")) logical[logical.length - 1] += line.slice(1);
    else logical.push(line);
  }
  const events = [];
  let current = null;
  let depth = 0;
  let balanced = true;
  for (const line of logical) {
    const [name, ...rest] = line.split(":");
    const value = rest.join(":");
    if (name === "BEGIN") {
      depth += 1;
      if (value === "VEVENT") current = {};
    } else if (name === "END") {
      depth -= 1;
      if (value === "VEVENT") {
        events.push(current);
        current = null;
      }
    } else if (current) {
      current[name] = value.replace(/\\(\\|n|;|,)/g, (_, c) => (c === "n" ? "\n" : c));
    }
    if (depth < 0) balanced = false;
  }
  return { okEndings, okLengths, balanced: balanced && depth === 0, events, first: logical[0] };
}

/* ---------- scenarios ---------- */

const browser = await chromium.launch();
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

async function guestJourney(vp) {
  const tag = `guest-${vp.name}`;
  const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true });
  const page = await ctx.newPage();

  await gotoSchedule(page);
  check(`${tag}: fresh planner says Not saved yet`, (await saveLabel(page)) === "Not saved yet", await saveLabel(page));
  await shoot(page, `${tag}-01-fresh.png`);

  // markTaking ends with a full page load straight after the last click, so
  // this also proves the pagehide flush kept edits made inside the debounce.
  await markTaking(page, ["ANTH 1010", "CSCE 1030"]);
  await gotoSchedule(page);
  const built = await eventSignature(page);
  check(`${tag}: courses marked Taking reach the schedule`, built.includes("ANTH 1010") && built.includes("CSCE 1030"), built.slice(0, 160));
  await optimize(page, "Compact days");
  check(`${tag}: picked a different section by hand`, await pickSection(page));
  const lockName = await lockFirst(page);
  check(
    `${tag}: lock control has an accessible name and pressed state`,
    /^Lock [A-Z]{2,4} \d{4} section \d{3}$/.test(lockName) && (await lockPressed(page, lockName)) === "true",
    lockName,
  );
  const { before, after } = await optimizeWithLock(page, "Cluster nights");
  check(`${tag}: optimizing keeps the locked section`, (await lockPressed(page, lockName)) === "true", lockName);
  note(`${tag}: lock toggles before optimize ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  check(`${tag}: build/pick/lock/optimize acknowledged as Saved`, (await waitLabel(page, "Saved")) === "Saved");
  const signature = await eventSignature(page);
  const optimization = await activeOptimization(page);
  await shoot(page, `${tag}-02-saved.png`);

  await page.reload({ waitUntil: "networkidle" });
  await waitLabel(page, "Saved");
  check(
    `${tag}: rule 1 Saved survives reload`,
    (await saveLabel(page)) === "Saved" && (await eventSignature(page)) === signature && (await activeOptimization(page)) === optimization,
  );
  check(`${tag}: lock survives reload`, (await lockPressed(page, lockName)) === "true", lockName);
  check(`${tag}: sample-data notice shown`, await page.locator("[data-sample-notice]").isVisible());
  if (vp.name === "mobile") {
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    check(`${tag}: no horizontal overflow`, width <= vp.width + 2, `scrollWidth=${width}`);
  }
  await axe(page, `${tag} schedule`);

  // Print view
  await page.goto(`${BASE}/schedule/print`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0);
  const printRows = await page.locator("tbody tr").count();
  check(`${tag}: print view lists every meeting`, printRows === signature.split(" | ").length, `${printRows} rows`);
  await shoot(page, `${tag}-03-print.png`);
  await axe(page, `${tag} print view`);
  await page.emulateMedia({ media: "print" });
  check(`${tag}: print media hides controls`, !(await page.locator(".print-controls").isVisible()));
  await shoot(page, `${tag}-04-print-media.png`);
  await page.emulateMedia({ media: "screen" });

  // .ics with user-entered dates
  await gotoSchedule(page);
  await page.getByRole("button", { name: "Download .ics", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Download calendar" });
  await dialog.getByRole("button", { name: "Download calendar file" }).click();
  check(`${tag}: .ics refuses to guess term dates`, await dialog.getByRole("alert").isVisible());
  await shoot(page, `${tag}-05-ics-dates-required.png`);
  await axe(page, `${tag} .ics dialog`);
  await dialog.getByLabel("First day of classes").fill("2027-01-19");
  await dialog.getByLabel("Last day of classes").fill("2027-05-14");
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download calendar file" }).click();
  const icsPath = join(TMP, `${tag}.ics`);
  await (await downloadPromise).saveAs(icsPath);
  const ics = readIcs(readFileSync(icsPath, "utf8"));
  check(`${tag}: .ics parses (CRLF, folding, nesting)`, ics.okEndings && ics.okLengths && ics.balanced && ics.first === "BEGIN:VCALENDAR");
  const codesOf = (texts) => texts.map((t) => t.match(/^([A-Z]{2,4} \d{4})/)?.[1]).sort().join(",");
  const calendarCodes = codesOf(signature.split(" | "));
  const icsCodes = codesOf(ics.events.map((e) => e.SUMMARY));
  check(`${tag}: .ics events match the plan`, ics.events.length === printRows && icsCodes === calendarCodes, `${ics.events.length} events`);
  check(
    `${tag}: .ics repeats weekly until the entered last day`,
    ics.events.length > 0 && ics.events.every((e) => /UNTIL=20270514T235959$/.test(e.RRULE) && e.DTSTART >= "20270119"),
  );
  await ctx.close();
}

async function guestDurability() {
  const tag = "guest-desktop";
  // Rule 3: storage denied
  {
    const ctx = await browser.newContext({ viewport: viewports[0], acceptDownloads: true });
    await ctx.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("denied", "SecurityError");
      };
    });
    const page = await ctx.newPage();
    await gotoSchedule(page);
    await optimize(page, "Cluster nights");
    await page.waitForTimeout(800);
    const label = await saveLabel(page);
    check(`${tag}: rule 3 storage denied shows a persistent Not saved`, label === "Not saved…", label);
    check(`${tag}: rule 3 edits stay in memory`, (await activeOptimization(page)) === "Cluster nights");
    const exportButton = page.getByRole("button", { name: "Export schedule" });
    check(`${tag}: rule 3 export offered`, await exportButton.isVisible());
    const dl = page.waitForEvent("download");
    await exportButton.click();
    check(`${tag}: rule 3 export downloads a file`, Boolean((await dl).suggestedFilename()));
    await shoot(page, `${tag}-06-storage-denied.png`);
    await ctx.close();
  }
  // Rule 4: corrupt bytes
  {
    const ctx = await browser.newContext({ viewport: viewports[0] });
    const page = await ctx.newPage();
    await gotoSchedule(page);
    const corrupt = '{"storeSchemaVersion":1,"revision":9,"state":{"optimization":"compact"';
    await page.evaluate((bytes) => localStorage.setItem("untangle.planner-state.v1", bytes), corrupt);
    await gotoSchedule(page);
    const body = await page.evaluate(() => document.body.innerText);
    const kept = await page.evaluate((bytes) => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith("untangle.planner-state.corrupt-"));
      return keys.length === 1 && localStorage.getItem(keys[0]) === bytes;
    }, corrupt);
    check(`${tag}: rule 4 corrupt bytes quarantined intact`, kept);
    check(`${tag}: rule 4 notice never claims recovery`, body.includes("nothing was recovered"));
    check(`${tag}: rule 4 not shown as Saved`, (await saveLabel(page)) !== "Saved", await saveLabel(page));
    await shoot(page, `${tag}-07-corrupt-quarantined.png`);
    await ctx.close();
  }
  // Rule 5: other tab, clean then dirty
  {
    const ctx = await browser.newContext({ viewport: viewports[0] });
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await gotoSchedule(a);
    await gotoSchedule(b);
    await optimize(b, "Cluster nights");
    await waitLabel(b, "Saved");
    await a.getByText("Loaded newer version from another tab").waitFor({ timeout: 8000 }).catch(() => {});
    check(`${tag}: rule 5 clean tab adopts newer data`, (await activeOptimization(a)) === "Cluster nights");
    check(`${tag}: rule 5 clean tab says so`, await a.getByText("Loaded newer version from another tab").isVisible());
    await shoot(a, `${tag}-08-clean-tab-adopted.png`);

    let conflictPage = null;
    const pairs = [
      ["Strong professors", "Minimize walking"],
      ["Compact days", "Cluster mornings"],
      ["Cluster nights", "Strong professors"],
      ["Minimize walking", "Compact days"],
    ];
    for (const [la, lb] of pairs) {
      if (conflictPage) break;
      await Promise.all([optimize(a, la), optimize(b, lb)]);
      for (let i = 0; i < 30 && !conflictPage; i += 1) {
        for (const p of [a, b]) {
          if (await p.getByRole("alertdialog", { name: "Unsaved changes conflict" }).isVisible().catch(() => false)) conflictPage = p;
        }
        await a.waitForTimeout(150);
      }
    }
    check(`${tag}: rule 5 dirty tab sees both versions`, Boolean(conflictPage));
    if (conflictPage) {
      const dialog = conflictPage.getByRole("alertdialog", { name: "Unsaved changes conflict" });
      const text = await dialog.innerText();
      check(`${tag}: rule 5 dialog shows this tab and the newer version`, text.includes("This tab (unsaved)") && text.includes("Newer saved version"));
      check(`${tag}: dialog focus moves into the dialog`, await conflictPage.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"], [role="alertdialog"]'))));
      for (let i = 0; i < 4; i += 1) await conflictPage.keyboard.press("Tab");
      check(`${tag}: dialog focus stays trapped on Tab`, await conflictPage.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"], [role="alertdialog"]'))));
      await conflictPage.keyboard.press("Escape");
      check(`${tag}: Escape does not silently pick a side`, await dialog.isVisible());
      await shoot(conflictPage, `${tag}-09-conflict.png`);
      await axe(conflictPage, `${tag} conflict dialog`);
      await dialog.getByRole("button", { name: "Use the newer version" }).click();
      await waitLabel(conflictPage, "Saved");
      await a.waitForTimeout(800);
      check(`${tag}: rule 5 tabs agree after choosing`, (await activeOptimization(a)) === (await activeOptimization(b)));
    }
    await ctx.close();
  }
}

async function restoreStalePlan(vp) {
  const tag = `guest-${vp.name}`;
  const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true });
  const page = await ctx.newPage();
  await markTaking(page, ["ANTH 1010"]);
  await gotoSchedule(page);
  await optimize(page, "Compact days");
  await waitLabel(page, "Saved");
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await page.locator("#save-plan-name").fill("Older plan");
  await page.getByRole("button", { name: "Save current schedule" }).click();
  const card = page.locator("li", { hasText: "Older plan" }).first();
  await card.waitFor();
  const dl = page.waitForEvent("download");
  await card.getByRole("button", { name: "Export", exact: true }).click();
  const exported = join(TMP, `${tag}-plan.json`);
  await (await dl).saveAs(exported);
  const plan = JSON.parse(readFileSync(exported, "utf8"));
  plan.name = "Older plan with stale sections";
  plan.state.selectedSections = { ...plan.state.selectedSections, "ANTH 1010": "anth-1010-999" };
  const doctored = join(TMP, `${tag}-stale.json`);
  writeFileSync(doctored, JSON.stringify(plan));
  await page.getByLabel("Import a saved-plan JSON file").setInputFiles(doctored);
  const staleCard = page.locator("li", { hasText: "Older plan with stale sections" }).first();
  await staleCard.waitFor();
  await staleCard.getByRole("button", { name: "Preview restore" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Restore this plan" }).waitFor();
  const warningFirst = await dialog.evaluate((el) => {
    const warning = el.querySelector('[role="alert"]');
    const steps = el.querySelector("ol");
    return warning && steps ? Boolean(warning.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
  });
  check(`${tag}: stale-section warning appears before the restore steps`, warningFirst);
  check(`${tag}: warning names the stale section`, (await dialog.innerText()).includes("anth-1010-999"));
  await shoot(page, `${tag}-10-restore-stale-warning.png`);
  await axe(page, `${tag} restore preview`);
  await dialog.getByRole("button", { name: "Restore this plan" }).click();
  await page.waitForURL(/\/schedule/);
  check(
    `${tag}: restore reports the skipped reference`,
    await page.getByText(/no longer resolve and were skipped/).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false),
  );
  await ctx.close();
}

async function keyboardAndMotion() {
  const tag = "guest-desktop";
  const ctx = await browser.newContext({ viewport: viewports[0], acceptDownloads: true, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await markTaking(page, ["ANTH 1010"]);
  await gotoSchedule(page);
  let reached = false;
  for (let i = 0; i < 150 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.textContent?.trim() === "Download .ics");
  }
  check(`${tag}: keyboard reaches the .ics export`, reached);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Download calendar" });
  await dialog.waitFor();
  check(`${tag}: keyboard-opened dialog takes focus`, await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"], [role="alertdialog"]'))));
  const duration = await page.evaluate(() => getComputedStyle(document.querySelector(".modal-box")).animationDuration);
  check(`${tag}: reduced motion collapses the dialog animation`, parseFloat(duration) <= 0.01, duration);
  await shoot(page, `${tag}-11-reduced-motion-dialog.png`);
  const focusedLabel = () =>
    page.evaluate(() => document.activeElement?.closest("label")?.textContent?.trim() ?? "");
  for (let i = 0; i < 6 && !(await focusedLabel()).startsWith("First day"); i += 1) await page.keyboard.press("Tab");
  await page.keyboard.type("01192027");
  for (let i = 0; i < 6 && !(await focusedLabel()).startsWith("Last day"); i += 1) await page.keyboard.press("Tab");
  await page.keyboard.type("05142027");
  const dl = page.waitForEvent("download", { timeout: 8000 });
  await page.keyboard.press("Enter");
  check(`${tag}: keyboard-only .ics download`, Boolean(await dl.catch(() => null)));
  await page.waitForTimeout(400);
  check(
    `${tag}: focus returns to the opener after the dialog closes`,
    await page.evaluate(() => document.activeElement?.textContent?.trim() === "Download .ics"),
  );
  await ctx.close();
}

async function registeredJourney() {
  if (!DATABASE_URL) {
    check("registered journey ran", false, "no DATABASE_URL");
    return;
  }
  const tag = "registered-desktop";
  const ctx = await browser.newContext({ viewport: viewports[0], acceptDownloads: true });
  const page = await ctx.newPage();
  await signUpOrIn(page, "signUp");
  const userId = sql(`select id from "user" where email = '${EMAIL}'`);
  check(`${tag}: password sign-up created the account`, Boolean(userId));

  await gotoSchedule(page);
  check(`${tag}: no stored plan yet says Not saved yet`, (await saveLabel(page)) === "Not saved yet", await saveLabel(page));
  await shoot(page, `${tag}-01-not-saved-yet.png`);
  await markTaking(page, ["ANTH 1010", "CSCE 1030"]);
  await gotoSchedule(page);
  const built = await eventSignature(page);
  check(`${tag}: courses marked Taking reach the schedule`, built.includes("ANTH 1010") && built.includes("CSCE 1030"), built.slice(0, 160));
  await optimize(page, "Compact days");
  await pickSection(page);
  const lockName = await lockFirst(page);
  check(`${tag}: saved to Postgres`, (await waitLabel(page, "Saved")) === "Saved");
  const signature = await eventSignature(page);
  const row = sql(`select revision || '|' || optimization from planner_state where user_id = '${userId}'`);
  check(`${tag}: row exists with a revision`, /^\d+\|compact$/.test(row), row);
  const [, lockCourse, lockNumber] = lockName.match(/^Lock (.+) section (\d+)$/);
  const storedLock = sql(`select locked_sections->>'${lockCourse}' from planner_state where user_id = '${userId}'`);
  check(`${tag}: lock stored in Postgres`, storedLock.endsWith(`-${lockNumber}`), storedLock);
  await shoot(page, `${tag}-02-saved.png`);
  await axe(page, `${tag} schedule`);

  await page.reload({ waitUntil: "networkidle" });
  check(`${tag}: rule 1 Saved survives reload`, (await waitLabel(page, "Saved")) === "Saved" && (await eventSignature(page)) === signature);
  check(`${tag}: lock survives reload`, (await lockPressed(page, lockName)) === "true", lockName);
  await signOut(page);
  await signUpOrIn(page, "signIn");
  await gotoSchedule(page);
  check(
    `${tag}: rule 1 Saved survives sign-out and sign-in`,
    (await waitLabel(page, "Saved")) === "Saved" && (await eventSignature(page)) === signature,
  );
  check(`${tag}: lock survives sign-out and sign-in`, (await lockPressed(page, lockName)) === "true", lockName);

  // Rule 2: 500 and dropped connection
  for (const [failure, choice] of [["500", "Cluster nights"], ["drop", "Cluster mornings"]]) {
    let failed = false;
    await page.route("**/api/planner", async (route) => {
      if (route.request().method() === "POST" && !failed) {
        failed = true;
        return failure === "500" ? route.fulfill({ status: 500, body: '{"error":"injected"}' }) : route.abort("connectionreset");
      }
      return route.continue();
    });
    await optimize(page, choice);
    const label = await waitLabel(page, "Saving failed…");
    check(`${tag}: rule 2 ${failure} is never Saved`, label === "Saving failed…", label);
    if (failure === "500") await shoot(page, `${tag}-03-save-failed.png`);
    await page.getByRole("button", { name: "Retry save" }).click();
    check(`${tag}: rule 2 ${failure} retry saves`, (await waitLabel(page, "Saved")) === "Saved");
    await page.unroute("**/api/planner");
  }

  // Expired session (item 5)
  const revisionBefore = sql(`select revision from planner_state where user_id = '${userId}'`);
  await ctx.clearCookies();
  await optimize(page, "Strong professors");
  const signedOut = await waitLabel(page, "Not saved: signed out");
  check(`${tag}: expired session shows Not saved: signed out`, signedOut === "Not saved: signed out", signedOut);
  check(`${tag}: expired session wrote nothing`, sql(`select revision from planner_state where user_id = '${userId}'`) === revisionBefore);
  check(
    `${tag}: expired session keeps the edit in the local mirror`,
    await page.evaluate(() => JSON.parse(localStorage.getItem("untangle.planner-state.v1") ?? "{}").state?.optimization === "maximizeProfessor"),
  );
  await shoot(page, `${tag}-04-signed-out.png`);
  const other = await ctx.newPage();
  await signUpOrIn(other, "signIn");
  await other.close();
  await page.waitForTimeout(800);
  if ((await saveLabel(page)) !== "Saved") {
    await page.getByRole("button", { name: "Retry save" }).click();
  }
  check(`${tag}: after signing in again the pending edit is saved`, (await waitLabel(page, "Saved")) === "Saved");
  check(`${tag}: the saved row has the edit`, sql(`select optimization from planner_state where user_id = '${userId}'`) === "maximizeProfessor");

  // Rule 5 registered: clean tab adopts; dirty tab gets the server's conflict
  const tabB = await ctx.newPage();
  await gotoSchedule(tabB);
  await waitLabel(tabB, "Saved");
  await optimize(tabB, "Minimize walking");
  await waitLabel(tabB, "Saved");
  await page.getByText("Loaded newer version from another tab").waitFor({ timeout: 8000 }).catch(() => {});
  check(`${tag}: rule 5 clean tab adopts the newer server revision`, (await activeOptimization(page)) === "Minimize walking");
  check(`${tag}: rule 5 clean tab says so`, await page.getByText("Loaded newer version from another tab").isVisible());
  await page.route("**/api/planner", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 2000));
    return route.continue();
  });
  await optimize(page, "Cluster nights");
  await page.waitForTimeout(500);
  await optimize(tabB, "Compact days");
  const conflict = page.getByRole("alertdialog", { name: "Unsaved changes conflict" });
  const sawConflict = await conflict.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check(`${tag}: rule 5 registered conflict shows both versions`, sawConflict);
  await page.unroute("**/api/planner");
  if (sawConflict) {
    await shoot(page, `${tag}-05-conflict.png`);
    await conflict.getByRole("button", { name: "Keep my edits" }).click();
    check(`${tag}: keeping my edits saves on top of the newer revision`, (await waitLabel(page, "Saved")) === "Saved");
    check(`${tag}: server row has my edit`, sql(`select optimization from planner_state where user_id = '${userId}'`) === "clusterNight");
  }
  await tabB.close();
  await ctx.close();

  // Mobile registered
  const mctx = await browser.newContext({ viewport: viewports[1] });
  const mpage = await mctx.newPage();
  await signUpOrIn(mpage, "signIn");
  await gotoSchedule(mpage);
  check("registered-mobile: stored plan loads as Saved", (await waitLabel(mpage, "Saved")) === "Saved");
  const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth);
  check("registered-mobile: no horizontal overflow", overflow <= 392, `scrollWidth=${overflow}`);
  await shoot(mpage, "registered-mobile-01-saved.png");
  await axe(mpage, "registered-mobile schedule");
  await mctx.close();
}

/**
 * Full registered journey at 390x844 against Postgres, on a second synthetic
 * account so it starts empty: build, lock, optimize, save, reload, sign out
 * and back in, save to the library and restore, print, .ics, axe per surface.
 */
async function registeredMobileJourney() {
  if (!DATABASE_URL) {
    check("registered mobile journey ran", false, "no DATABASE_URL");
    return;
  }
  const tag = "registered-mobile";
  const email = "accept-8-mobile@my.unt.edu";
  const vp = viewports[1];
  const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true });
  const page = await ctx.newPage();
  await signUpOrIn(page, "signUp", email);
  const userId = sql(`select id from "user" where email = '${email}'`);
  check(`${tag}: password sign-up created the account`, Boolean(userId));

  await gotoSchedule(page);
  check(`${tag}: no stored plan yet says Not saved yet`, (await saveLabel(page)) === "Not saved yet", await saveLabel(page));
  await markTaking(page, ["ANTH 1010", "CSCE 1030"]);
  await gotoSchedule(page);
  const built = await eventSignature(page);
  check(`${tag}: courses marked Taking reach the schedule`, built.includes("ANTH 1010") && built.includes("CSCE 1030"), built.slice(0, 160));
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${tag}: no horizontal overflow`, width <= vp.width + 2, `scrollWidth=${width}`);

  const lockName = await lockFirst(page);
  check(
    `${tag}: lock control has an accessible name and pressed state`,
    /^Lock [A-Z]{2,4} \d{4} section \d{3}$/.test(lockName) && (await lockPressed(page, lockName)) === "true",
    lockName,
  );
  await optimizeWithLock(page, "Cluster nights");
  check(`${tag}: optimizing keeps the locked section`, (await lockPressed(page, lockName)) === "true", lockName);
  check(`${tag}: saved to Postgres`, (await waitLabel(page, "Saved")) === "Saved");
  const [, lockCourse, lockNumber] = lockName.match(/^Lock (.+) section (\d+)$/);
  const row = sql(
    `select optimization || '|' || coalesce(locked_sections->>'${lockCourse}', '') from planner_state where user_id = '${userId}'`,
  );
  check(`${tag}: plan and lock stored in Postgres`, row.startsWith("clusterNight|") && row.endsWith(`-${lockNumber}`), row);
  const signature = await eventSignature(page);
  await page.getByRole("button", { name: lockName, exact: true }).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shoot(page, `${tag}-02-locked-saved.png`);
  await axe(page, `${tag} schedule`);

  await page.reload({ waitUntil: "networkidle" });
  check(
    `${tag}: Saved, plan and lock survive reload`,
    (await waitLabel(page, "Saved")) === "Saved" &&
      (await eventSignature(page)) === signature &&
      (await lockPressed(page, lockName)) === "true",
  );
  await tap(page.getByRole("button", { name: "Sign out" }));
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
  await signUpOrIn(page, "signIn", email);
  await gotoSchedule(page);
  check(
    `${tag}: Saved, plan and lock survive sign-out and sign-in`,
    (await waitLabel(page, "Saved")) === "Saved" &&
      (await eventSignature(page)) === signature &&
      (await lockPressed(page, lockName)) === "true",
  );

  // Library: save this version, change the schedule, restore it.
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await page.locator("#save-plan-name").fill("Mobile locked plan");
  await tap(page.getByRole("button", { name: "Save current schedule" }));
  const card = page.locator("li", { hasText: "Mobile locked plan" }).first();
  await card.waitFor();
  await axe(page, `${tag} plans`);
  await gotoSchedule(page);
  await tap(page.getByRole("button", { name: lockName, exact: true }));
  await optimize(page, "Compact days");
  await waitLabel(page, "Saved");
  check(`${tag}: schedule changed before restore`, (await lockPressed(page, lockName)) !== "true");
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await tap(page.locator("li", { hasText: "Mobile locked plan" }).first().getByRole("button", { name: "Preview restore" }));
  const preview = page.getByRole("dialog");
  await preview.getByRole("button", { name: "Restore this plan" }).waitFor();
  check(`${tag}: restore preview lists the lock`, (await preview.innerText()).includes(`Lock ${lockCourse} section`));
  await shoot(page, `${tag}-03-restore-preview.png`);
  await axe(page, `${tag} restore preview`);
  await tap(preview.getByRole("button", { name: "Restore this plan" }));
  await page.waitForURL(/\/schedule/);
  await page.waitForTimeout(600);
  check(`${tag}: restore brings back the locked section`, (await lockPressed(page, lockName)) === "true", lockName);
  check(`${tag}: restored plan saved`, (await waitLabel(page, "Saved")) === "Saved");
  check(
    `${tag}: restored lock stored in Postgres`,
    sql(`select coalesce(locked_sections->>'${lockCourse}', '') from planner_state where user_id = '${userId}'`).endsWith(`-${lockNumber}`),
  );
  const restoredSignature = await eventSignature(page);

  // Print
  await page.goto(`${BASE}/schedule/print`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0);
  const printRows = await page.locator("tbody tr").count();
  check(`${tag}: print view lists every meeting`, printRows === restoredSignature.split(" | ").length, `${printRows} rows`);
  await shoot(page, `${tag}-04-print.png`);
  await axe(page, `${tag} print view`);

  // .ics
  await gotoSchedule(page);
  await tap(page.getByRole("button", { name: "Download .ics", exact: true }));
  const dialog = page.getByRole("dialog", { name: "Download calendar" });
  await dialog.getByLabel("First day of classes").fill("2027-01-19");
  await dialog.getByLabel("Last day of classes").fill("2027-05-14");
  await shoot(page, `${tag}-05-ics-dialog.png`);
  await axe(page, `${tag} .ics dialog`);
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download calendar file" }).click();
  const icsPath = join(TMP, `${tag}.ics`);
  await (await downloadPromise).saveAs(icsPath);
  const ics = readIcs(readFileSync(icsPath, "utf8"));
  check(`${tag}: .ics parses`, ics.okEndings && ics.okLengths && ics.balanced && ics.first === "BEGIN:VCALENDAR");
  check(`${tag}: .ics has one event per meeting`, ics.events.length === printRows, `${ics.events.length} events`);
  await ctx.close();
}

const only = process.env.UNTANGLE_M6_ONLY?.split(",");
const run = async (name, fn) => {
  if (only && !only.includes(name)) return;
  try {
    await fn();
  } catch (error) {
    check(`${name} completed without an exception`, false, String(error?.stack ?? error).slice(0, 700));
  }
};
await run("guest", async () => {
  for (const vp of viewports) await guestJourney(vp);
});
await run("durability", guestDurability);
await run("restore", async () => {
  for (const vp of viewports) await restoreStalePlan(vp);
});
await run("keyboard", keyboardAndMotion);
await run("registered", registeredJourney);
await run("registered-mobile", registeredMobileJourney);
await browser.close();

report.finishedAt = new Date().toISOString();
const failed = report.checks.filter((c) => !c.passed);
writeFileSync(join(OUT, "untangle-plans-m6-report.json"), JSON.stringify(report, null, 2));
console.log(`SUMMARY ${report.checks.length - failed.length}/${report.checks.length} checks passed`);
if (failed.length) console.log(`FAILED: ${failed.map((c) => c.name).join("; ")}`);
process.exit(failed.length ? 1 : 0);
