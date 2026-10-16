import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PROGRAM_SPECS } from "./derive";
import { readCatalogPage } from "./sections";
import type { CatalogPage } from "./sections";
import type { CourseScope, CourseSlot, DegreeData, OptionGroup, PolicyNode, ProgramData, RequirementNode } from "@untangle/core/degree/types";

// The planner's CatalogId form (packages/contracts/src/ids.ts) for the UNT
// 2026-2027 Undergraduate Catalog, Acalog catoid 40. An academic record names
// its catalog in this form, and the audit route compares the two.
const CATALOG_ID = "unt-2026-27";
const CATALOG_YEAR = "2026-2027";

type ManifestPage = { file: string; url: string; title: string; capturedAt: string; sha256: string };
type Manifest = { source: string; capturedAt: string; pages: ManifestPage[] };

function collectCodes(node: RequirementNode, into: Set<string>): void {
  const optionsOf = (slots: CourseSlot[]): OptionGroup[] => slots.flatMap((slot) => slot.alternatives);
  const addAll = (option: OptionGroup): void => { for (const code of option.must) into.add(code); };
  switch (node.kind) {
    case "all":
    case "choose": for (const option of optionsOf(node.items)) addAll(option); break;
    case "hours": for (const option of node.options) addAll(option); break;
    case "pool": break;
    case "choice": for (const branch of node.branches) collectCodes(branch.node, into); break;
    case "group": for (const child of node.children) collectCodes(child, into); break;
    default: break;
  }
}

/** Courses a program shares with a core area, from the two captured pages alone. */
function coreSharedCourses(coreCodes: Set<string>, requirements: RequirementNode[]): string[] {
  const programCodes = new Set<string>();
  for (const node of requirements) collectCodes(node, programCodes);
  return [...programCodes].filter((code) => coreCodes.has(code)).sort();
}

/** Codes of the first tree node whose name matches, searched depth-first. */
function codesFromNamedNode(nodes: RequirementNode[], pattern: RegExp): string[] {
  for (const node of nodes) {
    if (pattern.test(node.name)) {
      const codes = new Set<string>();
      collectCodes(node, codes);
      if (codes.size > 0) return [...codes].sort();
    }
    if (node.kind === "group") {
      const nested = codesFromNamedNode(node.children, pattern);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

/** A policy's identity: the same name and check parameters is the same rule. */
function policyKey(node: PolicyNode): string {
  const p = node.policy;
  const params = "hours" in p ? String(p.hours) : "minimum" in p ? String(p.minimum) : "percent" in p ? String(p.percent) : "grade" in p ? p.grade : "";
  const scope = "scope" in p ? p.scope : "";
  return `${node.name}|${p.type}|${scope}|${params}`;
}

/**
 * Collapse policies the program and university scans both emit. The first
 * copy wins: program-level rules keep their program citations, and the
 * core's nested Communication floor (beside the area it governs) beats the
 * generic top-level copy.
 */
function dedupePolicies(nodes: RequirementNode[], seen: Set<string> = new Set()): RequirementNode[] {
  const kept: RequirementNode[] = [];
  for (const node of nodes) {
    if (node.kind === "policy") {
      const key = policyKey(node);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(node);
    } else if (node.kind === "group") {
      kept.push({ ...node, children: dedupePolicies(node.children, seen) });
    } else {
      kept.push(node);
    }
  }
  return kept;
}

/**
 * Resolve the catalog's scope wording into typed course scopes. The
 * Communication floor applies to the University Core's Communication area
 * (codes from the core page); the major floor applies to the courses the
 * audit applied to the program's requirements. Any other wording fails the
 * build: an unresolved scope would ship a check that can never run.
 */
function resolveCourseScopes(nodes: RequirementNode[], communicationCodes: string[]): RequirementNode[] {
  const resolve = (scope: string): CourseScope => {
    if (scope === "overall") return { kind: "overall" };
    if (scope === "unt") return { kind: "unt" };
    if (scope === "all courses required in the major") return { kind: "applied" };
    if (scope === "Communication core requirement" && communicationCodes.length > 0) return { kind: "codes", codes: communicationCodes };
    throw new Error(`no course scope resolves the catalog wording "${scope}"`);
  };
  const walk = (list: RequirementNode[]): RequirementNode[] =>
    list.map((node) => {
      if (node.kind === "policy") {
        const p = node.policy;
        if ((p.type === "minGrade" || p.type === "gpa") && p.courseScope === undefined) {
          return { ...node, policy: { ...p, courseScope: resolve(p.scope) } };
        }
        return node;
      }
      if (node.kind === "group") return { ...node, children: walk(node.children) };
      if (node.kind === "choice") return { ...node, branches: node.branches.map((branch) => ({ ...branch, node: walk([branch.node])[0]! })) };
      return node;
    });
  return walk(nodes);
}

export function buildDegreeData(dataDir: string, builtAt: string): DegreeData {
  const manifest: Manifest = JSON.parse(readFileSync(path.join(dataDir, "manifest.json"), "utf8"));
  const pageMap = new Map<string, ManifestPage>(manifest.pages.map((page) => [page.file, page]));
  const loadPage = (file: string): CatalogPage => {
    const entry = pageMap.get(file);
    if (!entry) throw new Error(`catalog page ${file} is not in the manifest`);
    const html = readFileSync(path.join(dataDir, entry.file), "utf8");
    // A page that no longer matches its capture hash means the source under
    // the derivation moved: stop the build instead of deriving from drift.
    const digest = createHash("sha256").update(html, "utf8").digest("hex");
    if (digest !== entry.sha256) {
      throw new Error(`catalog page ${entry.file} does not match its manifest hash: captured ${entry.sha256}, read ${digest}. Recapture the page before rebuilding.`);
    }
    return readCatalogPage(entry.file, entry.url, html);
  };

  const university = loadPage("degree-requirements.html");
  const corePage = loadPage("core-curriculum.html");
  const coreSpec = PROGRAM_SPECS.find((spec) => spec.id === "core")!;
  const coreRequirements = coreSpec.derive(corePage, university);
  const coreCodes = new Set<string>();
  for (const node of coreRequirements) collectCodes(node, coreCodes);
  // The university-wide Communication floor scopes to the core's Communication
  // area; every program resolves it against this one sourced course list.
  const communicationCodes = codesFromNamedNode(coreRequirements, /communication/i);

  const programs: ProgramData[] = PROGRAM_SPECS.filter((spec) => spec.id !== "core").map((spec) => {
    const page = loadPage(spec.file);
    const requirements = resolveCourseScopes(dedupePolicies(spec.derive(page, university)), communicationCodes);
    return {
      id: spec.id,
      name: spec.name,
      catalogId: CATALOG_ID,
      sourceUrl: page.url,
      requirements,
      coreSharedCourses: coreSharedCourses(coreCodes, requirements),
    };
  });

  const coreProgram: ProgramData = {
    id: coreSpec.id,
    name: coreSpec.name,
    catalogId: CATALOG_ID,
    sourceUrl: corePage.url,
    requirements: resolveCourseScopes(dedupePolicies(coreRequirements), communicationCodes),
    coreSharedCourses: [...coreCodes].sort(),
  };

  return {
    catalogId: CATALOG_ID,
    catalogYear: CATALOG_YEAR,
    builtAt,
    pages: manifest.pages.map(({ file, url, title, capturedAt, sha256 }) => ({ file, url, title, capturedAt, sha256 })),
    programs: [...programs, coreProgram],
  };
}

// The frontend module is a byte-exact serialization of the same data: the
// routes import DEGREE_DATA from it, so it must be written by the same build
// that writes programs.json. degree-data.generated.test.ts fails when either
// committed file drifts from this serialization.
export function toGeneratedModuleSource(data: DegreeData): string {
  const header = [
    "// GENERATED from packages/ingest/data/degree/programs.json by packages/ingest/src/degree/build.ts.",
    "// Do not edit by hand: rebuild with `bun packages/ingest/src/degree/build.ts`.",
    "// Source: UNT 2026-2027 catalog pages captured in packages/ingest/data/catalog/unt-2026-27.",
  ];
  // The annotation makes the frontend typecheck the generated data against
  // the engine's types, so the routes read it without a cast.
  return [...header, 'import type { DegreeData } from "@untangle/core/degree/types";', ""].join("\n") + "\n" + "export const DEGREE_DATA: DegreeData = " + JSON.stringify(data, null, 2) + ";\n";
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const dataDir = path.resolve(import.meta.dir, "../../data/catalog/unt-2026-27");
  const outFile = path.resolve(import.meta.dir, "../../data/degree/programs.json");
  const frontendModule = path.resolve(import.meta.dir, "../../../../frontend/src/lib/degree/programs.generated.ts");
  const data = buildDegreeData(dataDir, new Date().toISOString());
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(frontendModule, toGeneratedModuleSource(data));
  console.log(`wrote ${outFile}`);
  console.log(`wrote ${frontendModule}`);
}
