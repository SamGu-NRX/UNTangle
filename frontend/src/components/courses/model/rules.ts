/**
 * Readable requirement text. Works on the engine's portable `Prerequisite` and
 * `Reason` trees only, so another school's adapter gets the same sentences.
 */
import type { Prerequisite, Reason } from "@/lib/prereq";

export type RuleNode =
  | { kind: "course"; id: string; grade?: string; together?: boolean }
  | { kind: "all" | "any"; items: RuleNode[] }
  | { kind: "standing"; text: string }
  | { kind: "consent"; text: string }
  | { kind: "unparsed"; text: string };

export type RuleToken =
  | { kind: "text"; text: string }
  | { kind: "course"; id: string }
  | { kind: "unparsed"; text: string };

function group(kind: "all" | "any", items: RuleNode[]): RuleNode | null {
  const flat = items.flatMap((item) => (item.kind === kind ? item.items : [item]));
  if (flat.length === 0) return null;
  return flat.length === 1 ? flat[0] : { kind, items: flat };
}

function withGrade(node: RuleNode, grade: string): RuleNode {
  if (node.kind === "course") return { ...node, grade };
  if (node.kind === "all" || node.kind === "any") return { ...node, items: node.items.map((item) => withGrade(item, grade)) };
  return node;
}

function concurrent(node: RuleNode): RuleNode {
  if (node.kind === "course") return { ...node, together: true };
  if (node.kind === "all" || node.kind === "any") return { ...node, items: node.items.map(concurrent) };
  return node;
}

/** The catalog rule as written. Null means the course has no requirement. */
export function ruleFromPrerequisite(node: Prerequisite): RuleNode | null {
  switch (node.kind) {
    case "course":
      return { kind: "course", id: node.courseId };
    case "and":
    case "or":
      return group(node.kind === "and" ? "all" : "any", node.children.flatMap((child) => ruleFromPrerequisite(child) ?? []));
    case "minGrade": {
      const inner = ruleFromPrerequisite(node.requirement);
      return inner && withGrade(inner, node.grade);
    }
    case "corequisite": {
      const inner = ruleFromPrerequisite(node.requirement);
      return inner && concurrent(inner);
    }
    case "standing":
      return { kind: "standing", text: `${node.minimum} standing` };
    case "consent":
      return { kind: "consent", text: node.authority.charAt(0).toLowerCase() + node.authority.slice(1) };
    case "unknown":
      return { kind: "unparsed", text: node.source.trim().replace(/\s+([.,;])/g, "$1") };
  }
}

/**
 * The part of an evaluated rule that still blocks the course. Satisfied
 * branches drop out of an AND; an unmet OR keeps every alternative.
 */
export function unmetFromReason(reason: Reason): RuleNode | null {
  if (reason.outcome === "satisfied") return null;
  const children = reason.children ?? [];
  switch (reason.kind) {
    case "and":
      return group("all", children.flatMap((child) => unmetFromReason(child) ?? []));
    case "or":
      return group("any", children.flatMap((child) => unmetFromReason(child) ?? []));
    case "course":
    case "grade":
    case "override":
      return reason.courseId ? { kind: "course", id: reason.courseId } : null;
    case "corequisite": {
      const inner = group("all", children.flatMap((child) => unmetFromReason(child) ?? []));
      return inner && concurrent(inner);
    }
    case "standing":
      return { kind: "standing", text: reason.source ?? "class standing" };
    case "advisor":
      return children.length > 0
        ? group("all", children.flatMap((child) => unmetFromReason(child) ?? []))
        : { kind: "unparsed", text: reason.source ?? reason.message };
    case "cycle":
      return group("all", children.flatMap((child) => unmetFromReason(child) ?? []));
    default:
      return null;
  }
}

/** Drops unparsed and consent clauses, for the one-line row summary. */
export function onlyCheckable(node: RuleNode | null): RuleNode | null {
  if (!node) return null;
  if (node.kind === "unparsed" || node.kind === "consent") return null;
  if (node.kind === "all" || node.kind === "any") {
    const items = node.items.flatMap((item) => onlyCheckable(item) ?? []);
    // Removing an alternative from an OR would overstate what is required.
    if (node.kind === "any" && items.length !== node.items.length) return null;
    return group(node.kind, items);
  }
  return node;
}

/**
 * Splits top-level clauses the parser could not read from the readable rule,
 * so the panel can quote them separately instead of gluing catalog prose into
 * a sentence. Unparsed text nested inside an OR stays inline.
 */
export function splitUnparsed(node: RuleNode | null): { readable: RuleNode | null; unparsed: string[] } {
  if (!node) return { readable: null, unparsed: [] };
  if (node.kind === "unparsed") return { readable: null, unparsed: [node.text] };
  if (node.kind !== "all") return { readable: node, unparsed: [] };
  const unparsed = node.items.flatMap((item) => (item.kind === "unparsed" ? [item.text] : []));
  return { readable: group("all", node.items.filter((item) => item.kind !== "unparsed")), unparsed };
}

export function hasUnparsed(node: RuleNode | null): boolean {
  if (!node) return false;
  if (node.kind === "unparsed" || node.kind === "consent") return true;
  return (node.kind === "all" || node.kind === "any") && node.items.some(hasUnparsed);
}

export function ruleCourseIds(node: RuleNode | null): string[] {
  if (!node) return [];
  if (node.kind === "course") return [node.id];
  if (node.kind === "all" || node.kind === "any") return [...new Set(node.items.flatMap(ruleCourseIds))];
  return [];
}

const text = (value: string): RuleToken => ({ kind: "text", text: value });

function sharedGrade(items: RuleNode[]): string | undefined {
  const first = items[0];
  if (first?.kind !== "course" || !first.grade) return undefined;
  return items.every((item) => item.kind === "course" && item.grade === first.grade && !item.together) ? first.grade : undefined;
}

function list(parts: RuleToken[][], word: "and" | "or"): RuleToken[] {
  return parts.flatMap((part, index) => {
    if (index === 0) return part;
    const joiner = index === parts.length - 1 ? ` ${word} ` : ", ";
    return [text(joiner), ...part];
  });
}

/**
 * Plain-language tokens: "CSCE 1030 (C or better) and MATH 1100, MATH 1650 or
 * MATH 1710 (C or better)". Nested groups get parentheses.
 */
export function ruleTokens(node: RuleNode | null, nested = false, options: { grades?: boolean } = {}): RuleToken[] {
  const grades = options.grades ?? true;
  if (!node) return [];
  switch (node.kind) {
    case "course": {
      const tokens: RuleToken[] = [{ kind: "course", id: node.id }];
      if (grades && node.grade) tokens.push(text(` (${node.grade} or better)`));
      if (node.together) tokens.push(text(" (same term is fine)"));
      return tokens;
    }
    case "standing":
    case "consent":
      return [text(node.text)];
    case "unparsed":
      return [{ kind: "unparsed", text: node.text }];
    case "all":
    case "any": {
      const shared = grades ? sharedGrade(node.items) : undefined;
      const parts = node.items.map((item) =>
        shared && item.kind === "course" ? [{ kind: "course", id: item.id } as RuleToken] : ruleTokens(item, true, options),
      );
      const body = list(parts, node.kind === "all" ? "and" : "or");
      const wrapped = nested && node.items.length > 1 ? [text("("), ...body, text(")")] : body;
      return shared ? [...wrapped, text(` with ${shared} or better`)] : wrapped;
    }
  }
}

export function tokensToString(tokens: RuleToken[]): string {
  return tokens.map((token) => (token.kind === "course" ? token.id : token.text)).join("");
}
