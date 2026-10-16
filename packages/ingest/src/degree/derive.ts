import type { CatalogPage, FlowItem, Section } from "./sections";
import type { AllNode, ChooseNode, Citation, CourseSlot, HoursNode, NoteNode, OptionGroup, PolicyNode, PoolNode, RequirementNode } from "@untangle/core/degree/types";

/**
 * Turns the section item streams of the saved catalog pages into the
 * requirements tree. Every rule keys off the catalog's actual wording; where
 * no rule fits, the passage becomes a NoteNode that keeps the catalog text
 * verbatim and stays untracked. Nothing is invented to fill a gap, and a
 * section the derivation expects but cannot find stops the build: a
 * requirement must not drop out of a derived tree without anyone noticing.
 */

/**
 * One option unit. `must` courses are taken together; `either` courses are
 * one-each alternatives added to `must` ("with either"); `anyOf` courses are
 * "and/or" lectures, any non-empty set of which joins `must`.
 */
export type Unit = { must: string[]; either: string[]; anyOf: string[]; orBefore: boolean };

/**
 * Reads a run of courseGroup/marker items as option units:
 * - "or" starts an alternative unit of the same slot;
 * - "and" continues the current unit (lecture plus lab);
 * - "and/or" makes the unit's course and the next one an any-of set;
 * - "with either" marks the following courses as either-options of the unit;
 * - no connector starts a new, independent unit.
 */
export function parseUnits(items: FlowItem[]): Unit[] {
  const units: Unit[] = [];
  let current: Unit | null = null;
  let mode: "must" | "either" = "must";
  let pending: string | null = null;
  for (const item of items) {
    if (item.type === "courseGroup") {
      const codes = item.courses.map((course) => course.code);
      if (current !== null && pending === "and/or") {
        // Only the one shape the served pages print is read: a single course,
        // "and/or", a single course. Anything wider is not guessed at.
        if (current.must.length !== 1 || current.either.length > 0 || current.anyOf.length > 0 || codes.length !== 1) {
          throw new Error(`"and/or" joins ${[...current.must, ...current.either, ...current.anyOf].join(", ")} to ${codes.join(", ")}; only one course on each side is supported.`);
        }
        current.anyOf.push(current.must.pop()!, codes[0]!);
        mode = "must";
        pending = item.connector;
        continue;
      }
      // An "or" marker always separates alternatives, even while collecting
      // "with either" options; otherwise an or between two with-either pairs
      // would be absorbed into the first pair's either-list.
      if (current === null || pending === null || pending === "or") {
        current = { must: [], either: [], anyOf: [], orBefore: pending === "or" };
        units.push(current);
        mode = "must";
      } else if (pending === "and") {
        mode = "must";
      } else if (pending === "with either") {
        mode = "either";
      }
      (mode === "either" ? current.either : current.must).push(...codes);
      pending = item.connector;
      continue;
    }
    if (item.type === "marker" && current) pending = item.text;
    // Headings, notes, and labels between course runs do not end the run.
  }
  return units;
}

/**
 * One unit as options. Either-courses become one alternative each. An any-of
 * set becomes each single course and then the whole set, and each option
 * fills as many choose picks as it has any-of courses.
 */
export function unitOptions(unit: Unit): OptionGroup[] {
  if (unit.anyOf.length > 0) {
    const singles = unit.anyOf.map((code) => ({ must: [code, ...unit.must] }));
    return [...singles, { must: [...unit.anyOf, ...unit.must], counts: unit.anyOf.length }];
  }
  if (unit.either.length === 0) return [{ must: unit.must }];
  return unit.either.map((course) => ({ must: [...unit.must, course] }));
}

/** Units as slots: an or-joined unit extends the previous slot's alternatives. */
export function allSlots(units: Unit[]): CourseSlot[] {
  const slots: CourseSlot[] = [];
  for (const unit of units) {
    if (unit.orBefore && slots.length > 0) slots[slots.length - 1]!.alternatives.push(...unitOptions(unit));
    else slots.push({ alternatives: unitOptions(unit) });
  }
  return slots;
}

function paragraphs(section: Section): string[] {
  return section.items.filter((item): item is Extract<FlowItem, { type: "paragraph" }> => item.type === "paragraph").map((item) => item.text);
}

export function citation(section: Section, page: CatalogPage): Citation {
  return { page: page.file, url: page.url, anchor: section.anchor, heading: section.heading };
}

function note(name: string, text: string, cite: Citation): NoteNode {
  return { kind: "note", name, text, citation: cite };
}

function policyNode(name: string, policy: PolicyNode["policy"], quote: string, cite: Citation): PolicyNode {
  return { kind: "policy", name, policy, quote, citation: cite };
}

function courseItems(section: Section): FlowItem[] {
  return section.items.filter((item) => item.type === "courseGroup" || item.type === "marker");
}

function allNode(name: string, items: FlowItem[], cite: Citation): AllNode {
  return { kind: "all", name, items: allSlots(parseUnits(items)), citation: cite };
}

function chooseNode(name: string, count: number, items: FlowItem[], cite: Citation): ChooseNode {
  return { kind: "choose", name, count, items: allSlots(parseUnits(items)), citation: cite };
}

function hoursNode(name: string, hours: number, items: FlowItem[], cite: Citation): HoursNode {
  const units = parseUnits(items);
  // An hours node has no slots, so "A or B" equivalents would both count.
  // None of the served lists prints one; fail rather than double-count.
  const joined = units.find((unit) => unit.orBefore);
  if (joined) throw new Error(`${name}: an "or" before ${joined.must.join(", ")} has no place in an hours requirement.`);
  return { kind: "hours", name, hours, options: units.flatMap(unitOptions), citation: cite };
}

function findSection(page: CatalogPage, heading: string): Section | undefined {
  return page.sections.find((section) => section.heading === heading);
}

/** A section the derivation depends on. Its absence stops the build. */
export function requireSection(page: CatalogPage, heading: string): Section {
  const section = findSection(page, heading);
  if (!section) throw new Error(`${page.file}: expected section "${heading}" is missing. The catalog page changed shape; update the derivation.`);
  return section;
}

/** The one paragraph of a section that matches a pattern. Its absence stops the build. */
function requireParagraph(page: CatalogPage, section: Section, pattern: RegExp): string {
  const text = paragraphs(section).find((candidate) => pattern.test(candidate));
  if (text === undefined) throw new Error(`${page.file}: section "${section.heading}" has no paragraph matching ${pattern}.`);
  return text;
}

function policyName(policy: PolicyNode["policy"]): string {
  switch (policy.type) {
    case "totalHours": return `Total hours: ${policy.hours}`;
    case "advancedHours": return `Advanced hours: ${policy.hours}`;
    case "residencyPercent": return `Residency: ${policy.percent}% of total hours at UNT`;
    case "advancedHoursAtUnt": return `Advanced hours at UNT: ${policy.hours}`;
    case "minGrade": return `Minimum grade of ${policy.grade} (${policy.scope})`;
    case "gpa": return `GPA ${policy.minimum.toFixed(1)} (${policy.scope})`;
    case "note": return "Note";
  }
}

const RESIDENCY_QUOTE = "minimum of 25 percent of the total hours for the degree";

/** University-level rules every program carries, from the Degree and Program Requirements page. */
export function universityPolicies(page: CatalogPage): PolicyNode[] {
  const nodes: PolicyNode[] = [];
  const hours = requireSection(page, "Minimum Hour Requirements");
  const totalHours: PolicyNode["policy"] = { type: "totalHours", hours: 120 };
  nodes.push(policyNode(policyName(totalHours), totalHours, requireParagraph(page, hours, /minimum of 120 semester hours/), citation(hours, page)));
  const residence = requireSection(page, "Residence");
  const atUnt: PolicyNode["policy"] = { type: "advancedHoursAtUnt", hours: 24 };
  nodes.push(policyNode(policyName(atUnt), atUnt, requireParagraph(page, residence, /24 hours of advanced work/), citation(residence, page)));
  nodes.push(policyNode("Residency", { type: "residencyPercent", percent: 25 }, requireParagraph(page, hours, new RegExp(RESIDENCY_QUOTE)), citation(hours, page)));
  const gpa = requireSection(page, "Grade Point Average (GPA)");
  nodes.push(policyNode("Overall GPA", { type: "gpa", minimum: 2, scope: "overall" }, requireParagraph(page, gpa, /OGPA/), citation(gpa, page)));
  nodes.push(policyNode("UNT GPA", { type: "gpa", minimum: 2, scope: "unt" }, requireParagraph(page, gpa, /UNT-CGPA/), citation(gpa, page)));
  const english = requireSection(page, "English Composition Proficiency");
  nodes.push(policyNode("Communication core grade", { type: "minGrade", grade: "C", scope: "Communication core requirement" }, requireParagraph(page, english, /grade of C or better/), citation(english, page)));
  return nodes;
}

const MAJOR_GRADE_RULE = /A minimum grade of C is required in all courses required in a student.s major for degree completion/;

/** The CS and CE program pages share the College of Engineering shape. */
function deriveEngineering(page: CatalogPage, program: "cs" | "ce"): RequirementNode[] {
  const nodes: RequirementNode[] = [];
  const general = requireSection(page, "Hours required and general/college requirements");
  const hoursLine = requireParagraph(page, general, /A minimum of \d+ semester hours, of which \d+ must be advanced/);
  const hours = /A minimum of (\d+) semester hours, of which (\d+) must be advanced/.exec(hoursLine)!;
  nodes.push(policyNode(`Total hours: ${hours[1]}`, { type: "totalHours", hours: Number(hours[1]) }, hoursLine, citation(general, page)));
  nodes.push(policyNode(`Advanced hours: ${hours[2]}`, { type: "advancedHours", hours: Number(hours[2]) }, hoursLine, citation(general, page)));

  const major = requireSection(page, "Major requirements");
  const majorCite = citation(major, page);
  const majorHoursLine = requireParagraph(page, major, /A minimum of \d+ semester hours, including/);
  const majorChildren: RequirementNode[] = [
    allNode("Required courses", courseItems(major), majorCite),
    note(`${/A minimum of (\d+) semester hours/.exec(majorHoursLine)![1]}-hour major minimum`, majorHoursLine, majorCite),
  ];
  if (program === "cs") {
    const electiveLine = requireParagraph(page, major, /chosen from CSCE Advanced Elective Courses/);
    const electiveHours = Number(/plus (\d+) hours chosen/.exec(electiveLine)![1]);
    majorChildren.push({
      kind: "pool",
      name: `CSCE advanced electives, ${electiveHours} hours`,
      hours: electiveHours,
      match: { subjects: ["CSCE"], minLevel: 4000, maxLevel: null },
      note: "The authoritative list is the CSCE Advanced Elective Courses list, linked from the catalog page and not captured here; the audit applies the 4000-level CSCE rule and flags this node as advisory.",
      citation: majorCite,
    } satisfies PoolNode);
  }
  nodes.push({ kind: "group", name: major.heading, children: majorChildren, citation: majorCite });

  const other = requireSection(page, "Other required courses");
  nodes.push(allNode("Other required courses", courseItems(other), citation(other, page)));

  if (program === "cs") {
    for (const heading of ["CSCE core, 6 hours", "CSCE breadth courses, 6 hours"]) {
      const section = requireSection(page, heading);
      nodes.push(hoursNode(heading, Number(/(\d+) hours/.exec(heading)![1]), section.items, citation(section, page)));
    }
    const lab = requireSection(page, "Choose 2 courses (6-8 hours) from the following courses");
    nodes.push(chooseNode("Laboratory science, 6-8 hours (choose 2)", 2, lab.items, citation(lab, page)));
    const techWriting = requireSection(page, "3 hours selected from");
    requireParagraph(page, techWriting, /Any 4000-level TECM course/);
    nodes.push({
      kind: "pool",
      name: "Technical writing, 3 hours",
      hours: 3,
      match: { subjects: ["TECM"], minLevel: 4000, maxLevel: null },
      note: "The catalog names no list, only \"any 4000-level TECM course\"; the audit cannot tell which TECM course numbers exist.",
      citation: citation(techWriting, page),
    } satisfies PoolNode);
  } else {
    const specialization = requireSection(page, "Specialization area, 9 hours");
    const areas = ["Real-Time and Embedded Systems", "VLSI and Electronics", "Communication and Networks", "Computer Systems", "Artificial intelligence and machine learning"];
    requireParagraph(page, specialization, /one of the five computer engineering specialization areas/);
    nodes.push({
      kind: "choice",
      name: specialization.heading,
      branches: areas.map((heading) => {
        const section = requireSection(page, heading);
        return { name: heading, node: chooseNode(`Three courses from ${heading}`, 3, section.items, citation(section, page)) };
      }),
      citation: citation(specialization, page),
    });
  }

  for (const heading of ["Note", "Minor", "Electives"]) {
    const section = requireSection(page, heading);
    nodes.push(note(heading, paragraphs(section).join(" "), citation(section, page)));
  }

  const policies = requireSection(page, "Department policies");
  nodes.push(policyNode("Minimum grade of C (major courses)", { type: "minGrade", grade: "C", scope: "all courses required in the major" }, requireParagraph(page, policies, MAJOR_GRADE_RULE), citation(policies, page)));
  return nodes;
}

function deriveCore(page: CatalogPage): RequirementNode[] {
  const nodes: RequirementNode[] = [];
  const intro = requireSection(page, "University Core Curriculum Requirements");
  // The 42 hours are the hours the areas claimed. Scoping the total to every
  // course a core list names would count a second course in an area that
  // only needs one.
  nodes.push(policyNode("Core total: 42 hours", { type: "totalHours", hours: 42, courseScope: { kind: "applied" } }, requireParagraph(page, intro, /42 semester credit hours/), citation(intro, page)));

  const comm = requireSection(page, "Communication, 6 hours");
  const commCite = citation(comm, page);
  const group1 = requireSection(page, "Group 1");
  const group2 = requireSection(page, "Group 2");
  nodes.push({
    kind: "group",
    name: "Communication, 6 hours",
    children: [
      chooseNode("Communication Group 1", 1, group1.items, citation(group1, page)),
      chooseNode("Communication Group 2", 1, group2.items, citation(group2, page)),
      policyNode("Communication core grade", { type: "minGrade", grade: "C", scope: "Communication core requirement" }, requireParagraph(page, comm, /grade of C or higher/), commCite),
    ],
    citation: commCite,
  });

  const simpleAreas: Array<[string, number]> = [
    ["Mathematics, 3 hours", 3],
    ["Life and Physical Sciences, 6 hours", 6],
    ["Language, Philosophy and Culture, 3 hours", 3],
    ["Creative Arts, 3 hours", 3],
    ["American History, 6 hours", 6],
    ["Government/Political Science, 6 hours", 6],
    ["Social and Behavioral Sciences, 3 hours", 3],
  ];
  for (const [heading, hours] of simpleAreas) {
    const section = requireSection(page, heading);
    nodes.push(hoursNode(heading, hours, section.items, citation(section, page)));
  }

  const option = requireSection(page, "Component Area Option, 6 hours");
  const optionA = requireSection(page, "Component Area Option A");
  const optionB = requireSection(page, "Component Area Option B");
  // The allowance printed at the end of the Option A list: its hours may come
  // from "any course included in the other core areas listed above". Both
  // Option A hour nodes gain one-course options for those areas' courses; the
  // audit's allocation carries out the section's double-dip note, so a course
  // its home area used cannot also count toward Option A.
  const otherCore = requireParagraph(page, optionA, /^Or any course included in the other core areas/);
  const optionACodes = new Set(parseUnits(optionA.items).flatMap((unit) => unitOptions(unit).flatMap((entry) => entry.must)));
  const otherCoreOptions = [...new Set(nodes.flatMap(nodeCodes))].filter((code) => !optionACodes.has(code)).map((code) => ({ must: [code] }));
  const sixFromA = hoursNode("Six hours from Component Area Option A", 6, optionA.items, citation(optionA, page));
  const threeFromA = hoursNode("Three hours from Component Area Option A", 3, optionA.items, citation(optionA, page));
  nodes.push({
    kind: "choice",
    name: "Component Area Option, 6 hours",
    branches: [
      { name: "6 hours from Component Area Option A", node: { ...sixFromA, options: [...sixFromA.options, ...otherCoreOptions] } },
      {
        name: "3 hours from Option A and 3 hours from Option B",
        node: {
          kind: "group",
          name: "Option A plus Option B",
          children: [
            { ...threeFromA, options: [...threeFromA.options, ...otherCoreOptions] },
            hoursNode("Three hours from Component Area Option B", 3, optionB.items, citation(optionB, page)),
          ],
          citation: citation(option, page),
        },
      },
    ],
    citation: citation(option, page),
  });
  nodes.push(note("Component Area Option double-dip rule", requireParagraph(page, optionA, /double-dip/), citation(optionA, page)));
  nodes.push(note("Option A other-core courses", otherCore, citation(optionA, page)));

  const transfer = requireSection(page, "Transfer of the Core Curriculum");
  const exam = requireSection(page, "Advanced Standing Examination (AP/IB/CLEP)");
  nodes.push(note("Other ways to complete the core", [transfer, exam].map((section) => paragraphs(section).join(" ")).join(" "), citation(transfer, page)));
  return nodes;
}

/** Course codes a node lists, in listed order. */
function nodeCodes(node: RequirementNode): string[] {
  switch (node.kind) {
    case "all":
    case "choose":
      return node.items.flatMap((slot) => slot.alternatives.flatMap((option) => option.must));
    case "hours":
      return node.options.flatMap((option) => option.must);
    case "group":
      return node.children.flatMap(nodeCodes);
    case "choice":
      return node.branches.flatMap((branch) => nodeCodes(branch.node));
    case "pool":
    case "policy":
    case "note":
      return [];
  }
}

export type ProgramSpec = {
  id: string;
  name: string;
  file: string;
  derive: (page: CatalogPage, university: CatalogPage) => RequirementNode[];
};

/**
 * The programs this build serves. Mathematics BSMTH and Biology BSBIO were
 * derived in #132 but are left out: their pages need explicit per-program
 * structure (both calculus sequences, track-wide "or" alternatives, lab-only
 * picks) that this generic reader does not express, so they wait for a PR
 * that writes and cites that structure.
 */
export const PROGRAM_SPECS: ProgramSpec[] = [
  { id: "cs-bs", name: "Computer Science, BS", file: "cs-bs.html", derive: (page, university) => [...deriveEngineering(page, "cs"), ...universityPolicies(university)] },
  { id: "ce-bs", name: "Computer Engineering, BS", file: "ce-bs.html", derive: (page, university) => [...deriveEngineering(page, "ce"), ...universityPolicies(university)] },
  // The core carries its own rules only. The degree-wide policies (total
  // hours, residence, GPA) belong to the major audit, which the audit route
  // returns beside every core audit.
  { id: "core", name: "University Core Curriculum", file: "core-curriculum.html", derive: (page) => deriveCore(page) },
];
