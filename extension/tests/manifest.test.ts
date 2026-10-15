import { expect, test } from "bun:test";
import manifest from "../manifest.json";
import { CLASS_SEARCH_MATCHES, isClassSearchUrl } from "../src/config";
test("the manifest pins only mock and reserved class-search hosts", () => {
  expect([...CLASS_SEARCH_MATCHES]).toEqual(["http://localhost:4317/class-search*", "https://class-search.myunt.example.invalid/*", "https://class-search-frame.myunt.example.invalid/*"]);
  expect(manifest.content_scripts[0].matches).toEqual([...CLASS_SEARCH_MATCHES]);
  expect(manifest.host_permissions).toEqual(["http://127.0.0.1:3217/*"]);
  expect(manifest.permissions).toEqual(["storage", "identity"]);
  for (const denied of ["<all_urls>", "cookies", "history", "webRequest", "webRequestBlocking", "https://*.unt.edu/*"])
    expect(JSON.stringify(manifest)).not.toContain(denied);
  expect(isClassSearchUrl("http://localhost:4317/class-search")).toBe(true);
  for (const url of ["https://login.unt.edu/", "https://my.unt.edu/", "http://localhost:4317/transcript", "http://localhost:4317.evil.test/class-search", "https://idp.unt.edu/", "http://localhost:9999/class-search"])
    expect(isClassSearchUrl(url)).toBe(false);
});
