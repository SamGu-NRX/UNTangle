import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { buildDegreeData, toGeneratedModuleSource } from "../src/degree/build";

/**
 * The routes serve the committed generated module, so a rebuild of the same
 * committed catalog pages must reproduce both committed artifacts
 * byte-for-byte. The rebuild pins builtAt to the committed value — the only
 * non-derived field — so any drift between the catalog pages, the derivation,
 * and either committed file fails here; a rebuild is the only fix.
 */
describe("generated degree data freshness", () => {
  test("committed programs.json and programs.generated.ts match a rebuild", () => {
    const dataDir = path.resolve(import.meta.dir, "../data/catalog/unt-2026-27");
    const committedJson = readFileSync(path.resolve(import.meta.dir, "../data/degree/programs.json"), "utf8");
    const committedModule = readFileSync(
      path.resolve(import.meta.dir, "../../../frontend/src/lib/degree/programs.generated.ts"),
      "utf8",
    );
    const builtAt = (JSON.parse(committedJson) as { builtAt: string }).builtAt;
    const rebuilt = buildDegreeData(dataDir, builtAt);
    expect(JSON.stringify(rebuilt, null, 2) + "\n").toBe(committedJson);
    expect(toGeneratedModuleSource(rebuilt)).toBe(committedModule);
  });
});
