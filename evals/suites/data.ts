/**
 * Data suite — conditional-presence evaluation of the catalog's data claims.
 *
 * Two independent presence checks against the TARGET checkout; a missing
 * artifact is not-applicable and names the path:
 *
 *   data/catalog-certification-counts — when the target carries the REAL
 *     catalog-consistency tools (tools/catalog-consistency/{audit,verify}.mjs)
 *     and its generated catalog (frontend/src/lib/generated/seed-data.json),
 *     the suite drives their REAL interface (decision 685c; the CLIs are the
 *     tools' own, read at the PR #6 head that introduced them):
 *
 *       node tools/catalog-consistency/audit.mjs \
 *         --input frontend/src/lib/generated/seed-data.json --out <runDir>/catalog-audit
 *       node tools/catalog-consistency/verify.mjs \
 *         --results <runDir>/catalog-audit --repo-root <target-root>
 *         (verify.mjs's parser requires --repo-root; audit.mjs's own
 *         "verify with:" hint omits it — the parser is authoritative.)
 *
 *     The case passes only when the audit exits 0 with a parseable
 *     report.json AND verify certifies the evidence chain (exit 0, final
 *     output line `verdict: PASS` — the tool's own verdict semantics: the
 *     committed catalog carries documented findings, and verify certifies
 *     the chain, not zero findings). A nonzero exit, a timeout, or output
 *     that cannot be parsed FAILS the case. Every count the audit reports
 *     is recorded verbatim in measured and evidence.
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
  catalogAuditCommand,
  catalogVerifyCommand,
  collectNumericCounts,
  DATA_AUDIT_REL,
  DATA_VERIFY_REL,
  extractActiveDataset,
  missingPathNote,
  parseVerifyVerdict,
  readJsonObjectFile,
  recognizeDescriptorClaims,
  resolveBundledCatalogPath,
  resolveTargetDir,
  runCaptured,
  SEED_DATA_REL,
  verifyDescriptorAgainstBundle,
  writeEvidence,
} from "./_optdata-lib";

// Two sequential real-tool steps inside one case: each step's wall-clock cap
// leaves headroom under the case cap (the runner applies caseTimeoutMs to the
// whole case run).
const STEP_TIMEOUT_MS = 60_000;
export const CATALOG_CASE_TIMEOUT_MS = 180_000;

/** Counts the audit's report.json carries; rendered into `measured`. */
function reportCounts(report: Record<string, unknown>): { summary: string; counts: Record<string, number> } {
  const sections = [report.counts, report.violations].filter(
    (section): section is Record<string, unknown> => section !== null && typeof section === "object" && !Array.isArray(section),
  );
  const counts: Record<string, number> = {};
  for (const section of sections) {
    for (const [key, value] of Object.entries(collectNumericCounts(section).counts)) {
      counts[key] = value;
    }
  }
  const summary = Object.keys(counts)
    .sort()
    .map((key) => `${key}=${counts[key]}`)
    .join(" ");
  return { summary, counts };
}

// ---------------------------------------------------------------------------
// data/catalog-certification-counts
// ---------------------------------------------------------------------------

async function runCatalogCertification(ctx: SuiteContext, targetDir: string): Promise<CaseOutcome> {
  const required = [DATA_AUDIT_REL, DATA_VERIFY_REL, SEED_DATA_REL];
  const missing = required.filter((rel) => !existsSync(path.join(targetDir, rel)));
  if (missing.length > 0) {
    // Not-applicable ONLY when the target files are absent (decision 685c).
    return {
      status: "not-applicable",
      note: missingPathNote(targetDir, missing[0] ?? "") + (missing.length > 1 ? ` (also missing: ${missing.slice(1).join(", ")})` : ""),
    };
  }

  const bar = "audit exits 0 with parseable report.json, verify certifies the evidence chain (verdict PASS); certification counts recorded exactly";
  const auditOutDir = path.join(ctx.runDir, "catalog-audit");
  const audit = catalogAuditCommand(targetDir, auditOutDir);
  const verify = catalogVerifyCommand(targetDir, auditOutDir);

  const auditRun = await runCaptured({
    cmd: audit.cmd,
    args: audit.args,
    cwd: audit.cwd,
    timeoutMs: STEP_TIMEOUT_MS,
    signal: ctx.signal,
  });
  // The audit's own output contract: report.json under --out (read even on a
  // failing exit, so the evidence carries whatever the tool managed to write).
  const report = auditRun.code === 0 && !auditRun.timedOut && auditRun.spawnError === undefined
    ? readJsonObjectFile(path.join(auditOutDir, "report.json"))
    : undefined;

  // After a cancel, ctx.signal is already aborted, so this returns at once
  // without spawning verify.
  const verifyRun = await runCaptured({
    cmd: verify.cmd,
    args: verify.args,
    cwd: verify.cwd,
    timeoutMs: STEP_TIMEOUT_MS,
    signal: ctx.signal,
  });
  const verifyRan = verifyRun.code !== null && !verifyRun.timedOut && verifyRun.spawnError === undefined;
  const verdict = verifyRan ? parseVerifyVerdict(verifyRun.stdout) : null;

  const { summary } = report !== undefined ? reportCounts(report) : { summary: "" };
  const measured = [summary || "no counts parsed", verdict === null ? "verdict unreadable" : `verify=${verdict}`].join("; ");
  const evidencePath = writeEvidence(ctx.runDir, "optdata-catalog-consistency-evidence.json", {
    what: "catalog-consistency audit + verify execution evidence (decision 685c: the real tools, their real CLIs)",
    audit: {
      invocation: audit.describe,
      cwd: audit.cwd,
      exitCode: auditRun.code,
      timedOut: auditRun.timedOut,
      spawnError: auditRun.spawnError ?? null,
      durationMs: auditRun.durationMs,
      stdoutTail: auditRun.stdout.slice(-20_000),
      stderrTail: auditRun.stderr.slice(-20_000),
      reportParsed: report !== undefined,
    },
    verify: {
      invocation: verify.describe,
      cwd: verify.cwd,
      exitCode: verifyRun.code,
      timedOut: verifyRun.timedOut,
      spawnError: verifyRun.spawnError ?? null,
      durationMs: verifyRun.durationMs,
      stdoutTail: verifyRun.stdout.slice(-20_000),
      stderrTail: verifyRun.stderr.slice(-20_000),
      parsedVerdict: verdict,
    },
  });

  const fail = (note: string): CaseOutcome => ({ status: "fail", measured, bar, evidencePath, note: note.slice(0, 400) });

  if (auditRun.spawnError !== undefined) return fail(`catalog audit could not be spawned: ${auditRun.spawnError}`);
  if (auditRun.timedOut) return fail(`catalog audit did not finish within ${STEP_TIMEOUT_MS}ms`);
  if (auditRun.code !== 0) {
    return fail(`catalog audit exited ${auditRun.code ?? "with a signal"}; stderr tail: ${auditRun.stderr.slice(-300)}`);
  }
  if (report === undefined) {
    return fail(`catalog audit exited 0 but its report.json is missing or unparseable at ${path.join(auditOutDir, "report.json")}`);
  }
  if (verifyRun.spawnError !== undefined) return fail(`catalog verify could not be spawned: ${verifyRun.spawnError}`);
  if (verifyRun.timedOut) return fail(`catalog verify did not finish within ${STEP_TIMEOUT_MS}ms`);
  if (verifyRun.code !== 0) {
    return fail(
      `catalog verify exited ${verifyRun.code ?? "with a signal"}${verdict === null ? "" : ` (verdict: ${verdict})`}; stderr tail: ${verifyRun.stderr.slice(-300)}`,
    );
  }
  if (verdict === null) {
    return fail(`catalog verify's output ends without a "verdict: PASS|FAIL" line (unparseable); stdout tail: ${verifyRun.stdout.slice(-300)}`);
  }
  if (verdict === "FAIL") {
    return fail(`catalog verify reported verdict: FAIL — the evidence chain did not certify (stdout tail: ${verifyRun.stdout.slice(-300)})`);
  }

  return {
    status: "pass",
    measured,
    bar,
    evidencePath,
    note: `audit (${audit.describe}) exited 0 and verify certified the results (verdict: PASS); counts and violations recorded verbatim from report.json: ${summary}`,
  };
}

// ---------------------------------------------------------------------------
// data/provenance-descriptor
// ---------------------------------------------------------------------------

function shortHash(hex: string): string {
  return hex.length >= 12 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex;
}

async function runProvenanceDescriptor(ctx: SuiteContext, targetDir: string): Promise<CaseOutcome> {
  const provenancePath = path.join(targetDir, "frontend", "src", "lib", "data-provenance.ts");
  let sourceText: string;
  try {
    sourceText = readFileSync(provenancePath, "utf8");
  } catch {
    return { status: "not-applicable", note: missingPathNote(targetDir, "frontend/src/lib/data-provenance.ts") };
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
  caseTimeoutMs: CATALOG_CASE_TIMEOUT_MS,

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
