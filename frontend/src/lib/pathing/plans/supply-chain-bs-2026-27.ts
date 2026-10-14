import type { RequirementSet } from "../types";

/**
 * Supply Chain Management, BS, from the UNT 2026-2027 Undergraduate Catalog:
 * https://catalog.unt.edu/preview_program.php?catoid=40&poid=21322
 * Copied from the program page in a browser on 2026-10-14 (catalog.unt.edu
 * refuses plain HTTP fetches). Requirements follow the page's order; shared
 * requirement groups carried from pages the major hyperlinks come first, in the
 * order the major page references them. Single-ownership trims are documented in
 * docs/research/degree-plans/encoding-notes.md.
 */
export const supplyChainBs2026: RequirementSet = {
  name: "Supply Chain Management, BS (2026-2027)",
  source: "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21322, copied 2026-10-14",
  notChecked: [
    "the university-wide 120-hour minimum, advanced-hour minimum, residence, and overall GPA rules of the Degree and Program Requirements section (navoid=4689), which the major page requires.",
    "admission to the professional program requires a 2.7 grade point average on all hours attempted at UNT; transfer students must have completed the equivalent pre-business requirements with a 2.7 GPA.",
    "students must receive a grade of C or above in each professional program course and complete them with a cumulative UNT GPA of 2.0 or higher.",
    "all students pursuing a bachelor of science in supply chain management must have a grade point average of at least 2.0 on all hours attempted at UNT.",
    "with departmental permission, professional field electives may be selected from other programs, or one internship may be counted in place of up to 3 hours of professional field electives; the pool is advisor-checked.",
    "the professional field electives pool carries no printed course list; an advisor confirms the selections.",
    "transfer credit rules and the 30-hour major-at-UNT framing.",
    "this is the Bachelor of Science program; it does not carry the BBA communication combination, international requirement, or BBA professional-development groups.",
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
                  "ADES 3700", "COMM 1440", "CSCE 1010", "HDFS 2033", "INST 2100", "JOUR 2300",
                  "LING 2070", "MKTG 2650", "PHED 1000", "RHAB 3000", "TECM 1500", "UNIV 2100",
                  "UNIV 2300", "WGST 2100",
                ],
              },
          ],
        },
      ],
    },
          // "Pre-business requirements, 21 hours"; the final 3 hours are the one-of mathematics
      // course below. DSCI 2710, ECON 1100, ECON 1110 and the mathematics one-of are core options,
      // so the UCC lists here drop them (single ownership).
    {
      kind: "all",
      name: "Pre-business requirements, 18 hours",
      courses: [
        "ACCT 2010", "ACCT 2020", "BCIS 2610", "DSCI 2710", "ECON 1100", "ECON 1110",
      ],
    }
,
    {
      kind: "choose",
      name: "Pre-business mathematics, 3 hours",
      count: 1,
      options: [
        "MATH 1190", "MATH 1710",
      ],
    }
,
          // ACCT 2010, ACCT 2020, BCIS 2610 and DSCI 2710 are counted in pre-business, so this
      // supply-chain foundation block carries the remaining seven courses.
    {
      kind: "all",
      name: "Business foundation requirements, 21 hours",
      courses: [
        "BLAW 3430", "DSCI 3710", "FINA 3770", "LSCM 3960", "MGMT 3720", "MKTG 3650",
        "OPSM 3830",
      ],
    }
,
    {
      kind: "choice",
      name: "Supply chain major, 33 hours (choose one concentration)",
      branches: [
        {
          name: "Logistics concentration",
          requirements: [
                        {
                          kind: "all",
                          name: "Concentration courses",
                          courses: [
                            "LSCM 4510", "LSCM 4530", "LSCM 4560",
                          ],
                        },
                              // "Professional Field Electives (6 hours)" — the page lists no course set for this pool;
                          // an advisor confirms the selections.
                        {
                          kind: "pool",
                          name: "Professional Field Electives, 6 hours",
                          hours: 6,
                        },
                        {
                          kind: "all",
                          name: "Internship and capstone, 3 hours each",
                          courses: [
                            "LSCM 4800", "LSCM 4860",
                          ],
                        },
          ],
        },
        {
          name: "Operations concentration",
          requirements: [
                        {
                          kind: "all",
                          name: "Concentration courses",
                          courses: [
                            "OPSM 4820", "OPSM 4830", "OPSM 4850",
                          ],
                        },
                              // "Professional Field Electives (6 hours)" — the page lists no course set for this pool;
                          // an advisor confirms the selections.
                        {
                          kind: "pool",
                          name: "Professional Field Electives, 6 hours",
                          hours: 6,
                        },
                        {
                          kind: "all",
                          name: "Internship and capstone, 3 hours each",
                          courses: [
                            "LSCM 4860", "OPSM 4800",
                          ],
                        },
          ],
        },
        {
          name: "Aviation Logistics concentration",
          requirements: [
                        {
                          kind: "all",
                          name: "Concentration courses",
                          courses: [
                            "LGAV 3100", "LGAV 3120", "LGAV 3130",
                          ],
                        },
                              // "Professional Field Electives (6 hours)" — the page lists no course set for this pool;
                          // an advisor confirms the selections.
                        {
                          kind: "pool",
                          name: "Professional Field Electives, 6 hours",
                          hours: 6,
                        },
                        {
                          kind: "all",
                          name: "Internship and capstone, 3 hours each",
                          courses: [
                            "LGAV 4100", "LSCM 4800",
                          ],
                        },
          ],
        },
        {
          name: "Supply Chain Analytics concentration",
          requirements: [
                        {
                          kind: "all",
                          name: "Concentration courses",
                          courses: [
                            "DSCI 3870", "DSCI 4510", "DSCI 4520",
                          ],
                        },
                              // "Professional Field Electives (6 hours)" — the page lists no course set for this pool;
                          // an advisor confirms the selections.
                        {
                          kind: "pool",
                          name: "Professional Field Electives, 6 hours",
                          hours: 6,
                        },
                        {
                          kind: "all",
                          name: "Internship and capstone, 3 hours each",
                          courses: [
                            "LSCM 4860", "LSCM 4800",
                          ],
                        },
          ],
        },
        {
          name: "Purchasing concentration",
          requirements: [
                        {
                          kind: "all",
                          name: "Concentration courses",
                          courses: [
                            "PRCH 4825", "PRCH 4835", "PRCH 4845",
                          ],
                        },
                              // "Professional Field Electives (6 hours)" — the page lists no course set for this pool;
                          // an advisor confirms the selections.
                        {
                          kind: "pool",
                          name: "Professional Field Electives, 6 hours",
                          hours: 6,
                        },
                        {
                          kind: "all",
                          name: "Internship and capstone, 3 hours each",
                          courses: [
                            "LSCM 4860", "PRCH 4800",
                          ],
                        },
          ],
        },
      ],
    },
    {
      kind: "all",
      name: "Professional development, 2 hours",
      courses: [
        "BUSI 1200", "BUSI 3100",
      ],
    }
,
          // "Read a minimum of one of the following: BUSI 3200, COMM 1010, TECM 2700."
    {
      kind: "choose",
      name: "Professional development: one of",
      count: 1,
      options: [
        "BUSI 3200", "COMM 1010", "TECM 2700",
      ],
    },
  ],
};
