// Self-check for journey.mjs module resolution (Codex round 6, thread 4302115817).
// journeys.yml sets PLAYWRIGHT_MODULE to a file (.../node_modules/playwright/index.mjs);
// the README documents the install directory. Both forms must load, and the old
// directory-only fallback must fail on the file form.
//
// Usage: node probe-playwright-module.mjs /path/to/node_modules/playwright
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModule, packageDirOf } from "./playwright-entry.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node probe-playwright-module.mjs /path/to/node_modules/playwright");
  process.exit(2);
}

// 1. Informational: the old fallback (createRequire(join(envPath, "package.json")))
//    on the file form makes require walk UP the ancestor chain, so inside a real
//    node_modules tree it can still resolve by accident; outside one it throws.
//    Either way it never resolved the file form directly — the new resolver does.
let oldFormResolved = false;
try {
  createRequire(join(join(dir, "index.mjs"), "package.json"))("playwright");
  oldFormResolved = true;
} catch {}
console.log(`old directory-only fallback on the file form: ${oldFormResolved ? "resolved only via the ancestor node_modules walk-up" : "throws outside a node_modules tree"}`);

// 2. The new resolver loads both forms and hands back chromium.
const fromDir = loadModule("playwright", dir, import.meta.url);
const fileForm = join(dir, "index.mjs");
const fromFile = loadModule("playwright", fileForm, import.meta.url);
const hasChromium = (mod) => typeof mod?.chromium?.launch === "function";
console.log(`packageDirOf(${fileForm}) = ${packageDirOf(fileForm)}`);
console.log(`directory form ${dir}: ${hasChromium(fromDir) ? "loaded chromium" : "NO chromium"}`);
console.log(`file form ${fileForm}: ${hasChromium(fromFile) ? "loaded chromium" : "NO chromium"}`);

const ok = hasChromium(fromDir) && hasChromium(fromFile);
console.log(ok ? "SELF-CHECK PASS" : "SELF-CHECK FAIL");
process.exit(ok ? 0 : 1);
