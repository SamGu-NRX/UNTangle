import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// The root layout's title template appends " · UNTangle" to every child
// title string, so a child that names the product itself reads
// "Print week | UNTangle · UNTangle". A child that must carry the name
// sets { absolute: ... } instead.
// https://github.com/SamGu-NRX/UNTangle/pull/31#discussion_r4259717942
const appDir = join(import.meta.dir, "..", "src", "app");
const rootLayout = join(appDir, "layout.tsx");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return /^(page|layout)\.tsx$/.test(entry.name) && path !== rootLayout ? [path] : [];
  });
}

describe("page titles", () => {
  test("the root template is the only place that adds the product name", () => {
    expect(readFileSync(rootLayout, "utf8")).toContain('template: "%s · UNTangle"');
    const branded = routeFiles(appDir).flatMap((file) => {
      // Template-literal holes (`${id} · …`) would otherwise end the match at their brace.
      const source = readFileSync(file, "utf8").replace(/\$\{[^}]*\}/g, "…");
      // title: "…", title: `…`, and either branch of title: x ? "…" : "…".
      // An object value ({ absolute: … }) bypasses the template, so it may.
      const titles = [...source.matchAll(/\btitle:\s*(?![\s{])([^,}\n]+)/g)].map((match) => match[1]);
      return titles.filter((value) => value.includes("UNTangle")).map((value) => `${relative(appDir, file)}: ${value.trim()}`);
    });
    expect(branded).toEqual([]);
  });
});
