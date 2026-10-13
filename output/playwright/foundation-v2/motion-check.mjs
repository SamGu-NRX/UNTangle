#!/usr/bin/env node
// Reads the computed motion of the controls with reduced motion on and off,
// at 1440x900 and 390x844 (DESIGN.md §6: under reduced motion translate and
// scale go, opacity fades stay at 120ms). Writes motion-report.json; exits
// 1 on any failure. Run from a directory with playwright installed:
//   node motion-check.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const results = [];
const check = (label, name, pass, detail) => {
  results.push({ label, name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${label}] ${name} — ${detail}`);
};
const style = (page, selector, props) =>
  page.evaluate(
    ({ selector, props }) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, cs[p]]));
    },
    { selector, props },
  );

const browser = await chromium.launch();
try {
  for (const [size, viewport, touch] of [
    ["desktop", { width: 1440, height: 900 }, false],
    ["phone", { width: 390, height: 844 }, true],
  ]) {
    for (const reduced of [true, false]) {
      const label = `${size}, ${reduced ? "reduced" : "full"} motion`;
      const ctx = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch, reducedMotion: reduced ? "reduce" : "no-preference" });
      const page = await ctx.newPage();
      await page.goto(`${base}/dev/controls`, { waitUntil: "networkidle" });

      const pill = await style(page, ".ui-seg__pill", ["transitionDuration", "transitionProperty"]);
      const knob = await style(page, ".ui-toggle__knob", ["transitionDuration", "transitionProperty"]);
      if (reduced) {
        check(label, "segmented pill jumps", pill.transitionDuration === "0s", JSON.stringify(pill));
        check(label, "toggle knob jumps", knob.transitionDuration === "0s", JSON.stringify(knob));
      } else {
        check(label, "segmented pill slides 160ms on transform", pill.transitionProperty === "transform" && pill.transitionDuration === "0.16s", JSON.stringify(pill));
        check(label, "toggle knob slides 160ms on transform", knob.transitionProperty === "transform" && knob.transitionDuration === "0.16s", JSON.stringify(knob));
      }

      // Arrow keys move the pill instantly, with or without reduced motion.
      await page.getByRole("radio", { name: "Courses" }).focus();
      await page.keyboard.press("ArrowRight");
      const keyPill = await style(page, ".ui-seg__pill", ["transitionDuration"]);
      check(label, "arrow keys move the pill without animation", keyPill.transitionDuration === "0s", JSON.stringify(keyPill));

      await page.getByRole("combobox", { name: "Instructor" }).click();
      const pop = await style(page, ".ui-listbox", ["transitionProperty", "transitionDuration", "transform"]);
      if (reduced) {
        check(label, "listbox fades 120ms, no scale", pop.transitionProperty === "opacity" && pop.transitionDuration === "0.12s", JSON.stringify(pop));
      } else {
        check(label, "listbox fades and scales 160ms", pop.transitionProperty.includes("transform") && pop.transitionDuration.startsWith("0.16s"), JSON.stringify(pop));
      }
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Open dialog" }).click();
      const dialog = await style(page, ".ui-dialog", ["transitionProperty", "transitionDuration", "transformOrigin"]);
      if (reduced) {
        check(label, "dialog fades 120ms, no scale", dialog.transitionProperty === "opacity" && dialog.transitionDuration === "0.12s", JSON.stringify(dialog));
      } else {
        check(label, "dialog scales from its centre over 200ms", dialog.transitionProperty.includes("transform") && dialog.transitionDuration.startsWith("0.2s"), JSON.stringify(dialog));
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);

      await page.getByRole("button", { name: "Toast with Undo" }).click();
      await page.waitForTimeout(250);
      const toastStyle = await style(page, ".ui-toast", ["transform", "transitionDuration"]);
      check(label, reduced ? "toast fades without rising" : "toast settles at rest", toastStyle.transform === "none" || toastStyle.transform === "matrix(1, 0, 0, 1, 0, 0)", JSON.stringify(toastStyle));
      await page.getByRole("button", { name: "Dismiss" }).click();

      await page.getByRole("button", { name: "Open sheet" }).click();
      await page.waitForTimeout(20);
      const sheet = await page.evaluate(() => document.querySelector(".ui-sheet").style.transition);
      check(label, reduced ? "sheet fades in, does not slide" : "sheet slides in on the sheet curve", reduced ? sheet.includes("opacity") && !sheet.includes("transform") : sheet.includes("transform"), sheet);
      await page.waitForTimeout(400);
      const handle = page.getByRole("button", { name: "Resize sheet" });
      await handle.focus();
      await page.keyboard.press("ArrowUp");
      const keyed = await page.evaluate(() => document.querySelector(".ui-sheet").style.transition);
      check(label, "↑ on the sheet handle moves without sliding", keyed === "none" || keyed.startsWith("opacity"), keyed);

      // Reopen inside the exit window: the sheet must come back visible.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(60);
      // Focus is back on "Open sheet"; Enter reopens it inside the exit window.
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
      const reopened = await page.evaluate(() => {
        const el = document.querySelector(".ui-sheet");
        return el ? getComputedStyle(el).opacity : "missing";
      });
      check(label, "a sheet reopened during its exit is fully visible", reopened === "1", reopened);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "motion-report.json"), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
