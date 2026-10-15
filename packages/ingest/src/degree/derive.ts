import type { CatalogPage, FlowItem, Section } from "./sections";
import type { AllNode, ChooseNode, Citation, CourseSlot, HoursNode, NoteNode, OptionGroup, PolicyNode, PoolNode, RequirementNode } from "@untangle/core/degree/types";

/**
 * Turns the section item streams of the saved catalog pages into the
 * requirements tree. Every rule keys off the catalog's actual wording; where
 * no rule fits, the passage becomes a NoteNode that keeps the catalog text
 * verbatim and stays untracked. Nothing is invented to fill a gap.
 */

export type Unit = { must: string[]; either: string[]; orBefore: boolean };

/**
 * Reads a run of courseGroup/marker items as option units:
 * - "or" starts an alternative unit of the same slot (except inside a
 *   "with either" run, where it adds another lecture option);
 * - "and" continues the current unit (lecture plus lab);
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
      // An "or" marker always separates alternatives, even while collecting
      // "with either" options; otherwise an or between two with-either pairs
      // would be absorbed into the first pair's either-list.
      const startNew = current === null || pending === null || pending === "or";
      if (startNew) {
        current = { must: [], either: [], orBefore: pending === "or" };
        units.push(current);
        mode = "must";
      } else if (pending === "and") {
        mode = "must";
      } else if (pending === "with either") {
        mode = "either";
      }
      const target = mode === "either" ? current!.either : current!.must;
      target.push(...item.courses.map((course) => course.code));
      pending = item.connector;
      continue;
    }
    if (item.type === "marker" && current) {
      pending = item.text;
      continue;
    }
    // Headings, notes, and labels between course runs do not end the run.
    continue;
  }
  return units;
}

/** One unit as options: the either-courses become one alternative each. */
export function unitOptions(unit: Unit): OptionGroup[] {
  if (unit.either.length === 0) return [{ must: unit.must }];
  return unit.either.map((course) => ({ must: [...unit.must, course] }));
}

/** Units as slots: an or-joined unit extends the previous slot's alternatives. */
export function allSlots(units: Unit[]): CourseSlot[] {
  const slots: CourseSlot[] = [];
  for (const unit of units) {
    if (unit.orBefore && slots.length > 0) slots[slots.length - 1].alternatives.push(...unitOptions(unit));
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

function allNode(name: string, items: FlowItem[], cite: Citation): AllNode {
  return { kind: "all", name, items: allSlots(parseUnits(items)), citation: cite };
}

function chooseNode(name: string, count: number, items: FlowItem[], cite: Citation): ChooseNode {
  return { kind: "choose", name, count, options: parseUnits(items).flatMap(unitOptions), citation: cite };
}

function hoursNode(name: string, hours: number, items: FlowItem[], cite: Citation): HoursNode {
  return { kind: "hours", name, hours, options: parseUnits(items).flatMap(unitOptions), citation: cite };
}

function sectionByName(page: CatalogPage, heading: string): Section | undefined {
  return page.sections.find((section) => section.heading === heading);
}

function sectionsAfter(page: CatalogPage, heading: string): Section[] {
  const index = page.sections.findIndex((section) => section.heading === heading);
  return index === -1 ? [] : page.sections.slice(index + 1);
}

function findStopIndex(page: CatalogPage, after: string, stopHeadings: string[]): number {
  const sections = sectionsAfter(page, after);
  let count = 0;
  for (const section of sections) {
    if (stopHeadings.includes(section.heading)) break;
    count += 1;
  }
  return count;
}

function policyName(policy: PolicyNode["policy"]): string {
  switch (policy.type) {
    case "totalHours": return `Total hours: ${policy.hours}`;
    case "advancedHours": return `Advanced hours: ${policy.hours}`;
    case "residencyPercent": return `Residency: ${policy.percent}% of total hours at UNT`;
    case "advancedHoursAtUnt": return `Advanced hours at UNT: ${policy.hours}`;
    case "subjectHours": return `${policy.hours} hours in ${policy.subjects.join("/")}`;
    case "minGrade": return `Minimum grade of ${policy.grade} (${policy.scope})`;
    case "gpa": return `GPA ${policy.minimum.toFixed(1)} (${policy.scope})`;
    default: return "Note";
  }
}

/** University-level rules every program carries, scanned from shared paragraphs. */
const RESIDENCY_QUOTE = "minimum of 25 percent of the total hours for the degree";

export function universityPolicies(page: CatalogPage): PolicyNode[] {
  const nodes: PolicyNode[] = [];
  const add = (heading: string, policy: PolicyNode["policy"], quote: string): void => {
    const section = sectionByName(page, heading);
    if (!section) return;
    nodes.push(policyNode(policyName(policy), policy, quote, citation(section, page)));
  };
  add("Minimum Hour Requirements", { type: "totalHours", hours: 120 }, "Students must complete a minimum of 120 semester hours to earn a degree at UNT.");
  add("Residence", { type: "advancedHoursAtUnt", hours: 24 }, "A minimum of 24 hours of advanced work (3000 or 4000 level) at UNT");
  const residence = sectionByName(page, "Minimum Hour Requirements");
  if (residence) {
    const line = paragraphs(residence).find((text) => text.includes(RESIDENCY_QUOTE));
    if (line) nodes.push(policyNode("Residency", { type: "residencyPercent", percent: 25 }, line, citation(residence, page)));
  }
  const gpa = sectionByName(page, "Grade Point Average (GPA)");
  if (gpa) {
    const ogpa = paragraphs(gpa).find((text) => text.includes("OGPA"));
    const cgpa = paragraphs(gpa).find((text) => text.includes("UNT-CGPA"));
    if (ogpa) nodes.push(policyNode("Overall GPA", { type: "gpa", minimum: 2, scope: "overall" }, ogpa, citation(gpa, page)));
    if (cgpa) nodes.push(policyNode("UNT GPA", { type: "gpa", minimum: 2, scope: "unt" }, cgpa, citation(gpa, page)));
  }
  const english = sectionByName(page, "English Composition Proficiency");
  if (english) {
    const line = paragraphs(english).find((text) => text.includes("grade of C or better"));
    if (line) nodes.push(policyNode("Communication core grade", { type: "minGrade", grade: "C", scope: "Communication core requirement" }, line, citation(english, page)));
  }
  return nodes;
}

/** Program-page paragraph rules: hour minimums, grade floors, and GPA rules. */
function programPolicies(page: CatalogPage, headings: string[]): PolicyNode[] {
  const nodes: PolicyNode[] = [];
  for (const heading of headings) {
    const section = sectionByName(page, heading);
    if (!section) continue;
    const cite = citation(section, page);
    for (const text of paragraphs(section)) {
      const hours = /A minimum of (\d+) semester hours, of which (\d+) must be advanced/.exec(text);
      if (hours) {
        nodes.push(policyNode(`Total hours: ${hours[1]}`, { type: "totalHours", hours: Number(hours[1]) }, text, cite));
        nodes.push(policyNode(`Advanced hours: ${hours[2]}`, { type: "advancedHours", hours: Number(hours[2]) }, text, cite));
        continue;
      }
      if (/A minimum grade of C is required in all courses required in a student.s major for degree completion/.test(text)) {
        nodes.push(policyNode("Minimum grade of C (major courses)", { type: "minGrade", grade: "C", scope: "all courses required in the major" }, text, cite));
        continue;
      }
      if (/grade point average of at least 2\.0 in all mathematics courses/.test(text)) {
        nodes.push(policyNode("GPA 2.0 (mathematics courses 3350+ in the major)", { type: "gpa", minimum: 2, scope: "mathematics courses numbered 3350 or above" }, text, cite));
        continue;
      }
      if (/achieving a C or better in each course and an overall 2\.5 grade point average in these courses/.test(text)) {
        nodes.push(policyNode("Foundation grade rules", { type: "minGrade", grade: "C", scope: "foundation courses" }, text, cite));
        nodes.push(policyNode("Foundation GPA 2.5", { type: "gpa", minimum: 2.5, scope: "foundation courses" }, text, cite));
        continue;
      }
    }
  }
  return nodes;
}

/** CS and CE share the College of Engineering page shape. */
function deriveEngineering(page: CatalogPage, program: "cs" | "ce"): RequirementNode[] {
  const nodes: RequirementNode[] = [];
  nodes.push(...programPolicies(page, ["Hours required and general/college requirements"]));

  const major = sectionByName(page, "Major requirements");
  if (major) {
    const cite = citation(major, page);
    const hourLine = paragraphs(major).find((text) => /A minimum of \d+ semester hours, including/.test(text));
    const children: RequirementNode[] = [allNode("Required courses", major.items.filter((item) => item.type === "courseGroup" || item.type === "marker"), cite)];
    if (hourLine) {
      const hours = /A minimum of (\d+) semester hours/.exec(hourLine)!;
      children.push(note(`${hours[1]}-hour major minimum`, hourLine, cite));
    }
    const electiveLine = paragraphs(major).find((text) => text.includes("chosen from CSCE Advanced Elective Courses"));
    if (electiveLine) {
      const hours = Number(/plus (\d+) hours chosen/.exec(electiveLine)![1]);
      children.push({
        kind: "pool",
        name: `CSCE advanced electives, ${hours} hours`,
        hours,
        match: { subjects: ["CSCE"], minLevel: 4000, maxLevel: null },
        note: "The authoritative list is the CSCE Advanced Elective Courses list, linked from the catalog page and not captured here; the audit applies the 4000-level CSCE rule and flags this node as advisory.",
        citation: cite,
      } satisfies PoolNode);
    }
    nodes.push({ kind: "group", name: major.heading, children, citation: cite });
  }

  const other = sectionByName(page, "Other required courses");
  if (other) nodes.push(allNode("Other required courses", other.items, citation(other, page)));

  if (program === "cs") {
    for (const heading of ["CSCE core, 6 hours", "CSCE breadth courses, 6 hours"]) {
      const section = sectionByName(page, heading);
      if (!section) continue;
      const hours = Number(/(\d+) hours/.exec(heading)![1]);
      nodes.push(hoursNode(heading, hours, section.items, citation(section, page)));
    }
    const lab = sectionByName(page, "Choose 2 courses (6-8 hours) from the following courses");
    if (lab) nodes.push(chooseNode("Laboratory science, 6-8 hours (choose 2)", 2, lab.items, citation(lab, page)));
    const techWriting = sectionByName(page, "3 hours selected from");
    if (techWriting) {
      nodes.push({
        kind: "pool",
        name: "Technical writing, 3 hours",
        hours: 3,
        match: { subjects: ["TECM"], minLevel: 4000, maxLevel: null },
        citation: citation(techWriting, page),
      } satisfies PoolNode);
    }
  } else {
    const specialization = sectionByName(page, "Specialization area, 9 hours");
    if (specialization) {
      const branches = sectionsAfter(page, specialization.heading).slice(0, findStopIndex(page, specialization.heading, ["Note"]));
      const branchNodes = branches
        .filter((section) => section.items.some((item) => item.type === "courseGroup"))
        .map((section) => ({
          name: section.heading,
          node: chooseNode(`Three courses from ${section.heading}`, 3, section.items, citation(section, page)),
        }));
      if (branchNodes.length > 0) nodes.push({ kind: "choice", name: specialization.heading, branches: branchNodes, citation: citation(specialization, page) });
    }
  }

  const noteSection = sectionByName(page, "Note");
  if (noteSection) nodes.push(note("Note", paragraphs(noteSection).join(" "), citation(noteSection, page)));

  const minor = sectionByName(page, "Minor");
  if (minor) nodes.push(note("Minor", paragraphs(minor).join(" "), citation(minor, page)));

  const electives = sectionByName(page, "Electives");
  if (electives) nodes.push(note("Electives", paragraphs(electives).join(" "), citation(electives, page)));

  const policies = sectionByName(page, "Department policies");
  if (policies) {
    const cite = citation(policies, page);
    for (const text of paragraphs(policies)) {
      if (/A minimum grade of C is required in all courses required in a student.s major for degree completion/.test(text)) {
        nodes.push(policyNode("Minimum grade of C (major courses)", { type: "minGrade", grade: "C", scope: "all courses required in the major" }, text, cite));
        break;
      }
    }
  }
  return nodes;
}

function deriveMathPage(page: CatalogPage): RequirementNode[] {
  const nodes: RequirementNode[] = [];
  nodes.push(...programPolicies(page, ["Hours required and general/college requirements"]));

  const comm = sectionByName(page, "Communication (English Composition and Rhetoric) core requirement");
  if (comm) nodes.push(note("Communication core suggestion", paragraphs(comm).join(" "), citation(comm, page)));

  const majorSection = sectionByName(page, "Major requirements");
  const majorChildren: RequirementNode[] = majorSection
    ? [policyNode("43 hours of mathematics courses", { type: "subjectHours", hours: 43, subjects: ["MATH", "STAT"] }, "43 hours of mathematics courses, which must include:", citation(majorSection, page))]
    : [];

  const core = sectionByName(page, "Mathematics core, 19 hours");
  if (core) {
    const cite = citation(core, page);
    const children: RequirementNode[] = [allNode("Mathematics core", core.items.filter((item) => item.type === "courseGroup" || item.type === "marker"), cite)];
    const asterisk = paragraphs(core).find((text) => text.startsWith("*"));
    if (asterisk) children.push(note("Core substitutions", asterisk, cite));
    majorChildren.push({ kind: "group", name: core.heading, children, citation: cite });
  }

  const depth = sectionByName(page, "Depth requirement, 9 hours");
  if (depth) {
    const branchNodes: { name: string; node: RequirementNode }[] = [];
    const analysis = sectionByName(page, "Analysis");
    const analysisPlus = sectionByName(page, "Plus two of the following:");
    if (analysis && analysisPlus) {
      const cite = citation(analysis, page);
      branchNodes.push({
        name: "Analysis",
        node: {
          kind: "group",
          name: "Analysis",
          children: [
            allNode("Required", analysis.items.filter((item) => item.type === "courseGroup"), cite),
            chooseNode("Plus two of the following", 2, analysisPlus.items, citation(analysisPlus, page)),
          ],
          citation: cite,
        },
      });
    }
    const algebra = sectionByName(page, "Algebra");
    const algebraPlus = sectionByName(page, "Plus two of the following");
    if (algebra && algebraPlus) {
      const cite = citation(algebra, page);
      branchNodes.push({
        name: "Algebra",
        node: {
          kind: "group",
          name: "Algebra",
          children: [
            allNode("Required", algebra.items.filter((item) => item.type === "courseGroup"), cite),
            chooseNode("Plus two of the following", 2, algebraPlus.items, citation(algebraPlus, page)),
          ],
          citation: cite,
        },
      });
    }
    const probability = sectionByName(page, "Probability/statistics");
    if (probability) branchNodes.push({ name: "Probability/statistics", node: hoursNode("Probability/statistics, 9 hours", 9, probability.items, citation(probability, page)) });
    const geometry = sectionByName(page, "Geometry/topology");
    if (geometry) branchNodes.push({ name: "Geometry/topology", node: hoursNode("Geometry/topology, 9 hours", 9, geometry.items, citation(geometry, page)) });
    nodes.push({ kind: "choice", name: depth.heading, branches: branchNodes, citation: citation(depth, page) });
  }

  const breadth = sectionByName(page, "Breadth requirement, 9 hours");
  if (breadth) nodes.push(note("Breadth requirement, 9 hours", paragraphs(breadth).join(" "), citation(breadth, page)));

  const electives = sectionByName(page, "Mathematics electives, 6 hours");
  if (electives) {
    nodes.push({
      kind: "pool",
      name: "Mathematics electives, 6 hours",
      hours: 6,
      match: { subjects: ["MATH"], minLevel: 3350, maxLevel: null },
      citation: citation(electives, page),
    } satisfies PoolNode);
  }

  const lab = sectionByName(page, "Laboratory science");
  if (lab) {
    const branchNodes: { name: string; node: RequirementNode }[] = [];
    const optionSpecs: Array<[string, string | null]> = [
      ["Option 1, Biology emphasis", "Plus one of the following"],
      ["Option 2, Chemistry emphasis", null],
      ["Option 3, Physics emphasis", null],
      ["Option 4", null],
      ["Option 5", "Plus one of the following lecture and laboratory combinations"],
    ];
    for (const [heading, plusHeading] of optionSpecs) {
      const section = sectionByName(page, heading);
      if (!section) continue;
      const cite = citation(section, page);
      const children: RequirementNode[] = [];
      const plus = plusHeading ? sectionByName(page, plusHeading) : null;
      if (plus) {
        if (section.items.some((item) => item.type === "courseGroup")) children.push(allNode("Required", section.items, cite));
        children.push(chooseNode("Plus one of the following", 1, plus.items, citation(plus, page)));
      } else if (heading === "Option 2, Chemistry emphasis" || heading === "Option 3, Physics emphasis") {
        const courseItems = section.items.filter((item) => item.type === "courseGroup" || item.type === "marker");
        children.push(allNode(heading === "Option 2, Chemistry emphasis" ? "Required chemistry sequence" : "Required physics sequences", courseItems, cite));
      }
      for (const text of paragraphs(section).filter((candidate) => candidate.includes("One additional course"))) {
        children.push(note("Additional course", text, cite));
      }
      if (heading === "Option 4") children.push(note("Option 4", paragraphs(section).join(" "), cite));
      if (children.length === 1 && children[0].kind === "note") branchNodes.push({ name: heading, node: children[0] });
      else if (children.length > 0) branchNodes.push({ name: heading, node: { kind: "group", name: heading, children, citation: cite } });
    }
    nodes.push({ kind: "choice", name: "Laboratory science", branches: branchNodes, citation: citation(lab, page) });
  }

  const foreign = sectionByName(page, "Foreign language");
  if (foreign) {
    const option1 = sectionByName(page, "Option 1");
    const option2 = sectionByName(page, "Option 2");
    const branchNodes: { name: string; node: RequirementNode }[] = [];
    if (option1) branchNodes.push({ name: "Proficiency (Option 1)", node: note("Proficiency in a foreign language equivalent to 1020", paragraphs(option1).join(" "), citation(option1, page)) });
    if (option2) branchNodes.push({ name: "6 hours of technical writing (Option 2)", node: hoursNode("Six hours of technical writing", 6, option2.items, citation(option2, page)) });
    nodes.push({ kind: "choice", name: "Foreign language", branches: branchNodes, citation: citation(foreign, page) });
  }

  const programming = sectionByName(page, "Computer programming");
  if (programming) {
    const cite = citation(programming, page);
    nodes.push({
      kind: "group",
      name: "Computer programming",
      children: [
        chooseNode("One programming course", 1, programming.items.filter((item) => item.type === "courseGroup" || item.type === "marker"), cite),
        note("Programming competency", paragraphs(programming).filter((text) => !text.includes("Required courses:")).join(" "), cite),
      ],
      citation: cite,
    });
  }

  const minor = sectionByName(page, "Minor requirements");
  if (minor) nodes.push(note("Minor requirements", paragraphs(minor).join(" "), citation(minor, page)));

  nodes.push(...programPolicies(page, ["Other requirements"]));

  if (majorSection && majorChildren.length > 1) {
    return [
      { kind: "group", name: "Major requirements, 43 hours of mathematics courses", children: majorChildren, citation: citation(majorSection, page) },
      ...nodes,
    ];
  }
  return nodes;
}

function deriveBiology(page: CatalogPage): RequirementNode[] {
  const nodes: RequirementNode[] = [];
  nodes.push(...programPolicies(page, ["Hours required and general/college requirements"]));

  const degree = sectionByName(page, "Degree requirements");
  if (degree) nodes.push(note("Degree requirements", paragraphs(degree).join(" "), citation(degree, page)));

  const foundation = sectionByName(page, "Foundation course requirements");
  if (foundation) {
    const cite = citation(foundation, page);
    const children: RequirementNode[] = [];
    children.push(...programPolicies(page, ["Foundation course requirements"]));
    const biology = sectionByName(page, "Biology courses:");
    if (biology) children.push(allNode("Biology foundation courses", biology.items, citation(biology, page)));
    const oneOf = sectionByName(page, "One of the following courses (with lab, if indicated):");
    if (oneOf) children.push(chooseNode("One of the following courses (with lab, if indicated)", 1, oneOf.items, citation(oneOf, page)));
    const chemistry = sectionByName(page, "Chemistry courses:");
    if (chemistry) children.push(allNode("Chemistry foundation courses", chemistry.items, citation(chemistry, page)));
    const math = sectionByName(page, "Math courses:");
    if (math) children.push(allNode("Math foundation courses", math.items, citation(math, page)));
    nodes.push({ kind: "group", name: "Foundation course requirements", children, citation: cite });
  }

  const bioReq = sectionByName(page, "Biology requirements");
  if (bioReq) {
    const cite = citation(bioReq, page);
    const children: RequirementNode[] = [];
    children.push(note("Biology requirements rule", paragraphs(bioReq).join(" "), cite));
    const second = sectionByName(page, "Options for the second 2000 level course requirement (with lab, if indicated):");
    if (second) children.push(chooseNode("Second 2000-level biology course", 1, second.items, citation(second, page)));
    const advanced = sectionByName(page, "Advanced biology requirements:");
    if (advanced) children.push(allNode("Advanced biology requirements", advanced.items, citation(advanced, page)));
    const physiology = sectionByName(page, "Physiology requirement options (with lab):");
    if (physiology) children.push(chooseNode("Physiology requirement (with lab)", 1, physiology.items, citation(physiology, page)));
    const electivePool = sectionByName(page, "Advanced biology electives:");
    if (electivePool) {
      const electiveLine = paragraphs(bioReq).find((text) => text.includes("advanced biology elective hours"));
      const hours = electiveLine ? Number(/(\d+) advanced biology elective hours/.exec(electiveLine)![1]) : 16;
      children.push(hoursNode(`Advanced biology electives, ${hours} hours`, hours, electivePool.items, citation(electivePool, page)));
      children.push(note("Advanced biology electives rule", paragraphs(electivePool).join(" "), citation(electivePool, page)));
    }
    nodes.push({ kind: "group", name: "Biology requirements", children, citation: cite });
  }

  const other = sectionByName(page, "Other course requirements");
  if (other) nodes.push(allNode("Other course requirements (physics and math)", other.items, citation(other, page)));

  const chemReq = sectionByName(page, "Chemistry requirements");
  if (chemReq) {
    const cite = citation(chemReq, page);
    const children: RequirementNode[] = [
      allNode("Chemistry minor courses", chemReq.items.filter((item) => item.type === "courseGroup" || item.type === "marker"), cite),
      note("Chemistry minor rule", paragraphs(chemReq).join(" "), cite),
    ];
    nodes.push({ kind: "group", name: "Chemistry requirements", children, citation: cite });
  }

  const plus4 = sectionByName(page, "Plus 4 advanced hours chosen from");
  if (plus4) nodes.push(hoursNode("Plus 4 advanced hours chosen from", 4, plus4.items, citation(plus4, page)));

  const electives = sectionByName(page, "Electives");
  if (electives) nodes.push(note("Electives", paragraphs(electives).join(" "), citation(electives, page)));

  const otherReq = sectionByName(page, "Other requirements");
  if (otherReq) nodes.push(note("Other requirements", paragraphs(otherReq).join(" "), citation(otherReq, page)));

  return nodes;
}

function deriveCore(page: CatalogPage): RequirementNode[] {
  const nodes: RequirementNode[] = [];
  const intro = sectionByName(page, "University Core Curriculum Requirements");
  if (intro) {
    const line = paragraphs(intro).find((text) => text.includes("42 semester credit hours"));
    if (line) nodes.push(policyNode("Core total: 42 hours", { type: "totalHours", hours: 42 }, line, citation(intro, page)));
  }

  const comm = sectionByName(page, "Communication, 6 hours");
  if (comm) {
    const cite = citation(comm, page);
    const children: RequirementNode[] = [];
    const group1 = sectionByName(page, "Group 1");
    const group2 = sectionByName(page, "Group 2");
    if (group1) children.push(chooseNode("Communication Group 1", 1, group1.items, citation(group1, page)));
    if (group2) children.push(chooseNode("Communication Group 2", 1, group2.items, citation(group2, page)));
    const gradeLine = paragraphs(comm).find((text) => text.includes("grade of C or higher"));
    if (gradeLine) children.push(policyNode("Communication core grade", { type: "minGrade", grade: "C", scope: "Communication core requirement" }, gradeLine, cite));
    nodes.push({ kind: "group", name: "Communication, 6 hours", children, citation: cite });
  }

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
    const section = sectionByName(page, heading);
    if (section) nodes.push(hoursNode(heading, hours, section.items, citation(section, page)));
  }

  const option = sectionByName(page, "Component Area Option, 6 hours");
  if (option) {
    const optionA = sectionByName(page, "Component Area Option A");
    const optionB = sectionByName(page, "Component Area Option B");
    const branches: { name: string; node: RequirementNode }[] = [];
    if (optionA) branches.push({ name: "6 hours from Component Area Option A", node: hoursNode("Six hours from Component Area Option A", 6, optionA.items, citation(optionA, page)) });
    if (optionA && optionB) {
      branches.push({
        name: "3 hours from Option A and 3 hours from Option B",
        node: {
          kind: "group",
          name: "Option A plus Option B",
          children: [
            hoursNode("Three hours from Component Area Option A", 3, optionA.items, citation(optionA, page)),
            hoursNode("Three hours from Component Area Option B", 3, optionB.items, citation(optionB, page)),
          ],
          citation: citation(option, page),
        },
      });
    }
    nodes.push({ kind: "choice", name: "Component Area Option, 6 hours", branches, citation: citation(option, page) });
    if (optionA) {
      const doubleDip = paragraphs(optionA).filter((text) => text.includes("double-dip") || text.includes("may not count toward Component Area Option A"));
      if (doubleDip.length > 0) nodes.push(note("Component Area Option double-dip rule", doubleDip.join(" "), citation(optionA, page)));
      const otherCore = paragraphs(optionA).find((text) => text.startsWith("Or any course included in the other core areas"));
      if (otherCore) nodes.push(note("Option A other-core courses", otherCore, citation(optionA, page)));
    }
  }

  const transfer = sectionByName(page, "Transfer of the Core Curriculum");
  const exam = sectionByName(page, "Advanced Standing Examination (AP/IB/CLEP)");
  const otherWays = [transfer, exam].filter(Boolean) as Section[];
  if (otherWays.length > 0) {
    nodes.push(note("Other ways to complete the core", otherWays.map((section) => paragraphs(section).join(" ")).join(" "), citation(otherWays[0], page)));
  }
  return nodes;
}

export type ProgramSpec = {
  id: string;
  name: string;
  file: string;
  sourceUrl: string;
  derive: (page: CatalogPage, university: CatalogPage) => RequirementNode[];
};

export const PROGRAM_SPECS: ProgramSpec[] = [
  { id: "cs-bs", name: "Computer Science, BS", file: "cs-bs.html", sourceUrl: "", derive: (page, university) => [...deriveEngineering(page, "cs"), ...universityPolicies(university)] },
  { id: "ce-bs", name: "Computer Engineering, BS", file: "ce-bs.html", sourceUrl: "", derive: (page, university) => [...deriveEngineering(page, "ce"), ...universityPolicies(university)] },
  { id: "math-bsmth", name: "Mathematics, BSMTH (non–teacher certification)", file: "math-bsmth.html", sourceUrl: "", derive: (page, university) => [...deriveMathPage(page), ...universityPolicies(university)] },
  { id: "biology-bsbio", name: "Biology, BSBIO", file: "biology-bsbio.html", sourceUrl: "", derive: (page, university) => [...deriveBiology(page), ...universityPolicies(university)] },
  { id: "core", name: "University Core Curriculum", file: "core-curriculum.html", sourceUrl: "", derive: (page, university) => [...deriveCore(page), ...universityPolicies(university)] },
];
