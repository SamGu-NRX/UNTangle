import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend");

const args = new Set(process.argv.slice(2));
const setupOnly = args.has("--setup-only");
const skipInstall = args.has("--no-install") || process.env.SKIP_INSTALL === "1";
const skipSeed = args.has("--no-seed") || process.env.SKIP_SEED === "1";

const commandName = process.platform === "win32" ? "bun.cmd" : "bun";
const nodeName = process.platform === "win32" ? "node.exe" : "node";
const npmName = process.platform === "win32" ? "npm.cmd" : "npm";

function log(message) {
  console.log(`[dev] ${message}`);
}

function run(command, args, options = {}) {
  log(`${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: options.env ?? process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureSubmodule() {
  if (fs.existsSync(path.join(backendDir, "package.json"))) return;
  run("git", ["submodule", "update", "--init", "--recursive"], { cwd: rootDir });
}

function ensureDependencies() {
  if (skipInstall) return;

  if (!fs.existsSync(path.join(rootDir, "node_modules")) || !fs.existsSync(path.join(frontendDir, "node_modules"))) {
    run(commandName, ["install", "--frozen-lockfile"], { cwd: rootDir });
  }

  if (!fs.existsSync(path.join(backendDir, "node_modules"))) {
    run(commandName, ["install", "--frozen-lockfile"], { cwd: backendDir });
  }
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function ensureEnvFile(filePath, examplePath) {
  if (fs.existsSync(filePath)) return;
  const initial = fs.existsSync(examplePath) ? readText(examplePath) : "";
  fs.writeFileSync(filePath, initial.endsWith("\n") || initial.length === 0 ? initial : `${initial}\n`);
  log(`created ${path.relative(rootDir, filePath)}`);
}

function setEnvValues(filePath, values) {
  const lines = readText(filePath).split(/\r?\n/);
  const remaining = new Map(Object.entries(values).filter(([, value]) => value !== undefined));
  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1]);
    remaining.delete(match[1]);
    return `${match[1]}=${value}`;
  });

  for (const [key, value] of remaining) {
    next.push(`${key}=${value}`);
  }

  fs.writeFileSync(filePath, `${next.filter((line, index) => line.length > 0 || index < next.length - 1).join("\n")}\n`);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

async function isUsableBackend(port) {
  try {
    const health = await fetch(`http://localhost:${port}/api/health`);
    if (!health.ok) return false;
    const body = await health.json();
    if (body?.service !== "untangle-backend") return false;

    const grades = await fetch(`http://localhost:${port}/api/grades/search?q=PSCI`);
    return grades.ok;
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parsePort(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function chooseFrontendPort() {
  const requested = process.env.FRONTEND_PORT ? [parsePort(process.env.FRONTEND_PORT, 3000)] : [];
  const candidates = unique([...requested, 3000, 3001, 3002, 3003, 3004, 3010]);

  for (const port of candidates) {
    if (await isPortFree(port)) return port;
  }

  throw new Error(`No available frontend port found in ${candidates.join(", ")}`);
}

async function chooseBackend(frontendPort) {
  const requested = process.env.BACKEND_PORT ? [parsePort(process.env.BACKEND_PORT, 3001)] : [];
  const candidates = unique([...requested, 3001, 3011, 3002, 3012, 3003, 3013]);

  for (const port of candidates) {
    if (port === frontendPort) continue;
    if (await isUsableBackend(port)) return { port, reuse: true };
    if (await isPortFree(port)) return { port, reuse: false };
  }

  throw new Error(`No available backend port found in ${candidates.join(", ")}`);
}

function ensureBetterSqlite() {
  const result = spawnSync(nodeName, ["-e", "require('better-sqlite3')"], {
    cwd: backendDir,
    stdio: "ignore",
  });

  if (result.status === 0) return;
  run(npmName, ["rebuild", "better-sqlite3"], { cwd: backendDir });
}

function dbNeedsSeed(dbPath) {
  if (!fs.existsSync(dbPath)) return true;

  const check = `
    const Database = require("better-sqlite3");
    const db = new Database(process.env.DB_PATH, { readonly: true });
    const table = db.prepare("select name from sqlite_master where type = 'table' and name = 'grade_sections'").get();
    if (!table) process.exit(1);
    const row = db.prepare("select count(*) as count from grade_sections").get();
    process.exit(row.count > 0 ? 0 : 1);
  `;

  const result = spawnSync(nodeName, ["-e", check], {
    cwd: backendDir,
    env: { ...process.env, DB_PATH: dbPath },
    stdio: "ignore",
  });

  return result.status !== 0;
}

function ensureDatabase(dbPath) {
  if (skipSeed) return;

  ensureBetterSqlite();
  if (!dbNeedsSeed(dbPath)) return;
  run(commandName, ["run", "seed"], {
    cwd: backendDir,
    env: { ...process.env, DB_PATH: dbPath },
  });
}

function ensureFrontendDevLockAvailable() {
  const lockPath = path.join(frontendDir, ".next", "dev", "lock");
  if (!fs.existsSync(lockPath)) return;

  const lsof = spawnSync("lsof", [lockPath], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (lsof.status === 0 && lsof.stdout.trim().length > 0) {
    const holder = lsof.stdout
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/).slice(0, 2).join(" "))
      .join(", ");
    throw new Error(
      `frontend/.next/dev/lock is held by ${holder}. Stop the existing Next dev server, then rerun bun dev.`,
    );
  }

  fs.unlinkSync(lockPath);
  log("removed stale frontend/.next/dev/lock");
}

function spawnServer(name, command, args, options) {
  log(`starting ${name}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  return child;
}

async function main() {
  ensureSubmodule();
  ensureDependencies();

  const frontendPort = await chooseFrontendPort();
  const backend = await chooseBackend(frontendPort);
  const frontendOrigin = `http://localhost:${frontendPort}`;
  const backendUrl = `http://localhost:${backend.port}`;
  const backendEnvPath = path.join(backendDir, ".env");
  const frontendEnvPath = path.join(frontendDir, ".env");
  const dbPath = path.join(backendDir, "data", "untangle.db");
  const corsAllowedOrigins = unique([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    frontendOrigin,
    `http://127.0.0.1:${frontendPort}`,
  ]).join(",");

  ensureEnvFile(backendEnvPath, path.join(backendDir, ".env.example"));
  ensureEnvFile(frontendEnvPath, path.join(frontendDir, ".env.example"));

  setEnvValues(backendEnvPath, {
    PORT: String(backend.port),
    DB_PATH: "data/untangle.db",
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
    CAS_SERVICE_URL: `${frontendOrigin}/auth/callback`,
  });
  setEnvValues(frontendEnvPath, {
    BACKEND_URL: backendUrl,
    BETTER_AUTH_URL: frontendOrigin,
  });

  ensureDatabase(dbPath);

  log(`frontend: ${frontendOrigin}`);
  log(`backend:  ${backendUrl}${backend.reuse ? " (already running)" : ""}`);

  if (setupOnly) {
    log("setup complete");
    return;
  }

  ensureFrontendDevLockAvailable();

  const children = [];
  let shuttingDown = false;

  if (!backend.reuse) {
    children.push(
      spawnServer("backend", commandName, ["run", "dev"], {
        cwd: backendDir,
        env: {
          ...process.env,
          PORT: String(backend.port),
          DB_PATH: "data/untangle.db",
          CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
          CAS_SERVICE_URL: `${frontendOrigin}/auth/callback`,
        },
      }),
    );
  }

  children.push(
    spawnServer("frontend", commandName, ["run", "dev", "--", "-p", String(frontendPort)], {
      cwd: frontendDir,
      env: {
        ...process.env,
        BACKEND_URL: backendUrl,
        BETTER_AUTH_URL: frontendOrigin,
      },
    }),
  );

  const shutdown = (signal = "SIGINT") => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down (${signal})`);
    for (const child of children) {
      if (!child.killed) child.kill(signal);
    }
    setTimeout(() => {
      for (const child of children) {
        if (!child.killed) child.kill("SIGTERM");
      }
    }, 2500).unref();
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => shutdown(signal));
  }

  for (const child of children) {
    child.on("exit", (code, signal) => {
      if (shuttingDown) return;
      shutdown(signal ?? "SIGTERM");
      process.exitCode = code === 0 ? 1 : code ?? 1;
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
