const seasonRanks = {
  spring: 0,
  summer: 1,
  fall: 2,
  winter: 3,
} as const;

export type ParsedAcademicTerm = { year: number; seasonRank: number };

const termPattern = /^(20\d{2})\s+(Spring|Summer|Fall|Winter)$/i;
const seasonFirstTermPattern = /^(Spring|Summer|Fall|Winter)\s+(20\d{2})$/i;

function seasonRank(name: string) {
  return seasonRanks[name.toLowerCase() as keyof typeof seasonRanks];
}

/**
 * Parses an academic term label in either "2025 Fall" or "Fall 2025" form.
 * Returns null for anything else (including sentinel labels like
 * "Unknown term" and "Needs review").
 */
export function parseAcademicTerm(term: string): ParsedAcademicTerm | null {
  const trimmed = term.trim();
  const yearFirst = termPattern.exec(trimmed);
  if (yearFirst) {
    return { year: Number(yearFirst[1]), seasonRank: seasonRank(yearFirst[2]) };
  }

  const seasonFirst = seasonFirstTermPattern.exec(trimmed);
  if (seasonFirst) {
    return { year: Number(seasonFirst[2]), seasonRank: seasonRank(seasonFirst[1]) };
  }

  return null;
}

/**
 * Orders term labels chronologically. Within one calendar year
 * Spring < Summer < Fall < Winter (Winter is the December intersession, so
 * "Winter 2025" falls between "Fall 2025" and "Spring 2026"). Year-first and
 * season-first spellings of the same term compare as equal. Unknown and
 * unparseable terms sort after every known term; ties among unknowns return 0
 * so stable sorts preserve their original relative order.
 */
export function compareAcademicTerms(a: string, b: string): number {
  const parsedA = parseAcademicTerm(a);
  const parsedB = parseAcademicTerm(b);

  if (parsedA && parsedB) {
    return parsedA.year - parsedB.year || parsedA.seasonRank - parsedB.seasonRank;
  }

  if (parsedA) {
    return -1;
  }

  if (parsedB) {
    return 1;
  }

  return 0;
}
