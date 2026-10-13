# Prerequisite engine API

The course-page and Auto-action callers use this library to compute statuses and suggestions from catalog requirements and student evidence. It performs no I/O and changes no planner state. Import from `@/lib/prereq` inside UNTangle, or copy the core modules and supply another school adapter.

## Usage

The caller loads the original catalog entries, supplies an explicit credit value for variable-hour courses, and passes reconciled transcript records. The existing flattened `Course.prerequisites` list cannot preserve alternatives or grade requirements.

```ts
import {
	adaptUntCatalog, evidenceFromUntTranscript, inferStatuses,
	suggestNext, untAdapter,
} from "@/lib/prereq";
import { majors } from "@/lib/seed-data";

const catalog = adaptUntCatalog(catalogEntries, selectedCreditHours);
const evidence = evidenceFromUntTranscript(transcriptRecords);
const result = inferStatuses(catalog, {
	...evidence,
	inProgress: [...(evidence.inProgress ?? []), ...currentCourseIds],
	overrides: new Map([
		["CSCE 1040", { status: "taking", reason: "Current enrollment" }],
	]),
	earnedHours: 60,
}, untAdapter);

const assessment = result.statuses.get("CSCE 2100");
const major = majors.find(major => major.id === "cs")!;
const next = suggestNext(major, result, { maxCredits: 12 });
```

The inferred statuses are `done`, `taking`, `eligible`, `locked`, and `unknown`. These differ from the planner's current three statuses. The UI caller decides how to present or persist them. `reason` is a tree of outcomes, messages, source text, course ids, and child reasons. Consent and unparsed requirements carry `Check with advisor` reasons, including inside OR alternatives. Explicit overrides can authorize a status after review.

## Public functions

```ts
parseUntPrerequisite(source: string): ParseResult
normalizeUntCourseId(code: string): string
adaptUntCatalog(
	entries: readonly UntCatalogEntry[],
	creditHours?: ReadonlyMap<string, number>,
): CatalogCourse[]
evidenceFromUntTranscript(records: readonly TranscriptCourseRecord[]): Evidence
inferStatuses(
	catalog: readonly CatalogCourse[], evidence: Evidence, adapter: SchoolAdapter,
): InferenceResult
detectCycles(catalog: readonly CatalogCourse[]): string[][]
suggestNext(
	major: Major, statuses: InferenceResult,
	options: { maxCredits: number; scorer?: SuggestionScorer },
): Suggestion[]
courseReferences(node: Prerequisite): string[]
requirementKey(node: Prerequisite): string
```

`untAdapter` implements `SchoolAdapter`. `Major` accepts the existing seed major's `coreCourseCodes`. The package also exports the public types in `types.ts` and `UntCatalogEntry` from `unt.ts`.

## Adapter contract

Course ids are opaque strings. The core never normalizes or splits them. `CatalogCourse` contains `id`, a finite nonnegative `credits` value, and a `prerequisite` tree. A school adapter defines grade and standing policy:

```ts
interface SchoolAdapter {
	isPassingGrade(grade: string): boolean | undefined;
	meetsMinimumGrade(actual: string, minimum: string): boolean | undefined;
	meetsStanding(actual: string, minimum: string): boolean | undefined;
	minimumHours?(minimum: string): number | undefined;
}
```

Return `undefined` when the school's policy cannot determine an answer. `false` means the evidence is insufficient under a known policy. Adapter functions must be pure and deterministic. The core modules `types.ts`, `ast.ts`, `engine.ts`, and `suggestions.ts` contain no UNT imports or runtime dependencies. A second school supplies its own text parser, transcript mapping, and `SchoolAdapter`; it uses the same evaluator and ranking functions.

`Evidence.transcript` holds accepted records as `{ courseId, grade, source?, credits? }`. `inProgress` holds current course ids. The optional `planned` list supplies planned enrollment for explicit co-requisites only; it does not mark a course taking or done. `earnedHours` is an optional authoritative completed-hour total. `needsReview` holds unresolved transcript course ids. `standing` is an explicit school-defined value. `overrides` maps course ids to `{ status, reason, grade? }`. An override requires a nonempty reason and always wins for that course. Only `done` asserts completion; `eligible` does not satisfy prerequisites for other courses. A `done` override without a grade cannot prove a letter-grade minimum.

The UNT transcript boundary accepts `TranscriptCourseRecord[]`, the existing reconciler's output. It excludes duplicate rows, keeps unreviewed completed and in-progress rows, and carries review-required rows separately. It uses the actual grade for each minimum check. UNT passing credit includes D, P, and CR, but P and CR do not prove a letter-grade minimum. The reconciler currently flags D and P for review, so those rows require explicit approval before this adapter supplies completion evidence. Grades outside UNT's A through F and known credit/enrollment markers need review.

## Expressions and parsing

Every `Prerequisite` node has `source`. The root retains the exact input, including whitespace and punctuation. Node kinds are `course`, `and`, `or`, `consent`, `standing`, `corequisite`, `minGrade`, and `unknown`. `and` and `or` have `children`; grade and co-requisite wrappers have `requirement`. An empty AND means no prerequisites. An empty OR has no satisfying alternative.

`ParseResult` contains `expression`, the original `source`, `coverage`, and retained `annotations`. Full coverage means every requirement leaf matched the grammar. Partial coverage means at least one requirement leaf matched and another remains unknown. Unknown coverage means no requirement leaf matched. Recognized repeat-credit notes, core-category labels, and explicitly labeled recommendations are annotations. Full coverage measures parsing, not eligibility or verified catalog accuracy.

The UNT grammar handles course codes, AND and OR with parentheses, simple lists, explicit alternative lists, grade thresholds, simple standing, consent, and concurrent enrollment. Slash-separated course pairs are mandatory conjunctions. AND binds before OR; comma-and and semicolons separate mandatory groups. A shared trailing grade applies to all course leaves in that clause. Top-level AND, comma, and semicolon groups retain recognized course conjuncts beside unknown mandatory leaves. Grade-qualified lists apply the threshold to every course, including lecture/lab pairs and a grade-qualified tail after an unsupported foundation conjunct. Parenthesized expressions retain their grouping. Ambiguous unqualified comma/OR lists remain unknown. Major-dependent conditional clauses remain whole, so closure cannot assume courses belonging to another major. A course followed by `or equivalent` remains a course leaf; `annotations` carry the advisor note for equivalents. The named course can satisfy that leaf, and another course id never silently substitutes for it.

Major restrictions, GPA requirements, placement tests, scoped departmental-hour requirements, timing conditions, and ambiguous lists require advisor interpretation. Credit ranges and legacy hour formats require `creditHours`, keyed by normalized UNT id. `prerequisites_course_codes` is accepted as catalog provenance but is never a substitute for the original text.

## Evidence, closure, and cycles

Completed credit outranks enrollment; explicit overrides outrank both. Each recognized passing attempt can satisfy a minimum grade. A low direct grade prevents closure from replacing that grade with a stronger assumption. Missing or unrecognized grade evidence remains unknown.

Closure records eligibility evidence implied by a passed course. For example, passing B with prerequisite A can satisfy A as a requirement for C. A's own status still requires transcript credit or a `done` override to become `done`. Closure adds no grades, earned hours, or credits. AND requirements propagate their required facts transitively. OR requirements witness the complete alternative expression without choosing a branch. A witnessed C-or-better threshold does not prove a B-or-better threshold.

Consent and unknown clauses never become satisfied through closure. A co-requisite may have been taken concurrently and failed, so historical enrollment cannot imply its completion or current enrollment. Current in-progress or planned evidence can satisfy a plain co-requisite, but cannot prove an unrecorded minimum grade. A non-done override prevents closure from using that course as completion evidence.

`cycles` lists sorted strongly connected components, including self-reference. It reports each course participating in a dependency cycle. Unresolved cycle members have `unknown` status and a cycle reason. Actual completion or enrollment evidence can resolve eligibility even though the catalog diagnostic remains. Evaluation never recursively promotes eligible courses into completed courses.

## Completed-hour requirements

The existing `standing` node represents both class standing and total earned-hour thresholds. UNT uses `minimum: "credits:45"` or `"credits:60"` for a numeric threshold. `SchoolAdapter.minimumHours` is optional, so existing adapters still compile and keep their previous standing behavior. A new adapter returns its own required completed-hour total for each label or numeric-threshold token.

UNT maps freshman to 0, sophomore to 30, junior to 60, upper-level to 60, and senior to 90 hours. Freshman through senior follow [UNT's completed-hour classification table](https://caiaa.unt.edu/advising/undergraduate-faqs.html), verified October 13, 2026. Upper-level follows the bundled catalog's explicit advanced junior-or-senior wording. Graduate standing has no inferred hour mapping.

A mapped requirement needs known hours. An explicit standing label without hours stays unknown; an explicitly insufficient label still blocks eligibility. The evaluator uses `earnedHours` when provided. Otherwise it sums accepted passing transcript credits once per course id, using the largest credit value across passing retakes. Missing credit values or unresolved transcript records leave the total unknown. In-progress courses, plans, inferred closure facts, and done overrides without transcript credits add no hours. Repeatable-course credit and a fuller transcript summary can be supplied through `earnedHours`.

A transcript array represents the caller's accepted record set, so an explicitly empty array establishes zero known hours. Omitting transcript evidence leaves hours unknown. Scoped requirements such as 15 ANTH hours or 6 honors hours stay advisor checks; they are never compared against the student's overall total. Invalid explicit totals and invalid adapter thresholds throw specific errors.

## Suggestions

`suggestNext` selects only eligible courses in the major's core list. The default score counts distinct unfinished courses reachable through downstream prerequisite references. This counts potential downstream progress, because other requirements and alternatives still apply. Each suggestion includes those ids and an explanation.

`scorer(course, assessment)` adds a finite score for a future interest or semantic ranking. Scores sort descending; opaque ids break ties in code-point order. The function greedily selects ranked courses that fit the remaining credit budget, skipping courses that do not fit. It does not solve a knapsack optimization or suggest locked courses that might become eligible within the same term. A scorer must be pure to retain determinism.

Duplicate catalog ids, invalid credits, invalid budgets, unexplained overrides, invalid UNT ids, and nonfinite scorer output throw specific errors. Neither inference nor suggestions mutates caller evidence or catalog objects.

## Verification artifacts

[Catalog coverage](../../../../tools/prereq-corpus/coverage.md) includes all 656 sources and classifications. [Golden interpretations](../../../tests/prereq/golden.json) contain 59 real catalog examples with independently authored expected trees. The parser tests verify those source strings against the bundled catalog. The additional shared-grade and semicolon co-requisite examples test the requested grammar directly.

Run `cd frontend && bun test tests/prereq` and `bun x tsc --noEmit` under the required Mac lease and heavy lock. From the repository root, `bun tools/prereq-corpus/coverage.ts --check` verifies report freshness. The standing-hour mapping was checked against UNT advising guidance. Full catalog-policy and advisor verification have not been performed.
