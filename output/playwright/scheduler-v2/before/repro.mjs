// Reproduce today's /schedule builder as a guest. Usage: node repro.mjs <baseUrl> <outDir>
import { chromium } from "/Users/samgu/.npm/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const report = { steps: [] };
const log = (entry) => { report.steps.push(entry); console.log(JSON.stringify(entry)); };

const browser = await chromium.launch({ executablePath: process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function readSchedule() {
  return page.evaluate(() => {
    const heads = [...document.querySelectorAll(".cal-head")].filter((el) => el.textContent.trim());
    const cols = heads.map((el) => ({ day: el.textContent.trim(), rect: el.getBoundingClientRect() }));
    const events = [...document.querySelectorAll("button.cal-event")].map((el) => {
      const r = el.getBoundingClientRect();
      const col = cols.find((c) => r.left + r.width / 2 >= c.rect.left && r.left + r.width / 2 <= c.rect.right);
      return { day: col?.day ?? "?", text: el.textContent.replace(/\s+/g, " ").trim() };
    });
    const banners = [...document.querySelectorAll("[role=alert], .conflict-banner")].map((el) => el.textContent.replace(/\s+/g, " ").trim());
    const stats = [...document.querySelectorAll("aside .surface-card")].map((el) => el.textContent.replace(/\s+/g, " ").trim()).find((t) => t.startsWith("Stats"));
    return { events, banners, stats };
  });
}

await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
log({ step: "fresh schedule", ...(await readSchedule()) });
await page.screenshot({ path: join(out, "01-fresh.png") });

await page.goto(`${base}/courses`, { waitUntil: "networkidle" });
const major = page.locator('[role="dialog"]', { hasText: "What are you studying?" });
if (await major.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) {
  await major.getByRole("button", { name: /Undeclared/ }).click();
  await major.getByRole("button", { name: "Confirm" }).click();
  await major.waitFor({ state: "detached" });
}
for (const code of ["ANTH 1010", "ENGL 1310", "PSYC 1630", "BIOL 1710"]) {
  await page.getByLabel("Search courses").fill(code);
  await page.locator("article.course-row", { hasText: code }).first().getByRole("button", { name: "Taking", exact: true }).click();
}
await page.getByRole("link", { name: /Schedule/ }).first().click();
await page.waitForURL(/\/schedule/);
await page.waitForTimeout(1000);
log({ step: "after marking 4 courses Taking (plus default MATH 1710)", ...(await readSchedule()) });
await page.screenshot({ path: join(out, "02-five-courses.png") });

const goals = ["Cluster mornings", "Cluster nights", "Compact days", "Minimize walking", "Strong professors"];
const results = {};
for (const goal of goals) {
  const t0 = Date.now();
  await page.getByRole("button", { name: new RegExp(goal) }).click();
  await page.waitForTimeout(400);
  const s = await readSchedule();
  results[goal] = s.events.map((e) => `${e.day} ${e.text}`).sort().join(" | ");
  log({ step: `goal ${goal}`, ms: Date.now() - t0, ...s });
  await page.screenshot({ path: join(out, `03-goal-${goal.replace(/\s+/g, "-").toLowerCase()}.png`) });
}
const before = (await readSchedule()).events.map((e) => `${e.day} ${e.text}`).sort().join(" | ");
const t1 = Date.now();
await page.getByRole("button", { name: "Optimize schedule" }).click();
await page.waitForTimeout(400);
const after = await readSchedule();
log({ step: "Optimize schedule", ms: Date.now() - t1, changed: before !== after.events.map((e) => `${e.day} ${e.text}`).sort().join(" | "), ...after });
await page.screenshot({ path: join(out, "04-optimize.png") });

const distinct = new Set(Object.values(results));
log({ step: "summary", distinctSchedulesAcrossGoals: distinct.size, goals: goals.length });
writeFileSync(join(out, "repro-report.json"), JSON.stringify(report, null, 2));
await browser.close();
