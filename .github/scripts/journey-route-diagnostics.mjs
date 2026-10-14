import { writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const base = process.env.UNTANGLE_BASE_URL;
const out = process.env.UNTANGLE_OUT;
const paths = ["/courses/ZZZZ/9999", "/courses/CSCE/3010", "/courses/%25/1030", "/instructors/123"];
const results = [];
const browser = await chromium.launch();
try {
  for (const [index, path] of paths.entries()) {
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    const html = await response.text();
    const page = await browser.newPage();
    const errors = [];
    const documents = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (reply) => {
      if (reply.request().resourceType() === "document") documents.push({ url: reply.url(), status: reply.status() });
    });
    await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    const settledUrl = page.url();
    let redirected = null;
    if (path.startsWith("/instructors/")) {
      redirected = await page.waitForURL("**/courses", { timeout: 10000 }).then(() => true, () => false);
    }
    results.push({
      path,
      httpStatus: response.status,
      location: response.headers.get("location"),
      htmlHas404: /404|NEXT_HTTP_ERROR_FALLBACK/.test(html),
      htmlHasRedirect: /NEXT_REDIRECT|http-equiv="refresh"/.test(html),
      settledUrl,
      finalUrl: page.url(),
      redirectedWithin10Seconds: redirected,
      title: await page.title(),
      bodyText: (await page.locator("body").innerText()).slice(0, 2000),
      robots: await page.locator('meta[name="robots"]').evaluateAll((elements) => elements.map((element) => element.content)),
      documents,
      errors,
    });
    writeFileSync(join(out, `route-${index}.html`), html);
    await page.screenshot({ path: join(out, `route-${index}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "route-diagnostics.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
const sectionsResponse = await fetch(`${base}/api/sections/spring-2027/MATH/1720`);
const sections = { httpStatus: sectionsResponse.status, body: await sectionsResponse.json() };
writeFileSync(join(out, "section-diagnostics.json"), `${JSON.stringify(sections, null, 2)}\n`);
console.log(JSON.stringify(sections, null, 2));
