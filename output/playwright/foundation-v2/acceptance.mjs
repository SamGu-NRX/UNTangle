#!/usr/bin/env node
// Acceptance journey for the v2 foundation (controls + app shell), at
// 1440x900 (fine pointer) and 390x844 (touch). Writes screenshots and
// report.json to <outDir>; exits 1 if any check fails.
// Run from a directory with playwright and axe-core installed:
//   node acceptance.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const results = [];
const check = (size, name, pass, detail = "") => {
  results.push({ size, name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${size}] ${name}${detail ? ` — ${detail}` : ""}`);
};

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function axe(page, include) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(
    async ({ include, tags }) => {
      const r = await window.axe.run(include ? { include } : document, { runOnly: { type: "tag", values: tags } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target }));
    },
    { include, tags: AXE_TAGS },
  );
}
const serious = (violations) => violations.filter((v) => v.impact === "serious" || v.impact === "critical");

const active = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 60) : "";
  });

async function controls(page, size, phone) {
  await page.goto(`${base}/dev/controls`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(out, `${size}-controls.png`), fullPage: true });

  // Every tab stop is reachable by Tab, in order, and shows the focus ring.
  const expected = await page.evaluate(() => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== "hidden";
    const all = Array.from(document.querySelectorAll("button, a[href], input, select, textarea, [tabindex]"));
    const stops = all.filter((el) => el.tabIndex >= 0 && !el.disabled && !el.closest("[inert]") && visible(el));
    // Native radios: one stop per group (the checked one).
    const kept = stops.filter((el) => !(el.type === "radio" && !el.checked && document.querySelector(`input[type=radio][name="${el.name}"]:checked`)));
    kept.forEach((el, i) => el.setAttribute("data-stop", String(i)));
    return kept.length;
  });
  const seen = new Set();
  let ringOk = 0;
  let ringChecked = 0;
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  for (let i = 0; i < expected + 5; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      const stop = el?.getAttribute("data-stop");
      const style = el ? getComputedStyle(el) : null;
      const ring = style ? `${style.boxShadow} ${style.outlineStyle !== "none" ? style.outlineColor : ""}` : "";
      // Inputs inside a field draw the ring on the field.
      const field = el?.closest(".ui-field");
      const fieldRing = field ? getComputedStyle(field).boxShadow : "";
      const toggleRing = el?.querySelector?.(".ui-toggle__track") ? getComputedStyle(el.querySelector(".ui-toggle__track")).boxShadow : "";
      return { stop, ring: `${ring} ${fieldRing} ${toggleRing}` };
    });
    if (info.stop !== undefined && info.stop !== null) {
      if (!seen.has(info.stop)) {
        ringChecked += 1;
        if (/rgb\(0, 168, 85\)|rgb\(26, 46, 26\)|rgb\(0, 81, 43\)/.test(info.ring) || info.ring.includes("0, 168, 85")) ringOk += 1;
      }
      seen.add(info.stop);
    }
  }
  check(size, "every control is a reachable tab stop", seen.size === expected, `${seen.size}/${expected} stops reached`);
  check(size, "each tab stop shows the accent focus ring", ringOk === ringChecked, `${ringOk}/${ringChecked}`);

  // Select: keyboard open, check on the selected option, arrow + Enter picks.
  const combo = page.getByRole("combobox", { name: "Instructor" });
  await combo.focus();
  await page.keyboard.press("ArrowDown");
  const listbox = page.getByRole("listbox", { name: "Instructor" });
  await listbox.waitFor();
  const selected = listbox.locator('[role="option"][aria-selected="true"]');
  const hasCheck = (await selected.locator(".ui-option__check").count()) === 1;
  check(size, "Select opens from the keyboard with a check on the selected option", hasCheck, await selected.innerText());
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${size}-select-open.png`) });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  // From R. Okafor, ↓ lands on M. Delgado (the specimen's disabled option is the last one).
  check(size, "Select: ↓ then Enter picks the next option", (await combo.innerText()).includes("M. Delgado"), await combo.innerText());
  const nativeShown = await page.evaluate(() => Array.from(document.querySelectorAll("select")).some((s) => s.offsetParent !== null));
  check(size, "no native <select> is ever shown", !nativeShown);

  // Menu
  const menuTrigger = page.getByRole("button", { name: "Plan menu" });
  await menuTrigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menu", { name: "Plan" }).waitFor();
  const firstItem = await active(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${size}-menu-open.png`) });
  await page.keyboard.press("ArrowDown");
  const second = await active(page);
  await page.keyboard.press("Escape");
  const back = await page.evaluate(() => document.activeElement?.textContent?.trim());
  check(size, "Menu: Enter opens on the first item, ↓ moves, Escape returns focus", firstItem.includes("Save a copy") && second.includes("Rename") && back === "Plan menu", `${firstItem} → ${second} → ${back}`);

  // Segmented
  await page.getByRole("radio", { name: "Courses" }).focus();
  await page.keyboard.press("ArrowRight");
  check(size, "Segmented: → selects the next segment", (await page.getByRole("radio", { name: "Week" }).getAttribute("aria-checked")) === "true");

  // Slider
  const thumb = page.getByRole("slider", { name: "Max walk between classes" });
  await thumb.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  check(size, "Slider: → steps 1, Shift+→ steps 5", (await thumb.getAttribute("aria-valuenow")) === "16", await thumb.getAttribute("aria-valuetext"));

  // Toggle, checkbox, chip
  const toggle = page.getByRole("switch", { name: "Show instructor ratings" });
  await toggle.focus();
  await page.keyboard.press("Space");
  check(size, "Toggle: Space switches it", (await toggle.getAttribute("aria-checked")) === "true");
  const box = page.getByRole("checkbox", { name: "Off" });
  await box.focus();
  await page.keyboard.press("Space");
  check(size, "Checkbox: Space checks it", await box.isChecked());
  const chip = page.getByRole("button", { name: "No Fridays" });
  await chip.focus();
  await page.keyboard.press("Enter");
  check(size, "Chip: Enter toggles it", (await chip.getAttribute("aria-pressed")) === "true");

  // Date input (typed on fine pointers; native date on touch) and the calendar grid.
  if (!phone) {
    const date = page.getByRole("combobox", { name: "First day of classes" });
    await date.fill("1/21/27");
    await page.keyboard.press("Enter");
    check(size, "DateInput accepts a typed 1/21/27", (await date.inputValue()) === "Jan 21, 2027", await date.inputValue());
  } else {
    const native = page.locator('input[type="date"]');
    check(size, "DateInput is a native date input on touch", (await native.count()) === 1 && (await native.isVisible()));
  }
  const grid = page.getByRole("grid", { name: "Term dates" });
  await grid.locator('[role="gridcell"][tabindex="0"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const picked = await grid.locator('[role="gridcell"][aria-selected="true"]').count();
  check(size, "DatePicker grid: arrows move, Enter picks", picked >= 1, `${picked} selected`);

  // Tooltip on keyboard focus
  await page.getByRole("button", { name: "Hover me" }).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const tip = await page.locator(".ui-tooltip").count();
  check(size, "Tooltip shows on keyboard focus", tip === 1);

  // Toast with an action
  await page.getByRole("button", { name: "Toast with Undo" }).focus();
  await page.keyboard.press("Enter");
  await page.locator(".ui-toast").waitFor();
  await page.waitForTimeout(250);
  check(size, "Toast shows with its Undo action", (await page.locator(".ui-toast__action").innerText()) === "Undo");
  await page.screenshot({ path: join(out, `${size}-toast.png`) });
  await page.getByRole("button", { name: "Dismiss" }).click();

  // Dialog: focus in, Escape closes, focus returns.
  const opener = page.getByRole("button", { name: "Open dialog" });
  await opener.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Export calendar" }).waitFor();
  await page.waitForTimeout(250);
  const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  const inert = await page.evaluate(() => document.querySelector(".spec-page")?.closest("[inert]") !== null);
  await page.screenshot({ path: join(out, `${size}-dialog.png`) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const returned = await opener.evaluate((el) => el === document.activeElement);
  check(size, "Dialog: focus moves in, page is inert, Escape closes and refocuses the opener", inside && inert && returned, `inside=${inside} inert=${inert} refocused=${returned}`);

  // Palette
  await page.getByRole("button", { name: "Search courses" }).first().focus();
  await page.keyboard.press("Enter");
  const palInput = page.getByRole("combobox", { name: "Search courses" });
  await palInput.waitFor();
  await page.keyboard.type("csce");
  await page.keyboard.press("ArrowDown");
  const activeId = await palInput.getAttribute("aria-activedescendant");
  await page.screenshot({ path: join(out, `${size}-palette.png`) });
  await page.keyboard.press("Escape");
  check(size, "Search palette: typing filters, ↓ moves the active result, Escape closes", Boolean(activeId) && (await palInput.count()) === 0);

  // axe on the specimen page.
  const violations = await axe(page);
  check(size, "axe: no serious or critical findings on /dev/controls", serious(violations).length === 0, JSON.stringify(serious(violations)));
  if (violations.length) console.log(`  (axe minor/moderate on /dev/controls: ${violations.map((v) => `${v.id}:${v.impact}`).join(", ")})`);

  if (phone) await sheet(page, size);
}

async function sheet(page, size) {
  await page.getByRole("button", { name: "Open sheet" }).click();
  const dialog = page.getByRole("dialog", { name: "CSCE 2100 details" });
  await dialog.waitFor();
  await page.waitForTimeout(400);
  const vh = 844;
  const visible = async () => vh - (await dialog.boundingBox()).y;
  const half = await visible();
  check(size, "BottomSheet opens at the 50% detent", Math.abs(half - vh * 0.5) < 6, `${Math.round(half)}px`);
  await page.screenshot({ path: join(out, `${size}-sheet-half.png`) });

  const handle = page.getByRole("button", { name: "Resize CSCE 2100 details" });
  const hb = await handle.boundingBox();
  const x = hb.x + hb.width / 2;
  let y = hb.y + hb.height / 2;
  // Slow drag up past the top detent: damped, then settles at 92%.
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) {
    await page.mouse.move(x, y - i * 22);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const full = await visible();
  check(size, "BottomSheet: a slow drag up settles at the 92% detent", Math.abs(full - vh * 0.92) < 6, `${Math.round(full)}px`);
  await page.screenshot({ path: join(out, `${size}-sheet-full.png`) });

  // A short fast flick down drops one detent.
  const hb2 = await handle.boundingBox();
  y = hb2.y + hb2.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i += 1) {
    await page.mouse.move(x, y + i * 15);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterFlick = await visible();
  check(size, "BottomSheet: a fast flick down (>0.11 px/ms) drops to 50%", Math.abs(afterFlick - vh * 0.5) < 6, `${Math.round(afterFlick)}px`);

  // Keyboard: ↓ on the handle goes to the peek detent; ↑ goes back.
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);
  const peek = await visible();
  check(size, "BottomSheet: ↓ on the handle moves to the 112px peek", Math.abs(peek - 112) < 6, `${Math.round(peek)}px`);
  await page.screenshot({ path: join(out, `${size}-sheet-peek.png`) });

  // Flick down from the lowest detent dismisses.
  const hb3 = await handle.boundingBox();
  y = hb3.y + hb3.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i += 1) {
    await page.mouse.move(x, y + i * 12);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
  check(size, "BottomSheet: a flick down from the peek dismisses it", (await dialog.count()) === 0);
}

async function shell(page, size, phone) {
  for (const route of ["/courses", "/schedule", "/map"]) {
    await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      const row = document.querySelector(".shell-topbar__row");
      const tabs = document.querySelector(".shell-tabs");
      const switcher = document.querySelector(".shell-switcher");
      const search = document.querySelector(".shell-search");
      const main = document.querySelector("main#main");
      // First visible text inside the view (ignoring overlays portaled to body).
      let contentTop = null;
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim()) continue;
        const r = node.parentElement.getBoundingClientRect();
        if (r.width && r.height) {
          contentTop = r.top;
          break;
        }
      }
      const current = document.querySelector('.shell-switcher [aria-current="page"], .shell-tabs [aria-current="page"]');
      return {
        barHeight: row?.getBoundingClientRect().height,
        tabsHeight: tabs && getComputedStyle(tabs).display !== "none" ? tabs.getBoundingClientRect().height : 0,
        switcherShown: !!switcher && getComputedStyle(switcher).display !== "none",
        searchShown: !!search && getComputedStyle(search).display !== "none",
        searchText: search?.innerText ?? "",
        contentTop,
        current: current?.textContent?.trim(),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // View content wider than the screen (clipped by the shell, but the
        // view's owner should know).
        // Outermost elements only: skip any whose parent is already too wide.
        wideInView: Array.from(main.querySelectorAll("*"))
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .filter((el) => el.parentElement.getBoundingClientRect().right <= innerWidth + 1)
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${(el.textContent || "").trim().slice(0, 40)}"`),
      };
    });
    const name = route.slice(1);
    await page.screenshot({ path: join(out, `${size}-shell-${name}.png`) });
    if (!phone) {
      check(size, `${route}: 56px bar with the view switcher and search`, m.barHeight === 56 && m.switcherShown && m.searchShown && m.tabsHeight === 0, JSON.stringify(m));
      if (route === "/courses") check(size, "/courses: search trigger shows ⌘K", m.searchText.includes("⌘K"), m.searchText);
      await page.keyboard.press("Meta+k");
      const opened = await page.getByRole("combobox", { name: "Search courses" }).isVisible().catch(() => false);
      await page.keyboard.press("Escape");
      check(size, `${route}: ⌘K opens the search palette`, opened);
    } else {
      check(size, `${route}: 48px bar, bottom tabs, no switcher in the bar`, m.barHeight === 48 && m.tabsHeight === 56 && !m.switcherShown, JSON.stringify(m));
      check(size, `${route}: content starts within 100px of the top`, m.contentTop !== null && m.contentTop <= 100, `${Math.round(m.contentTop)}px`);
    }
    const expectedTab = { "/courses": "Courses", "/schedule": "Week", "/map": "Map" }[route];
    check(size, `${route}: the current view is marked`, m.current === expectedTab, m.current);
    check(size, `${route}: no horizontal overflow`, m.overflow <= 0, `${m.overflow}px`);
    if (m.wideInView.length) results.push({ size, name: `${route}: view content wider than the screen (owner's)`, info: m.wideInView });

    const chrome = await axe(page, [[".shell-topbar"], [".shell-tabs"]]);
    check(size, `${route}: axe finds nothing serious or critical in the shell`, serious(chrome).length === 0, JSON.stringify(serious(chrome)));
    const whole = await axe(page);
    results.push({ size, name: `${route}: full-page axe (view content belongs to its owner)`, info: serious(whole) });
  }

  // Full-bleed body: fills exactly the space between the bars; the page does not scroll.
  await page.goto(`${base}/about`, { waitUntil: "networkidle" });
  const fb = await page.evaluate(async () => {
    const main = document.querySelector("main#main");
    main.innerHTML = '<div data-shell-body="full-bleed" style="background:#dfe7dc"></div>';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const body = main.firstElementChild.getBoundingClientRect();
    const bar = document.querySelector(".shell-topbar").getBoundingClientRect();
    const tabs = document.querySelector(".shell-tabs");
    const tabsTop = tabs && getComputedStyle(tabs).display !== "none" ? tabs.getBoundingClientRect().top : innerHeight;
    return { top: body.top, bottom: body.bottom, barBottom: bar.bottom, tabsTop, scroll: document.documentElement.scrollHeight - innerHeight };
  });
  check(size, "full-bleed body spans exactly from the bar to the tabs, page does not scroll", Math.abs(fb.top - fb.barBottom) < 1 && Math.abs(fb.bottom - fb.tabsTop) < 1 && fb.scroll <= 0, JSON.stringify(fb));
}

const browser = await chromium.launch();
try {
  for (const vp of [
    { size: "desktop", width: 1440, height: 900, phone: false },
    { size: "phone", width: 390, height: 844, phone: true },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.phone,
      hasTouch: vp.phone,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    try {
      await controls(page, vp.size, vp.phone);
      await shell(page, vp.size, vp.phone);
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
const failed = results.filter((r) => r.pass === false);
console.log(`\n${results.filter((r) => r.pass).length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
