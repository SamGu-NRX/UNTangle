import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

export const runtime = "nodejs";

/**
 * Serves MapLibre's web worker from this origin.
 *
 * MapLibre 6 looks for its worker next to its own module file. Once the
 * bundler has renamed and moved that module, the file isn't there, so the map
 * page points MapLibre here instead (setWorkerUrl). The response is the
 * worker exactly as the installed package ships it.
 */
const require = createRequire(import.meta.url);
let cached: Promise<string> | null = null;

function workerSource() {
  cached ??= readFile(require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs"), "utf8");
  return cached;
}

export async function GET() {
  try {
    return new Response(await workerSource(), {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        // The page requests this with ?v=<maplibre version>, so a new version is a new URL.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    cached = null;
    return new Response(`MapLibre worker unavailable: ${(error as Error).message}`, { status: 500 });
  }
}
