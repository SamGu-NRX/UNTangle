import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendDir = path.join(rootDir, "frontend");

const args = new Set(process.argv.slice(2));
const setupOnly = args.has("--setup-only");
const skipInstall = args.has("--no-install") || process.env.SKIP_INSTALL === "1";

const commandName = process.platform === "win32" ? "bun.cmd" : "bun";

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

function ensureDependencies() {
  if (skipInstall) return;

  // Always install: a pull can add a workspace or a dependency while every
  // node_modules folder already exists, and a frozen install with nothing to
  // do takes about a second.
  run(commandName, ["install", "--frozen-lockfile"], { cwd: rootDir });
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

async function main() {
  ensureDependencies();

  const frontendPort = await chooseFrontendPort();
  const frontendOrigin = `http://localhost:${frontendPort}`;
  const frontendEnvPath = path.join(frontendDir, ".env");

  ensureEnvFile(frontendEnvPath, path.join(frontendDir, ".env.example"));
  setEnvValues(frontendEnvPath, {
    BETTER_AUTH_URL: frontendOrigin,
  });

  log(`frontend: ${frontendOrigin}`);

  if (setupOnly) {
    log("setup complete");
    return;
  }

  ensureFrontendDevLockAvailable();

  const devArgs = ["run", "dev", "--", "-p", String(frontendPort)];
  log(`starting frontend: ${commandName} ${devArgs.join(" ")}`);
  const frontend = spawn(commandName, devArgs, {
    cwd: frontendDir,
    env: {
      ...process.env,
      BETTER_AUTH_URL: frontendOrigin,
    },
    stdio: "inherit",
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down (${signal})`);
    if (!frontend.killed) frontend.kill(signal);
    setTimeout(() => {
      if (!frontend.killed) frontend.kill("SIGTERM");
    }, 2500).unref();
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => shutdown(signal));
  }

  frontend.on("exit", (code) => {
    if (shuttingDown) return;
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
