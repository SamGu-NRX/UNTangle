import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("raising the threshold excludes weak pairs before deciding ambiguity", () => {
  // Isolate the module because its exported threshold is a constant, not a caller option.
  const directory = mkdtempSync(join(tmpdir(), "instructor-threshold-"));
  const source = new URL("../../src/lib/instructors/", import.meta.url);
  try {
    for (const file of ["fold.ts", "parse.ts"]) {
      copyFileSync(new URL(file, source), join(directory, file));
    }
    const matcher = readFileSync(new URL("match.ts", source), "utf8");
    const raised = matcher.replace(
      "export const CONFIDENCE_THRESHOLD = 0.9;",
      "export const CONFIDENCE_THRESHOLD = 0.95;",
    );
    expect(raised).not.toBe(matcher);
    writeFileSync(join(directory, "match.ts"), raised);
    const script = `
      import { matchInstructor } from ${JSON.stringify(join(directory, "match.ts"))};
      const full = { id: "john", name: "John Smith", firstName: "John", lastName: "Smith" };
      const initial = { id: "j", name: "J Smith", firstName: "J", lastName: "Smith" };
      console.log(JSON.stringify([
        matchInstructor("Smith,John", [full, initial]),
        matchInstructor("Smith,J", [full]),
        matchInstructor("Smith,John P", [{ ...full, firstName: "John Patrick" }]),
      ]));
    `;
    const child = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", script], {
      cwd: directory,
    });
    expect(child.exitCode).toBe(0);
    const [strong, weak, middle] = JSON.parse(child.stdout.toString());
    expect(strong).toEqual({
      candidateId: "john", confidence: 0.95, reason: "matched on surname and first name",
    });
    expect(middle).toEqual({
      candidateId: "john", confidence: 0.95, reason: "matched on surname and first name",
    });
    expect(weak.candidateId).toBeNull();
    expect(weak.confidence).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
