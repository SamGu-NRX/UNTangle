import type { Candidate } from "../../../src/lib/instructors/match";

/**
 * The eight real instructor identities captured in the committed grade-history
 * fixtures (frontend/tests/grades-history/fixtures/), 2026-10-13 MCP responses.
 * The id is the JSON name-pair string the history parser derives
 * (frontend/src/lib/grades-history/parse.ts), so these are the exact ids the
 * matcher must return.
 */
export const PRADHUMNA_SHRESTHA: Candidate = {
  id: JSON.stringify(["Pradhumna Lal", "Shrestha"]),
  name: "Pradhumna Lal Shrestha",
  firstName: "Pradhumna Lal",
  lastName: "Shrestha",
};
export const BINOD_SHRESTHA: Candidate = {
  id: JSON.stringify(["Binod", "Shrestha"]),
  name: "Binod Shrestha",
  firstName: "Binod",
  lastName: "Shrestha",
};
export const BEILEI_JIANG: Candidate = {
  id: JSON.stringify(["Beilei", "Jiang"]),
  name: "Beilei Jiang",
  firstName: "Beilei",
  lastName: "Jiang",
};
export const FERNANDO_MOSQUERA_FERRANDIZ: Candidate = {
  id: JSON.stringify(["Fernando", "Mosquera Ferrandiz"]),
  name: "Fernando Mosquera Ferrandiz",
  firstName: "Fernando",
  lastName: "Mosquera Ferrandiz",
};
export const HAILI_WANG: Candidate = {
  id: JSON.stringify(["Haili", "Wang"]),
  name: "Haili Wang",
  firstName: "Haili",
  lastName: "Wang",
};
export const MOHSEN_RIAHI_ALAM: Candidate = {
  id: JSON.stringify(["Mohsen", "Riahi alam"]),
  name: "Mohsen Riahi alam",
  firstName: "Mohsen",
  lastName: "Riahi alam",
};
export const SAYED_KHUSHAL_SHAH: Candidate = {
  id: JSON.stringify(["Sayed Khushal", "Shah"]),
  name: "Sayed Khushal Shah",
  firstName: "Sayed Khushal",
  lastName: "Shah",
};
export const SUBHARAG_SARKAR: Candidate = {
  id: JSON.stringify(["Subharag", "Sarkar"]),
  name: "Subharag Sarkar",
  firstName: "Subharag",
  lastName: "Sarkar",
};

/** Every real grade-history identity the committed fixtures carry. */
export const HISTORY_UNIVERSE: readonly Candidate[] = [
  PRADHUMNA_SHRESTHA,
  BINOD_SHRESTHA,
  BEILEI_JIANG,
  FERNANDO_MOSQUERA_FERRANDIZ,
  HAILI_WANG,
  MOHSEN_RIAHI_ALAM,
  SAYED_KHUSHAL_SHAH,
  SUBHARAG_SARKAR,
];
