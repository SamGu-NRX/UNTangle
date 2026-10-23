import { normalizeConnector, type CatalogPage, type FlowItem, type Section } from "./sections";
import type { AllNode, ChooseNode, Citation, CourseSlot, GroupNode, HoursNode, NoteNode, OptionGroup, PolicyNode, PoolNode, ProgramData, RequirementNode } from "@untangle/core/degree/types";

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

function readConnector(raw: string | null): string | null {
  if (raw === null) return null;
  const connector = normalizeConnector(raw);
  if (connector === null) throw new Error(`Unreadable course connector: "${raw}".`);
  return connector;
}

/**
 * Reads a run of courseGroup/marker items as option units.
 * Marker and course-group connectors are normalized; unreadable ones throw:
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
      const connector = readConnector(item.connector);
      const codes = item.courses.map((course) => course.code);
      if (current !== null && pending === "and/or") {
        // Only the one shape the served pages print is read: a single course,
        // "and/or", a single course. Anything wider is not guessed at.
        if (current.must.length !== 1 || current.either.length > 0 || current.anyOf.length > 0 || codes.length !== 1) {
          throw new Error(`"and/or" joins ${[...current.must, ...current.either, ...current.anyOf].join(", ")} to ${codes.join(", ")}; only one course on each side is supported.`);
        }
        current.anyOf.push(current.must.pop()!, codes[0]!);
        mode = "must";
        pending = connector;
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
      pending = connector;
      continue;
    }
    if (item.type === "marker") {
      const connector = readConnector(item.text);
      if (current) pending = connector;
    }
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
  nodes.push(policyNode(
    "Advanced hours in the major at UNT: 12",
    { type: "advancedHoursAtUnt", hours: 12, courseScope: { kind: "applied" } },
    requireParagraph(page, residence, /12 hours of advanced work in the major/),
    citation(residence, page),
  ));
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
      // Advanced is 3000-4999, as the catalog's "advanced hours" use it.
      // A 5000-level graduate course is left out, so it reads as an
      // advisor's call instead of counting.
      match: { subjects: ["CSCE"], minLevel: 3000, maxLevel: 4999 },
      note: "UNT's CSCE Advanced Elective Courses list is not captured here, so the audit lists any 3000- or 4000-level CSCE course on your record as a possible elective. A 5000-level graduate course is not counted; ask an advisor whether it can be.",
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
      // "4000-level" is 4000-4999. With no upper bound, a 5000-level
      // graduate TECM course matched the pool as a candidate.
      match: { subjects: ["TECM"], minLevel: 4000, maxLevel: 4999 },
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

/**
 * Explicit structure for the Mathematics and Biology pages.
 *
 * Their lists print option structure the generic reader cannot see: a
 * footnote that swaps one calculus sequence for another, an "or" between
 * two whole physics tracks, and lecture-lab pairs printed as separate
 * bullets with no connector between them (a blank line separates slots in
 * one list and sits inside a pair in the next). Read generically, BIOL 2042
 * alone would count as a 2000-level biology course and BIOL 4505 alone as a
 * physiology course with lab. So these lists are written out below, each
 * citing its section, and each is checked against the codes its section
 * prints: a course the catalog adds or drops stops the build.
 */

/** Every course code a section prints, in page order. */
function sectionCodes(section: Section): string[] {
  return section.items.flatMap((item) => (item.type === "courseGroup" ? item.courses.map((course) => course.code) : []));
}

/** Stops the build when an explicit structure no longer names exactly the codes its section prints. */
function matchListed(page: CatalogPage, section: Section, written: string[]): void {
  const listed = new Set(sectionCodes(section));
  const used = new Set(written);
  const missing = [...listed].filter((code) => !used.has(code));
  const extra = [...used].filter((code) => !listed.has(code));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${page.file}: section "${section.heading}" no longer matches its explicit structure (not encoded: ${missing.join(", ") || "none"}; not on the page: ${extra.join(", ") || "none"}). Update the derivation.`);
  }
}

/** A list of single courses with no connectors; anything else stops the build. */
function flatList(page: CatalogPage, section: Section): string[] {
  const joined = section.items.find((item) => item.type === "marker" || (item.type === "courseGroup" && (item.connector !== null || item.courses.length !== 1)));
  if (joined) throw new Error(`${page.file}: section "${section.heading}" is no longer a plain course list. Update the derivation.`);
  return sectionCodes(section);
}

/** One required slot per entry; each entry lists that slot's alternatives. */
function explicitAll(name: string, page: CatalogPage, section: Section, slots: string[][][]): AllNode {
  matchListed(page, section, slots.flat(2));
  return { kind: "all", name, items: slots.map((alternatives) => ({ alternatives: alternatives.map((must) => ({ must })) })), citation: citation(section, page) };
}

/** One pick among equivalent options. */
function explicitChooseOne(name: string, page: CatalogPage, section: Section, options: string[][]): ChooseNode {
  matchListed(page, section, options.flat());
  return { kind: "choose", name, count: 1, items: [{ alternatives: options.map((must) => ({ must })) }], citation: citation(section, page) };
}

/** One pick among single courses gathered from several area lists. */
function chooseOneOf(name: string, codes: string[], cite: Citation): ChooseNode {
  return { kind: "choose", name, count: 1, items: codes.map((code) => ({ alternatives: [{ must: [code] }] })), citation: cite };
}

function collegeOfScienceNote(hoursLine: string, cite: Citation): NoteNode {
  // The hours line also requires the College of Science requirements, which
  // live on a catalog page this build does not capture.
  return note("College of Science requirements", hoursLine, cite);
}

/**
 * Mathematics, BSMTH (non-teacher certification), catalog.unt.edu poid 21333.
 * The 43 major hours are the 19-hour core, 9 depth, 9 breadth and 6
 * elective hours the page lists.
 */
function deriveMathematics(page: CatalogPage, university: CatalogPage): RequirementNode[] {
  const general = requireSection(page, "Hours required and general/college requirements");
  const generalCite = citation(general, page);
  const hoursLine = requireParagraph(page, general, /A minimum of 120 semester hours, of which 36 must be advanced/);
  const nodes: RequirementNode[] = [
    policyNode("Total hours: 120", { type: "totalHours", hours: 120 }, hoursLine, generalCite),
    policyNode("Advanced hours: 36", { type: "advancedHours", hours: 36 }, hoursLine, generalCite),
  ];

  const major = requireSection(page, "Major requirements");
  const majorLine = requireParagraph(page, major, /^43 hours of mathematics courses, which must include:/);

  // "Mathematics core, 19 hours" prints MATH 1710, 1720, 1810, 1820 and 1830
  // as one flat list, but its footnote reads: "*Students have the option to
  // take Math 1810/1820/1830 or MATH 1710/1820/1830 in place of MATH
  // 1710/1720." So calculus is one slot with three sequences, and the other
  // four courses are required: 4 + 3 + 3 + 3 + 3 + 3 = 19 hours.
  const core = requireSection(page, "Mathematics core, 19 hours");
  const footnotes = requireParagraph(page, core, /^\*Students have the option to take Math 1810\/1820\/1830 or MATH 1710\/1820\/1830 in place of MATH 1710\/1720\./);
  const substitution = footnotes.indexOf("** Incoming students who have already taken an introduction to mathematical proofs may request substitution of MATH 2000");
  if (substitution < 0) throw new Error(`${page.file}: the MATH 2000 substitution footnote is missing from "${core.heading}".`);
  const mathCore = explicitAll("Mathematics core, 19 hours", page, core, [
    [["MATH 1710", "MATH 1720"], ["MATH 1810", "MATH 1820", "MATH 1830"], ["MATH 1710", "MATH 1820", "MATH 1830"]],
    [["MATH 2000"]], [["MATH 2700"]], [["MATH 2730"]], [["MATH 3000"]],
  ]);

  // "Depth requirement, 9 hours": "9 hours from one of the following areas".
  // Analysis and Algebra each print a required course plus "Plus two of the
  // following"; Probability/statistics and Geometry/topology print a list.
  const depth = requireSection(page, "Depth requirement, 9 hours");
  requireParagraph(page, depth, /^9 hours from one of the following areas$/);
  const analysis = requireSection(page, "Analysis");
  const analysisPlus = requireSection(page, "Plus two of the following:");
  const algebra = requireSection(page, "Algebra");
  const algebraPlus = requireSection(page, "Plus two of the following");
  const probability = requireSection(page, "Probability/statistics");
  const geometry = requireSection(page, "Geometry/topology");
  const areaCodes = {
    analysis: [...flatList(page, analysis), ...flatList(page, analysisPlus)],
    algebra: [...flatList(page, algebra), ...flatList(page, algebraPlus)],
    probability: flatList(page, probability),
    geometry: flatList(page, geometry),
  };
  // "Breadth requirement, 9 hours": "One course in each of the three areas is
  // not used to satisfy the depth requirement. One of the following must be
  // taken if neither were completed as part of the depth requirement: MATH
  // 3510, MATH 3610." Breadth depends on which area is the depth, so each
  // depth area is a branch carrying its own breadth picks. An area's courses
  // are the ones printed under its heading; a course counts once, so MATH
  // 3740 cannot be both an Analysis pick and the Geometry/topology course.
  const breadth = requireSection(page, "Breadth requirement, 9 hours");
  const breadthCite = citation(breadth, page);
  requireParagraph(page, breadth, /^One course in each of the three areas is not used to satisfy the depth requirement\. One of the following must be taken if neither were completed as part of the depth requirement:$/);
  matchListed(page, breadth, ["MATH 3510", "MATH 3610"]);
  const breadthPick = (area: keyof typeof areaCodes, label: string): ChooseNode => chooseOneOf(`Breadth: one ${label} course`, areaCodes[area], breadthCite);
  // With Probability/statistics or Geometry/topology as the depth, MATH 3610
  // must be the Analysis breadth course or MATH 3510 the Algebra one.
  const proofCourse: RequirementNode = {
    kind: "choice",
    name: "Breadth: MATH 3510 or MATH 3610",
    branches: [
      { name: "MATH 3610", node: { kind: "group", name: "MATH 3610 as the Analysis course", children: [explicitPick("MATH 3610", breadthCite), breadthPick("algebra", "Algebra")], citation: breadthCite } },
      { name: "MATH 3510", node: { kind: "group", name: "MATH 3510 as the Algebra course", children: [breadthPick("analysis", "Analysis"), explicitPick("MATH 3510", breadthCite)], citation: breadthCite } },
    ],
    citation: breadthCite,
  };
  const depthBranch = (name: string, children: RequirementNode[], section: Section) => ({ name, node: { kind: "group", name: `${name} depth, with breadth`, children, citation: citation(section, page) } satisfies GroupNode });
  const depthAndBreadth: RequirementNode = {
    kind: "choice",
    name: "Depth and breadth, 18 hours",
    branches: [
      depthBranch("Analysis", [
        allNode("Analysis depth: MATH 3610", courseItems(analysis), citation(analysis, page)),
        chooseNode("Analysis depth: two more", 2, courseItems(analysisPlus), citation(analysisPlus, page)),
        breadthPick("algebra", "Algebra"), breadthPick("probability", "Probability/statistics"), breadthPick("geometry", "Geometry/topology"),
      ], analysis),
      depthBranch("Algebra", [
        allNode("Algebra depth: MATH 3510", courseItems(algebra), citation(algebra, page)),
        chooseNode("Algebra depth: two more", 2, courseItems(algebraPlus), citation(algebraPlus, page)),
        breadthPick("analysis", "Analysis"), breadthPick("probability", "Probability/statistics"), breadthPick("geometry", "Geometry/topology"),
      ], algebra),
      depthBranch("Probability/statistics", [
        hoursNode("Probability/statistics depth, 9 hours", 9, courseItems(probability), citation(probability, page)),
        breadthPick("geometry", "Geometry/topology"), proofCourse,
      ], probability),
      depthBranch("Geometry/topology", [
        hoursNode("Geometry/topology depth, 9 hours", 9, courseItems(geometry), citation(geometry, page)),
        breadthPick("probability", "Probability/statistics"), proofCourse,
      ], geometry),
    ],
    citation: citation(depth, page),
  };

  const electives = requireSection(page, "Mathematics electives, 6 hours");
  requireParagraph(page, electives, /^Two additional upper-level mathematics courses chosen from mathematics course numbered 3350 or above\.$/);
  nodes.push({
    kind: "group",
    name: "Major requirements, 43 hours",
    children: [
      note("43-hour major minimum", majorLine, citation(major, page)),
      mathCore,
      note("MATH 2000 substitution", footnotes.slice(substitution), citation(core, page)),
      depthAndBreadth,
      {
        kind: "pool",
        name: "Mathematics electives, 6 hours",
        hours: 6,
        match: { subjects: ["MATH"], minLevel: 3350, maxLevel: 4999 },
        note: "The catalog names no list, only mathematics courses numbered 3350 or above, so the audit lists MATH 3350-4999 courses no other requirement counted. Whether a STAT or 5000-level course counts is an advisor's call.",
        citation: citation(electives, page),
      } satisfies PoolNode,
    ],
    citation: citation(major, page),
  });

  // "Laboratory science": "Three laboratory science courses intended for
  // science majors are required as follows", in five options.
  const lab = requireSection(page, "Laboratory science");
  requireParagraph(page, lab, /^Three laboratory science courses intended for science majors are required as follows:$/);
  const option1 = requireSection(page, "Option 1, Biology emphasis");
  const option1Plus = requireSection(page, "Plus one of the following");
  const option2 = requireSection(page, "Option 2, Chemistry emphasis");
  const option3 = requireSection(page, "Option 3, Physics emphasis");
  const option4 = requireSection(page, "Option 4");
  const option5 = requireSection(page, "Option 5");
  const option5Plus = requireSection(page, "Plus one of the following lecture and laboratory combinations");
  // Options 2 and 3 end with "One additional course that meets the University
  // Core Curriculum requirement for the natural sciences, or any 3 hours from
  // CHEM [PHYS] numbered at least 2000." The core list is on another page and
  // the level rule names no list, so that third course is left to an advisor.
  const thirdCourse = (section: Section, subject: string): NoteNode =>
    note("Third laboratory science course", requireParagraph(page, section, new RegExp(`^One additional course that meets the University Core Curriculum requirement for the natural sciences, or any 3 hours from ${subject} numbered at least 2000\\.$`)), citation(section, page));
  const option = (name: string, children: RequirementNode[], section: Section) => ({ name, node: { kind: "group", name, children, citation: citation(section, page) } satisfies GroupNode });
  nodes.push({
    kind: "choice",
    name: "Laboratory science",
    branches: [
      option(option1.heading, [
        allNode("BIOL 1710, BIOL 1720 and BIOL 1760", courseItems(option1), citation(option1, page)),
        chooseNode("Plus one physical science lecture and laboratory", 1, courseItems(option1Plus), citation(option1Plus, page)),
      ], option1),
      option(option2.heading, [allNode("General chemistry I and II with laboratories", courseItems(option2), citation(option2, page)), thirdCourse(option2, "CHEM")], option2),
      // The page prints "PHYS 1510 and 1530, PHYS 1520 and 1540, or PHYS 1710
      // and 1730, PHYS 2220 and 2240": the "or" is between the two physics
      // tracks, not between PHYS 1520 and PHYS 1710.
      option(option3.heading, [
        explicitAll("Calculus-based physics sequence", page, option3, [[["PHYS 1510", "PHYS 1530", "PHYS 1520", "PHYS 1540"], ["PHYS 1710", "PHYS 1730", "PHYS 2220", "PHYS 2240"]]]),
        thirdCourse(option3, "PHYS"),
      ], option3),
      { name: option4.heading, node: note("Double major laboratory science", paragraphs(option4).join(" "), citation(option4, page)) },
      option(option5.heading, [
        allNode("GEOL 1610 and GEOG 1710", courseItems(option5), citation(option5, page)),
        chooseNode("Plus one lecture and laboratory combination", 1, courseItems(option5Plus), citation(option5Plus, page)),
        note("Geography or geology minor", requireParagraph(page, option5, /students with a minor in geography or geology may use:$/), citation(option5, page)),
      ], option5),
    ],
    citation: citation(lab, page),
  });

  const language = requireSection(page, "Foreign language");
  requireParagraph(page, language, /Students may complete either of two options to satisfy the College of Science foreign language requirement:/);
  const language1 = requireSection(page, "Option 1");
  const language2 = requireSection(page, "Option 2");
  requireParagraph(page, language2, /^Complete 6 hours of technical writing courses from the following:$/);
  nodes.push({
    kind: "choice",
    name: "Foreign language",
    branches: [
      { name: "Option 1", node: note("Foreign language proficiency", requireParagraph(page, language1, /^Proficiency in a foreign language equivalent to 1020 is required\./), citation(language1, page)) },
      { name: "Option 2", node: hoursNode("Technical writing, 6 hours", 6, courseItems(language2), citation(language2, page)) },
    ],
    citation: citation(language, page),
  });

  const programming = requireSection(page, "Computer programming");
  nodes.push(allNode("Computer programming", courseItems(programming), citation(programming, page)));
  nodes.push(note("Programming competency exam", requireParagraph(page, programming, /may demonstrate their programming competency by passing a departmental exam/), citation(programming, page)));

  const minor = requireSection(page, "Minor requirements");
  nodes.push(note("Minor requirements", paragraphs(minor).join(" "), citation(minor, page)));
  // "Mathematics courses which are applied toward a mathematics major and are
  // numbered 3350 or above" is a scope no course filter expresses (and the
  // page does not say whether STAT counts), so the GPA is shown, not checked.
  const other = requireSection(page, "Other requirements");
  nodes.push(policyNode("GPA 2.0 in major mathematics courses numbered 3350 or above", { type: "note" }, requireParagraph(page, other, /grade point average of at least 2\.0 in all mathematics courses/), citation(other, page)));
  nodes.push(collegeOfScienceNote(hoursLine, generalCite));
  nodes.push(...universityPolicies(university));
  return nodes;
}

function explicitPick(code: string, cite: Citation): AllNode {
  return { kind: "all", name: code, items: [{ alternatives: [{ must: [code] }] }], citation: cite };
}

/** The 2000-level biology options both Biology lists print: BIOL 2041 only with its laboratory. */
const BIOLOGY_2000_OPTIONS = [["BIOL 2041", "BIOL 2042"], ["BIOL 2140"], ["BIOL 2241"], ["BIOL 2251"]];

/** Biology, BSBIO, catalog.unt.edu poid 21206. */
function deriveBiology(page: CatalogPage, university: CatalogPage): RequirementNode[] {
  const general = requireSection(page, "Hours required and general/college requirements");
  const generalCite = citation(general, page);
  const hoursLine = requireParagraph(page, general, /A minimum of 120 semester hours, of which 36 must be advanced/);
  const nodes: RequirementNode[] = [
    policyNode("Total hours: 120", { type: "totalHours", hours: 120 }, hoursLine, generalCite),
    policyNode("Advanced hours: 36", { type: "advancedHours", hours: 36 }, hoursLine, generalCite),
  ];

  // The Biology grade rules are scoped to the courses a requirement counted
  // ("these courses", "upper-division courses counting towards major
  // requirements"). No course filter expresses that, and a filter over every
  // listed code would fail a student for a D in a listed course that counts
  // nowhere, so each rule is shown with its quote rather than checked.
  const foundation = requireSection(page, "Foundation course requirements");
  const foundationRule = requireParagraph(page, foundation, /Successful completion is based on achieving a C or better in each course and an overall 2\.5 grade point average in these courses\./);
  const foundationBiology = requireSection(page, "Biology courses:");
  const foundation2000 = requireSection(page, "One of the following courses (with lab, if indicated):");
  const foundationChemistry = requireSection(page, "Chemistry courses:");
  const foundationMath = requireSection(page, "Math courses:");
  nodes.push({
    kind: "group",
    name: "Foundation course requirements",
    children: [
      allNode("Biology foundation courses", courseItems(foundationBiology), citation(foundationBiology, page)),
      explicitChooseOne("One 2000-level biology course", page, foundation2000, BIOLOGY_2000_OPTIONS),
      allNode("Chemistry foundation courses", courseItems(foundationChemistry), citation(foundationChemistry, page)),
      allNode("Math foundation course", courseItems(foundationMath), citation(foundationMath, page)),
      policyNode("Foundation courses: C or better and a 2.5 GPA", { type: "note" }, foundationRule, citation(foundation, page)),
    ],
    citation: citation(foundation, page),
  });

  // "Biology requirements": "students must complete with a C or higher a
  // second 2000 level biology course, the advanced biology requirements, one
  // physiology course with laboratory, and 16 advanced biology elective hours
  // (of which 2 courses must be with laboratory)."
  const biology = requireSection(page, "Biology requirements");
  const biologyRule = requireParagraph(page, biology, /16 advanced biology elective hours \(of which 2 courses must be with laboratory\)/);
  const second = requireSection(page, "Options for the second 2000 level course requirement (with lab, if indicated):");
  const advanced = requireSection(page, "Advanced biology requirements:");
  // "BIOL 4501, BIOL 4502 or BIOL 4503, BIOL 4504 or BIOL 4510 with either
  // BIOL 3800 or BIOL 4505": each option is a lecture with its laboratory, and
  // BIOL 4510 (the laboratory) goes with either lecture.
  const physiology = requireSection(page, "Physiology requirement options (with lab):");
  // "Select from this list, except that courses used to fulfill other
  // requirements cannot also count towards advanced electives": the audit
  // counts each course once, and this node comes after the ones it defers to.
  const electives = requireSection(page, "Advanced biology electives:");
  requireParagraph(page, electives, /^Select from this list, except that courses used to fulfill other requirements cannot also count towards advanced electives\.$/);
  nodes.push({
    kind: "group",
    name: "Biology requirements",
    children: [
      explicitChooseOne("Second 2000-level biology course", page, second, BIOLOGY_2000_OPTIONS),
      allNode("Advanced biology requirements", courseItems(advanced), citation(advanced, page)),
      explicitChooseOne("Physiology course with laboratory", page, physiology, [["BIOL 4501", "BIOL 4502"], ["BIOL 4503", "BIOL 4504"], ["BIOL 4510", "BIOL 3800"], ["BIOL 4510", "BIOL 4505"]]),
      { kind: "hours", name: "Advanced biology electives, 16 hours", hours: 16, options: flatList(page, electives).map((code) => ({ must: [code] })), citation: citation(electives, page) } satisfies HoursNode,
      // The list does not mark which entries are "with laboratory", so the
      // two-lab-course rule is left to an advisor.
      note("Two advanced biology electives with laboratory", biologyRule, citation(biology, page)),
      policyNode("Biology requirements: C or higher", { type: "note" }, biologyRule, citation(biology, page)),
    ],
    citation: citation(biology, page),
  });

  // "MATH 1710 or MATH 1810", then "PHYS 1410, PHYS 1430 or PHYS 1510, PHYS
  // 1530" and the same for the second semester: each line is one slot of
  // lecture-lab pairs.
  const other = requireSection(page, "Other course requirements");
  nodes.push(explicitAll("Other course requirements", page, other, [
    [["MATH 1710"], ["MATH 1810"]],
    [["PHYS 1410", "PHYS 1430"], ["PHYS 1510", "PHYS 1530"]],
    [["PHYS 1420", "PHYS 1440"], ["PHYS 1520", "PHYS 1540"]],
  ]));

  // "Students must complete a minor in chemistry with a minimum of 20 hours.
  // This includes the 12 hours of chemistry foundation courses plus 8 hours
  // completed with a grade of C or higher": CHEM 2380 and CHEM 3220, plus 4
  // advanced hours from pairs printed as "CHEM 3451, CHEM 3452 or CHEM 3530
  // or BIOC 3621, BIOC 3622 or BIOC 4540, BIOC 4550".
  const chemistry = requireSection(page, "Chemistry requirements");
  const chemistryRule = requireParagraph(page, chemistry, /minor in chemistry with a minimum of 20 hours\. This includes the 12 hours of chemistry foundation courses plus 8 hours completed with a grade of C or higher/);
  const plus4 = requireSection(page, "Plus 4 advanced hours chosen from");
  const plus4Options = [["CHEM 3451", "CHEM 3452"], ["CHEM 3530"], ["BIOC 3621", "BIOC 3622"], ["BIOC 4540", "BIOC 4550"]];
  matchListed(page, plus4, plus4Options.flat());
  nodes.push({
    kind: "group",
    name: "Chemistry requirements",
    children: [
      allNode("CHEM 2380 and CHEM 3220", courseItems(chemistry), citation(chemistry, page)),
      { kind: "hours", name: "Plus 4 advanced hours", hours: 4, options: plus4Options.map((must) => ({ must })), citation: citation(plus4, page) } satisfies HoursNode,
      policyNode("Chemistry minor: C or higher", { type: "note" }, chemistryRule, citation(chemistry, page)),
    ],
    citation: citation(chemistry, page),
  });

  const electivesNote = requireSection(page, "Electives");
  nodes.push(note("Electives", paragraphs(electivesNote).join(" "), citation(electivesNote, page)));
  const rules = requireSection(page, "Other requirements");
  nodes.push(policyNode("Department grade and attempt rules", { type: "note" }, requireParagraph(page, rules, /^Only two attempts will be allowed for each biology and biochemistry course in the degree\./), citation(rules, page)));
  nodes.push(collegeOfScienceNote(hoursLine, generalCite));
  nodes.push(...universityPolicies(university));
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
  /**
   * The core page forbids counting a course in two areas ("Students may not
   * double-dip"). The university's Minimum Hour Requirements say "One course
   * may be used to meet multiple requirements. Students should speak to an
   * advisor", which is how a major's shared course is reported.
   */
  courseSharing: ProgramData["courseSharing"];
  derive: (page: CatalogPage, university: CatalogPage) => RequirementNode[];
};

/**
 * The programs this build serves. Mathematics BSMTH and Biology BSBIO need
 * explicit per-program structure (both calculus sequences, track-wide "or"
 * alternatives, lecture-lab pairs printed without connectors) that the
 * generic reader does not express; deriveMathematics and deriveBiology write
 * it out and cite it.
 */
export const PROGRAM_SPECS: ProgramSpec[] = [
  { id: "cs-bs", name: "Computer Science, BS", file: "cs-bs.html", courseSharing: "advisor", derive: (page, university) => [...deriveEngineering(page, "cs"), ...universityPolicies(university)] },
  { id: "ce-bs", name: "Computer Engineering, BS", file: "ce-bs.html", courseSharing: "advisor", derive: (page, university) => [...deriveEngineering(page, "ce"), ...universityPolicies(university)] },
  { id: "math-bsmth", name: "Mathematics, BSMTH (non–teacher certification)", file: "math-bsmth.html", courseSharing: "advisor", derive: deriveMathematics },
  { id: "biology-bsbio", name: "Biology, BSBIO", file: "biology-bsbio.html", courseSharing: "advisor", derive: deriveBiology },
  // The core carries its own rules only. The degree-wide policies (total
  // hours, residence, GPA) belong to the major audit, which the audit route
  // returns beside every core audit.
  { id: "core", name: "University Core Curriculum", file: "core-curriculum.html", courseSharing: "forbidden", derive: (page) => deriveCore(page) },
];
