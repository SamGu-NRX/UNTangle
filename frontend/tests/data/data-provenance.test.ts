import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { activeDataset } from "@/lib/data-provenance";

const bundlePath = join(import.meta.dir, "../../src/lib/generated/seed-data.json");

describe("data provenance", () => {
  test("activeDataset.bundleSha256 matches the bundle the app ships", () => {
    const bytes = readFileSync(bundlePath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe(activeDataset.bundleSha256);
  });

  test("the shipped bundle is the synthetic sample, not a real term", () => {
    expect(activeDataset.kind).toBe("synthetic-sample");
    expect(activeDataset.term).toBeNull();
    expect(activeDataset.retrievedAt).toBeNull();
  });
});
