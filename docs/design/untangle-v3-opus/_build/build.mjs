// Inlines base.css and base.js into each page so every mockup is one self-contained file.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "base.css"), "utf8");
const js = readFileSync(join(here, "base.js"), "utf8");
for (const name of readdirSync(join(here, "pages")).filter((f) => f.endsWith(".html"))) {
  const src = readFileSync(join(here, "pages", name), "utf8");
  if (!src.includes("<!--BASE_CSS-->") || !src.includes("<!--BASE_JS-->")) throw new Error(`${name}: missing BASE_CSS or BASE_JS marker`);
  const out = src.replace("<!--BASE_CSS-->", () => `<style>\n${css}</style>`).replace("<!--BASE_JS-->", () => `<script>\n${js}</script>`);
  writeFileSync(join(here, "..", name), out);
  console.log("built", name);
}
