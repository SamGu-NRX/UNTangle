import { expect, test } from "bun:test";
import manifest from "../manifest.json";
import { CLASS_SEARCH_MATCHES, isClassSearchUrl } from "../src/config";
test("the manifest pins only mock and reserved class-search hosts", () => {
  expect([...CLASS_SEARCH_MATCHES]).toEqual([
    "http://localhost:4317/class-search",
    "http://localhost:4317/class-search?*",
    "http://localhost:4317/class-search/*",
    "https://class-search.myunt.example.invalid/class-search",
    "https://class-search.myunt.example.invalid/class-search?*",
    "https://class-search.myunt.example.invalid/class-search/*",
    "https://class-search-frame.myunt.example.invalid/class-search",
    "https://class-search-frame.myunt.example.invalid/class-search?*",
    "https://class-search-frame.myunt.example.invalid/class-search/*",
  ]);
  expect(manifest.content_scripts[0].matches).toEqual([...CLASS_SEARCH_MATCHES]);
  expect(manifest.host_permissions).toEqual(["http://127.0.0.1:3217/*"]);
  expect(manifest.permissions).toEqual(["storage", "identity"]);
  for (const denied of ["<all_urls>", "cookies", "history", "webRequest", "webRequestBlocking", "https://*.unt.edu/*"])
    expect(JSON.stringify(manifest)).not.toContain(denied);
  for (const url of ["http://localhost:4317/class-search", "http://localhost:4317/class-search?term=fall", "http://localhost:4317/class-search/results", "http://localhost:4317/class-search/results?term=fall"]) {
    expect(isClassSearchUrl(url)).toBe(true);
    // Every page the extension accepts must also get its content script.
    expect(manifest.content_scripts[0].matches.some((pattern) => chromiumMatches(pattern, url))).toBe(true);
  }
  for (const url of ["https://login.unt.edu/", "https://my.unt.edu/", "http://localhost:4317/transcript", "http://localhost:4317/class-search-evil", "http://localhost:4317/class-searchx", "http://localhost:4317.evil.test/class-search", "https://idp.unt.edu/", "http://localhost:9999/class-search"])
    expect(isClassSearchUrl(url)).toBe(false);
});

/** Chromium's content-script matching: `*` is the only wildcard, and the path part covers the path and the query string. */
function chromiumMatches(pattern: string, raw: string): boolean {
  const url = new URL(raw);
  const pathStart = pattern.indexOf("/", pattern.indexOf("://") + 3);
  const path = pattern.slice(pathStart).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return url.origin === pattern.slice(0, pathStart) && new RegExp(`^${path}$`).test(url.pathname + url.search);
}
