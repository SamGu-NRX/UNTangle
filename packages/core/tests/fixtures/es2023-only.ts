// Uses ES2023 library methods and nothing from a host environment.
const credits = [3, 4, 3, 1];
export const lastHeavy = credits.findLast((hours) => hours > 3);
export const ascending = credits.toSorted((a, b) => a - b);
