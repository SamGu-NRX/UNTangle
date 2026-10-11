/**
 * selfcheck — the built-in preflight-only suite.
 *
 * It owns NO application cases: it proves the harness plumbing is healthy by
 * asserting on the running stack itself. When `bun evals/run.ts --suite
 * selfcheck` exits 0, the whole preflight (submodule, native SQLite build,
 * Postgres, migrations, persistence roundtrip, backend, frontend build+start,
 * Playwright) is green and the runner produced a validated scorecard.
 */

import { defineSuite, type SuiteContext } from "../suite-kit";
import { Client } from "pg";
import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

interface RmpLogShape {
  blockedTotal?: unknown;
  blocked?: unknown;
}

function readBlockedTotal(logPath: string): number {
  if (!existsSync(logPath)) return 0;
  const raw = JSON.parse(readFileSync(logPath, "utf8")) as RmpLogShape;
  if (typeof raw.blockedTotal === "number") return raw.blockedTotal;
  if (Array.isArray(raw.blocked)) return raw.blocked.length;
  return 0;
}

export default defineSuite({
  name: "selfcheck",

  describe: () => [
    { id: "preflight-all-green", title: "every stack step passed" },
    { id: "db-roundtrip-persists", title: "a probe row survives a write/read cycle" },
    { id: "frontend-renders", title: "the built frontend serves and renders" },
    { id: "rmp-block-active", title: "the backend's RateMyProfessors requests are blocked and counted" },
  ],

  run: async (caseId, ctx: SuiteContext) => {
    switch (caseId) {
      case "preflight-all-green": {
        const failed = ctx.preflightSteps.filter((s) => s.status !== "pass");
        return {
          status: failed.length === 0 ? "pass" : "fail",
          measured: `${ctx.preflightSteps.length - failed.length}/${ctx.preflightSteps.length} steps green`,
          bar: "every stack step reports pass",
          evidencePath: ctx.runDir,
          note: failed.length > 0 ? `failed/skipped: ${failed.map((s) => s.step).join(", ")}` : undefined,
        };
      }

      case "db-roundtrip-persists": {
        const client = new Client({ connectionString: ctx.databaseUrl });
        try {
          await client.connect();
          await client.query(
            "CREATE TABLE IF NOT EXISTS evals_selfcheck_probe (k text PRIMARY KEY, v text NOT NULL)",
          );
          const key = `selfcheck-${randomBytes(8).toString("hex")}`;
          const value = `v-${randomBytes(16).toString("hex")}`;
          await client.query("INSERT INTO evals_selfcheck_probe (k, v) VALUES ($1, $2)", [key, value]);
          const result = await client.query("SELECT v FROM evals_selfcheck_probe WHERE k = $1", [key]);
          const row: unknown = result.rows[0];
          const readBack =
            typeof row === "object" && row !== null && "v" in row ? ((row as { v: unknown }).v as string) : undefined;
          if (readBack !== value) {
            return { status: "fail", measured: String(readBack), bar: "read-back equals written value" };
          }
          return { status: "pass", measured: key, bar: "read-back equals written value" };
        } finally {
          await client.end().catch(() => undefined);
        }
      }

      case "frontend-renders": {
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          const response = await page.goto(`${ctx.frontendOrigin}/`, { timeout: 60_000 });
          const status = response?.status() ?? 0;
          const body = (await page.textContent("body")) ?? "";
          return {
            status: status === 200 && body.length > 0 ? "pass" : "fail",
            measured: `HTTP ${status}, body ${body.length} chars`,
            bar: "GET / returns 200 with a non-empty rendered body",
            evidencePath: ctx.runDir,
            note: status === 200 && body.length === 0 ? "page rendered an empty body" : undefined,
          };
        } finally {
          await browser.close();
        }
      }

      case "rmp-block-active": {
        // Ask the backend to reach RateMyProfessors through whatever route the
        // pinned backend exposes; the preload must block the outbound fetch and
        // count it. The route's own response (error, empty, or data-shaped) is
        // irrelevant to this case — the counter is the evidence. The pinned
        // backend's GET /api/rmp requires a lastName before it will attempt
        // any outbound search (backend/src/routes/rmp.ts), so the probe
        // includes one; without it the route 400s before fetching anything.
        const before = readBlockedTotal(ctx.blockedRmpLogPath);
        let backendReachable = false;
        try {
          await fetch(`${ctx.backendOrigin}/api/rmp?firstName=Eval&lastName=Probe`, {
            signal: AbortSignal.timeout(10_000),
          });
          backendReachable = true;
        } catch {
          // A timeout/refusal here still counts as "backend attempted the
          // fetch" only if the counter moved; fall through to the counter.
        }
        const after = readBlockedTotal(ctx.blockedRmpLogPath);
        const blocked = after - before;
        return {
          status: blocked >= 1 ? "pass" : "fail",
          measured: blocked,
          bar: "at least one outbound RateMyProfessors request blocked and counted",
          note:
            blocked >= 1
              ? undefined
              : `counter did not move (before=${before}, after=${after}, backendReachable=${backendReachable}) — the preload may be missing from the backend process`,
        };
      }

      default:
        return {
          status: "fail",
          note: `selfcheck does not know case "${caseId}"`,
        };
    }
  },
});
