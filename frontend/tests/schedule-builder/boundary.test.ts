import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * components/schedule-builder/** serves UNTangle and the standalone UNT
 * Schedule Builder (HANDOFF §6), so it may not read UNTangle's stores, the
 * prerequisite engine or the app shell. This is an allowlist: a new import
 * has to be argued into it, rather than slipping past a list of bans.
 */
const ROOT = join(import.meta.dir, "../../src/components/schedule-builder");

type Import = { file: string; specifier: string; typeOnly: boolean };

function importsOf(file: string, source: string): Import[] {
  const out: Import[] = [];
  const pattern = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[3] ?? match[4];
    out.push({ file, specifier, typeOnly: Boolean(match[2]) });
  }
  return out;
}

/** Allowed for values and types. */
const ALLOWED: RegExp[] = [
  /^react$/,
  /^react-dom$/,
  /^\.\/[\w.-]+$/, // this folder only; never ../
  /^@\/components\/ui\/[\w.-]+$/,
  /^@\/lib\/optimizer\//,
  /^@\/lib\/course-colors$/,
  /^@\/lib\/export\/[\w-]+$/,
  /^@\/lib\/planner-ics$/,
  /^@\/lib\/sections\/open-seats$/, // one pure predicate, so search's Open seats matches Auto's
  // Pure: connected calendars' busy time as dated blocks and grid bands. Fetching stays with the host.
  /^@\/lib\/calendar-busy$/,
];
/** Shared data shapes: allowed as `import type` only. */
const TYPES_ONLY: RegExp[] = [/^@\/lib\/sections(\/model)?$/, /^@\/lib\/types$/];

export function violation({ specifier, typeOnly }: Pick<Import, "specifier" | "typeOnly">): string | null {
  if (ALLOWED.some((rule) => rule.test(specifier))) return null;
  if (TYPES_ONLY.some((rule) => rule.test(specifier))) return typeOnly ? null : `${specifier} may only be imported with "import type"`;
  return `${specifier} is outside the builder's allowlist`;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );
}

describe("schedule-builder imports", () => {
  test("every import in the folder is on the allowlist", () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(5);
    const imports = files.flatMap((file) => importsOf(file, readFileSync(file, "utf8")));
    expect(imports.length).toBeGreaterThan(20);
    const bad = imports.flatMap((entry) => {
      const reason = violation(entry);
      return reason ? [`${entry.file.slice(ROOT.length + 1)}: ${reason}`] : [];
    });
    expect(bad).toEqual([]);
  });

  test("the rule catches stores, the prerequisite engine, the shell and escapes", () => {
    for (const specifier of [
      "@/components/planner-provider",
      "@/lib/planner",
      "@/lib/planner-store",
      "@/lib/prereq/engine",
      "@/components/shell/TopBar",
      "@/lib/seed-data",
      "@/lib/sections/client",
      "../shell/shell-context",
      "./nested/../../planner-provider",
    ]) {
      expect(violation({ specifier, typeOnly: false })).not.toBeNull();
    }
    expect(violation({ specifier: "@/lib/sections", typeOnly: false })).toContain("import type");
    expect(violation({ specifier: "@/lib/sections", typeOnly: true })).toBeNull();
  });

  test("the reader sees every import form", () => {
    const found = importsOf("x.ts", `import a from "one";\nimport type { B } from "two";\nexport { c } from "three";\nimport "four";\nconst d = await import("five");`);
    expect(found.map((entry) => [entry.specifier, entry.typeOnly])).toEqual([
      ["one", false],
      ["two", true],
      ["three", false],
      ["four", false],
      ["five", false],
    ]);
  });
});
