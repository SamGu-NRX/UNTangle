/**
 * rmp-block — a preload that makes any request to ratemyprofessors.com fail.
 *
 * Loaded into the backend process in one of two ways (both handled by
 * evals/stack.ts, which records which one ran):
 *   - `bun --preload evals/rmp-block.ts <entry>` (primary, per harness spec), or
 *   - node `--require <runDir>/rmp-block.cjs` — the same file passed through
 *     Bun's type-stripping transpiler, used because the backend's better-sqlite3
 *     addon crashes Bun at runtime (NAPI panic), so the backend must run on the
 *     Node toolchain (see backend/README.md, "Bun Notes").
 *
 * The file is intentionally written without import/export statements so the
 * same source works as a Bun preload (require() is available in Bun ESM) and
 * as a node CJS preload after type stripping. It must live in evals/, never in
 * backend/.
 *
 * Behavior: requests to ratemyprofessors.com (any subdomain) are rejected with
 * a distinctive error, the attempt is logged to stderr, and the count is
 * appended to the JSON file named by UNTANGLE_RMP_BLOCK_LOG (written
 * synchronously so the runner can read it even after a hard kill).
 */

const RMP_HOST_SUFFIX = "ratemyprofessors.com";
const LOG_PATH = process.env.UNTANGLE_RMP_BLOCK_LOG ?? "";

interface RmpAttempt {
  url: string;
  at: string;
}

interface RmpBlockState {
  blockedTotal: number;
  attempts: RmpAttempt[];
}

const fs = require("node:fs") as typeof import("node:fs");

function readState(): RmpBlockState {
  if (!LOG_PATH) return { blockedTotal: 0, attempts: [] };
  try {
    const raw = fs.readFileSync(LOG_PATH, "utf8");
    const parsed = JSON.parse(raw) as RmpBlockState;
    if (typeof parsed.blockedTotal !== "number" || !Array.isArray(parsed.attempts)) {
      throw new Error("unexpected shape");
    }
    return parsed;
  } catch (error) {
    // Missing file (first block of the run) is normal; anything else is a
    // harness bug — surface it loudly instead of silently resetting counts.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(
        `[rmp-block] could not read block log ${LOG_PATH}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return { blockedTotal: 0, attempts: [] };
  }
}

/**
 * Stateless record: every block re-reads the log, increments, and writes
 * synchronously. Several processes can carry this preload (the tsx CLI parent
 * and the backend child both see NODE_OPTIONS), so no process may cache state
 * or flush it on exit — a stale writer would clobber another process's count.
 */
function recordBlock(url: string): number {
  if (!LOG_PATH) return 0;
  const state = readState();
  state.blockedTotal += 1;
  state.attempts.push({ url, at: new Date().toISOString() });
  try {
    fs.writeFileSync(LOG_PATH, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error(
      `[rmp-block] could not write block log ${LOG_PATH}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
  return state.blockedTotal;
}

function isRmpUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === RMP_HOST_SUFFIX || host.endsWith(`.${RMP_HOST_SUFFIX}`);
}

const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;

  if (isRmpUrl(url)) {
    const n = recordBlock(url);
    console.error(`[rmp-block] BLOCKED request #${n}: ${url}`);
    throw new Error(
      `[untangle-evals] RateMyProfessors request blocked by eval harness (rmp-block preload): ${url}`,
    );
  }

  return originalFetch(input, init);
}) as typeof fetch;
