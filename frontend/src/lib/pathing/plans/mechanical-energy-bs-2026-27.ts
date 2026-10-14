import type { RequirementSet } from "../types";

/**
 * Mechanical and Energy Engineering, BS, from the UNT 2026-2027 Undergraduate Catalog:
 * https://catalog.unt.edu/preview_program.php?catoid=40&poid=21335
 * Copied from the program page in a browser on 2026-10-14 (catalog.unt.edu
 * refuses plain HTTP fetches). Requirements follow the page's order; shared
 * requirement groups carried from pages the major hyperlinks come first, in the
 * order the major page references them. Single-ownership trims are documented in
 * docs/research/degree-plans/encoding-notes.md.
 */
export const mechanicalEnergyBs2026: RequirementSet = {
  name: "Mechanical and Energy Engineering, BS (2026-2027)",
  source: "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21335, copied 2026-10-14",
  notChecked: [
    "the university-wide 120-hour minimum, advanced-hour minimum, residence, and overall GPA rules of the Degree and Program Requirements section (navoid=4689), which the major page requires.",
    "the mechanical and energy engineering major must total at least 50 hours (the encoded blocks carry the listed courses plus the 12 elective hours).",
    "electives must be selected from the prefixes ME, EE, CSE, CE and MSE; no course list is printed on the page.",
    "the College of Engineering policies the page requires (admission and degree policies).",
    "the page's calculus block prints 'MATH 1710 or MATH 1810 and MATH 1820 ... MATH 1720 ... MATH 1830 ... MATH 2730'; the two-branch choice encodes the standard 1710/1720/2730 sequence and the engineering 1810/1820/1830 sequence (see docs/research/degree-plans/encoding-notes.md).",
    "ENGR 3450 appears in both the fundamentals block and the 42-hour major block; the fundamentals entry owns it.",
  ],
  requirements: [
    {
      kind: "choose",
      name: "UCC Communication, Group 1",
      count: 1,
      options: [
        "ENGL 1310", "ENGL 1311", "ENGL 1315", "TECM 1700",
      ],
    },
    {
      kind: "choose",
      name: "UCC Communication, Group 2",
      count: 1,
      options: [
        "ENGL 1320", "ENGL 1321", "ENGL 1325",
      ],
    },
    {
      kind: "choose",
      name: "UCC Mathematics",
      count: 1,
      options: [
        "DSCI 2710", "MATH 1180", "MATH 1190", "MATH 1580", "MATH 1650", "MATH 1680",
      ],
    },
    {
      kind: "choose",
      name: "UCC Life and Physical Sciences, 6 hours",
      count: 2,
      options: [
        "ANTH 2700", "ARCH 2800", "BIOL 1082", "BIOL 1112", "BIOL 1132", "BIOL 1710",
        "BIOL 1711", "BIOL 1720", "BIOL 1722", "BIOL 2301", "BIOL 2302", "BIOL 2700",
        "CHEM 1360", "CHEM 1412", "CHEM 1413", "CHEM 1420", "CHEM 1422", "CHEM 1423",
        "GEOG 1710", "GEOL 1610", "LING 3050", "MTSE 2000", "NUTR 2460", "NUTR 3460",
        "PHYS 1052", "PHYS 1062", "PHYS 1270", "PHYS 1315", "PHYS 1410", "PHYS 1420",
        "PHYS 1510", "PHYS 1520",
      ],
    },
    {
      kind: "choose",
      name: "UCC Language, Philosophy and Culture",
      count: 1,
      options: [
        "AGER 2250", "ANTH 3101", "ANTH 3110", "ANTH 3120", "ANTH 3130", "ANTH 3140",
        "ANTH 3200", "ANTH 3210", "ANTH 3220", "ANTH 3300", "ANTH 3400", "ANTH 3500",
        "ANTH 3700", "ANTH 3710", "ART 2350", "ENGL 2321", "ENGL 2326", "ENGL 2331",
        "ENGL 2341", "ENGL 2351", "ENGL 3450", "GEOG 1000", "HDFS 2313", "HIST 1050",
        "HIST 1060", "KINE 2050", "LING 2050", "LING 3010", "MUET 2000", "MUET 3030",
        "PHIL 1050", "PHIL 1400", "PHIL 2050", "PHIL 2070", "PHIL 2600", "THEA 3040",
      ],
    },
    {
      kind: "choose",
      name: "UCC Creative Arts",
      count: 1,
      options: [
        "ANTH 2400", "ART 1300", "ART 1301", "ART 2360", "ART 2370", "COMM 2060",
        "DANC 1200", "DANC 2800", "MUCO 1200", "MUCO 3500", "MUET 3060", "MUJS 3400",
        "MUMH 1610", "MUMH 2040", "MUMH 2050", "MUMH 2060", "MUMH 2080", "MUMH 3000",
        "MUMH 3010", "MUMH 3100", "MUMH 3200", "MUMH 3520", "PHIL 1900", "THEA 1340",
        "THEA 2340", "THEA 3030",
      ],
    },
    {
      kind: "choose",
      name: "UCC American History, 6 hours",
      count: 2,
      options: [
        "HIST 2610", "HIST 2620", "HIST 2675", "HIST 2685",
      ],
    },
    {
      kind: "choose",
      name: "UCC Government/Political Science, 6 hours",
      count: 2,
      options: [
        "PSCI 2305", "PSCI 2315", "PSCI 2306", "PSCI 2316",
      ],
    },
    {
      kind: "choose",
      name: "UCC Social and Behavioral Sciences",
      count: 1,
      options: [
        "AGER 4560", "AGER 4800", "ANTH 1010", "ANTH 2300", "BAAS 3000", "BEHV 2300",
        "CJUS 2100", "COMM 2020", "EADP 1010", "EADP 4050", "ECON 1100", "ECON 1110",
        "FIPL 2770", "GEOG 1200", "GEOG 1500", "HDFS 1013", "HLTH 2200", "JOUR 1210",
        "LING 3060", "MDSE 2750", "PADM 2100", "PSYC 1630", "RESM 3450", "RHAB 3100",
        "SOCI 1510", "SOWK 1450",
      ],
    },
    {
      kind: "choice",
      name: "UCC Component Area Option, 6 hours",
      branches: [
        {
          name: "Take 6 credit hours from Component Area Option A",
          requirements: [
              {
                kind: "hours",
                name: "Component Area Option A, 6 hours",
                hours: 6,
                options: [
                  "ANTH 1150", "COMM 2040", "COMM 2140", "COUN 2620", "HDFS 3423", "NUTR 1450",
                  "JOUR 2250", "MDSE 3370", "MKTG 3010", "MTSE 1100", "MUJS 3070", "MUMH 3500",
                  "MUMH 3510", "PHIL 2500", "PHIL 3900", "PHIL 4150", "PHIL 4200", "SOCI 2070",
                  "SOWK 4540", "TECM 1600",
                ],
              },
          ],
        },
        {
          name: "Take 3 credit hours from Component Area Option A and 3 from Component Area Option B",
          requirements: [
              {
                kind: "hours",
                name: "Component Area Option A, 3 hours",
                hours: 3,
                options: [
                  "ANTH 1150", "COMM 2040", "COMM 2140", "COUN 2620", "HDFS 3423", "NUTR 1450",
                  "JOUR 2250", "MDSE 3370", "MKTG 3010", "MTSE 1100", "MUJS 3070", "MUMH 3500",
                  "MUMH 3510", "PHIL 2500", "PHIL 3900", "PHIL 4150", "PHIL 4200", "SOCI 2070",
                  "SOWK 4540", "TECM 1600",
                ],
              },
              {
                kind: "hours",
                name: "Component Area Option B, 3 hours",
                hours: 3,
                options: [
                  "ADES 3700", "COMM 1010", "COMM 1440", "CSCE 1010", "HDFS 2033", "INST 2100",
                  "JOUR 2300", "LING 2070", "MKTG 2650", "PHED 1000", "RHAB 3000", "TECM 1500",
                  "UNIV 2100", "UNIV 2300", "WGST 2100",
                ],
              },
          ],
        },
      ],
    },
    {
      kind: "all",
      name: "Engineering fundamentals: intro",
      courses: [
        "ENGR 1304",
      ],
    }
,
    {
      kind: "choose",
      name: "Engineering fundamentals: 2405/2610 (one of)",
      count: 1,
      options: [
        "ENGR 2405", "EENG 2610",
      ],
    }
,
    {
      kind: "all",
      name: "Engineering fundamentals: thermodynamics I",
      courses: [
        "ENGR 3450",
      ],
    }
,
          // "42 hours of major courses" per the page heading, with the course list transcribed as
      // printed except ENGR 3450: the page lists it here and in the fundamentals block, and the
      // validator forbids double listing, so the fundamentals entry owns it (single ownership;
      // see encoding notes).
    {
      kind: "all",
      name: "Mechanical and energy engineering major, 42 hours",
      courses: [
        "ENGR 2310", "ENGR 2320", "ENGR 2340", "ENGR 2350", "ENGR 2380", "ENGR 2410",
        "ENGR 3210", "ENGR 3260", "ENGR 3320", "ENGR 3340", "ENGR 3360", "ENGR 3510",
        "ENGR 3520", "ENGR 3530", "ENGR 3540", "ENGR 4420", "ENGR 4620",
      ],
    }
,
          // "Must be selected from the following prefixes: ME, EE, CSE, CE, MSE." The four-year plan
      // shows students taking approved upper-division engineering electives; the prefix rule is
      // advisor-checked.
    {
      kind: "pool",
      name: "Mechanical and energy engineering electives, 12 hours",
      hours: 12,
    }
,
    {
      kind: "choose",
      name: "Other required courses: chemistry lecture (one of)",
      count: 1,
      options: [
        "CHEM 1410", "CHEM 1415",
      ],
    }
,
    {
      kind: "choose",
      name: "Other required courses: chemistry laboratory (one of)",
      count: 1,
      options: [
        "CHEM 1430", "CHEM 1435",
      ],
    }
,
    {
      kind: "choice",
      name: "Other required courses: calculus",
      branches: [
        {
          name: "Calculus sequence MATH 1710, 1720 with MATH 2730",
          requirements: [
              {
                kind: "all",
                name: "Courses",
                courses: [
                  "MATH 1710", "MATH 1720", "MATH 2730",
                ],
              },
          ],
        },
        {
          name: "Calculus sequence MATH 1810, 1820, 1830 (engineering track)",
          requirements: [
              {
                kind: "all",
                name: "Courses",
                courses: [
                  "MATH 1810", "MATH 1820", "MATH 1830",
                ],
              },
          ],
        },
      ],
    },
    {
      kind: "all",
      name: "Other required courses: additional math, physics and technical communication",
      courses: [
        "MATH 2700", "MATH 3410", "PHYS 1710", "PHYS 1730", "PHYS 2220", "PHYS 2240",
        "TECM 2700",
      ],
    },
  ],
};
