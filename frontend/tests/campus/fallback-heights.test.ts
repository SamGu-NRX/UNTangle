import { describe, expect, test } from "bun:test";
import { FALLBACK_FLOORS } from "@/lib/campus/map-detail/fallback-heights";

describe("FALLBACK_FLOORS", () => {
  test("every entry has a positive integer floor count", () => {
    for (const [code, entry] of Object.entries(FALLBACK_FLOORS)) {
      expect(Number.isInteger(entry.floors), `${code} floors must be an integer`).toBe(true);
      expect(entry.floors, `${code} floors must be positive`).toBeGreaterThan(0);
    }
  });

  test("every entry cites an unt.edu source URL", () => {
    for (const [code, entry] of Object.entries(FALLBACK_FLOORS)) {
      expect(entry.source, `${code} must cite a source`).toBeTruthy();
      expect(entry.source.startsWith("https://"), `${code} source must be https`).toBe(true);
      expect(entry.source, `${code} source must be an unt.edu page`).toMatch(/^https:\/\/[a-z0-9.-]*unt\.edu\//);
    }
  });

  test("every entry has an ISO retrieval date", () => {
    for (const [code, entry] of Object.entries(FALLBACK_FLOORS)) {
      expect(entry.retrieved, `${code} retrieved must be an ISO date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.retrieved)), `${code} retrieved must parse as a date`).toBe(false);
    }
  });
});
