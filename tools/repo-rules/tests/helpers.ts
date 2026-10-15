import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dir, "../../..");

/** A fresh directory for one test, removed by the returned cleanup. */
export function scratchDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "repo-rules-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Writes each file, creating its directories. */
export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(root, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
}

/** A bun test file whose tests pass or throw, so a run's outcome shows which ones ran. */
export function testFile(tests: Array<{ name: string; passes: boolean }>, describeName?: string): string {
  const body = tests
    .map(({ name, passes }) => `  test(${JSON.stringify(name)}, () => { ${passes ? "" : 'throw new Error("ran");'} });`)
    .join("\n");
  return describeName === undefined
    ? `import { test } from "bun:test";\n${body}\n`
    : `import { describe, test } from "bun:test";\ndescribe(${JSON.stringify(describeName)}, () => {\n${body}\n});\n`;
}

/** Runs a command and returns its exit code and combined output. */
export function run(command: string[], cwd: string, env: Record<string, string> = {}): { exitCode: number; output: string } {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode ?? -1, output: `${result.stdout.toString()}${result.stderr.toString()}` };
}
