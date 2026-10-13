# Build a campus walking kit

Run the kit from the repository root with Bun. The campus definition supplies the extract bounds, Overpass query, catalogue source, geocode context, and name-cleanup words.

```sh
bun --no-env-file tools/campus-geodata/kit.ts tools/campus-geodata/campuses/unt-denton.json
bun --no-env-file tools/campus-geodata/kit.ts tools/campus-geodata/campuses/ut-austin.json
```

If the raw inputs are missing, add `--fetch`. The kit caches the response in the git-ignored `raw/` directory. It never refreshes an existing cache implicitly. A fetch sends one combined query, with a descriptive User-Agent, and tries at most two endpoints. A failed fetch throws an error. There are no paid or keyed services in the build.

Run extraction and Next.js builds under the host's heavy-work lease. Keep at least 8 GiB free.

```sh
lease_id=$(~/.long-run/bin/lr-lease acquire --run untangle-campus-kit --kind heavy --est-mem 3 --est-disk 1 --ttl 60 --owner-pid $$) || exit $?
trap '~/.long-run/bin/lr-lease release "$lease_id"' EXIT
lockf -k ~/.long-run/locks/heavy.lock bun --no-env-file tools/campus-geodata/kit.ts tools/campus-geodata/campuses/ut-austin.json --fetch
```

If acquisition exits 75, wait and retry. Do not run the command without a lease.

The kit writes these artifacts to `frontend/src/lib/campus/data/`, or its `ut-austin/` subdirectory:

- `campus-map.json` contains the campus-map-v0 GeoJSON FeatureCollection and directed graph. Both runtime engines read this contract.
- `catalogue.json` contains the selected building names and pins.
- `walking-times.json` contains building anchors, all-pairs seconds and metres, and the speed model.
- `verification.json` contains source queries, input and output hashes, byte counts, connectivity, anchor methods, and data counts. Repeated builds from the same definition and cached input bytes produce identical artifacts, including verification.

For another campus, copy a definition in `campuses/`, set its bbox and `osmQuery`, and choose `catalogue.kind: "osm-names"`. Add `includeOsmIds` to select named OSM building outlines. A selected outline that is missing, outside the bounds, or too far from the connected network fails the build. Without that list, every named, in-bounds, snappable outline enters the catalogue. `catalogue.sources` records the sources of the names and pins. The UNT-only `unt-registry` source preserves its existing facilities catalogue.

Set `nodeMarginDegrees` to include whole-way overshoot, or zero to clip the routing graph at the bbox. The UNT margin remains 0.002 degrees to preserve its original network. Set `geocode` and `nameCleanupWords` for the campus; a generic resolver has no cleanup words by default. Register the resulting catalogue as a `CampusConfig` in `frontend/src/lib/campus/config.ts`, and add its graph and matrix to `engine.ts`.

Pedestrian direction tags determine the allowed directed edges, including `oneway:foot`, `foot:forward`, `foot:backward`, and directional `access`. Conditional or unsupported direction values fail with a specific way/tag error. UNT alone sets `pedestrianDirectionPolicy: "legacy-unt-reciprocal"` to reproduce its historical matrix bytes; new campuses cannot enable that exception. The source decisions are documented in [PROVENANCE.md](PROVENANCE.md).

To inspect UT, open `/map?campus=ut-austin`. The existing map changes its bounds, center, and building labels. The UNT planner remains UNT-specific, so the UT map shows no UNT schedule stops. Test UT lookup and walking routes with `POST /api/map/resolve?campus=ut-austin` and `POST /api/map/route?campus=ut-austin`. Omit the parameter for UNT. Unsupported IDs return an error. UT disables the existing optional keyed runtime fallbacks.

For contract decisions, port provenance, and data limits, read [PROVENANCE.md](PROVENANCE.md). Legacy `data/walkways.json` and `data/buildings.json` remain as historical compatibility fixtures for existing evaluation scripts. The kit does not introduce another public graph format. `build.mjs` extracts the legacy representation only as an internal conversion step; `build-matrix.ts` exports the shared anchor and matrix builder.
