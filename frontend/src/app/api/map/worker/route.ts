import { withRateLimit } from "@/lib/rate-limit/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

/**
 * Serves MapLibre's web worker from this origin.
 *
 * MapLibre 6 looks for its worker next to its own module file. Once the
 * bundler has renamed and moved that module, the file isn't there, so the map
 * page points MapLibre here instead (setWorkerUrl). The response is the
 * worker exactly as the installed package ships it.
 *
 * The file is found on disk rather than through require.resolve, which the
 * server bundler rewrites. Bun workspaces may install the package in the
 * frontend's node_modules or hoist it to the repository root.
 */
const WORKER_FILE = join("maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const candidates = [
  join(process.cwd(), "node_modules", WORKER_FILE),
  join(process.cwd(), "..", "node_modules", WORKER_FILE),
];

let cached: Promise<string> | null = null;

async function workerSource(): Promise<string> {
  const failures: string[] = [];
  for (const path of candidates) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      failures.push(`${path}: ${(error as Error).message}`);
    }
  }
  throw new Error(`maplibre-gl worker not found. Tried ${failures.join("; ")}`);
}

async function getWorker() {
  try {
    cached ??= workerSource();
    return new Response(await cached, {
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

export const GET = withRateLimit("general", getWorker);
