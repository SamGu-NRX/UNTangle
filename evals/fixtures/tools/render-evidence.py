#!/usr/bin/env python3
"""Render visual evidence for campus-routes.json.

Generates one Leaflet HTML page per pair (plus an overview), draws each route
polyline over the rendered openstreetmap.org raster tiles, and screenshots each
page with Playwright (chromium). PNGs land in evals/fixtures/evidence/.

Usage: PLAYWRIGHT_BROWSERS_PATH=/home/user/work/pw-browsers python3 render-evidence.py
Prereq: PLAYWRIGHT_BROWSERS_PATH populated via
  PLAYWRIGHT_BROWSERS_PATH=/home/user/work/pw-browsers bun x playwright install chromium
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.abspath(os.path.join(HERE, ".."))
EVIDENCE = os.path.join(FIXTURES, "evidence")
RENDER_DIR = "/home/user/work/render"
PW_ENV = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/home/user/work/pw-browsers")

HTML_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body { margin: 0; padding: 0; }
  #map { width: 100vw; height: 100vh; }
  #label { position: absolute; z-index: 1000; top: 8px; left: 8px; background: white;
           padding: 6px 10px; font: 14px sans-serif; border-radius: 4px; box-shadow: 0 1px 4px #0006; }
</style>
</head>
<body>
<div id="label"></div>
<div id="map"></div>
<script>
const DATA = %s;
const mode = location.hash.slice(1) || "overview";
const map = L.map("map", { zoomControl: false, attributionControl: true });
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);
function lines(pair) {
  return [pair.geometry.map(p => [p[0], p[1]])];
}
if (mode === "overview") {
  const all = [];
  for (const pair of DATA.pairs) {
    const pts = pair.geometry.map(p => [p[0], p[1]]);
    all.push(pts);
    L.polyline(pts, { color: "#7c4dff", weight: 3, opacity: 0.75 }).addTo(map);
    L.circleMarker(pts[0], { radius: 5, color: "#1a7f37", fillOpacity: 1 }).addTo(map);
    L.circleMarker(pts[pts.length - 1], { radius: 5, color: "#d1242f", fillOpacity: 1 }).addTo(map);
    L.circleMarker([pts[0][0], pts[0][1]], { radius: 1 }).addTo(map);
  }
  for (const b of DATA.buildings) {
    if (b.entrance) {
      L.marker([b.entrance.lat, b.entrance.lng], { opacity: 0.9 })
        .bindTooltip(b.id).addTo(map);
    }
  }
  map.fitBounds(L.latLngBounds(all.flat()).pad(0.08));
  document.getElementById("label").textContent =
    "campus-routes.json — all " + DATA.pairs.length + " measured pairs (green = start, red = end) — map-derived from OpenStreetMap";
} else {
  const pair = DATA.pairs.find(p => p.id === mode);
  if (!pair) { document.getElementById("label").textContent = "unknown pair " + mode; }
  else {
    const pts = pair.geometry.map(p => [p[0], p[1]]);
    const a = DATA.buildings.find(b => b.id === pair.start.buildingId);
    const b = DATA.buildings.find(x => x.id === pair.end.buildingId);
    L.polyline(pts, { color: "#7c4dff", weight: 5, opacity: 0.9 }).addTo(map);
    L.circleMarker(pts[0], { radius: 7, color: "#1a7f37", fillOpacity: 1 })
      .bindTooltip(a.name + " (start)").addTo(map);
    L.circleMarker(pts[pts.length - 1], { radius: 7, color: "#d1242f", fillOpacity: 1 })
      .bindTooltip(b.name + " (end)").addTo(map);
    map.fitBounds(L.latLngBounds(pts).pad(0.15));
    document.getElementById("label").textContent =
      pair.id + "  |  " + a.shortName + " → " + b.shortName +
      "  |  measured " + pair.distanceMeters + " m (great-circle " + pair.greatCircleMeters +
      " m)  |  " + pair.roadCrossings + " road crossing(s), " + pair.stepsSegments +
      " steps segment(s)  |  map-derived, not walked";
  }
}
</script>
</body>
</html>
"""


def main():
    fixture = json.load(open(os.path.join(FIXTURES, "campus-routes.json"), encoding="utf-8"))
    os.makedirs(RENDER_DIR, exist_ok=True)
    os.makedirs(EVIDENCE, exist_ok=True)
    html_path = os.path.join(RENDER_DIR, "campus-routes.html")
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(HTML_TEMPLATE % json.dumps(fixture, ensure_ascii=False))

    env = dict(os.environ, PLAYWRIGHT_BROWSERS_PATH=PW_ENV)
    targets = ["overview"] + [p["id"] for p in fixture["pairs"]]
    for target in targets:
        out = os.path.join(EVIDENCE,
                           "overview-pairs.png" if target == "overview" else f"route-{target}.png")
        url = f"file://{html_path}#{target}"
        cmd = ["bun", "x", "playwright", "screenshot",
               "--viewport-size=1280,900", "--wait-for-timeout=9000", url, out]
        print(f"[render] {target} -> {out}")
        result = subprocess.run(cmd, env=env, cwd="/home/user/work", capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stdout[-500:], result.stderr[-500:])
            sys.exit(f"playwright failed for {target}")
    print(f"[done] {len(targets)} screenshots in {EVIDENCE}")


if __name__ == "__main__":
    main()
