/**
 * Data suite — conditional-presence evaluation of the catalog's data claims.
 *
 * Two independent presence checks against the TARGET checkout; a missing
 * artifact is not-applicable and names the path:
 *
 *   data/catalog-certification-counts — when tools/catalog-consistency
 *     exists, the suite drives ITS interface (package.json script or
 *     entrypoint discovery; no arguments prescribed — see _optdata-lib.ts),
 *     records every numeric field it reports verbatim, and requires exit
 *     code 0. A tool whose output exposes no numeric counts is
 *     not-applicable with the reason (nothing was prescribed for it to
 *     report); a tool that fails to run, or reports failures itself, fails.
 *
 *   data/provenance-descriptor — when frontend/src/lib/data-provenance.ts
 *     contains a statically readable `activeDataset` object literal, the
 *     suite records it verbatim and checks the claims it can recognize in
 *     it: a .json file reference (by field name or value shape), a 64-hex
 *     sha256 digest (whatever the field is called), and count numbers whose
 *     bare keys have counterparts in the bundle (array -> length, number ->
 *     direct compare). A literal with no recognizable verifiable claims is
 *     not-applicable with the reason; a false claim (wrong digest, wrong
 *     count, named bundle missing) fails. The descriptor is read
 *     statically, never imported, so the harness never pulls the target's
 *     dependency graph — and never prescribes its shape.
 *
 * Bar values come from evals/bars.json (suite "data"): "exact certification
 * counts, real-term bundle present".
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, SuiteContext } from "../suite-kit";
import {
  artifactCommand,
  collectNumericCounts,
  extractActiveDataset,
  isDirectory,
  isRegularFile,
  missingPathNote,
  parseJsonObjectFromProcess,
  recognizeDescriptorClaims,
  resolveBundledCatalogPath,
  resolveTargetDir,
  runCaptured,
  verifyDescriptorAgainstBundle,
  writeEvidence,
} from "./_optdata-lib";

const CONSISTENCY_REL = path.join("tools", "catalog-consistency");
const PROVENANCE_REL = path.join("frontend", "src", "lib", "data-provenance.ts");
const CONSISTENCY_TIMEOUT_MS = 60_000;

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

  const command = artifactCommand(toolPath);
  if (!command.ok) {
    // Present, but no real interface could be derived from its own code —
    // not-applicable with that reason, not a fail against an invented shape.
    return {
      status: "not-applicable",
      note: `catalog-consistency is present but its real interface could not be determined: ${command.reason}`.slice(0, 400),
    };
  }

  const run = await runCaptured({ cmd: command.cmd, args: command.args, cwd: command.cwd, timeoutMs: CONSISTENCY_TIMEOUT_MS });
  const payload = parseJsonObjectFromProcess(run.stdout);
  // Counts are whatever numbers the tool reports, wherever it nests them.
  const { counts, nonNumericFields: nonNumeric } = collectNumericCounts(payload ?? {});
  const summary = countsSummary(counts);
  const bar = "certification counts recorded exactly as the tool reports; tool exits 0";
  const evidencePath = writeEvidence(ctx.runDir, "optdata-catalog-consistency-evidence.json", {
    what: "catalog-consistency execution evidence (output recorded verbatim; interpretation is best-effort recognition)",
    invocation: command.describe,
    invocationSource: command.source,
    cwd: command.cwd,
    args: command.args,
    exitCode: run.code,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    stdoutTail: run.stdout.slice(-20_000),
    stderrTail: run.stderr.slice(-20_000),
    recordedCounts: counts,
    nonNumericFields: nonNumeric,
  });

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
      status: "not-applicable",
      note: `catalog-consistency ran (${command.describe}) and exited 0 but reported no numeric counts its output could be read from (non-numeric fields: ${nonNumeric.slice(0, 8).join(", ") || "none"}); stdout recorded verbatim at ${evidencePath} — nothing was prescribed for it to report`.slice(0, 400),
    };
  }
  // Failure signals count wherever the tool nests them: "failures" and
  // "totals.failures" are both failure counts with a positive value.
  const reportedFailures = FAILURE_COUNT_KEYS.flatMap((key) =>
    Object.keys(counts)
      .filter((k) => (k === key || k.endsWith(`.${key}`)) && (counts[k] ?? 0) > 0)
      .map((k) => `${k}=${counts[k]}`),
  );
  if (reportedFailures.length > 0) {
    return {
      status: "fail",
      measured: summary,
      bar,
      evidencePath,
      note: `the tool reports inconsistencies: ${reportedFailures.join(", ")}`,
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
    // The module is present but its activeDataset is not a statically
    // readable object literal — the real interface cannot be determined,
    // so the case is not-applicable with that reason (never a fail for
    // not matching a shape the module never agreed to).
    return {
      status: "not-applicable",
      note: `data-provenance.ts is present but no statically readable activeDataset object literal could be determined: ${extracted.reason} (evidence: ${evidencePath})`.slice(0, 400),
    };
  }
  const descriptor = extracted.descriptor;

  const claims = recognizeDescriptorClaims(descriptor);
  const evidenceBase = {
    what: "provenance descriptor verification evidence (descriptor recorded verbatim; claims recognized, not prescribed)",
    descriptorFile: provenancePath,
    descriptor,
    recognizedClaims: claims,
  };

  if (claims.fileClaim === null) {
    const evidencePath = writeEvidence(ctx.runDir, "optdata-provenance-evidence.json", evidenceBase);
    return {
      status: "not-applicable",
      note: `the activeDataset literal (recorded verbatim at ${evidencePath}) names no bundled file the suite could recognize (no file-like field or .json reference), so there is nothing to verify it against`.slice(0, 400),
    };
  }

  const resolved = resolveBundledCatalogPath(targetDir, claims.fileClaim.value);
  let bundledUtf8: string | null = null;
  if (resolved.path !== null) {
    try {
      bundledUtf8 = readFileSync(resolved.path, "utf8");
    } catch (error) {
      bundledUtf8 = null;
      resolved.tried.push(`${resolved.path} (read failed: ${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const verdict = verifyDescriptorAgainstBundle(claims, resolved.path ?? "", bundledUtf8);
  const countsPart = verdict.countChecks
    .map((check) =>
      check.ok === null
        ? `${check.key}=${check.expected} (recorded, no bundle counterpart)`
        : `${check.key}=${check.expected}${check.ok ? " ok" : ` MISMATCH (${check.actual})`}`,
    )
    .join(", ");
  const measured =
    (verdict.hashExpected === null
      ? "no sha256 claim"
      : `sha256 ${shortHash(verdict.hashExpected)} vs bundled ${verdict.hashActual === null ? "unreadable" : shortHash(verdict.hashActual)}`) +
    (countsPart === "" ? "" : `; ${countsPart}`);
  const evidencePath = writeEvidence(ctx.runDir, "optdata-provenance-evidence.json", {
    ...evidenceBase,
    bundledPathsTried: resolved.tried,
    verdict,
  });

  if (resolved.path === null || bundledUtf8 === null) {
    // The descriptor claims a bundled file that is not there — a false claim.
    return {
      status: "fail",
      measured,
      bar,
      evidencePath,
      note: `the descriptor names ${claims.fileClaim.value} (field ${claims.fileClaim.key}) but that file is not present/readable in the checkout (tried: ${resolved.tried.join("; ")})`.slice(0, 400),
    };
  }
  if (!verdict.anythingChecked) {
    return {
      status: "not-applicable",
      note: `the bundle ${resolved.path} is readable but the descriptor's claims (recorded verbatim at ${evidencePath}) could not be checked: no sha256 claim and no count keys with counterparts in the bundle`.slice(0, 400),
    };
  }
  if (verdict.allCheckedOk) {
    return {
      status: "pass",
      measured,
      bar,
      evidencePath,
      note: `descriptor verifies against the bundled file ${resolved.path}: ${verdict.hashOk === true ? "sha256 matches" : "no sha256 claim"}${countsPart === "" ? "" : `, counts (${countsPart})`}`.slice(0, 400),
    };
  }
  const hashPart = verdict.hashOk === false ? `sha256 MISMATCH (descriptor ${shortHash(verdict.hashExpected ?? "")} vs bundled ${shortHash(verdict.hashActual ?? "")})` : "";
  return {
    status: "fail",
    measured,
    bar,
    evidencePath,
    note: [hashPart, ...verdict.countChecks.filter((c) => c.ok === false).map((c) => `count ${c.key} MISMATCH (descriptor ${c.expected} vs bundle ${c.actual})`)]
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
