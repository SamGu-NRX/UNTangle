import { describe, expect, test } from "bun:test";
import path from "node:path";
import { ESLint } from "eslint";

const repoRoot = path.resolve(import.meta.dir, "../../..");
// The same config the packages' lint scripts load.
const eslint = new ESLint({ cwd: repoRoot });

/** The rule behind each problem ESLint reports for `code` saved at `file`. */
async function problems(file: string, code: string): Promise<Array<string | null>> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
  return result.messages.map((message) => message.ruleId);
}

const restricted = "no-restricted-imports";
const escapes = "untangle/stay-in-package";

describe("a forbidden import fails lint", () => {
  test.each([
    // core imports no React, Next, Node, Bun, frontend code, data or other package.
    ["packages/core/src/a.ts", 'import { useState } from "react";\nexport const hook = useState;', restricted],
    ["packages/core/src/a.ts", 'import type { ReactNode } from "react";\nexport type Node = ReactNode;', restricted],
    ["packages/core/src/a.ts", 'import { redirect } from "next/navigation";\nexport const go = redirect;', restricted],
    ["packages/core/src/a.ts", 'import "server-only";', restricted],
    ["packages/core/src/a.ts", 'import { readFile } from "node:fs/promises";\nexport const read = readFile;', restricted],
    ["packages/core/src/a.ts", 'import path from "path";\nexport const join = path.join;', restricted],
    ["packages/core/src/a.ts", 'import { file } from "bun";\nexport const open = file;', restricted],
    ["packages/core/src/a.ts", 'import { courses } from "@/lib/seed-data";\nexport const all = courses;', restricted],
    ["packages/sync/src/a.ts", 'import type { PlannerState } from "frontend/src/lib/types";\nexport type S = PlannerState;', restricted],
    ["packages/core/src/a.ts", 'import catalog from "./catalog.json";\nexport const data = catalog;', restricted],
    ["packages/core/src/a.ts", 'import { WriteSchema } from "@untangle/contracts";\nexport const schema = WriteSchema;', restricted],
    ["packages/core/src/a.ts", 'export * from "@untangle/sync/engine";', restricted],
    ["packages/core/src/a.ts", 'import { tokens } from "@untangle/tokens";\nexport const t = tokens;', restricted],
    ["packages/core/src/a.ts", 'import { adapter } from "@untangle/campus/unt";\nexport const a = adapter;', restricted],
    // Relative paths out of the package are caught too.
    ["packages/core/src/deep/a.ts", 'import type { PlannerState } from "../../../../frontend/src/lib/types";\nexport type S = PlannerState;', escapes],
    ["packages/core/src/a.ts", 'import { ids } from "../../contracts/src/ids";\nexport const i = ids;', escapes],
    // Shipped code may not reach into its own package's tests, so a test helper can't route around the rules.
    ["packages/core/src/a.ts", 'export { a } from "../tests/helpers";', escapes],
    // Lazy and CommonJS loading can't dodge the rules.
    ["packages/core/src/a.ts", 'export const lazy = () => import("react");', "no-restricted-syntax"],
    ["packages/core/src/a.ts", 'export const fs = require("fs");', "@typescript-eslint/no-require-imports"],
    // contracts sits below sync, and never touches tokens or ingest.
    ["packages/contracts/src/a.ts", 'import { push } from "@untangle/sync";\nexport const p = push;', restricted],
    ["packages/contracts/src/a.ts", 'import { tokens } from "@untangle/tokens";\nexport const t = tokens;', restricted],
    ["packages/contracts/src/a.ts", 'import { fetchTerm } from "@untangle/ingest/sections";\nexport const f = fetchTerm;', restricted],
    ["packages/contracts/src/a.ts", 'import { useState } from "react";\nexport const hook = useState;', restricted],
    ["packages/contracts/src/a.ts", 'import { createHash } from "node:crypto";\nexport const hash = createHash;', restricted],
    // sync runs on web and native: no Node, no tokens, no ingest.
    ["packages/sync/src/a.ts", 'import { tokens } from "@untangle/tokens";\nexport const t = tokens;', restricted],
    ["packages/sync/src/a.ts", 'import { DatabaseSync } from "node:sqlite";\nexport const db = DatabaseSync;', restricted],
    ["packages/sync/src/a.ts", 'import { fetchTerm } from "@untangle/ingest";\nexport const f = fetchTerm;', restricted],
    // tokens imports nothing from the workspace.
    ["packages/tokens/src/a.ts", 'import { plan } from "@untangle/core/planner";\nexport const p = plan;', restricted],
    // ingest never pulls in client or UI code.
    ["packages/ingest/src/a.ts", 'import { tokens } from "@untangle/tokens";\nexport const t = tokens;', restricted],
    ["packages/ingest/src/a.ts", 'import { push } from "@untangle/sync";\nexport const p = push;', restricted],
    ["packages/ingest/src/a.ts", 'import { useState } from "react";\nexport const hook = useState;', restricted],
    ["packages/ingest/src/a.ts", 'export const lazy = () => import("@untangle/sync");', "no-restricted-syntax"],
    ["packages/ingest/src/a.ts", 'export const lazy = (name: string) => import(name);', "no-restricted-syntax"],
    ["packages/ingest/src/a.ts", 'export const lazy = () => import("../../sync/src/engine");', escapes],
  ])("%s: %s", async (file, code, rule) => {
    expect(await problems(file, code)).toEqual([rule]);
  });
});

describe("an allowed import passes lint", () => {
  test.each([
    ["packages/core/src/planner/a.ts", 'import { model } from "../sections/model";\nexport const m = model;'],
    // A relative path may climb as long as it stays inside the package.
    // Built-in names are matched exactly, so a local module called fs is fine.
    ["packages/core/src/a.ts", 'import { open } from "./fs";\nexport const o = open;'],
    ["packages/contracts/src/a.ts", 'import { z } from "zod";\nimport { plan } from "@untangle/core/planner";\nexport const s = [z, plan];'],
    ["packages/contracts/src/a.ts", 'import { adapter } from "@untangle/campus/unt";\nexport const a = adapter;'],
    ["packages/sync/src/a.ts", 'import { WriteSchema } from "@untangle/contracts/sync";\nimport { plan } from "@untangle/core";\nexport const s = [WriteSchema, plan];'],
    [
      "packages/ingest/src/a.ts",
      'import { readFile } from "node:fs/promises";\nimport { WriteSchema } from "@untangle/contracts";\nexport const s = [readFile, WriteSchema];\nexport const later = () => import("./publish");',
    ],
    // Tests may reach anything: they check the package from outside.
    ["packages/contracts/tests/a.test.ts", 'import type { PlannerState } from "../../../frontend/src/lib/types";\nimport { readFile } from "node:fs/promises";\nexport type S = PlannerState;\nexport const r = readFile;'],
  ])("%s: %s", async (file, code) => {
    expect(await problems(file, code)).toEqual([]);
  });
});
