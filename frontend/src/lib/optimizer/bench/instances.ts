/**
 * The PINNED benchmark suite. THE benchmark is reproducible from its seeds:
 * every family name below maps to a fixed seed and fixed size knobs, so
 * `generateInstance(seed, size)` (or `buildCatalogRequest`) rebuilds the
 * exact same instances on any machine, forever. Changing a seed or size
 * here invalidates all previously recorded results — do it only in a new
 * benchmark round and record the change in bench/README.md.
 *
 * SEEDS: base 424242; family i (in the order of SUITE below) uses
 * `424242 + i * 7919`. Catalog families use the adapter's lock/exclusion
 * seed 1.
 */

import type { OptimizeRequest } from "../types";
import { buildCatalogRequest, pickCatalogCourseCodes } from "./catalogAdapter";
import { generateInstance, type InstanceSize } from "./generator";

/** Which benchmark a pinned instance belongs to. */
export type BenchSuite = "synthetic" | "catalog" | "edge";

/** Coarse size class used for latency aggregation in the runner. */
export type SizeClass = "xs" | "s" | "m" | "l" | "xl";

/** One pinned benchmark instance. */
export interface BenchInstance {
  name: string;
  suite: BenchSuite;
  sizeClass: SizeClass;
  req: OptimizeRequest;
  /**
   * True when the instance is infeasible BY CONSTRUCTION — the family has a
   * blocking argument (not a solver guess). Used by tests to cross-check
   * brute force; the runner records it alongside results.
   */
  expectInfeasible?: boolean;
  /**
   * True when the instance is feasible BY CONSTRUCTION — a witness schedule
   * exists (e.g. anchors/credits witness picks, or the empty request).
   */
  expectFeasible?: boolean;
  /**
   * Whether brute force may enumerate it (product of per-course candidate
   * counts <= 1e6 after exclusions). Computed, not hand-labeled.
   */
  enumerable: boolean;
}

/** The brute-force enumerability bound pinned by the contract. */
export const ENUMERABLE_PRODUCT_BOUND = 1_000_000;

/** Product of per-course candidate counts after exclusions (cap pool too). */
export function isEnumerable(req: OptimizeRequest): boolean {
  const excluded = new Set(req.excludedSectionIds);
  const counts = new Map<string, number>();
  for (const section of req.sections) {
    if (!req.requestedCourseCodes.includes(section.courseCode)) continue;
    if (excluded.has(section.id)) continue;
    counts.set(section.courseCode, (counts.get(section.courseCode) ?? 0) + 1);
  }
  let product = 1;
  for (const code of req.requestedCourseCodes) {
    product *= counts.get(code) ?? 0;
    if (product > ENUMERABLE_PRODUCT_BOUND) return false;
  }
  return product <= ENUMERABLE_PRODUCT_BOUND;
}

/** Base seed for the pinned suite. Family i uses BASE_SEED + i * FAMILY_STRIDE. */
export const BASE_SEED = 424242;
export const FAMILY_STRIDE = 7919;

interface SyntheticFamily {
  name: string;
  sizeClass: SizeClass;
  size: InstanceSize;
  expectInfeasible?: boolean;
  expectFeasible?: boolean;
  /** Override the generated timeBudgetMs (e.g. for the 8x40 worst case). */
  timeBudgetMs?: number;
}

/** The pinned synthetic families, in seed order. */
const SYNTHETIC_FAMILIES: SyntheticFamily[] = [
  { name: "plain-xs", sizeClass: "xs", size: { courses: 2, sectionsPerCourse: 4, locks: 1, exclusions: 1, constraintDensity: 0, profile: "plain" } },
  { name: "plain-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 8, locks: 1, exclusions: 2, constraintDensity: 0, profile: "plain" } },
  { name: "plain-m", sizeClass: "m", size: { courses: 4, sectionsPerCourse: 12, locks: 1, exclusions: 2, constraintDensity: 0, profile: "plain" } },
  { name: "anchors-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 6, locks: 0, exclusions: 1, constraintDensity: 0, profile: "anchors" }, expectFeasible: true },
  { name: "daysoff-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 8, locks: 1, exclusions: 2, constraintDensity: 0, profile: "daysOff" } },
  { name: "blocked-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 8, locks: 1, exclusions: 2, constraintDensity: 0, profile: "blocked" } },
  { name: "transfer-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 8, locks: 1, exclusions: 2, constraintDensity: 0, profile: "transfer" } },
  { name: "credits-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 8, locks: 1, exclusions: 2, constraintDensity: 0, profile: "credits" }, expectFeasible: true },
  { name: "mixed-m", sizeClass: "m", size: { courses: 5, sectionsPerCourse: 12, locks: 1, exclusions: 2, constraintDensity: 0.6, profile: "mixed" } },
  { name: "mixed-l", sizeClass: "l", size: { courses: 6, sectionsPerCourse: 20, locks: 1, exclusions: 2, constraintDensity: 0.8, profile: "mixed" } },
  { name: "infeasible-credits-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 8, locks: 0, exclusions: 0, constraintDensity: 0, profile: "infeasibleCredits" }, expectInfeasible: true },
  { name: "infeasible-blocked-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 6, locks: 0, exclusions: 0, constraintDensity: 0, profile: "infeasibleBlocked" }, expectInfeasible: true },
  { name: "infeasible-transfer-xs", sizeClass: "xs", size: { courses: 2, sectionsPerCourse: 1, locks: 0, exclusions: 0, constraintDensity: 0, profile: "infeasibleTransfer" }, expectInfeasible: true },
  { name: "infeasible-locked-overlap-s", sizeClass: "s", size: { courses: 2, sectionsPerCourse: 3, locks: 0, exclusions: 0, constraintDensity: 0, profile: "infeasibleLockedOverlap" }, expectInfeasible: true },
  { name: "infeasible-locked-excluded-xs", sizeClass: "xs", size: { courses: 2, sectionsPerCourse: 2, locks: 0, exclusions: 0, constraintDensity: 0, profile: "infeasibleLockedExcluded" }, expectInfeasible: true },
  { name: "infeasible-alldaysoff-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 4, locks: 0, exclusions: 0, constraintDensity: 0, profile: "infeasibleAllDaysOff" }, expectInfeasible: true },
  { name: "edge-empty-xs", sizeClass: "xs", size: { courses: 2, sectionsPerCourse: 2, locks: 0, exclusions: 0, constraintDensity: 0, profile: "empty" }, expectFeasible: true },
  { name: "edge-zero-candidates-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 4, locks: 0, exclusions: 0, constraintDensity: 0, profile: "zeroCandidates" }, expectInfeasible: true },
  { name: "edge-single-option-s", sizeClass: "s", size: { courses: 3, sectionsPerCourse: 1, locks: 1, exclusions: 0, constraintDensity: 0, profile: "singleOption" } },
  { name: "worst-case-xl", sizeClass: "xl", size: { courses: 8, sectionsPerCourse: 40, locks: 1, exclusions: 2, constraintDensity: 0.5, profile: "mixed" }, timeBudgetMs: 3000 },
  { name: "large-l", sizeClass: "l", size: { courses: 6, sectionsPerCourse: 30, locks: 1, exclusions: 2, constraintDensity: 0.5, profile: "mixed" }, timeBudgetMs: 2000 },
];

/** Build the pinned suite. Deterministic; safe to call repeatedly. */
export function buildSuite(): BenchInstance[] {
  const instances: BenchInstance[] = [];

  SYNTHETIC_FAMILIES.forEach((family, index) => {
    const seed = BASE_SEED + index * FAMILY_STRIDE;
    const req = generateInstance(seed, family.size);
    if (family.timeBudgetMs !== undefined) req.timeBudgetMs = family.timeBudgetMs;
    instances.push({
      name: family.name,
      suite: family.name.startsWith("edge-") ? "edge" : "synthetic",
      sizeClass: family.sizeClass,
      req,
      expectInfeasible: family.expectInfeasible,
      expectFeasible: family.expectFeasible,
      enumerable: isEnumerable(req),
    });
  });

  // Real-catalog families: small and enumerable, plus one large 8-course
  // instance at the catalog's natural section counts (not enumerable).
  const catalogFamilies: { name: string; sizeClass: SizeClass; count: number; min: number; max: number }[] = [
    { name: "catalog-s", sizeClass: "s", count: 3, min: 2, max: 6 },
    { name: "catalog-m", sizeClass: "m", count: 5, min: 2, max: 5 },
    { name: "catalog-l", sizeClass: "l", count: 8, min: 2, max: 8 },
  ];
  for (const family of catalogFamilies) {
    const courseCodes = pickCatalogCourseCodes(family.count, family.min, family.max);
    const req = buildCatalogRequest({ courseCodes, seed: 1, locks: 1, exclusions: 2 });
    instances.push({
      name: family.name,
      suite: "catalog",
      sizeClass: family.sizeClass,
      req,
      enumerable: isEnumerable(req),
    });
  }

  return instances;
}

/** Only the instance families for one suite selector ("all" | suite name). */
export function suiteInstances(suite: string): BenchInstance[] {
  const all = buildSuite();
  if (suite === "all") return all;
  return all.filter((instance) => instance.suite === suite);
}
