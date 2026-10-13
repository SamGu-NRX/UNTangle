#!/usr/bin/env node
/**
 * Short recordings of the motion in the Courses v2 view, for the PR.
 * desktop: panel slides in, instructor change crossfades the bars, ↓ moves the
 * panel to the next course without re-animating, Esc slides it out.
 * phone: the course sheet rises, a drag settles it at half, a flick dismisses it.
 * Grade history is the same untgrades.app-shaped fixture the journey uses.
 * Env: UNTANGLE_BASE_URL, PLAYWRIGHT_MODULE, OUT_DIR. Writes WebM files.
 */
import { mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.UNTANGLE_BASE_URL ?? "http://127.0.0.1:3123";
const OUT = process.env.OUT_DIR ?? here;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
mkdirSync(`${OUT}/video-tmp`, { recursive: true });

const g = (a, b, c, d, f, w) => ({ gradeA: a, gradeB: b, gradeC: c, gradeD: d, gradeF: f, gradeP: 0, gradeNP: 0, gradeW: w, gradeWF: 0, gradeI: 0, gradePR: 0, gradeNPR: 0, gradeZ: 0, gradeSuppressed: 0, totalEnroll: a + b + c + d + f + w });
const s = (n, first, last, grades) => ({ sectionNumber: n, instructor: { id: `${last},${first}`, firstName: first, lastName: last, name: `${first} ${last}` }, counts: {}, total: grades.totalEnroll, grades });
const all = g(139, 108, 63, 24, 25, 28);
const fixture = { status: "ok", source: "untgrades.app", data: { course: { subject: "CSCE", number: "1030", title: "Computer Science I" }, terms: [
  { term: "Fall", year: "2023", counts: {}, total: 0, grades: g(0, 0, 0, 0, 0, 0), sections: [s("001", "Beilei", "Jiang", g(48, 30, 14, 5, 6, 9)), s("003", "Haili", "Wang", g(20, 26, 22, 9, 10, 8))] },
  { term: "Spring", year: "2024", counts: {}, total: 0, grades: g(0, 0, 0, 0, 0, 0), sections: [s("002", "Beilei", "Jiang", g(40, 28, 12, 4, 5, 6)), s("005", "Pradhumna", "Shrestha", g(31, 24, 15, 6, 4, 5))] },
], sectionCount: 4, gpa: null, counts: {}, total: all.totalEnroll, grades: all } };

async function setup(context) {
  const page = await context.newPage();
  await page.route("**/api/grades/courses/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/CSCE/1030")
        ? fixture
        : { status: "unavailable", source: "untgrades.app", data: null, error: { reason: "upstream", message: "Simulated." } },
    }),
  );
  await page.goto(`${BASE}/courses`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Try a sample transcript/ }).click();
  const picker = page.getByRole("combobox", { name: "Major" }).filter({ visible: true });
  await picker.click();
  await page.getByRole("option", { name: /Computer Science/ }).first().click();
  await page.locator('[data-row-open="CSCE 1030"]').waitFor();
  return page;
}

const browser = await chromium.launch();
try {
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: `${OUT}/video-tmp`, size: { width: 1440, height: 900 } } });
    const page = await setup(context);
    await page.getByRole("button", { name: "Auto-fill", exact: true }).filter({ visible: true }).click();
    await page.waitForTimeout(900);
    await page.locator('[data-row-open="CSCE 1030"]').click();
    await page.waitForTimeout(1100);
    const panel = page.locator("aside[aria-labelledby=course-panel-title]");
    await panel.getByRole("combobox", { name: "Instructor" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: /Haili Wang/ }).click();
    await page.waitForTimeout(900);
    await panel.getByRole("combobox", { name: "Instructor" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("option", { name: /Beilei Jiang/ }).click();
    await page.waitForTimeout(900);
    await page.locator('[data-row-open="CSCE 1030"]').focus();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(700);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    const video = page.video();
    await context.close();
    renameSync(await video.path(), `${OUT}/desktop-panel-motion.webm`);
  }
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, recordVideo: { dir: `${OUT}/video-tmp`, size: { width: 390, height: 844 } } });
    const page = await setup(context);
    await page.locator('[data-row-open="CSCE 1030"]').tap();
    await page.waitForTimeout(1000);
    const grip = page.getByRole("dialog", { name: "CSCE 1030 details" }).getByRole("button", { name: "Resize sheet" });
    const box = await grip.boundingBox();
    const x = box.x + box.width / 2;
    await page.mouse.move(x, box.y + 10);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(x, box.y + 10 + step * 26);
      await page.waitForTimeout(35);
    }
    await page.mouse.up();
    await page.waitForTimeout(1000);
    const half = await grip.boundingBox();
    await page.mouse.move(x, half.y + 10);
    await page.mouse.down();
    for (let step = 1; step <= 4; step++) {
      await page.mouse.move(x, half.y + 10 + step * 40);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(900);
    const video = page.video();
    await context.close();
    renameSync(await video.path(), `${OUT}/phone-sheet-motion.webm`);
  }
} finally {
  await browser.close();
}
console.log("recorded");
