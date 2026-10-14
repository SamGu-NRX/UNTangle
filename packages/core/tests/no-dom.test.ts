import { describe, expect, test } from "bun:test";
import path from "node:path";
import ts from "typescript";

const coreDir = path.resolve(import.meta.dir, "..");

/** Compiles one fixture with exactly the options core's tsconfig.json gives its source. */
function diagnosticsUnderCoreConfig(fixture: string) {
  const configPath = path.join(coreDir, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, coreDir, undefined, configPath);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  }
  const file = path.join(import.meta.dir, "fixtures", fixture);
  const program = ts.createProgram({ rootNames: [file], options: parsed.options });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    file: diagnostic.file ? path.relative(coreDir, diagnostic.file.fileName) : null,
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
}

describe("core's tsconfig", () => {
  test("compiles code that uses only the ES2023 library", () => {
    expect(diagnosticsUnderCoreConfig("es2023-only.ts")).toEqual([]);
  });

  test.each([
    ["uses-window.ts", "window"],
    ["uses-local-storage.ts", "localStorage"],
    ["uses-fetch.ts", "fetch"],
  ])("rejects %s, because %s is not declared", (fixture, name) => {
    expect(diagnosticsUnderCoreConfig(fixture)).toEqual([
      { file: `tests/fixtures/${fixture}`, code: 2304, message: `Cannot find name '${name}'.` },
    ]);
  });
});
