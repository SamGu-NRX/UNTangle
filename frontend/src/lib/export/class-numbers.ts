/**
 * The class numbers a student types into the myUNT cart, in the order to
 * type them. Pure, so the order rule has one tested answer.
 */

export type ClassNumberEntry = {
  courseCode: string;
  /** How the student refers to the section, such as "001". */
  sectionLabel: string;
  /** Every component's class number, primary first; empty for a sample section. */
  classNumbers: readonly string[];
  /** Open seats, or null when the source does not say. */
  openSeats: number | null;
};

export type ClassNumberRow = ClassNumberEntry & { fewSeats: boolean };

/**
 * At or under this many open seats a row says "Few seats". A starting
 * value with no data behind it (the mockup's threshold).
 */
export const FEW_SEATS = 5;

/**
 * Fewest open seats first, so the section most likely to fill is added
 * before it does. A starting value with no data behind it
 * (docs/design/untangle-v3.md, Placeholders): myUNT may need a lecture and
 * its lab together, which this keeps by never splitting a section's
 * numbers. Unknown seats go last; ties keep course then section order.
 * Sections without class numbers (samples) are left out.
 */
export function orderClassNumbers(entries: readonly ClassNumberEntry[]): ClassNumberRow[] {
  const seats = (entry: ClassNumberEntry) => entry.openSeats ?? Number.POSITIVE_INFINITY;
  return entries
    .filter((entry) => entry.classNumbers.length > 0)
    .map((entry) => ({ ...entry, fewSeats: entry.openSeats !== null && entry.openSeats <= FEW_SEATS }))
    .sort(
      (a, b) =>
        seats(a) - seats(b) ||
        a.courseCode.localeCompare(b.courseCode) ||
        a.sectionLabel.localeCompare(b.sectionLabel),
    );
}

/** One class number per line, in cart order: what "Copy all" puts on the clipboard. */
export function classNumbersText(rows: readonly ClassNumberRow[]): string {
  return rows.flatMap((row) => row.classNumbers).join("\n");
}
