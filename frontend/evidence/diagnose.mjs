import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const BASE = "http://localhost:3100";
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${BASE}/courses`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const contrast = axe.violations.filter((v) => v.id === "color-contrast");
  for (const v of contrast) {
    for (const n of v.nodes) {
      console.log(`CONTRAST ${n.any?.[0]?.data?.fgColor ?? "?"} on ${n.any?.[0]?.data?.bgColor ?? "?"} ratio ${n.any?.[0]?.data?.contrastRatio ?? "?"} :: ${n.target.join(" ")} :: ${n.failureSummary?.slice(0, 120)}`);
    }
  }

  const mobile = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await mobile.goto(`${BASE}/courses`);
  await mobile.waitForLoadState("networkidle");
  await mobile.waitForTimeout(400);
  const wide = await mobile.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > 392 && r.right > 392) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === "string" ? el.className.slice(0, 60) : "",
          w: Math.round(r.width),
          right: Math.round(r.right),
          text: (el.textContent ?? "").slice(0, 40),
        });
      }
    }
    out.sort((a, b) => b.right - a.right);
    return out.slice(0, 12);
  });
  console.log("WIDE ELEMENTS (mobile 390):");
  for (const w of wide) console.log(JSON.stringify(w));
} finally {
  await browser.close();
}
