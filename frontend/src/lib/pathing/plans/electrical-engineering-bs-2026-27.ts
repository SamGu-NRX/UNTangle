import type { RequirementSet } from "../types";

/**
 * Electrical Engineering, BS, from the UNT 2026-2027 Undergraduate Catalog:
 * https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250
 * Copied from the program page in a browser on 2026-10-14 (catalog.unt.edu
 * refuses plain HTTP fetches). Requirements follow the page's order; shared
 * requirement groups carried from pages the major hyperlinks come first, in the
 * order the major page references them. Single-ownership trims are documented in
 * docs/research/degree-plans/encoding-notes.md.
 */
export const electricalEngineeringBs2026: RequirementSet = {
  name: "Electrical Engineering, BS (2026-2027)",
  source: "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250, copied 2026-10-14",
  notChecked: [
    "the university-wide 120-hour minimum, advanced-hour minimum, residence, and overall GPA rules of the Degree and Program Requirements section (navoid=4689), which the major page requires.",
    "the electrical engineering major must total at least 39 hours (the named core, the five electives and the project and laboratory block together carry the total).",
    "the optional certificates the page lists are not encoded as degree requirements.",
    "students must see an advisor to plan electives; the College of Engineering policies the page requires.",
    "the calculus substitution rule is encoded as a choice branch; the C-or-better condition on the substitute sequence stays advisor-checked.",
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
          // The 39-hour major total spans the named core, the five elective courses and the project
      // and laboratory block below.
    {
      kind: "all",
      name: "Electrical engineering major, 39 hours",
      courses: [
        "EENG 2610", "EENG 2611", "EENG 2710", "EENG 2711", "EENG 2620", "EENG 3510",
        "EENG 3610", "EENG 3700",
      ],
    }
,
          // "Select five courses from the following."
    {
      kind: "choose",
      name: "Electrical engineering electives, 5 courses (3000/4000-level)",
      count: 5,
      options: [
        "EENG 4000", "EENG 4010", "EENG 4020", "EENG 4110", "EENG 4130", "EENG 4140",
        "EENG 4150", "EENG 4210", "EENG 4215", "EENG 4220", "EENG 4230", "EENG 4310",
        "EENG 4330", "EENG 4410", "EENG 4500", "EENG 4510", "EENG 4520", "EENG 4600",
        "EENG 4700", "EENG 4710", "EENG 4800", "EENG 4900",
      ],
    }
,
    {
      kind: "all",
      name: "Electrical engineering project and laboratory block",
      courses: [
        "EENG 3810", "EENG 3820", "EENG 3830", "EENG 3840", "EENG 3850", "EENG 3860",
        "EENG 3870", "EENG 3880", "EENG 4890", "EENG 4910", "EENG 4920", "EENG 4930",
        "EENG 4940",
      ],
    }
,
    {
      kind: "choice",
      name: "Other required courses: chemistry (lecture and laboratory)",
      branches: [
        {
          name: "CHEM 1410 and CHEM 1430",
          requirements: [
              {
                kind: "all",
                name: "Courses",
                courses: [
                  "CHEM 1410", "CHEM 1430",
                ],
              },
          ],
        },
        {
          name: "CHEM 1415 and CHEM 1435",
          requirements: [
              {
                kind: "all",
                name: "Courses",
                courses: [
                  "CHEM 1415", "CHEM 1435",
                ],
              },
          ],
        },
      ],
    },
    {
      kind: "choice",
      name: "Other required courses: calculus (MATH 1810 sequence may substitute)",
      branches: [
        {
          name: "MATH 1710 and 1720",
          requirements: [
              {
                kind: "all",
                name: "Courses",
                courses: [
                  "MATH 1710", "MATH 1720",
                ],
              },
          ],
        },
        {
          name: "MATH 1810, 1820 and 1830 with a C or better (substitute)",
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
      name: "Other required courses: mathematics, physics and technical communication",
      courses: [
        "MATH 2700", "MATH 2730", "MATH 3180", "MATH 3410", "PHYS 1710", "PHYS 1730",
        "PHYS 2220", "PHYS 2240", "TECM 2700",
      ],
    }
,
    {
      kind: "all",
      name: "Other required courses: computer science",
      courses: [
        "CSCE 1030", "CSCE 1015",
      ],
    },
  ],
};
