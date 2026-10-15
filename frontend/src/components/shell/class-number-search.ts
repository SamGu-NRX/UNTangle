import type { SearchSection } from "@/components/ui/SearchPalette";

/** Prefix of the palette item that opens a class number in Week. */
export const CLASS_NUMBER_ITEM = "class-number:";

/** Five digits is a myUNT class number; four would collide with course numbers ("2110"). */
const CLASS_NUMBER = /^\d{5}$/;

/**
 * A five-digit query in the top bar's search is a class number (DESIGN.md
 * §8.1): offer to find it in Week, whose search looks it up through
 * /api/sections/<term>/class/<number>.
 */
export function classNumberSection(query: string): SearchSection | null {
  const number = query.trim();
  if (!CLASS_NUMBER.test(number)) return null;
  return {
    id: "class-number",
    label: "Class number",
    items: [{ id: `${CLASS_NUMBER_ITEM}${number}`, title: `Find class ${number} in Week` }],
  };
}

/** Where the item goes: Week, with its search open on the number. */
export const classNumberHref = (itemId: string) => `/schedule?q=${encodeURIComponent(itemId.slice(CLASS_NUMBER_ITEM.length))}`;
