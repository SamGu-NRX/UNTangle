import { describe, expect, test } from "bun:test";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const packages = ["core", "contracts", "sync", "tokens", "ingest"] as const;

// How frontend/ and the packages resolve imports (moduleResolution "bundler").
const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

function typescriptResolves(specifier: string): string | null {
  const containingFile = path.join(import.meta.dir, "importer.ts");
  const { resolvedModule } = ts.resolveModuleName(specifier, containingFile, compilerOptions, ts.sys);
  return resolvedModule ? path.relative(repoRoot, resolvedModule.resolvedFileName) : null;
}

function bunResolves(specifier: string): string | null {
  try {
    return path.relative(repoRoot, Bun.resolveSync(specifier, import.meta.dir));
  } catch {
    return null;
  }
}

describe.each([...packages])("@untangle/%s", (name) => {
  test("exports its index and every src/ module by path, and nothing else", async () => {
    const manifest = await Bun.file(path.join(repoRoot, "packages", name, "package.json")).json();
    expect(manifest.exports).toEqual({ ".": "./src/index.ts", "./*": "./src/*.ts" });
  });

  test("resolves the bare name and a module path to src/ for TypeScript and Bun", () => {
    const index = `packages/${name}/src/index.ts`;
    for (const resolve of [typescriptResolves, bunResolves]) {
      expect(resolve(`@untangle/${name}`)).toBe(index);
      expect(resolve(`@untangle/${name}/index`)).toBe(index);
    }
  });

  test("does not resolve a path that bypasses the export map", () => {
    expect(typescriptResolves(`@untangle/${name}/src/index.ts`)).toBeNull();
    expect(bunResolves(`@untangle/${name}/src/index.ts`)).toBeNull();
  });
});
