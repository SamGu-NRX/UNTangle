import type { SearchSection } from "@/components/ui/SearchPalette";

/** Prefix of the palette item that opens a class number in Week. */
export const CLASS_NUMBER_ITEM = "class-number:";

/** myUNT class numbers have four or five digits. */
const CLASS_NUMBER = /^\d{4,5}$/;

/**
 * A class number in the top bar's search (DESIGN.md §8.1): offer to find it
 * in Week, whose search looks it up through /api/sections/<term>/class/<number>.
 * Four digits can also be a course number ("2110"), so a four-digit query is
 * offered only when no course matches it, the rule Week's search follows.
 */
export function classNumberSection(query: string, coursesMatch: boolean): SearchSection | null {
  const number = query.trim();
  if (!CLASS_NUMBER.test(number) || (number.length === 4 && coursesMatch)) return null;
  return {
    id: "class-number",
    label: "Class number",
    items: [{ id: `${CLASS_NUMBER_ITEM}${number}`, title: `Find class ${number} in Week` }],
  };
}

/** Where the item goes: Week, with its search open on the number. */
export const classNumberHref = (itemId: string) => `/schedule?q=${encodeURIComponent(itemId.slice(CLASS_NUMBER_ITEM.length))}`;
