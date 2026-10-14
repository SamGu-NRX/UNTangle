import type { RequirementSet } from "../types";

/**
 * Biology, BSBIO, from the UNT 2026-2027 Undergraduate Catalog:
 * https://catalog.unt.edu/preview_program.php?catoid=40&poid=21206
 * Copied from the program page in a browser on 2026-10-14 (catalog.unt.edu
 * refuses plain HTTP fetches). Requirements follow the page's order; shared
 * requirement groups carried from pages the major hyperlinks come first, in the
 * order the major page references them. Single-ownership trims are documented in
 * docs/research/degree-plans/encoding-notes.md.
 */
export const bioBsBio2026: RequirementSet = {
  name: "Biology, BSBIO (2026-2027)",
  source: "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21206, copied 2026-10-14",
  notChecked: [
    "the university-wide 120-hour minimum, advanced-hour minimum, residence, and overall GPA rules of the Degree and Program Requirements section (navoid=4689), which the major page requires.",
    "the College of Science degree requirements the page hyperlinks (120 total hours with 36 advanced; a major of at least 24 hours with 12 advanced hours at UNT; college admission rules).",
    "Foundation course requirements must be completed with a C or better in each course and an overall 2.5 GPA in those courses before enrollment in 3000- and 4000-level major courses.",
    "biology foundation and second-2000-level courses are completed with a C or higher.",
    "of the 16 advanced biology elective hours, 2 courses must be with laboratory.",
    "the chemistry minor's 20-hour total framing (12 foundation hours plus 8 hours with a C or higher).",
    "advanced biology electives drop the physiology options (BIOL 3800, BIOL 4501, BIOL 4502, BIOL 4503, BIOL 4504, BIOL 4505, BIOL 4510) because the page bars courses used for other requirements from counting toward electives.",
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
        "ENGL 1320", "ENGL 1321", "ENGL 1325", "TECM 2700",
      ],
    },
    {
      kind: "choose",
      name: "UCC Mathematics",
      count: 1,
      options: [
        "DSCI 2710", "MATH 1180", "MATH 1190", "MATH 1580", "MATH 1680",
      ],
    },
    {
      kind: "choose",
      name: "UCC Life and Physical Sciences, 6 hours",
      count: 2,
      options: [
        "ANTH 2700", "ARCH 2800", "BIOL 1082", "BIOL 1112", "BIOL 1132", "BIOL 2301",
        "BIOL 2302", "BIOL 2700", "CHEM 1360", "GEOG 1710", "GEOL 1610", "LING 3050",
        "MTSE 2000", "NUTR 2460", "NUTR 3460", "PHYS 1052", "PHYS 1062", "PHYS 1270",
        "PHYS 1315", "PHYS 1710", "PHYS 2220",
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
                  "JOUR 2250", "MATH 1720", "MDSE 3370", "MKTG 3010", "MTSE 1100", "MUJS 3070",
                  "MUMH 3500", "MUMH 3510", "PHIL 2500", "PHIL 3900", "PHIL 4150", "PHIL 4200",
                  "SOCI 2070", "SOWK 4540", "TECM 1600",
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
                  "JOUR 2250", "MATH 1720", "MDSE 3370", "MKTG 3010", "MTSE 1100", "MUJS 3070",
                  "MUMH 3500", "MUMH 3510", "PHIL 2500", "PHIL 3900", "PHIL 4150", "PHIL 4200",
                  "SOCI 2070", "SOWK 4540", "TECM 1600",
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
      kind: "choose",
      name: "Foundation biology I",
      count: 1,
      options: [
        "BIOL 1710", "BIOL 1711",
      ],
    }
,
    {
      kind: "choose",
      name: "Foundation biology II",
      count: 1,
      options: [
        "BIOL 1720", "BIOL 1722",
      ],
    }
,
    {
      kind: "choose",
      name: "Foundation biology laboratory",
      count: 1,
      options: [
        "BIOL 1750", "BIOL 1760", "BIOL 1761",
      ],
    }
,
          // The foundation block asks for "one of the following courses (with lab, if indicated)"
      // and the biology block asks for a second 2000-level course from the same list. The
      // validator forbids listing one course under two requirements, so the two asks share this
      // one two-course group; the foundation courses gate the upper-division work either way.
    {
      kind: "choose",
      name: "Foundation biology: one course now and a second 2000-level course later, 2 courses",
      count: 2,
      companions: {
        "BIOL 2041": ["BIOL 2042"],
      },
      options: [
        "BIOL 2041", "BIOL 2140", "BIOL 2241", "BIOL 2251",
      ],
    }
,
    {
      kind: "choose",
      name: "Foundation chemistry I",
      count: 1,
      options: [
        "CHEM 1410", "CHEM 1412", "CHEM 1413",
      ],
    }
,
    {
      kind: "all",
      name: "Foundation chemistry I laboratory",
      courses: [
        "CHEM 1430",
      ],
    }
,
    {
      kind: "choose",
      name: "Foundation chemistry II",
      count: 1,
      options: [
        "CHEM 1420", "CHEM 1422", "CHEM 1423",
      ],
    }
,
    {
      kind: "all",
      name: "Foundation chemistry II laboratory and organic chemistry",
      courses: [
        "CHEM 1440", "CHEM 2370", "CHEM 3210",
      ],
    }
,
    {
      kind: "all",
      name: "Foundation mathematics",
      courses: [
        "MATH 1650",
      ],
    }
,
    {
      kind: "all",
      name: "Advanced biology requirements",
      courses: [
        "BIOL 3451", "BIOL 3452", "BIOL 3510", "BIOL 3520",
      ],
    }
,
    {
      kind: "choice",
      name: "Physiology requirement options (with lab)",
      branches: [
        {
          name: "Bacterial Diversity and Physiology with laboratory",
          requirements: [
              {
                kind: "all",
                name: "Courses",
                courses: [
                  "BIOL 4501", "BIOL 4502",
                ],
              },
          ],
        },
        {
          name: "Plant Physiology and Development with laboratory",
          requirements: [
              {
                kind: "all",
                name: "Courses",
                courses: [
                  "BIOL 4503", "BIOL 4504",
                ],
              },
          ],
        },
        {
          name: "Animal Physiology Laboratory with Human or Comparative Animal Physiology",
          requirements: [
                        {
                          kind: "all",
                          name: "Laboratory",
                          courses: [
                            "BIOL 4510",
                          ],
                        },
                        {
                          kind: "choose",
                          name: "Physiology lecture",
                          count: 1,
                          options: [
                            "BIOL 3800", "BIOL 4505",
                          ],
                        },
          ],
        },
      ],
    },
          // "16 advanced biology elective hours (of which 2 courses must be with laboratory)". The
      // two-with-lab rule and the page rule that courses used for other requirements cannot also
      // count toward electives are not engine-checkable; the list below drops the physiology
      // options (BIOL 3800, BIOL 4501, BIOL 4502, BIOL 4503, BIOL 4504, BIOL 4505, BIOL 4510) per that page rule.
    {
      kind: "hours",
      name: "Advanced biology electives, 16 hours",
      hours: 16,
      options: [
        "BIOL 3000", "BIOL 3030", "BIOL 3080", "BIOL 3150", "BIOL 3160", "BIOL 3170",
        "BIOL 3331", "BIOL 3381", "BIOL 3382", "BIOL 3770", "BIOL 3850", "BIOL 3900",
        "BIOL 3996", "BIOL 4000", "BIOL 4005", "BIOL 4006", "BIOL 4030", "BIOL 4035",
        "BIOL 4045", "BIOL 4050", "BIOL 4051", "BIOL 4052", "BIOL 4053", "BIOL 4054",
        "BIOL 4055", "BIOL 4056", "BIOL 4057", "BIOL 4070", "BIOL 4085", "BIOL 4091",
        "BIOL 4092", "BIOL 4100", "BIOL 4110", "BIOL 4120", "BIOL 4160", "BIOL 4170",
        "BIOL 4180", "BIOL 4190", "BIOL 4201", "BIOL 4202", "BIOL 4220", "BIOL 4230",
        "BIOL 4240", "BIOL 4250", "BIOL 4260", "BIOL 4261", "BIOL 4280", "BIOL 4290",
        "BIOL 4300", "BIOL 4320", "BIOL 4330", "BIOL 4370", "BIOL 4375", "BIOL 4380",
        "BIOL 4400", "BIOL 4420", "BIOL 4440", "BIOL 4460", "BIOL 4480", "BIOL 4506",
        "BIOL 4530", "BIOL 4540", "BIOL 4560", "BIOL 4570", "BIOL 4590", "BIOL 4650",
        "BIOL 4720", "BIOL 4751", "BIOL 4752", "BIOL 4760", "BIOL 4800", "BIOL 4801",
        "BIOL 4805", "BIOL 4810", "BIOL 4820", "BIOL 4580", "BIOL 4900", "BIOL 4910",
        "BIOL 4920", "BIOL 4930", "BIOL 4940", "BIOL 4950", "BIOL 4951",
      ],
    }
,
    {
      kind: "choose",
      name: "Other required courses: calculus",
      count: 1,
      options: [
        "MATH 1710", "MATH 1810",
      ],
    }
,
    {
      kind: "choice",
      name: "Other required courses: physics",
      branches: [
        {
          name: "General Physics I and II with laboratories",
          requirements: [
              {
                kind: "all",
                name: "Courses",
                courses: [
                  "PHYS 1410", "PHYS 1430", "PHYS 1420", "PHYS 1440",
                ],
              },
          ],
        },
        {
          name: "General Physics with Calculus and laboratories",
          requirements: [
              {
                kind: "all",
                name: "Courses",
                courses: [
                  "PHYS 1510", "PHYS 1530", "PHYS 1520", "PHYS 1540",
                ],
              },
          ],
        },
      ],
    },
    {
      kind: "all",
      name: "Chemistry minor: Organic Chemistry II with laboratory",
      courses: [
        "CHEM 2380", "CHEM 3220",
      ],
    }
,
          // "Plus 4 advanced hours chosen from" the listed alternatives; the engine resolves the
      // course/laboratory pairings by credit hours from the course catalog.
    {
      kind: "hours",
      name: "Chemistry minor: 4 advanced hours chosen from",
      hours: 4,
      options: [
        "CHEM 3451", "CHEM 3452", "CHEM 3530", "BIOC 3621", "BIOC 3622", "BIOC 4540",
        "BIOC 4550",
      ],
    },
  ],
};
