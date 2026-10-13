#!/usr/bin/env node
// Renders the app icons (manifest 192/512, maskable 512, apple-touch 180,
// and the 64px tab icon that Next serves from app/icon.png):
// the wordmark's "U" in Syne 800, white on brand green, full bleed. The
// glyph sits inside the central 60%, so the maskable safe zone (80% circle)
// never clips it. Run from a directory with playwright installed:
//   node make-icons.mjs <frontend/public/icons dir> <frontend/src/app dir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [outDir, appDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const html = (size) => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@800&display=block" rel="stylesheet">
<style>
  html,body{margin:0;width:${size}px;height:${size}px;background:#00512b}
  body{display:grid;place-items:center}
  span{font:800 ${Math.round(size * 0.62)}px/1 "Syne";color:#fff;transform:translateY(-2%)}
</style></head><body><span>U</span></body></html>`;

const browser = await chromium.launch();
try {
  for (const [dir, name, size] of [
    [outDir, "icon-192.png", 192],
    [outDir, "icon-512.png", 512],
    [outDir, "icon-maskable-512.png", 512],
    [outDir, "apple-touch-icon.png", 180],
    [appDir, "icon.png", 64],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(html(size), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(dir, name) });
    await page.close();
  }
} finally {
  await browser.close();
}
