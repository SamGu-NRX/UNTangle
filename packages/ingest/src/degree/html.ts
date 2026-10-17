/**
 * A small, dependency-free HTML reader for the subset of markup the Acalog
 * catalog pages use. It tokenizes tags, builds an element tree, skips
 * script/style content, and decodes the entities the catalog emits. It is
 * not a general HTML parser; it is exact about the shapes it reads
 * (div, h1-h6, p, ul, ol, li, a, em, strong, table, tr, td, span, hr, br)
 * and tolerates the rest by treating unknown tags as transparent containers.
 */

export type HtmlElement = {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
};

export type HtmlNode = HtmlElement | string;

export function isElement(node: HtmlNode): node is HtmlElement {
  return typeof node !== "string";
}

export function elementText(node: HtmlNode): string {
  if (typeof node === "string") return node;
  return node.children.map(elementText).join("");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  rsquo: "\u2019",
  lsquo: "\u2018",
  ldquo: "\u201c",
  rdquo: "\u201d",
  hellip: "\u2026",
  aacute: "\u00e1",
  eacute: "\u00e9",
  iacute: "\u00ed",
  oacute: "\u00f3",
  uacute: "\u00fa",
  ntilde: "\u00f1",
  copy: "\u00a9",
  middot: "\u00b7",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SKIP_CONTENT = new Set(["script", "style", "head", "title"]);

function attr(attrs: Record<string, string>, name: string): string | null {
  return Object.hasOwn(attrs, name) ? attrs[name] : null;
}

/** Reads one tag or text run starting at `i`; returns the consumed length. */
function readNode(html: string, i: number): { length: number; node: HtmlNode } | null {
  const char = html[i];
  if (char !== "<") {
    const next = html.indexOf("<", i);
    const end = next === -1 ? html.length : next;
    return { length: end - i, node: decodeEntities(html.slice(i, end)) };
  }
  const comment = html.startsWith("<!--", i);
  if (comment) {
    const end = html.indexOf("-->", i);
    return { length: end === -1 ? html.length - i : end + 3 - i, node: "" };
  }
  const doctype = /^<!/.exec(html.slice(i, i + 9));
  if (doctype) {
    const end = html.indexOf(">", i);
    return { length: end === -1 ? html.length - i : end + 1 - i, node: "" };
  }
  const closing = html[i + 1] === "/";
  const match = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/.exec(html.slice(i));
  if (!match) return { length: 1, node: decodeEntities("<") };
  const tag = match[1].toLowerCase();
  const attrText = match[2] ?? "";
  const attrs: Record<string, string> = {};
  for (const pair of attrText.matchAll(/([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|[^\s"'>]+))?/g)) {
    attrs[pair[1].toLowerCase()] = pair[3] ?? pair[4] ?? pair[2] ?? "";
  }
  if (closing) return { length: match[0].length, node: { tag, attrs, children: [], closing: true } as never };
  const selfClosed = match[3] === "/" || VOID_TAGS.has(tag);
  if (selfClosed) return { length: match[0].length, node: { tag, attrs, children: [] } };
  // Skip the content of tags whose children are never wanted.
  if (SKIP_CONTENT.has(tag)) {
    const closeIndex = html.toLowerCase().indexOf(`</${tag}`, i + match[0].length);
    const end = closeIndex === -1 ? html.length : html.indexOf(">", closeIndex) + 1;
    return { length: end - i, node: { tag, attrs, children: [] } };
  }
  return { length: match[0].length, node: { tag, attrs, children: [] } };
}

type OpenElement = HtmlElement & { closing?: never };

/**
 * Parses HTML into a tree. Malformed nesting is repaired by closing open
 * elements when an end tag matches an ancestor, which is how the catalog's
 * own markup behaves in browsers for the tags this parser reads.
 */
export function parseHtml(html: string): { children: HtmlNode[] } {
  const root: OpenElement = { tag: "#root", attrs: {}, children: [] };
  const stack: OpenElement[] = [root];
  let i = 0;
  while (i < html.length) {
    const read = readNode(html, i);
    if (!read) break;
    i += read.length;
    const node = read.node;
    if (typeof node === "string") {
      if (node.length > 0) stack.at(-1)!.children.push(node);
      continue;
    }
    const element = node as OpenElement;
    if (Object.hasOwn(element as never, "closing")) {
      const closeTag = element.tag;
      const openIndex = stack.findLastIndex((open) => open.tag === closeTag);
      if (openIndex > 0) stack.length = openIndex;
      continue;
    }
    stack.at(-1)!.children.push(element);
    // Void elements (br, hr, img, ...) never hold children: do not open them.
    if (!VOID_TAGS.has(element.tag)) stack.push(element);
  }
  return { children: root.children };
}

/** First descendant matching a predicate, depth-first. */
export function findFirst(node: HtmlNode, matches: (element: HtmlElement) => boolean): HtmlElement | null {
  if (typeof node === "string") return null;
  if (matches(node)) return node;
  for (const child of node.children) {
    const found = findFirst(child, matches);
    if (found) return found;
  }
  return null;
}

export function hasClass(element: HtmlElement, className: string): boolean {
  return (attr(element.attrs, "class") ?? "").split(/\s+/).includes(className);
}

export function id(element: HtmlElement): string | null {
  return attr(element.attrs, "id");
}

/** Whitespace-normalized text of an element. */
export function normalizedText(node: HtmlNode): string {
  return elementText(node).replace(/\s+/g, " ").trim();
}
