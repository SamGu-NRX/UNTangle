// Module resolution for the journeys in this directory. journeys.yml sets
// PLAYWRIGHT_MODULE to the module's own file (.../node_modules/playwright/index.mjs),
// while the README documents the install directory — both forms must resolve.
// Self-check: probe-playwright-module.mjs.
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * The package dir behind an env-provided module path: the directory itself, or
 * the directory containing a file path (the journeys.yml file form).
 */
export function packageDirOf(envPath) {
  if (!envPath) return null;
  try {
    if (statSync(envPath).isDirectory()) return envPath;
  } catch {
    // not on disk — treat it as a file path anyway
  }
  return dirname(envPath);
}

/**
 * Resolve `name` from the journey's own dependency tree, else from an
 * env-provided install directory or entry file.
 */
export function loadModule(name, envPath, parentUrl) {
  const parent = createRequire(parentUrl);
  try {
    return parent(name);
  } catch {
    const dir = packageDirOf(envPath);
    if (dir) return createRequire(join(dir, "package.json"))(name);
    throw new Error(`${name} not found; set PLAYWRIGHT_MODULE / AXE_PATH to its install dir or entry file`);
  }
}
