/**
 * Building label text: the name students read on signs, then the code they
 * see in their schedule, as in "General Academic Building (GAB)".
 *
 * OpenStreetMap names UNT buildings in that same form ("Willis Library
 * (LIBR)"), so splitOsmName reads the code back out of them.
 */

export type NamedCode = { name: string; code: string | null };

/** "Willis Library (LIBR)" -> { name: "Willis Library", code: "LIBR" }; no trailing code -> code null. */
export function splitOsmName(raw: string): NamedCode {
  const text = raw.trim();
  const match = /^(.*\S)\s*\(([A-Z0-9][A-Z0-9 ]{0,9})\)$/.exec(text);
  if (!match) return { name: text, code: null };
  return { name: match[1], code: match[2].trim() };
}

export function buildingLabel(name: string, code: string | null): string {
  const cleanName = splitOsmName(name).name;
  if (cleanName === "") throw new Error("A building label needs a name");
  const cleanCode = code?.trim() ?? "";
  if (cleanCode === "" || cleanCode.toUpperCase() === cleanName.toUpperCase()) return cleanName;
  return `${cleanName} (${cleanCode})`;
}
