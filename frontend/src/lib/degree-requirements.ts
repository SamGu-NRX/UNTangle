/**
 * src/lib/degree-requirements.ts
 *
 * The degree-requirements model the /degree experience consumes. Data
 * originates from the published UNT catalog (ingested by
 * tools/degree-requirements/ with a robots-honoring, receipted fetcher) and
 * is committed as a generated manifest in src/lib/generated/.
 *
 * Design contract:
 * - every requirement traces to the published catalog page via the manifest's
 *   sourceUrl + sourceSha256 (the ingestion receipt verifies those bytes);
 * - anything the ingestion could not structure confidently — a pattern
 *   ("any 4000-level TECM course"), an ambiguous "or", a policy note — is an
 *   `advisor` item: surfaced honestly, never counted as satisfied or unmet;
 * - progress arithmetic only uses hours it actually knows; when a choose
 *   block's options have unknown hours the result is marked `partial`
 *   instead of guessing.
 */

import type { MajorId } from "./types";

export type DegreeRequirementNode =
  | { kind: "course"; courseCode: string; title: string; creditHours: number | null }
  | { kind: "choose"; label: string; chooseHours: number; options: DegreeRequirementNode[] }
  | { kind: "group"; label: string; hoursLabel: string | null; items: DegreeRequirementNode[] }
  | { kind: "advisor"; label: string; note: string | null };

export type DegreeRequirementsSection = {
  label: string;
  hoursLabel: string | null;
  items: DegreeRequirementNode[];
};

export type DegreeRequirements = {
  majorId: MajorId;
  majorName: string;
  catalogYear: string;
  sourceUrl: string;
  fetchedAt: string;
  sourceSha256: string;
  totalHours: number | null;
  advancedHours: number | null;
  majorHours: number | null;
  sections: DegreeRequirementsSection[];
  advisorNotes: string[];
};

export type RequirementNodeStatus = "satisfied" | "inProgress" | "unmet" | "info";

export type NodeEvaluation = {
  status: RequirementNodeStatus;
  hoursDone: number;
  hoursTarget: number | null;
  partial: boolean; // true when unknown hours forced a count-based estimate
  children: NodeEvaluation[];
};

export type SectionEvaluation = {
  label: string;
  hoursDone: number;
  hoursTarget: number | null;
  partial: boolean;
  status: RequirementNodeStatus;
  items: NodeEvaluation[];
};

export type DegreeProgress = {
  majorId: MajorId;
  sections: SectionEvaluation[];
  advisorNotes: string[];
  totalHoursDone: number;
  totalHoursTarget: number | null;
  partial: boolean;
};

function hoursOf(node: DegreeRequirementNode, hoursFor: (code: string) => number | null): number | null {
  if (node.kind === "course") return node.creditHours ?? hoursFor(node.courseCode) ?? null;
  return null;
}

function hasAnyStatus(nodes: NodeEvaluation[], status: RequirementNodeStatus): boolean {
  return nodes.some((n) => n.status === status || (n.children.length > 0 && hasAnyStatus(n.children, status)));
}

/**
 * Evaluate one requirement node against completed / in-progress courses.
 * `hoursFor` supplies credit hours for courses the requirement did not carry
 * (the app catalog is the production source).
 */
export function evaluateNode(
  node: DegreeRequirementNode,
  completedCodes: ReadonlySet<string>,
  inProgressCodes: ReadonlySet<string>,
  hoursFor: (code: string) => number | null,
): NodeEvaluation {
  if (node.kind === "advisor") {
    return { status: "info", hoursDone: 0, hoursTarget: null, partial: false, children: [] };
  }
  if (node.kind === "course") {
    const code = node.courseCode;
    if (completedCodes.has(code)) {
      const h = hoursOf(node, hoursFor);
      return { status: "satisfied", hoursDone: h ?? 0, hoursTarget: h, partial: h == null, children: [] };
    }
    if (inProgressCodes.has(code)) {
      return { status: "inProgress", hoursDone: 0, hoursTarget: hoursOf(node, hoursFor), partial: false, children: [] };
    }
    return { status: "unmet", hoursDone: 0, hoursTarget: hoursOf(node, hoursFor), partial: false, children: [] };
  }
  if (node.kind === "choose") {
    let done = 0;
    let partial = false;
    let inProgress = false;
    const children = node.options.map((option) => {
      const evaluation = evaluateNode(option, completedCodes, inProgressCodes, hoursFor);
      done += evaluation.hoursDone;
      partial = partial || evaluation.partial;
      if (evaluation.status === "inProgress") inProgress = true;
      return evaluation;
    });
    const status: RequirementNodeStatus =
      done >= node.chooseHours ? "satisfied" : inProgress ? "inProgress" : "unmet";
    return { status, hoursDone: done, hoursTarget: node.chooseHours, partial, children };
  }
  // group: progress is the sum of its items (no own target beyond that).
  let done = 0;
  let partial = false;
  const children = node.items.map((item) => {
    const evaluation = evaluateNode(item, completedCodes, inProgressCodes, hoursFor);
    done += evaluation.hoursDone;
    partial = partial || evaluation.partial;
    return evaluation;
  });
  const status: RequirementNodeStatus = children.every((c) => c.status === "satisfied")
    ? "satisfied"
    : hasAnyStatus(children, "inProgress")
      ? "inProgress"
      : "unmet";
  return { status, hoursDone: done, hoursTarget: null, partial, children };
}

/**
 * Evaluate a full degree's requirements. Section targets use the hoursLabel
 * when it parses to a number ("16 hours"), else stay null (counted
 * course-by-course instead, flagged partial when hours are unknown).
 */
export function evaluateDegreeRequirements(
  reqs: DegreeRequirements,
  completed: ReadonlyArray<{ code: string }>,
  inProgress: ReadonlyArray<{ code: string }> = [],
  hoursFor: (code: string) => number | null = () => null,
): DegreeProgress {
  const completedCodes = new Set(completed.map((c) => c.code));
  const inProgressCodes = new Set(inProgress.map((c) => c.code));
  const sections = reqs.sections.map((section) => {
    const items = section.items.map((item) => evaluateNode(item, completedCodes, inProgressCodes, hoursFor));
    const hoursDone = items.reduce((sum, item) => sum + item.hoursDone, 0);
    const labelMatch = section.hoursLabel?.match(/(\d+)\s*hours?/i);
    const hoursTarget = labelMatch ? Number(labelMatch[1]) : null;
    const partial = items.some((item) => item.partial);
    const status: RequirementNodeStatus = items.every((i) => i.status === "satisfied" || i.status === "info")
      ? "satisfied"
      : hasAnyStatus(items, "inProgress")
        ? "inProgress"
        : "unmet";
    return { label: section.label, hoursDone, hoursTarget, partial, status, items };
  });
  const totalHoursDone = sections.reduce((sum, s) => sum + s.hoursDone, 0);
  return {
    majorId: reqs.majorId,
    sections,
    advisorNotes: reqs.advisorNotes,
    totalHoursDone,
    totalHoursTarget: reqs.totalHours,
    partial: sections.some((s) => s.partial),
  };
}
