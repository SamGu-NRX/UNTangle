/**
 * Bundles the extension into dist/ with bun build: one entry per runtime,
 * plus the manifest and popup page copied verbatim. The UNTangle origin is a
 * build-time constant; it defaults to the repo's local dev origin and can be
 * overridden with UNTANGLE_ORIGIN at build time (never through a .env file -
 * bun runs with --no-env-file everywhere).
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const outdir = join(import.meta.dir, "..", "dist");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const origin = process.env.UNTANGLE_ORIGIN;

const bundle = await Bun.build({
  entrypoints: [
    join(import.meta.dir, "..", "src", "background.ts"),
    join(import.meta.dir, "..", "src", "content.ts"),
    join(import.meta.dir, "..", "src", "popup.ts"),
  ],
  outdir,
  target: "browser",
  format: "esm",
  minify: true,
  define: origin === undefined ? {} : { __UNTANGLE_ORIGIN__: JSON.stringify(origin) },
});
if (!bundle.success) {
  // A failed bundle must not look like a built extension: print the logs
  // and stop before anything is copied or reported as built.
  console.error("extension build failed:");
  for (const log of bundle.logs) console.error(String(log));
  process.exit(1);
}

cpSync(join(import.meta.dir, "..", "manifest.json"), join(outdir, "manifest.json"));
cpSync(join(import.meta.dir, "..", "popup.html"), join(outdir, "popup.html"));

console.log(`extension built into ${outdir}`);
