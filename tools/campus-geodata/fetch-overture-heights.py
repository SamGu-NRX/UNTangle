#!/usr/bin/env python3
"""
Overture Maps building heights for the UNT map area, keyed by the OSM
element each Overture building came from, into raw/overture-heights-<release>.json.

Around UNT, Overture's footprints are OpenStreetMap's and its heights come
from Microsoft's ML building heights (estimates from imagery). Only heights
whose recorded source is that dataset are kept; the build reads OSM's own
height tags directly. Licence: Overture buildings are ODbL 1.0.

Needs the duckdb Python package (pip install duckdb) and network access to
the public Overture bucket. No key.

Usage: python3 -I tools/campus-geodata/fetch-overture-heights.py 2026-09-23.1
"""
import json
import os
import re
import sys

import duckdb

# The map's pan bounds (campus bounds widened by 0.01 degrees, map-canvas.tsx PAN_MARGIN).
WEST, SOUTH, EAST, NORTH = -97.166, 33.194, -97.129, 33.226
HEIGHT_DATASET = "Microsoft ML Buildings"


def main(release: str) -> None:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+", release):
        raise SystemExit(f'release must look like 2026-09-23.1, not "{release}"')
    con = duckdb.connect()
    for extension in ("httpfs", "spatial"):
        con.execute(f"INSTALL {extension}; LOAD {extension};")
    con.execute("SET s3_region='us-west-2';")
    path = f"s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*"
    rows = con.execute(
        f"""
        SELECT height, to_json(sources) AS sources
        FROM read_parquet('{path}', hive_partitioning=1)
        WHERE bbox.xmin > {WEST} AND bbox.xmax < {EAST} AND bbox.ymin > {SOUTH} AND bbox.ymax < {NORTH}
          AND height IS NOT NULL
        """
    ).fetchall()
    heights = {}
    for height, sources_json in rows:
        sources = json.loads(sources_json)
        osm = next((s["record_id"] for s in sources if s["dataset"] == "OpenStreetMap"), None)
        height_sources = [s["dataset"] for s in sources if s.get("property") == "/properties/height"]
        if osm is None or height_sources != [HEIGHT_DATASET]:
            continue
        match = re.fullmatch(r"([wr])(\d+)@\d+", osm)
        if not match:
            raise SystemExit(f'unexpected OSM record id "{osm}"')
        key = f"{'way' if match.group(1) == 'w' else 'relation'}/{match.group(2)}"
        heights[key] = round(float(height), 1)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw", f"overture-heights-{release}.json")
    doc = {
        "meta": {
            "source": f"Overture Maps Foundation, buildings theme, release {release} ({path})",
            "licence": "ODbL 1.0 (https://docs.overturemaps.org/attribution/)",
            "heightDataset": HEIGHT_DATASET,
            "bbox": {"west": WEST, "south": SOUTH, "east": EAST, "north": NORTH},
            "count": len(heights),
        },
        "heights": dict(sorted(heights.items())),
    }
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=1)
        handle.write("\n")
    print(f"{len(heights)} heights -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
