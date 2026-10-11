/**
 * tests for the robots-policy logic that keeps catalog.unt.edu ingestion
 * compliant. These are the checks that must hold before any fetch runs.
 */
import { describe, expect, test } from "bun:test";
import { decodeBytes, effectiveIntervalMs, parseRobots, robotsVerdict } from "./fetch-lib.mjs";

// Shaped like the real catalog.unt.edu robots.txt (\r\n endings, comments,
// three groups, crawl-delay on the wildcard group).
const UNT_ROBOTS =
  "# Oberlin's bot.\r\n" +
  "User-agent: archive.org_bot\r\n" +
  "Disallow: /portfolio.php\r\n" +
  "Disallow: /portfolio_nopop.php\r\n" +
  "Disallow: /ajax/\r\n" +
  "Disallow: /search_advanced.php\r\n" +
  "crawl-delay: 15\r\n" +
  "\r\n" +
  "#Owens Community College\r\n" +
  "User-agent: occ-crawler\r\n" +
  "Disallow: /portfolio.php\r\n" +
  "crawl-delay: 15\r\n" +
  "\r\n" +
  "# Everyone else.\r\n" +
  "User-agent: *\r\n" +
  "Disallow: /portfolio.php\r\n" +
  "Disallow: /portfolio_nopop.php\r\n" +
  "Disallow: /ajax/\r\n" +
  "Disallow: /search_advanced.php\r\n" +
  "crawl-delay: 120";

const OUR_TOKEN = "untangledegreeplanbot";

describe("parseRobots", () => {
  test("applies the wildcard group with its crawl-delay", () => {
    const parsed = parseRobots(UNT_ROBOTS, OUR_TOKEN);
    expect(parsed.crawlDelay).toBe(120);
    expect(parsed.rules).toHaveLength(4);
  });

  test("a group naming our token wins over the wildcard group", () => {
    const withNamed = UNT_ROBOTS + "\r\n\r\nUser-agent: " + OUR_TOKEN + "\r\nDisallow: /private\r\ncrawl-delay: 30";
    const parsed = parseRobots(withNamed, OUR_TOKEN);
    expect(parsed.crawlDelay).toBe(30);
    expect(parsed.rules).toHaveLength(1);
  });

  test("no applicable group yields no rules and no delay", () => {
    const parsed = parseRobots("User-agent: someoneelse\r\nDisallow: /\r\ncrawl-delay: 5", OUR_TOKEN);
    expect(parsed.crawlDelay).toBeNull();
    expect(parsed.rules).toHaveLength(0);
  });

  test("comments and blank lines are ignored", () => {
    const parsed = parseRobots("# hi\r\n\r\nUser-agent: *\r\n# disallow everything? no:\r\nDisallow: /x # trailing\r\n", "any");
    expect(parsed.rules).toEqual([{ type: "disallow", path: "/x" }]);
  });
});

describe("robotsVerdict", () => {
  const parsed = parseRobots(UNT_ROBOTS, OUR_TOKEN);

  test("disallowed paths are refused", () => {
    for (const p of ["/portfolio.php?catoid=40", "/portfolio_nopop.php", "/ajax/search", "/search_advanced.php"]) {
      expect(robotsVerdict(parsed, p).allowed).toBe(false);
    }
  });

  test("published catalog pages are allowed", () => {
    for (const p of ["/", "/content.php?catoid=40&navoid=4657", "/preview_program.php?catoid=40&poid=1", "/robots.txt"]) {
      expect(robotsVerdict(parsed, p).allowed).toBe(true);
    }
  });

  test("an empty Disallow directive does not block everything", () => {
    const emptyDisallow = parseRobots("User-agent: *\r\nDisallow:\r\n", OUR_TOKEN);
    expect(robotsVerdict(emptyDisallow, "/anything").allowed).toBe(true);
  });
});

describe("effectiveIntervalMs", () => {
  test("max(1rps, crawl-delay)", () => {
    expect(effectiveIntervalMs(null)).toBe(1000);
    expect(effectiveIntervalMs(0)).toBe(1000);
    expect(effectiveIntervalMs(15)).toBe(15000);
    expect(effectiveIntervalMs(120)).toBe(120000);
  });
});

describe("decodeBytes", () => {
  test("decodes fetched bytes as text (Uint8Array.toString does NOT)", () => {
    const bytes = new TextEncoder().encode("catoid=40&navoid=4657");
    expect(decodeBytes(bytes)).toContain("catoid=40");
    expect(bytes.toString()).not.toContain("catoid=40"); // the bug this guards against
  });
});
