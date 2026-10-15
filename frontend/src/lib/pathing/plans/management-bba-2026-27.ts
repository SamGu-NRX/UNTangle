import type { RequirementSet } from "../types";

/**
 * Management, BBA, from the UNT 2026-2027 Undergraduate Catalog:
 * https://catalog.unt.edu/preview_program.php?catoid=40&poid=21751
 * Copied from the program page in a browser on 2026-10-14 (catalog.unt.edu
 * refuses plain HTTP fetches). Requirements follow the page's order; shared
 * requirement groups carried from pages the major hyperlinks come first, in the
 * order the major page references them. Single-ownership trims are documented in
 * docs/research/degree-plans/encoding-notes.md.
 */
export const managementBba2026: RequirementSet = {
  name: "Management, BBA (2026-2027)",
  source: "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21751, copied 2026-10-14",
  notChecked: [
    "the university-wide 120-hour minimum, advanced-hour minimum, residence, and overall GPA rules of the Degree and Program Requirements section (navoid=4689), which the major page requires.",
    "the G. Brint Ryan College of Business tiered academic progression plan and admission policy the page hyperlinks (Tier One GPA thresholds, restricted course levels).",
    "a grade of C or above in each business foundation course and each professional field or supporting field course completed in residence or transferred to UNT.",
    "the first two BBA communication courses need a grade of C or higher before declaring a specific BBA degree program.",
    "the supporting field pool is a level rule (any MGMT 3000/4000-level courses); the page's recommended five-course list is advisory and not exhaustive.",
    "any other Ryan College of Business requirements for a BBA (the page's 'Additional requirements' note).",
    "the BBA international requirement is fulfilled by MGMT 4660, which the professional field already requires, so no separate group is encoded.",
    "BBA communication requirement courses can be used to fulfill University Core requirements; the validator forces single ownership, so this plan drops ENGL 1310, ENGL 1320, TECM 2700 and COMM 1010 from the UCC lists and keeps them in the BBA combination.",
  ],
  requirements: [
    {
      kind: "choose",
      name: "UCC Communication, Group 1",
      count: 1,
      options: [
        "ENGL 1311", "ENGL 1315", "TECM 1700",
      ],
    },
    {
      kind: "choose",
      name: "UCC Communication, Group 2",
      count: 1,
      options: [
        "ENGL 1321", "ENGL 1325",
      ],
    },
    {
      kind: "choose",
      name: "UCC Mathematics",
      count: 1,
      options: [
        "MATH 1180", "MATH 1580", "MATH 1650", "MATH 1680", "MATH 1810",
      ],
    },
    {
      kind: "choose",
      name: "UCC Life and Physical Sciences, 6 hours",
      count: 2,
      options: [
        "ANTH 2700", "ARCH 2800", "BIOL 1082", "BIOL 1112", "BIOL 1132", "BIOL 1710",
        "BIOL 1711", "BIOL 1720", "BIOL 1722", "BIOL 2301", "BIOL 2302", "BIOL 2700",
        "CHEM 1360", "CHEM 1410", "CHEM 1412", "CHEM 1413", "CHEM 1420", "CHEM 1422",
        "CHEM 1423", "GEOG 1710", "GEOL 1610", "LING 3050", "MTSE 2000", "NUTR 2460",
        "NUTR 3460", "PHYS 1052", "PHYS 1062", "PHYS 1270", "PHYS 1315", "PHYS 1410",
        "PHYS 1420", "PHYS 1510", "PHYS 1520", "PHYS 1710", "PHYS 2220",
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
          // The Government area states Texas law requires the 6 hours "to include consideration of
      // the constitutions of the United States and Texas", while its list sentence says "choose
      // two" across four options (2305/2315 behavior, 2306/2316 constitutions). Encoded as one
      // from each pair: the statute, the transfer paragraph ("completed both GOVT 2305 and 2306
      // or their equivalents have satisfied this requirement"), and every major's four-year
      // sample plan all pair them. Advanced standing exams, ROTC credit, and transfer
      // satisfaction stay advisor-checked (see notChecked).
    {
      kind: "choose",
      name: "UCC Government/Political Science: US Political Behavior, 3 hours",
      count: 1,
      options: [
        "PSCI 2305", "PSCI 2315",
      ],
    },
    {
      kind: "choose",
      name: "UCC Government/Political Science: Constitutions of the United States and Texas, 3 hours",
      count: 1,
      options: [
        "PSCI 2306", "PSCI 2316",
      ],
    },
    {
      kind: "choose",
      name: "UCC Social and Behavioral Sciences",
      count: 1,
      options: [
        "AGER 4560", "AGER 4800", "ANTH 1010", "ANTH 2300", "BAAS 3000", "BEHV 2300",
        "CJUS 2100", "COMM 2020", "EADP 1010", "EADP 4050", "FIPL 2770", "GEOG 1200",
        "GEOG 1500", "HDFS 1013", "HLTH 2200", "JOUR 1210", "LING 3060", "MDSE 2750",
        "PADM 2100", "PSYC 1630", "RESM 3450", "RHAB 3100", "SOCI 1510", "SOWK 1450",
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
                  "ADES 3700", "COMM 1440", "CSCE 1010", "HDFS 2033", "INST 2100", "JOUR 2300",
                  "LING 2070", "MKTG 2650", "PHED 1000", "RHAB 3000", "TECM 1500", "UNIV 2100",
                  "UNIV 2300", "WGST 2100",
                ],
              },
          ],
        },
      ],
    },
    {
      kind: "choice",
      name: "BBA communication requirements, 9 hours",
      branches: [
        {
          name: "Combination A",
          requirements: [
              {
                kind: "all",
                name: "Required courses",
                courses: [
                  "ENGL 1310", "COMM 1010",
                ],
              },
              {
                kind: "choose",
                name: "Second writing course",
                count: 1,
                options: [
                  "ENGL 1320", "TECM 2700",
                ],
              },
          ],
        },
        {
          name: "Combination B",
          requirements: [
              {
                kind: "all",
                name: "Required courses",
                courses: [
                  "ENGL 1310", "ENGL 1320", "TECM 2700",
                ],
              },
          ],
        },
      ],
    }
,
                    // "Pre-business requirements, 21 hours" on the BBA page; the final 3 hours are the
                // one-of mathematics course below. The catalog marks DSCI 2710, ECON 1100, ECON 1110 and
                // the mathematics one-of as usable toward University Core areas, so the UCC lists here
                // drop them (single ownership; see docs/research/degree-plans/encoding-notes.md).
              {
                kind: "all",
                name: "Pre-business requirements, 18 hours",
                courses: [
                  "ACCT 2010", "ACCT 2020", "BCIS 2610", "DSCI 2710", "ECON 1100", "ECON 1110",
                ],
              },
              {
                kind: "choose",
                name: "Pre-business mathematics, 3 hours",
                count: 1,
                options: [
                  "MATH 1190", "MATH 1710",
                ],
              },
                    // The third professional development hour is "BUSI 3200 (or alternative)" — the BBA page
                // defers the alternative list to the individual program, so it stays advisor-checked.
              {
                kind: "all",
                name: "Professional development, 2 hours",
                courses: [
                  "BUSI 1200", "BUSI 3100",
                ],
              },
              {
                kind: "pool",
                name: "Professional Development III or departmental equivalent, 1 hour",
                hours: 1,
              },
              {
                kind: "all",
                name: "Business foundation requirements, 24 hours",
                courses: [
                  "BCIS 3610", "BLAW 3430", "MGMT 3660", "MGMT 4940", "DSCI 3710", "FINA 3770",
                  "MGMT 3720", "MKTG 3650",
                ],
              },
    {
      kind: "all",
      name: "Professional field courses, 18 hours",
      courses: [
        "MGMT 3820", "MGMT 3860", "MGMT 4470", "MGMT 4660", "MGMT 4800", "MGMT 4860",
      ],
    }
,
          // "Select 4 courses from MGMT 3000 and 4000-level courses. The following courses are
      // recommended: MGMT 3880, MGMT 4150, MGMT 4210, MGMT 4270, MGMT 4335." The rule spans
      // two level bands and a pool pattern matches one, so the pool stays advisor-checked.
    {
      kind: "pool",
      name: "Supporting field courses, 12 hours",
      hours: 12,
    },
  ],
};
