import type { RequirementSet } from "../types";

/**
 * Computer Science, BS, from the UNT 2026-2027 Undergraduate Catalog:
 * https://catalog.unt.edu/preview_program.php?catoid=37&poid=18560
 * Copied from the program page in a browser on 2026-10-14 (catalog.unt.edu
 * refuses plain HTTP fetches). Requirements follow the page's order, except
 * that MATH 1780 or MATH 3680 moves out of the "Other required courses" list
 * into its own one-of requirement.
 */
export const csBs2026: RequirementSet = {
  name: "Computer Science, BS (2026-2027)",
  source: "https://catalog.unt.edu/preview_program.php?catoid=37&poid=18560, copied 2026-10-14",
  notChecked: [
    "the major's C-or-better rule for degree completion; progress counts any passing grade the engine accepts as done.",
    "the 58-hour minimum for the major.",
  ],
  requirements: [
    {
      kind: "all",
      name: "Major requirements",
      courses: [
        "CSCE 1010", "CSCE 1015", "CSCE 1030", "CSCE 1040", "CSCE 2100", "CSCE 2110",
        "CSCE 2610", "CSCE 3444", "CSCE 3550", "CSCE 3600", "CSCE 4010", "CSCE 4110",
      ],
    },
    {
      kind: "choice",
      name: "Capstone or thesis",
      branches: [
        {
          name: "Software Development Capstone",
          requirements: [
            { kind: "all", name: "Capstone courses", courses: ["CSCE 4901", "CSCE 4902"] },
            // The catalog's "plus 6 hours chosen from CSCE Advanced Elective
            // Courses" is satisfied by the 12 elective hours below (the
            // Advanced Elective Courses list is exactly these two groups), so
            // the 6- or 9-hour minimum needs no separate line.
            { kind: "hours", name: "CSCE core, 6 hours", hours: 6, options: ["CSCE 3530", "CSCE 4115", "CSCE 4430", "CSCE 4600", "CSCE 4650"] },
            { kind: "hours", name: "CSCE breadth, 6 hours", hours: 6, options: ["CSCE 4201", "CSCE 4210", "CSCE 4230", "CSCE 4240", "CSCE 4290", "CSCE 4350", "CSCE 4460"] },
          ],
        },
        {
          name: "Senior Thesis",
          requirements: [
            { kind: "all", name: "Senior thesis", courses: ["CSCE 4999"] },
            { kind: "hours", name: "CSCE core, 6 hours", hours: 6, options: ["CSCE 3530", "CSCE 4115", "CSCE 4430", "CSCE 4600", "CSCE 4650"] },
            { kind: "hours", name: "CSCE breadth, 6 hours", hours: 6, options: ["CSCE 4201", "CSCE 4210", "CSCE 4230", "CSCE 4240", "CSCE 4290", "CSCE 4350", "CSCE 4460"] },
          ],
        },
      ],
    },
    {
      kind: "all",
      name: "Other required courses",
      courses: ["EENG 2710", "MATH 1710", "MATH 1720", "MATH 2700", "TECM 2700"],
    },
    { kind: "choose", name: "Probability or statistics", count: 1, options: ["MATH 1780", "MATH 3680"] },
    {
      // "Choose 2 courses (6-8 hours)": each option is a lecture, counted only
      // with the lab the catalog pairs it with. Listing CHEM 1410 and CHEM 1415
      // separately lets those two alternatives count as two courses.
      kind: "choose",
      name: "Laboratory science",
      count: 2,
      options: [
        "BIOL 1132", "BIOL 1710", "BIOL 1720", "CHEM 1410", "CHEM 1415", "CHEM 1420", "GEOG 1710",
        "GEOL 1610", "PHYS 1270", "PHYS 1410", "PHYS 1420", "PHYS 1710", "PHYS 2220",
      ],
      companions: {
        "BIOL 1710": ["BIOL 1760"],
        "BIOL 1720": ["BIOL 1760"],
        "CHEM 1410": ["CHEM 1430"],
        "CHEM 1415": ["CHEM 1435"],
        "CHEM 1420": ["CHEM 1440"],
        "PHYS 1410": ["PHYS 1430"],
        "PHYS 1420": ["PHYS 1440"],
        "PHYS 1710": ["PHYS 1730"],
        "PHYS 2220": ["PHYS 2240"],
      },
    },
    { kind: "pool", name: "4000-level TECM", hours: 3, match: { subject: "TECM", level: 4000 } },
  ],
};
