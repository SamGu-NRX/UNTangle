import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PROGRAM_SPECS } from "./derive";
import { readCatalogPage } from "./sections";
import type { CatalogPage } from "./sections";
import type { CourseSlot, DegreeData, OptionGroup, ProgramData, RequirementNode } from "./types";

const CATALOG_ID = "catoid-40";
const CATALOG_YEAR = "2026-2027";

type ManifestPage = { file: string; url: string; title: string; capturedAt: string; sha256: string };
type Manifest = { source: string; capturedAt: string; pages: ManifestPage[] };

function collectCodes(node: RequirementNode, into: Set<string>): void {
  const optionsOf = (slots: CourseSlot[]): OptionGroup[] => slots.flatMap((slot) => slot.alternatives);
  const addAll = (option: OptionGroup): void => { for (const code of option.must) into.add(code); };
  switch (node.kind) {
    case "all": for (const option of optionsOf(node.items)) addAll(option); break;
    case "choose":
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

export function buildDegreeData(dataDir: string, builtAt: string): DegreeData {
  const manifest: Manifest = JSON.parse(readFileSync(path.join(dataDir, "manifest.json"), "utf8"));
  const pageMap = new Map<string, ManifestPage>(manifest.pages.map((page) => [page.file, page]));
  const loadPage = (file: string): CatalogPage => {
    const entry = pageMap.get(file);
    if (!entry) throw new Error(`catalog page ${file} is not in the manifest`);
    return readCatalogPage(entry.file, entry.url, readFileSync(path.join(dataDir, entry.file), "utf8"));
  };

  const university = loadPage("degree-requirements.html");
  const corePage = loadPage("core-curriculum.html");
  const coreSpec = PROGRAM_SPECS.find((spec) => spec.id === "core")!;
  const coreCodes = new Set<string>();
  for (const node of coreSpec.derive(corePage, university)) collectCodes(node, coreCodes);

  const programs: ProgramData[] = PROGRAM_SPECS.filter((spec) => spec.id !== "core").map((spec) => {
    const page = loadPage(spec.file);
    const requirements = spec.derive(page, university);
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
    requirements: coreSpec.derive(corePage, university),
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

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const dataDir = path.resolve(import.meta.dir, "../../data/catalog/unt-2026-27");
  const outFile = path.resolve(import.meta.dir, "../../data/degree/programs.json");
  const data = buildDegreeData(dataDir, new Date().toISOString());
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${outFile}`);
}
