/**
 * Bundles the extension into dist/ with bun build: one entry per runtime,
 * plus a manifest generated from the host config, the popup page and the
 * web app's fonts.
 * The UNTangle origin is a
 * build-time constant; it defaults to the repo's local dev origin and can be
 * overridden with UNTANGLE_ORIGIN at build time (never through a .env file -
 * bun runs with --no-env-file everywhere).
 */
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLASS_SEARCH_MATCHES, UNTANGLE_ORIGIN } from "../src/config";
const outdir = join(import.meta.dir, "..", "dist");
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
const origin = process.env.UNTANGLE_ORIGIN;
// The web app's self-hosted faces, shared rather than copied into this package.
const fonts = join(import.meta.dir, "..", "..", "frontend", "src", "app", "fonts");
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
  define: {
    // The content script registers DM Sans from these bytes (src/content.ts).
    __DM_SANS_WOFF2__: JSON.stringify(readFileSync(join(fonts, "dm-sans-latin-opsz-normal.woff2")).toString("base64")),
    ...origin === undefined ? {} : { __UNTANGLE_ORIGIN__: JSON.stringify(origin) },
  },
});
if (!bundle.success) {
  // A failed bundle must not look like a built extension: print the logs
  // and stop before anything is copied or reported as built.
  console.error("extension build failed:");
  for (const log of bundle.logs)
    console.error(String(log));
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "manifest.json"), "utf8"));
manifest.content_scripts[0].matches = [...CLASS_SEARCH_MATCHES];
manifest.host_permissions = [`${new URL(origin ?? UNTANGLE_ORIGIN).origin}/*`];
writeFileSync(join(outdir, "manifest.json"), JSON.stringify(manifest, null, 2));
cpSync(join(import.meta.dir, "..", "popup.html"), join(outdir, "popup.html"));
// The panel loads the same faces from the package itself.
for (const file of ["dm-sans-latin-opsz-normal.woff2", "syne-latin-800-normal.woff2", "OFL-DM-Sans.txt", "OFL-Syne.txt"])
  cpSync(join(fonts, file), join(outdir, "fonts", file));
console.log(`extension built into ${outdir}`);
