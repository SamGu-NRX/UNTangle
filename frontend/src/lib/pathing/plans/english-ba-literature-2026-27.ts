import type { RequirementSet } from "../types";

/**
 * English, BA (Literature concentration), from the UNT 2026-2027 Undergraduate Catalog:
 * https://catalog.unt.edu/preview_program.php?catoid=40&poid=21425
 * Copied from the program page in a browser on 2026-10-14 (catalog.unt.edu
 * refuses plain HTTP fetches). Requirements follow the page's order; shared
 * requirement groups carried from pages the major hyperlinks come first, in the
 * order the major page references them. Single-ownership trims are documented in
 * docs/research/degree-plans/encoding-notes.md.
 *
 * The six category course lists render outside the standard catalog container on the live
page; they were transcribed from the captured page text.
 */
export const englishBa2026: RequirementSet = {
  name: "English, BA (Literature concentration) (2026-2027)",
  source: "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21425, copied 2026-10-14",
  notChecked: [
    "the university-wide 120-hour minimum, advanced-hour minimum, residence, and overall GPA rules of the Degree and Program Requirements section (navoid=4689), which the major page requires.",
    "ENGL 3000 (or its equivalent) should be taken during the first 18 hours of English work.",
    "a grade of C or better is required in all English courses; a 2.5 cumulative grade point average in English courses is required for graduation.",
    "the six category lists carry the page's 'additional courses may apply, see faculty advisor' note; the encoded lists are the printed options.",
    "a course may apply to only one of the literature category groups; the surveys and major-author courses are also excluded from the categories (single ownership via trimmed lists).",
    "the CLASS degree requirements the page hyperlinks (major of at least 24 hours with 12 advanced at UNT; BA hour rules).",
    "the optional minor; the page leaves it to the student.",
    "the remaining '9 hours from ENGL courses approved by the department advisor' of the 24-hour major framing are advisor-checked.",
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
        "ENGL 1321", "ENGL 1325", "TECM 2700",
      ],
    },
    {
      kind: "choose",
      name: "UCC Mathematics",
      count: 1,
      options: [
        "DSCI 2710", "MATH 1180", "MATH 1190", "MATH 1580", "MATH 1650", "MATH 1680",
        "MATH 1710", "MATH 1810",
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
        "ANTH 3700", "ANTH 3710", "ART 2350", "GEOG 1000", "HDFS 2313", "HIST 1050",
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
      kind: "all",
      name: "English foundation",
      courses: [
        "ENGL 1310", "ENGL 1320", "ENGL 3000",
      ],
    }
,
    {
      kind: "choose",
      name: "Literary history and multicultural studies, 6 hours",
      count: 2,
      options: [
        "ENGL 2100", "ENGL 2321", "ENGL 2326", "ENGL 2331", "ENGL 2341", "ENGL 2351",
      ],
    }
,
    {
      kind: "choose",
      name: "Literature concentration: surveys, 6 hours",
      count: 2,
      options: [
        "ENGL 3360", "ENGL 3370", "ENGL 3430", "ENGL 3440", "ENGL 3450", "ENGL 3455",
        "ENGL 3465", "ENGL 3470", "ENGL 3830", "ENGL 3840", "ENGL 3920", "ENGL 3924",
      ],
    }
,
    {
      kind: "choose",
      name: "Literature concentration: major author, 3 hours",
      count: 1,
      options: [
        "ENGL 4400", "ENGL 4410", "ENGL 4430", "ENGL 4440", "ENGL 4460",
      ],
    }
,
    {
      kind: "choose",
      name: "Literature concentration: Critical theory, writing studies and game studies, 3 hours",
      count: 1,
      options: [
        "ENGL 4130", "ENGL 4140", "ENGL 4145", "ENGL 4150", "ENGL 4195", "ENGL 4200",
        "ENGL 4205", "ENGL 4210", "ENGL 4215", "ENGL 4225", "ENGL 4230", "ENGL 4240",
        "ENGL 4245", "ENGL 4255", "ENGL 4285", "ENGL 4680",
      ],
    }
,
    {
      kind: "choose",
      name: "Literature concentration: Race, ethnicity and indigeneity, 3 hours",
      count: 1,
      options: [
        "ENGL 4220", "ENGL 4250", "ENGL 4260", "ENGL 4270", "ENGL 4280", "ENGL 4660",
        "ENGL 4841",
      ],
    }
,
    {
      kind: "choose",
      name: "Literature concentration: Gender, sexuality and the body, 3 hours",
      count: 1,
      options: [
        "ENGL 4405", "ENGL 4630", "ENGL 4670",
      ],
    }
,
    {
      kind: "choose",
      name: "Literature concentration: Early historical periods, 3 hours",
      count: 1,
      options: [
        "ENGL 4431", "ENGL 4432", "ENGL 4433", "ENGL 4830", "ENGL 4831",
      ],
    }
,
    {
      kind: "choose",
      name: "Literature concentration: Middle historical periods, 3 hours",
      count: 1,
      options: [
        "ENGL 4434", "ENGL 4435", "ENGL 4490", "ENGL 4832", "ENGL 4842", "ENGL 4844",
      ],
    }
,
    {
      kind: "choose",
      name: "Literature concentration: Late historical periods, 3 hours",
      count: 1,
      options: [
        "ENGL 4610", "ENGL 4665", "ENGL 4845",
      ],
    }
,
          // "One additional 4000-level course from any of the above listed categories." Every
      // candidate is already an option of one of the category groups, and the validator
      // forbids double listing, so this pool stays advisor-checked.
    {
      kind: "pool",
      name: "Literature concentration: one additional 4000-level course from any of the above categories, 3 hours",
      hours: 3,
    },
  ],
};
