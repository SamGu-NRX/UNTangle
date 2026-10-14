import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";

const YEAR_2026 = { start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z" };
const FIXTURES = join(import.meta.dir, "fixtures", "directory");
const DIRECTORY = join(import.meta.dir, "../../src/lib/calendar-feeds/directory.json");

/** One directory entry, exactly the shape directory.json stores. */
type DirectoryEntry = {
  name: string;
  url: string;
  category: string;
  lastVerified: string;
  eventCountSeen: number;
};

/** The operator categories the directory must always cover. */
const OPERATOR_CATEGORIES = [
  "university-events",
  "student-organizations",
  "recreation",
  "library",
  "athletics",
  "academic-colleges",
] as const;

function loadDirectory(): DirectoryEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(DIRECTORY, "utf-8"));
  expect(Array.isArray(parsed)).toBe(true);
  return (parsed as DirectoryEntry[]).map((entry) => {
    expect(entry, "every directory entry is an object").toBeObject();
    return entry;
  });
}

/**
 * Fixture files are named by the feed's URL path, so the mapping needs no
 * extra field in directory.json: /calendar.ics -> calendar.ics and
 * /group|department/<slug>/calendar/ics -> <slug>.ics.
 */
function fixtureNameFor(entry: DirectoryEntry): string {
  const path = new URL(entry.url).pathname;
  if (path === "/calendar.ics") return "calendar.ics";
  const match = path.match(/\/(?:group|department)\/([^/]+)\/calendar\/ics$/);
  expect(match, `directory URL does not follow a known feed shape: ${entry.url}`).not.toBeNull();
  return `${match?.[1]}.ics`;
}

test("every directory entry is well formed, with unique names and URLs", () => {
  const entries = loadDirectory();
  expect(entries.length, "the directory keeps at least 15 verified feeds").toBeGreaterThanOrEqual(15);
  const seenNames = new Set<string>();
  const seenUrls = new Set<string>();
  for (const entry of entries) {
    expect(entry.name, "name is a non-empty string").toBeString();
    expect(entry.name.length).toBeGreaterThan(0);
    expect(entry.url, `url is https for ${entry.name}`).toMatch(/^https:\/\//);
    expect(entry.category, `category is a non-empty string for ${entry.name}`).toBeString();
    expect(entry.category.length).toBeGreaterThan(0);
    expect(entry.lastVerified, `lastVerified is YYYY-MM-DD for ${entry.name}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isInteger(entry.eventCountSeen), `eventCountSeen is an integer for ${entry.name}`).toBeTrue();
    expect(entry.eventCountSeen, `eventCountSeen is positive for ${entry.name}`).toBeGreaterThan(0);
    expect(seenNames.has(entry.name), `duplicate name ${entry.name}`).toBeFalse();
    seenNames.add(entry.name);
    expect(seenUrls.has(entry.url), `duplicate url ${entry.url}`).toBeFalse();
    seenUrls.add(entry.url);
  }
});

test("the directory covers every operator category", () => {
  const entries = loadDirectory();
  const present = new Set(entries.map((entry) => entry.category));
  for (const category of OPERATOR_CATEGORIES) {
    expect(present.has(category), `category ${category} has at least one entry`).toBeTrue();
  }
});

test("every directory entry has a real-content fixture that the parser accepts", () => {
  const entries = loadDirectory();
  for (const entry of entries) {
    const fixturePath = join(FIXTURES, fixtureNameFor(entry));
    expect(existsSync(fixturePath), `fixture is missing for ${entry.name}: ${fixturePath}`).toBeTrue();
    const raw = readFileSync(fixturePath, "utf-8");
    // The parser records events it rejects in `skipped` and keeps going, so a
    // lone surviving event could hide a partial-drop regression. Assert the
    // whole excerpt is accepted: nothing skipped, every VEVENT returned.
    const veventCount = (raw.match(/^BEGIN:VEVENT\r?$/gm) ?? []).length;
    expect(veventCount, `fixture contains real events for ${entry.name}`).toBeGreaterThanOrEqual(1);
    const result = parseCalendarFeed(raw, YEAR_2026);
    expect(result.skipped, `parser skips nothing in the fixture for ${entry.name}`).toHaveLength(0);
    expect(result.events.length, `parser returns every VEVENT in the fixture for ${entry.name}`).toBe(veventCount);
  }
});
