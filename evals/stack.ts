/**
 * stack — starts and stops the whole UNTangle stack for an eval run.
 *
 * Steps (each bounded by a timeout, named on failure, cleaned up by stop()):
 *   target-dir            target checkout exists and is a directory
 *   contract-hash         the HARNESS's own evals/CONTRACT.md is hashed and
 *                         its sha256 recorded in the step detail; the target is
 *                         never required to carry evals/ (decision 685a)
 *   submodule-backend     backend submodule fetched at its pinned SHA
 *   backend-install       backend deps (bun install --frozen-lockfile; the native
 *                         better-sqlite3 addon is built by its install script)
 *   backend-sqlite-build  native SQLite build verified (addon loads in node,
 *                         memory-db roundtrip) + backend `bun run build` (tsc → dist)
 *   postgres-init         fresh cluster under /home/user/work/pgdata-<taskId>
 *                         (never inside the repo)
 *   postgres-start        server on a free 5432x port + createdb untangle
 *   migrations-apply      frontend drizzle migrations via drizzle-kit migrate
 *   db-roundtrip          DATABASE_URL save-then-read-back (persistence gate:
 *                         frontend/src/lib/persistence.ts disables persistence
 *                         when DATABASE_URL is unset)
 *   frontend-install      workspace root bun install (frontend deps)
 *   backend-start         backend up on a free port; RateMyProfessors blocked via
 *                         the rmp-block preload. Primary attempt: bun --preload
 *                         (per harness spec). The backend's better-sqlite3 addon
 *                         crashes Bun (NAPI panic — backend/README.md "Bun
 *                         Notes"), so the fallback start is the backend's
 *                         documented runtime: node + tsx with the same preload
 *                         transpiled to CJS via NODE_OPTIONS=--require. Which
 *                         mode ran is recorded in the step detail.
 *   frontend-build        next build (production). Google-font CSS is pinned via
 *                         NEXT_FONT_GOOGLE_MOCKED_RESPONSES to dodge the flaky
 *                         extensionless-/l/font Turbopack bug
 *                         (vercel/next.js#99114); set UNTANGLE_EVALS_FONT_MODE=live
 *                         to build against live Google Fonts instead.
 *   frontend-start        next start with DATABASE_URL, BETTER_AUTH_URL aligned
 *                         to the app origin, and a fresh random BETTER_AUTH_SECRET
 *   playwright-launch     chromium launches and renders the app's /
 *
 * Hard rules honored here: no .env* file is ever read, written, or copied — all
 * configuration is passed via spawned-process environments with freshly
 * generated random secrets; nothing inside the target checkout's tracked files
 * is modified (backend/ receives only its own generated outputs: node_modules,
 * dist/, and data/untangle.db).
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, openSync, closeSync, writeSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { sha256File, type StackStepRecord } from "./scorecard";

/** The harness checkout's evals/ directory (this file's own location). */
export const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const EXPECTED_BACKEND_PIN = "0a49d4d863161c3b568f6aa6d3da4b4e68637a44";

const PG_BIN = process.env.UNTANGLE_PG_BIN ?? "/usr/lib/postgresql/17/bin";
const PG_PORT_RANGE = { start: 54320, end: 54429 };
const BACKEND_PORT_RANGE = { start: 3950, end: 3999 };
const FRONTEND_PORT_RANGE = { start: 3900, end: 3949 };
const POLL_INTERVAL_MS = 400;

// The exact css2 URLs next/font requests for the app's layout.tsx font imports
// (Syne wght 700;800, DM Sans wght 400;500;600;700, both display=swap).
// Learned empirically via the missing-mock error; see ensureFontMock().
const FONT_CSS_URLS = [
  "https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap",
  "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap",
];
// The UA next/font sends (Google answers it with woff2).
const FONT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36";

export class StackBootError extends Error {
  readonly brokenStep: string;
  readonly steps: StackStepRecord[];
  constructor(brokenStep: string, message: string, steps: StackStepRecord[]) {
    super(message);
    this.name = "StackBootError";
    this.brokenStep = brokenStep;
    this.steps = steps;
  }
}

interface ManagedProc {
  name: string;
  proc: ChildProcess | null;
}

interface StackContext {
  targetDir: string;
  runDir: string;
  steps: StackStepRecord[];
  procs: ManagedProc[];
  pgDataDir: string | null;
  pgPort: number | null;
  backendOrigin: string;
  frontendOrigin: string;
  databaseUrl: string;
  blockedRmpLogPath: string;
  backendStartMode: string;
  stopped: boolean;
}

export interface RunningStack {
  steps: StackStepRecord[];
  runDir: string;
  pgDataDir: string;
  pgPort: number;
  backendPort: number;
  frontendPort: number;
  backendOrigin: string;
  frontendOrigin: string;
  databaseUrl: string;
  blockedRmpLogPath: string;
  /** How the backend was actually started, e.g. "bun-preload" or "node-tsx". */
  backendStartMode: string;
  stop(): Promise<void>;
}

function randomSecret(): string {
  return randomBytes(32).toString("hex");
}

async function getFreePort(start: number, end: number, exclude: ReadonlySet<number>): Promise<number> {
  for (let port = start; port <= end; port += 1) {
    if (exclude.has(port)) continue;
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen({ port, host: "127.0.0.1" }, () => {
        server.close(() => resolve(true));
      });
    });
    if (free) return port;
  }
  throw new Error(`no free port found in range ${start}-${end}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BoundedResult {
  code: number | null;
  timedOut: boolean;
  tail: string;
}

/** Run a subprocess to completion with a hard timeout; output is appended to logPath and kept as a tail. */
async function runBounded(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number; logPath: string },
): Promise<BoundedResult> {
  return new Promise<BoundedResult>((resolve, reject) => {
    let tail = "";
    let timedOut = false;
    let settled = false;

    let fd: number | null = null;
    try {
      fd = openSync(opts.logPath, "a");
    } catch (error) {
      reject(new Error(`could not open step log ${opts.logPath}: ${(error as Error).message}`));
      return;
    }

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const keep = (chunk: Buffer): void => {
      const text = chunk.toString();
      tail = (tail + text).slice(-8000);
      if (fd !== null) {
        try {
          writeSync(fd, text);
        } catch (error) {
          console.error(`[stack] could not append to ${opts.logPath}: ${(error as Error).message}`);
        }
      }
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 5000);
    }, opts.timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSync(fd);
      reject(new Error(`could not spawn ${cmd}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSync(fd);
      resolve({ code, timedOut, tail });
    });
  }).then((result) => {
    if (result.timedOut) {
      throw new Error(`timed out after ${opts.timeoutMs}ms running: ${cmd} ${args.join(" ")}`);
    }
    return result;
  });
}

function spawnDetached(
  name: string,
  ctx: StackContext,
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; logPath: string },
): ChildProcess {
  const fd = openSync(opts.logPath, "a");
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  closeSync(fd);
  ctx.procs.push({ name, proc: child });
  return child;
}

function killProcGroup(proc: ManagedProc, signal: NodeJS.Signals): void {
  if (proc.proc?.pid && proc.proc.exitCode === null && proc.proc.signalCode === null) {
    try {
      process.kill(-proc.proc.pid, signal);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ESRCH") {
        console.error(`[stack] could not signal ${proc.name} (${signal}): ${(error as Error).message}`);
      }
    }
  }
}

async function waitProcsExit(procs: ManagedProc[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const dead = (p: ManagedProc): boolean =>
    p.proc === null || p.proc.exitCode !== null || p.proc.signalCode !== null;
  for (;;) {
    if (procs.every(dead) || Date.now() > deadline) return;
    await sleep(200);
  }
}

async function pollUntil(
  description: string,
  timeoutMs: number,
  probe: () => Promise<boolean>,
  watchProc?: ManagedProc,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (watchProc?.proc && watchProc.proc.exitCode !== null) {
      throw new Error(
        `${description}: process exited early (code ${watchProc.proc.exitCode}, signal ${watchProc.proc.signalCode ?? "none"})`,
      );
    }
    if (await probe()) return;
    if (Date.now() > deadline) {
      throw new Error(`${description}: not healthy within ${timeoutMs}ms`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function backendHealthy(backendOrigin: string): Promise<boolean> {
  try {
    const res = await fetch(`${backendOrigin}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { service?: unknown };
    return body.service === "untangle-backend";
  } catch {
    return false;
  }
}

// node -e probe: the native SQLite addon must open a database and roundtrip a
// row under the Node toolchain the backend actually runs on.
const SQLITE_PROBE_JS =
  "const D=require('better-sqlite3');const d=new D(':memory:');" +
  "d.exec('CREATE TABLE t(x INTEGER)');d.prepare('INSERT INTO t VALUES (42)').run();" +
  "const row=d.prepare('SELECT x FROM t').get();" +
  "if(!row||row.x!==42)throw new Error('sqlite roundtrip mismatch');console.log('ok')";

/**
 * Deterministic Google-font CSS for next/font/google, pinned through Next's own
 * test hook NEXT_FONT_GOOGLE_MOCKED_RESPONSES. A css2 response occasionally
 * carries extensionless /l/font?kit= URLs that crash Turbopack's font module
 * (vercel/next.js#99114 — ~1 in 60 responses), so we fetch until we get a
 * verified extensionful body and pin it; bodies are cached on disk across runs.
 */
async function ensureFontMock(runDir: string): Promise<string> {
  const cacheDir = process.env.UNTANGLE_EVALS_CACHE ?? "/home/user/work/untangle-evals-cache";
  const key = createHash("sha256").update(FONT_CSS_URLS.join("|")).digest("hex").slice(0, 16);
  const cachePath = path.join(cacheDir, `font-mock-${key}.cjs`);
  const mockPath = path.join(runDir, "font-mock.cjs");

  if (existsSync(cachePath)) {
    await writeFile(mockPath, await (await import("node:fs/promises")).readFile(cachePath));
    return mockPath;
  }

  const map: Record<string, string> = {};
  for (const url of FONT_CSS_URLS) {
    let body: string | null = null;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const res = await fetch(url, { headers: { "User-Agent": FONT_UA }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`font css fetch ${url} returned ${res.status}`);
      const candidate = await res.text();
      if (!candidate.includes("/l/font?kit=")) {
        body = candidate;
        break;
      }
      console.error(
        `[stack] font css for ${url} came back with the poisoned extensionless shape (attempt ${attempt}); refetching`,
      );
    }
    if (body === null) {
      throw new Error(`font css for ${url} was poisoned 10 times in a row; refusing to build with it`);
    }
    if (!body.includes(".woff2")) {
      throw new Error(`font css for ${url} has no extensionful .woff2 URLs; refusing to pin it`);
    }
    map[url] = body;
  }
  const contents = `// Generated by evals/stack.ts (NEXT_FONT_GOOGLE_MOCKED_RESPONSES pin).\nmodule.exports = ${JSON.stringify(map, null, 2)};\n`;
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, contents);
  await writeFile(mockPath, contents);
  return mockPath;
}

/**
 * A dir holding a `bunx` shim, prepended to spawned PATHs. Some hosts ship a
 * dangling bunx symlink (or none); the backend's build script invokes `bunx
 * tsc`, and a missing bunx must not fail the harness — `bun x` is equivalent.
 */
function ensureBunxShim(runDir: string): string {
  const binDir = path.join(runDir, "bin");
  const shim = path.join(binDir, "bunx");
  if (!existsSync(shim)) {
    mkdirSync(binDir, { recursive: true });
    writeFileSync(shim, "#!/bin/sh\nexec bun x \"$@\"\n", { mode: 0o755 });
  }
  return binDir;
}

/** Transpile evals/rmp-block.ts to plain CJS for the node --require preload path. */
async function ensureRmpPreloadCjs(harnessDir: string, runDir: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.join(harnessDir, "rmp-block.ts"), "utf8");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const js = transpiler.transformSync(source);
  const outPath = path.join(runDir, "rmp-block.cjs");
  await writeFile(outPath, js);
  return outPath;
}

export interface StartStackOptions {
  targetDir: string;
  /** Evidence/log directory for this run (created if missing). */
  runDir: string;
  /** Stable task id, used to namespace the Postgres data dir. */
  taskId: string;
}

export async function startStack(options: StartStackOptions): Promise<RunningStack> {
  const ctx: StackContext = {
    targetDir: options.targetDir,
    runDir: options.runDir,
    steps: [],
    procs: [],
    pgDataDir: null,
    pgPort: null,
    backendOrigin: "",
    frontendOrigin: "",
    databaseUrl: "",
    blockedRmpLogPath: path.join(options.runDir, "rmp-block.json"),
    backendStartMode: "",
    stopped: false,
  };

  const stepLog = (stepName: string): string => path.join(ctx.runDir, `step-${stepName}.log`);
  const usedPorts = new Set<number>();

  async function step(stepName: string, fn: () => Promise<string>): Promise<void> {
    const t0 = Date.now();
    const logPath = stepLog(stepName);
    try {
      const detail = await fn();
      ctx.steps.push({ step: stepName, status: "pass", durationMs: Date.now() - t0, detail, logPath });
      console.error(`[stack] step ${stepName}: pass (${Date.now() - t0}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.steps.push({ step: stepName, status: "fail", durationMs: Date.now() - t0, detail: message, logPath });
      console.error(`[stack] step ${stepName}: FAIL — ${message}`);
      await stopStack(ctx);
      throw new StackBootError(stepName, `stack step "${stepName}" failed: ${message}`, ctx.steps);
    }
  }

  const backendDir = path.join(ctx.targetDir, "backend");
  const frontendDir = path.join(ctx.targetDir, "frontend");

  await mkdir(ctx.runDir, { recursive: true });
  const shimBinDir = ensureBunxShim(ctx.runDir);
  const pathWithShim = `${shimBinDir}:${process.env.PATH ?? ""}`;

  // --- target-dir + contract-present ----------------------------------------
  await step("target-dir", async () => {
    if (!existsSync(ctx.targetDir)) throw new Error(`target dir does not exist: ${ctx.targetDir}`);
    const st = await stat(ctx.targetDir);
    if (!st.isDirectory()) throw new Error(`target dir is not a directory: ${ctx.targetDir}`);
    return ctx.targetDir;
  });

  // --- contract: the harness's own doc, hashed -------------------------------
  await step("contract-hash", async () => {
    // Decision 685a: nothing may require evals/ inside the TARGET checkout —
    // baseline targets are application states that do not carry evals/ at
    // all. The contract doc belongs to the HARNESS, so this step hashes the
    // harness's own evals/CONTRACT.md (HARNESS_DIR, never the target dir) and
    // records its sha256 in the step detail; a missing harness-side contract
    // is a harness defect, not a target one.
    const contractPath = path.join(HARNESS_DIR, "CONTRACT.md");
    if (!existsSync(contractPath)) {
      throw new Error(
        `harness checkout has no evals/CONTRACT.md (expected at ${contractPath}) — harness defect, not a target one`,
      );
    }
    const hash = await sha256File(contractPath);
    return `harness evals/CONTRACT.md sha256 ${hash} (${contractPath}); the target is not required to carry evals/`;
  });

  // --- (a) backend submodule at its pinned SHA -------------------------------
  await step("submodule-backend", async () => {
    const gitEnv: NodeJS.ProcessEnv = { ...process.env };
    const recordedPin = await (async (): Promise<string | null> => {
      const r = await runBounded("git", ["ls-tree", "HEAD", "backend"], {
        cwd: ctx.targetDir,
        env: gitEnv,
        timeoutMs: 30_000,
        logPath: stepLog("submodule-backend"),
      });
      if (r.code !== 0) return null;
      const sha = r.tail.trim().split(/\s+/)[2];
      return sha ?? null;
    })();
    if (recordedPin === null) {
      throw new Error(`git ls-tree HEAD backend failed — is ${ctx.targetDir} a UNTangle checkout?`);
    }
    if (recordedPin !== EXPECTED_BACKEND_PIN) {
      throw new Error(`backend gitlink is ${recordedPin}, expected pinned ${EXPECTED_BACKEND_PIN}`);
    }

    const backendHead = async (): Promise<string | null> => {
      if (!existsSync(path.join(backendDir, "package.json"))) return null;
      const r = await runBounded("git", ["rev-parse", "HEAD"], {
        cwd: backendDir,
        env: gitEnv,
        timeoutMs: 30_000,
        logPath: stepLog("submodule-backend"),
      });
      return r.code === 0 ? r.tail.trim() || null : null;
    };

    if ((await backendHead()) === EXPECTED_BACKEND_PIN) {
      return `already initialized at pinned SHA ${EXPECTED_BACKEND_PIN}`;
    }

    const upd = await runBounded("git", ["submodule", "update", "--init", "backend"], {
      cwd: ctx.targetDir,
      env: gitEnv,
      timeoutMs: 240_000,
      logPath: stepLog("submodule-backend"),
    });
    if (upd.code !== 0) {
      throw new Error(`git submodule update --init backend failed (code ${upd.code}): ${upd.tail.slice(-600)}`);
    }
    const head = await backendHead();
    if (head !== EXPECTED_BACKEND_PIN) {
      throw new Error(`submodule HEAD is ${head ?? "unknown"} after update, expected ${EXPECTED_BACKEND_PIN}`);
    }
    return `submodule fetched at pinned SHA ${EXPECTED_BACKEND_PIN}`;
  });

  // --- (b) backend install + native SQLite build ------------------------------
  await step("backend-install", async () => {
    const bindingPath = path.join(backendDir, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
    const tsxBin = path.join(backendDir, "node_modules", ".bin", "tsx");
    if (existsSync(bindingPath) && existsSync(tsxBin)) {
      return "cached install present (better-sqlite3 native binding + tsx)";
    }
    const r = await runBounded("bun", ["install", "--frozen-lockfile"], {
      cwd: backendDir,
      env: { ...process.env, PATH: pathWithShim },
      timeoutMs: 600_000,
      logPath: stepLog("backend-install"),
    });
    if (r.code !== 0) {
      throw new Error(`bun install failed in backend (code ${r.code}): ${r.tail.slice(-600)}`);
    }
    if (!existsSync(bindingPath)) {
      throw new Error(
        "better-sqlite3 native binding missing after install (build/Release/better_sqlite3.node); the backend cannot run without its native SQLite build",
      );
    }
    return "bun install --frozen-lockfile; better-sqlite3 native binding present";
  });

  await step("backend-sqlite-build", async () => {
    const probe = await runBounded("node", ["-e", SQLITE_PROBE_JS], {
      cwd: backendDir,
      env: { ...process.env, PATH: pathWithShim },
      timeoutMs: 60_000,
      logPath: stepLog("backend-sqlite-build"),
    });
    if (probe.code !== 0 || !probe.tail.includes("ok")) {
      throw new Error(`native better-sqlite3 addon failed under node: ${probe.tail.slice(-500)}`);
    }
    const build = await runBounded("bun", ["run", "build"], {
      cwd: backendDir,
      env: { ...process.env, PATH: pathWithShim },
      timeoutMs: 300_000,
      logPath: stepLog("backend-sqlite-build"),
    });
    if (build.code !== 0) {
      throw new Error(`backend build (tsc -p tsconfig.json) failed (code ${build.code}): ${build.tail.slice(-600)}`);
    }
    return "native SQLite addon loads in node (memory-db roundtrip ok); backend tsc build emitted dist/";
  });

  // --- (c) postgres: initdb + start + createdb --------------------------------
  const pgBase = path.join("/home/user/work", `pgdata-${options.taskId}`);
  const pgData = path.join(pgBase, `run-${Date.now()}-${process.pid}`);
  if (!path.resolve(pgData).startsWith("/home/user/work/")) {
    throw new Error(`refusing to place pgdata outside /home/user/work: ${pgData}`);
  }
  ctx.pgDataDir = pgData;

  await step("postgres-init", async () => {
    await rm(pgData, { recursive: true, force: true });
    await mkdir(pgBase, { recursive: true });
    const initdb = path.join(PG_BIN, "initdb");
    if (!existsSync(initdb)) {
      throw new Error(
        `initdb not found at ${initdb} — install the PostgreSQL 17 server (sudo apt-get install postgresql-17) or set UNTANGLE_PG_BIN`,
      );
    }
    const r = await runBounded(initdb, ["-D", pgData, "-U", "postgres", "--auth=trust"], {
      cwd: "/home/user/work",
      timeoutMs: 180_000,
      logPath: stepLog("postgres-init"),
    });
    if (r.code !== 0) throw new Error(`initdb failed (code ${r.code}): ${r.tail.slice(-600)}`);
    return `fresh cluster at ${pgData}`;
  });

  await step("postgres-start", async () => {
    const port = await getFreePort(PG_PORT_RANGE.start, PG_PORT_RANGE.end, usedPorts);
    usedPorts.add(port);
    ctx.pgPort = port;
    ctx.databaseUrl = `postgres://postgres@127.0.0.1:${port}/untangle`;
    const pgCtl = path.join(PG_BIN, "pg_ctl");
    const r = await runBounded(
      pgCtl,
      [
        "-D", pgData,
        "-l", path.join(ctx.runDir, "postgres.log"),
        "-o", `-p ${port} -c listen_addresses=127.0.0.1 -k /tmp`,
        "-w", "start",
      ],
      { cwd: "/home/user/work", timeoutMs: 90_000, logPath: stepLog("postgres-start") },
    );
    if (r.code !== 0) throw new Error(`pg_ctl start failed on port ${port} (code ${r.code}): ${r.tail.slice(-600)}`);
    const cdb = await runBounded(
      path.join(PG_BIN, "createdb"),
      ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "untangle"],
      { cwd: "/home/user/work", timeoutMs: 30_000, logPath: stepLog("postgres-start") },
    );
    if (cdb.code !== 0) throw new Error(`createdb untangle failed (code ${cdb.code}): ${cdb.tail.slice(-400)}`);
    return `postgres up on 127.0.0.1:${port}, database untangle created`;
  });

  // --- (d) drizzle migrations ---------------------------------------------------
  await step("migrations-apply", async () => {
    const localBin = path.join(frontendDir, "node_modules", ".bin", "drizzle-kit");
    const cmd = existsSync(localBin) ? localBin : "bunx";
    const args = existsSync(localBin) ? ["migrate"] : ["drizzle-kit", "migrate"];
    const r = await runBounded(cmd, args, {
      cwd: frontendDir,
      env: { ...process.env, DATABASE_URL: ctx.databaseUrl },
      timeoutMs: 180_000,
      logPath: stepLog("migrations-apply"),
    });
    if (r.code !== 0 || !r.tail.includes("migrations applied")) {
      throw new Error(`drizzle-kit migrate failed (code ${r.code}): ${r.tail.slice(-600)}`);
    }
    return `drizzle migrations applied (${existsSync(localBin) ? "frontend/node_modules/.bin/drizzle-kit" : "bunx drizzle-kit"}) against ${ctx.databaseUrl}`;
  });

  // --- (e) DATABASE_URL save-then-read-back -----------------------------------
  await step("db-roundtrip", async () => {
    const client = new Client({ connectionString: ctx.databaseUrl });
    try {
      await client.connect();
      await client.query(
        "CREATE TABLE IF NOT EXISTS evals_preflight_probe (k text PRIMARY KEY, v text NOT NULL, at timestamptz NOT NULL DEFAULT now())",
      );
      const key = `roundtrip-${randomBytes(8).toString("hex")}`;
      const value = `saved-${randomBytes(16).toString("hex")}`;
      await client.query("INSERT INTO evals_preflight_probe (k, v) VALUES ($1, $2)", [key, value]);
      const result = await client.query("SELECT v FROM evals_preflight_probe WHERE k = $1", [key]);
      const row: unknown = result.rows[0];
      const readBack =
        typeof row === "object" && row !== null && "v" in row ? ((row as { v: unknown }).v as string) : undefined;
      if (readBack !== value) {
        throw new Error(`save-then-read-back mismatch: wrote ${value}, read ${String(readBack)}`);
      }
      return `probe row ${key} written and read back via DATABASE_URL (persistence gate satisfied)`;
    } finally {
      await client.end().catch(() => undefined);
    }
  });

  // --- (f) frontend install, build, start --------------------------------------
  await step("frontend-install", async () => {
    const nextBin = path.join(frontendDir, "node_modules", ".bin", "next");
    const drizzleBin = path.join(frontendDir, "node_modules", ".bin", "drizzle-kit");
    if (existsSync(nextBin) && existsSync(drizzleBin)) {
      return "cached workspace install present (next + drizzle-kit)";
    }
    const r = await runBounded("bun", ["install", "--frozen-lockfile"], {
      cwd: ctx.targetDir,
      timeoutMs: 600_000,
      logPath: stepLog("frontend-install"),
    });
    if (r.code !== 0) throw new Error(`workspace bun install failed (code ${r.code}): ${r.tail.slice(-600)}`);
    return "bun install --frozen-lockfile at workspace root";
  });

  const backendPort = await getFreePort(BACKEND_PORT_RANGE.start, BACKEND_PORT_RANGE.end, usedPorts);
  usedPorts.add(backendPort);
  ctx.backendOrigin = `http://127.0.0.1:${backendPort}`;
  const frontendPort = await getFreePort(FRONTEND_PORT_RANGE.start, FRONTEND_PORT_RANGE.end, usedPorts);
  usedPorts.add(frontendPort);
  ctx.frontendOrigin = `http://localhost:${frontendPort}`;

  const backendEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: pathWithShim,
    PORT: String(backendPort),
    JWT_SECRET: randomSecret(),
    CORS_ALLOWED_ORIGINS: ctx.frontendOrigin,
    UNTANGLE_RMP_BLOCK_LOG: ctx.blockedRmpLogPath,
  };

  await step("backend-start", async () => {
    await rm(ctx.blockedRmpLogPath, { force: true });
    const attempts: string[] = [];

    // Attempt 1 (per harness spec): bun --preload evals/rmp-block.ts <entry>.
    const bunProc = spawnDetached("backend-bun", ctx, process.execPath, ["--preload", path.join(__dirname, "rmp-block.ts"), "src/server.ts"], {
      cwd: backendDir,
      env: backendEnv,
      logPath: path.join(ctx.runDir, "backend-bun-attempt.log"),
    });
    let bunOk = true;
    try {
      await pollUntil("bun --preload backend", 20_000, () => backendHealthy(ctx.backendOrigin), {
        name: "backend-bun",
        proc: bunProc,
      });
    } catch (error) {
      bunOk = false;
      attempts.push(
        `bun --preload attempt failed: ${(error as Error).message} — expected: the backend's better-sqlite3 addon crashes Bun at runtime (backend/README.md "Bun Notes")`,
      );
      killProcGroup({ name: "backend-bun", proc: bunProc }, "SIGKILL");
    }

    if (bunOk) {
      ctx.backendStartMode = "bun-preload";
      return `backend healthy via bun --preload on ${ctx.backendOrigin}`;
    }

    // Attempt 2: the backend's documented runtime — node + tsx — with the same
    // fetch-blocking preload injected through NODE_OPTIONS.
    const cjsPath = await ensureRmpPreloadCjs(__dirname, ctx.runDir);
    const tsxBin = path.join(backendDir, "node_modules", ".bin", "tsx");
    if (!existsSync(tsxBin)) throw new Error(`tsx not found at ${tsxBin} — backend-install did not complete?`);
    const proc = spawnDetached("backend", ctx, tsxBin, ["src/server.ts"], {
      cwd: backendDir,
      env: { ...backendEnv, NODE_OPTIONS: `--require ${cjsPath}` },
      logPath: path.join(ctx.runDir, "backend.log"),
    });
    try {
      await pollUntil("backend (node/tsx)", 45_000, () => backendHealthy(ctx.backendOrigin), { name: "backend", proc });
    } catch (error) {
      throw new Error(
        `backend failed to start under node/tsx too: ${(error as Error).message}. Attempts: ${attempts.join(" | ")}`,
      );
    }
    ctx.backendStartMode = "node-tsx";
    return `backend healthy on ${ctx.backendOrigin} under node/tsx (rmp-block preload via NODE_OPTIONS --require). ${attempts.join(" | ")}`;
  });

  await step("frontend-build", async () => {
    await rm(path.join(frontendDir, ".next"), { recursive: true, force: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BACKEND_URL: ctx.backendOrigin,
      NEXT_PUBLIC_BACKEND_URL: ctx.backendOrigin,
    };
    const fontMode = process.env.UNTANGLE_EVALS_FONT_MODE ?? "pinned";
    if (fontMode === "pinned") {
      env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES = await ensureFontMock(ctx.runDir);
    }
    const r = await runBounded(path.join(frontendDir, "node_modules", ".bin", "next"), ["build"], {
      cwd: frontendDir,
      env,
      timeoutMs: 900_000,
      logPath: stepLog("frontend-build"),
    });
    if (r.code !== 0) {
      throw new Error(`next build failed (code ${r.code}, mode production). Last output: ${r.tail.slice(-800)}`);
    }
    return `mode: production-build (next build); fonts: ${fontMode === "pinned" ? "pinned via NEXT_FONT_GOOGLE_MOCKED_RESPONSES (vercel/next.js#99114 workaround)" : "live Google fetch"}`;
  });

  await step("frontend-start", async () => {
    const nextBin = path.join(frontendDir, "node_modules", ".bin", "next");
    const proc = spawnDetached("frontend", ctx, nextBin, ["start", "-p", String(frontendPort)], {
      cwd: frontendDir,
      env: {
        ...process.env,
        DATABASE_URL: ctx.databaseUrl,
        BETTER_AUTH_URL: ctx.frontendOrigin,
        BETTER_AUTH_SECRET: randomSecret(),
        BACKEND_URL: ctx.backendOrigin,
      },
      logPath: path.join(ctx.runDir, "frontend.log"),
    });
    try {
      await pollUntil(
        "frontend next start",
        120_000,
        async () => {
          try {
            const res = await fetch(ctx.frontendOrigin, { signal: AbortSignal.timeout(4000) });
            return res.status === 200;
          } catch {
            return false;
          }
        },
        { name: "frontend", proc },
      );
    } catch (error) {
      throw new Error(`frontend did not serve ${ctx.frontendOrigin}: ${(error as Error).message}`);
    }
    return `frontend serving ${ctx.frontendOrigin} (DATABASE_URL set, BETTER_AUTH_URL aligned to origin, fresh random BETTER_AUTH_SECRET)`;
  });

  // --- (g) playwright chromium launch check -------------------------------------
  await step("playwright-launch", async () => {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const response = await page.goto(`${ctx.frontendOrigin}/`, { timeout: 30_000 });
      if (!response || response.status() !== 200) {
        throw new Error(`chromium loaded ${ctx.frontendOrigin}/ but status was ${response?.status() ?? "none"}`);
      }
      const body = await page.textContent("body");
      if (!body || body.length === 0) throw new Error("chromium rendered an empty body");
      return `chromium (headless) launched and rendered ${ctx.frontendOrigin}/ (body ${body.length} chars)`;
    } finally {
      await browser.close();
    }
  });

  return {
    steps: ctx.steps,
    runDir: ctx.runDir,
    pgDataDir: pgData,
    pgPort: ctx.pgPort ?? 0,
    backendPort,
    frontendPort,
    backendOrigin: ctx.backendOrigin,
    frontendOrigin: ctx.frontendOrigin,
    databaseUrl: ctx.databaseUrl,
    blockedRmpLogPath: ctx.blockedRmpLogPath,
    backendStartMode: ctx.backendStartMode,
    stop: () => stopStack(ctx),
  };
}

async function stopStack(ctx: StackContext): Promise<void> {
  if (ctx.stopped) return;
  ctx.stopped = true;
  for (const proc of ctx.procs) killProcGroup(proc, "SIGTERM");
  await waitProcsExit(ctx.procs, 10_000);
  for (const proc of ctx.procs) killProcGroup(proc, "SIGKILL");
  ctx.procs = [];
  if (ctx.pgDataDir && existsSync(path.join(ctx.pgDataDir, "PG_VERSION"))) {
    const stop = spawnSync(path.join(PG_BIN, "pg_ctl"), ["-D", ctx.pgDataDir, "stop", "-m", "fast"], {
      timeout: 30_000,
      cwd: "/home/user/work",
    });
    if (stop.status !== 0) {
      console.error(`[stack] pg_ctl stop failed: ${stop.stderr?.toString().slice(-300) ?? "unknown error"}`);
    }
    if (process.env.UNTANGLE_EVALS_KEEP_PGDATA !== "1") {
      await rm(ctx.pgDataDir, { recursive: true, force: true }).catch((error: Error) => {
        console.error(`[stack] could not remove ${ctx.pgDataDir}: ${error.message}`);
      });
    }
  }
}

/** Read the blocked-RateMyProfessors counter the preload writes. Missing file = zero blocks so far. */
export function readRmpBlockedCount(logPath: string): { count: number; filePresent: boolean } {
  if (!existsSync(logPath)) return { count: 0, filePresent: false };
  const raw = JSON.parse(readFileSync(logPath, "utf8")) as { blockedTotal?: unknown };
  if (typeof raw.blockedTotal !== "number" || !Number.isInteger(raw.blockedTotal) || raw.blockedTotal < 0) {
    throw new Error(`blocked-RMP log ${logPath} has no integer blockedTotal`);
  }
  return { count: raw.blockedTotal, filePresent: true };
}

/**
 * Fault injection for harness tests and future persistence-faults suites: kill
 * the running Postgres server. mode "sigkill" simulates a server crash;
 * "immediate" uses pg_ctl stop -m immediate.
 */
export function killPostgres(stack: RunningStack, mode: "sigkill" | "immediate" = "sigkill"): void {
  if (mode === "immediate") {
    const stop = spawnSync(path.join(PG_BIN, "pg_ctl"), ["-D", stack.pgDataDir, "stop", "-m", "immediate"], {
      timeout: 30_000,
      cwd: "/home/user/work",
    });
    if (stop.status !== 0) {
      throw new Error(`pg_ctl stop -m immediate failed: ${stop.stderr?.toString().slice(-300) ?? "unknown"}`);
    }
    return;
  }
  const pidFile = path.join(stack.pgDataDir, "postmaster.pid");
  const pid = Number.parseInt(readFileSync(pidFile, "utf8").split("\n")[0] ?? "", 10);
  if (!Number.isInteger(pid)) throw new Error(`could not parse postmaster pid from ${pidFile}`);
  process.kill(pid, "SIGKILL");
}

export function hostOsLabel(): string {
  return `${os.type()} ${os.release()} ${os.arch()}`;
}
