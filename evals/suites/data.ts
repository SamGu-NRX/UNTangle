/**
 * Data suite — conditional-presence evaluation of the catalog's data claims.
 *
 * Two independent presence checks against the TARGET checkout; a missing
 * artifact is not-applicable and names the path, a present-but-broken
 * artifact is a fail:
 *
 *   data/catalog-certification-counts — when tools/catalog-consistency
 *     exists (script or directory with an entrypoint), run it (cwd = the
 *     target root) and record the certification counts EXACTLY as its JSON
 *     output reports them. Exit code 0 required; a reported failure count
 *     above zero fails the case.
 *
 *   data/provenance-descriptor — when frontend/src/lib/data-provenance.ts
 *     exports an activeDataset descriptor, verify it against the
 *     actually-bundled catalog file: sha256 of the file's utf8 bytes, plus
 *     every claimed count recomputed from the bundle (array -> length,
 *     number -> direct compare). The descriptor is read statically, never
 *     imported, so the harness never pulls the target's dependency graph.
 *
 * Bar values come from evals/bars.json (suite "data"): "exact certification
 * counts, real-term bundle present".
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, SuiteContext } from "../suite-kit";
import {
  artifactCommand,
  extractActiveDataset,
  isDirectory,
  missingPathNote,
  parseJsonObjectFromProcess,
  resolveBundledCatalogPath,
  resolveTargetDir,
  runCaptured,
  verifyDescriptorAgainstBundle,
} from "./optdata-lib";

function isRegularFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

const CONSISTENCY_REL = path.join("tools", "catalog-consistency");
const PROVENANCE_REL = path.join("frontend", "src", "lib", "data-provenance.ts");
const CONSISTENCY_TIMEOUT_MS = 60_000;

function writeEvidence(runDir: string, name: string, payload: unknown): string {
  mkdirSync(runDir, { recursive: true });
  const evidencePath = path.join(runDir, name);
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`);
  return evidencePath;
}

/** Count keys the data suite treats as failure signals when they exceed zero. */
const FAILURE_COUNT_KEYS = ["failures", "inconsistencies", "errors", "violations"];

function countsSummary(counts: Record<string, number>): string {
  return Object.keys(counts)
    .sort()
    .map((key) => `${key}=${counts[key]}`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// data/catalog-certification-counts
// ---------------------------------------------------------------------------

async function runCatalogCertification(ctx: SuiteContext, targetDir: string): Promise<CaseOutcome> {
  const toolPath = path.join(targetDir, CONSISTENCY_REL);
  if (!existsSync(toolPath)) {
    return { status: "not-applicable", note: missingPathNote(targetDir, CONSISTENCY_REL) };
  }
  const isFile = isRegularFile(toolPath);
  if (!isDirectory(toolPath) && !isFile) {
    return { status: "fail", note: `${toolPath} is neither a readable file nor a directory` };
  }

  const command = artifactCommand(toolPath, ["--format", "json"], targetDir);
  if (!command.ok) {
    return {
      status: "fail",
      bar: "certification counts recorded exactly as the tool reports; tool exits 0",
      note: `catalog-consistency present but not runnable: ${command.reason}`.slice(0, 400),
    };
  }

  const run = await runCaptured({ cmd: command.cmd, args: command.args, cwd: command.cwd, timeoutMs: CONSISTENCY_TIMEOUT_MS });
  const payload = parseJsonObjectFromProcess(run.stdout);
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) counts[key] = value;
  }
  const summary = countsSummary(counts);
  const evidencePath = writeEvidence(ctx.runDir, "optdata-catalog-consistency-evidence.json", {
    what: "catalog-consistency execution evidence",
    invocation: command.describe,
    cwd: command.cwd,
    exitCode: run.code,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    stdoutTail: run.stdout.slice(-20_000),
    stderrTail: run.stderr.slice(-20_000),
    recordedCounts: counts,
  });
  const bar = "certification counts recorded exactly as the tool reports; tool exits 0";

  if (run.spawnError !== undefined) {
    return { status: "fail", measured: summary || null, bar, evidencePath, note: `catalog-consistency could not be spawned: ${run.spawnError}`.slice(0, 400) };
  }
  if (run.timedOut) {
    return { status: "fail", measured: summary || null, bar, evidencePath, note: `catalog-consistency did not finish within ${CONSISTENCY_TIMEOUT_MS}ms` };
  }
  if (run.code !== 0) {
    return {
      status: "fail",
      measured: summary || null,
      bar,
      evidencePath,
      note: `catalog-consistency exited ${run.code ?? "with a signal"}; stderr tail: ${run.stderr.slice(-300)}`.slice(0, 400),
    };
  }
  if (Object.keys(counts).length === 0) {
    return {
      status: "fail",
      measured: null,
      bar,
      evidencePath,
      note: `catalog-consistency produced no numeric counts to record; stdout head: ${run.stdout.slice(0, 200)}`.slice(0, 400),
    };
  }
  const reportedFailures = FAILURE_COUNT_KEYS.filter((key) => key in counts && (counts[key] ?? 0) > 0);
  if (reportedFailures.length > 0) {
    return {
      status: "fail",
      measured: summary,
      bar,
      evidencePath,
      note: `the tool reports inconsistencies: ${reportedFailures.map((key) => `${key}=${counts[key]}`).join(", ")}`,
    };
  }
  return {
    status: "pass",
    measured: summary,
    bar,
    evidencePath,
    note: `certification counts recorded verbatim from the tool (exit 0, ${Object.keys(counts).length} numeric fields): ${summary}`,
  };
}

// ---------------------------------------------------------------------------
// data/provenance-descriptor
// ---------------------------------------------------------------------------

function shortHash(hex: string): string {
  return hex.length >= 12 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex;
}

async function runProvenanceDescriptor(ctx: SuiteContext, targetDir: string): Promise<CaseOutcome> {
  const provenancePath = path.join(targetDir, PROVENANCE_REL);
  let sourceText: string;
  try {
    sourceText = readFileSync(provenancePath, "utf8");
  } catch {
    return { status: "not-applicable", note: missingPathNote(targetDir, PROVENANCE_REL) };
  }
  const bar = "activeDataset descriptor matches the actually-bundled catalog data (sha256 + counts)";

  const extracted = extractActiveDataset(sourceText);
  if (!extracted.found) {
    const evidencePath = writeEvidence(ctx.runDir, "optdata-provenance-evidence.json", {
      what: "provenance descriptor verification evidence",
      descriptorFile: provenancePath,
      extraction: extracted,
    });
    return { status: "fail", bar, evidencePath, note: `data-provenance.ts present but unreadable as a descriptor: ${extracted.reason}`.slice(0, 400) };
  }
  const descriptor = extracted.descriptor;

  if (typeof descriptor.file !== "string" || descriptor.file === "") {
    const evidencePath = writeEvidence(ctx.runDir, "optdata-provenance-evidence.json", {
      what: "provenance descriptor verification evidence",
      descriptorFile: provenancePath,
      descriptor,
    });
    return { status: "fail", bar, evidencePath, note: "the descriptor names no bundled file (no `file` string field) — nothing to verify against" };
  }
  if (typeof descriptor.sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(descriptor.sha256)) {
    const evidencePath = writeEvidence(ctx.runDir, "optdata-provenance-evidence.json", {
      what: "provenance descriptor verification evidence",
      descriptorFile: provenancePath,
      descriptor,
    });
    return { status: "fail", bar, evidencePath, note: `the descriptor's sha256 is not a 64-hex digest: ${JSON.stringify(descriptor.sha256 ?? null)}` };
  }

  const resolved = resolveBundledCatalogPath(targetDir, descriptor.file);
  let bundledUtf8: string | null = null;
  if (resolved.path !== null) {
    try {
      bundledUtf8 = readFileSync(resolved.path, "utf8");
    } catch (error) {
      bundledUtf8 = null;
      resolved.tried.push(`${resolved.path} (read failed: ${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const verdict = verifyDescriptorAgainstBundle(descriptor, resolved.path ?? "", bundledUtf8);
  const countsPart = verdict.countChecks
    .map((check) => `${check.key}=${check.expected}${check.ok ? " ok" : ` MISMATCH (${check.actual})`}`)
    .join(", ");
  const measured =
    `sha256 ${shortHash(verdict.hashExpected ?? "")} vs bundled ${verdict.hashActual === null ? "unreadable" : shortHash(verdict.hashActual)}` +
    (countsPart === "" ? "" : `; ${countsPart}`);
  const evidencePath = writeEvidence(ctx.runDir, "optdata-provenance-evidence.json", {
    what: "provenance descriptor verification evidence",
    descriptorFile: provenancePath,
    descriptor,
    bundledPathsTried: resolved.tried,
    verdict,
  });

  if (resolved.path === null || bundledUtf8 === null) {
    return {
      status: "fail",
      measured,
      bar,
      evidencePath,
      note: `the bundled catalog the descriptor names is not readable in the checkout (tried: ${resolved.tried.join("; ")})`.slice(0, 400),
    };
  }
  if (verdict.allOk) {
    return {
      status: "pass",
      measured,
      bar,
      evidencePath,
      note: `descriptor verifies against the bundled file ${resolved.path}: sha256 matches${countsPart === "" ? "" : `, counts verified (${countsPart})`}`,
    };
  }
  const hashPart = verdict.hashOk === false ? `sha256 MISMATCH (descriptor ${shortHash(verdict.hashExpected ?? "")} vs bundled ${shortHash(verdict.hashActual ?? "")})` : "";
  return {
    status: "fail",
    measured,
    bar,
    evidencePath,
    note: [hashPart, ...verdict.countChecks.filter((c) => !c.ok).map((c) => `count ${c.key} MISMATCH (descriptor ${c.expected} vs bundle ${c.actual})`)]
      .filter(Boolean)
      .join("; ")
      .slice(0, 400),
  };
}

// ---------------------------------------------------------------------------
// Suite definition
// ---------------------------------------------------------------------------

export default defineSuite({
  name: "data",
  caseTimeoutMs: 120_000,

  describe: () => [
    { id: "catalog-certification-counts", title: "catalog-consistency certification counts are recorded exactly" },
    { id: "provenance-descriptor", title: "activeDataset descriptor matches the actually-bundled catalog" },
  ],

  run: async (caseId, ctx): Promise<CaseOutcome> => {
    const target = resolveTargetDir(ctx);
    if (!target.ok) {
      return { status: "not-applicable", note: `${target.reason} (infrastructure, not an application result)` };
    }
    switch (caseId) {
      case "catalog-certification-counts":
        return runCatalogCertification(ctx, target.dir);
      case "provenance-descriptor":
        return runProvenanceDescriptor(ctx, target.dir);
      default:
        return { status: "not-applicable", note: `unknown case ${caseId}` };
    }
  },
});
