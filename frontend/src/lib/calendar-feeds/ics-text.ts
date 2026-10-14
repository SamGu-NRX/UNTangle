/**
 * RFC 5545 text mechanics: line unfolding, content-line parsing with property
 * parameters, and TEXT value unescaping. Pure string work with no calendar
 * semantics.
 */

/**
 * Unfolds folded content lines: a continuation line starts with a single space
 * or tab and appends to the previous logical line, separator removed. Tolerates
 * bare LF and CR line endings alongside RFC 5545's CRLF.
 */
export function unfoldLines(raw: string): string[] {
  const logical: string[] = [];
  for (const rawLine of raw.split(/\r\n|\n|\r/)) {
    const isContinuation = rawLine.startsWith(" ") || rawLine.startsWith("\t");
    if (isContinuation && logical.length > 0) {
      logical[logical.length - 1] += rawLine.slice(1);
    } else {
      logical.push(rawLine);
    }
  }
  return logical;
}

/** One unfolded content line: `NAME;PARAM=value:value` with parameters unquoted. */
export type ContentLine = {
  /** Uppercased property or component name. */
  name: string;
  /** Uppercased parameter names mapped to their values; values keep their case. */
  params: Record<string, string>;
  /** The raw value, not yet unescaped. */
  value: string;
};

/**
 * Parses one unfolded content line. Quoted parameter values may contain
 * colons and semicolons. Returns null for lines without a value colon, which
 * callers skip.
 */
export function parseContentLine(line: string): ContentLine | null {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const firstSemicolon = head.indexOf(";");
  const name = (firstSemicolon < 0 ? head : head.slice(0, firstSemicolon)).trim().toUpperCase();
  if (name === "") return null;
  const params: Record<string, string> = {};
  if (firstSemicolon >= 0) parseParams(head.slice(firstSemicolon + 1), params);
  return { name, params, value };
}

/** The first colon that ends the name and parameters, ignoring colons inside quotes. */
function findValueColon(line: string): number {
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) return i;
  }
  return -1;
}

function parseParams(input: string, out: Record<string, string>): void {
  let inQuotes = false;
  let token = "";
  const tokens: string[] = [];
  for (const ch of input) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      token += ch;
    } else if (ch === ";" && !inQuotes) {
      tokens.push(token);
      token = "";
    } else {
      token += ch;
    }
  }
  tokens.push(token);
  for (const entry of tokens) {
    const equals = entry.indexOf("=");
    if (equals <= 0) continue;
    const key = entry.slice(0, equals).trim().toUpperCase();
    let value = entry.slice(equals + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (key !== "") out[key] = value;
  }
}

/**
 * Undoes RFC 5545 3.3.11 TEXT escaping: \\n and \\N become newlines, and \\,
 * \\; and \\\\ become their literal characters. Unknown escapes keep both
 * characters, so sloppy feeds round-trip instead of losing text.
 */
export function unescapeText(value: string): string {
  if (!value.includes("\\")) return value;
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== "\\" || i === value.length - 1) {
      out += ch;
      continue;
    }
    const next = value[i + 1];
    if (next === "n" || next === "N") out += "\n";
    else if (next === "," || next === ";" || next === "\\") out += next;
    else out += ch + next;
    i += 1;
  }
  return out;
}

/** Drops a leading UTF-8 byte-order mark, which real feeds sometimes carry. */
/** Drops a leading UTF-8 byte-order mark, which real feeds sometimes carry. */
export function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}