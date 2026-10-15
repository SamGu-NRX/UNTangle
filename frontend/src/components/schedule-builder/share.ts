/**
 * A week carried outside the app: in a share link (the schedule is encoded
 * in the URL; nothing is stored or revocable, untangle-v3.md "Decisions
 * taken") or in a saved file. Decoding is strict: anything malformed is
 * refused with a reason, never half-read.
 */

export type SharedWeek = {
  /** Term id, such as "spring-2027". */
  term: string;
  /** Course code -> section id. */
  sections: Record<string, string>;
};

/** The URL parameter a share link uses. */
export const SHARE_PARAM = "week";
const FILE_FORMAT = "unt-schedule-week";
const VERSION = 1;
const TERM = /^(spring|summer|fall)-\d{4}$/;
const COURSE = /^[A-Z]{3,4} \d{3,4}[A-Z]?$/;
/** More courses than anyone takes in a term; a guard against junk, not a rule. */
const MAX_COURSES = 12;
const MAX_ID = 160;

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): string {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function check(term: unknown, entries: unknown): SharedWeek | { error: string } {
  if (typeof term !== "string" || !TERM.test(term)) return { error: "It doesn't name a term." };
  if (!Array.isArray(entries) || entries.length === 0) return { error: "It has no classes." };
  if (entries.length > MAX_COURSES) return { error: `It lists more than ${MAX_COURSES} courses.` };
  const sections: Record<string, string> = {};
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) return { error: "One of its classes is unreadable." };
    const [code, id] = entry;
    if (typeof code !== "string" || !COURSE.test(code)) return { error: "One of its course codes is unreadable." };
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID) return { error: `The section for ${code} is unreadable.` };
    if (code in sections) return { error: `It lists ${code} twice.` };
    sections[code] = id;
  }
  return { term, sections };
}

const entriesOf = (week: SharedWeek) => Object.entries(week.sections).sort(([a], [b]) => a.localeCompare(b));

export function encodeShare(week: SharedWeek): string {
  return base64url(JSON.stringify([VERSION, week.term, entriesOf(week)]));
}

export function decodeShare(text: string): SharedWeek | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(fromBase64url(text));
  } catch {
    return { error: "The link is cut off or changed." };
  }
  if (!Array.isArray(value) || value.length !== 3 || value[0] !== VERSION) return { error: "The link is from a different version." };
  return check(value[1], value[2]);
}

/** The saved file: plain JSON a person can read. */
export function encodeFile(week: SharedWeek): string {
  return `${JSON.stringify({ format: FILE_FORMAT, version: VERSION, term: week.term, sections: Object.fromEntries(entriesOf(week)) }, null, 2)}\n`;
}

export function decodeFile(text: string): SharedWeek | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "That file isn't a saved schedule." };
  }
  if (typeof value !== "object" || value === null || !("format" in value) || value.format !== FILE_FORMAT) {
    return { error: "That file isn't a saved schedule." };
  }
  if (!("version" in value) || value.version !== VERSION) return { error: "That file is from a different version." };
  const sections = "sections" in value ? value.sections : null;
  if (typeof sections !== "object" || sections === null || Array.isArray(sections)) return { error: "That file has no classes." };
  return check("term" in value ? value.term : undefined, Object.entries(sections));
}
