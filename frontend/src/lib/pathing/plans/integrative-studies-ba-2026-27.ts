import type { RequirementSet } from "../types";

/**
 * Integrative Studies, BA, from the UNT 2026-2027 Undergraduate Catalog:
 * https://catalog.unt.edu/preview_program.php?catoid=40&poid=21274
 * Copied from the program page in a browser on 2026-10-14 (catalog.unt.edu
 * refuses plain HTTP fetches). Requirements follow the page's order; shared
 * requirement groups carried from pages the major hyperlinks come first, in the
 * order the major page references them. Single-ownership trims are documented in
 * docs/research/degree-plans/encoding-notes.md.
 *
 * The major is individualized: three student-chosen 12-hour fields, encoded as
hour-based pools with the counselor-approval rule in notChecked.
 */
export const integrativeStudiesBa2026: RequirementSet = {
  name: "Integrative Studies, BA (2026-2027)",
  source: "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21274, copied 2026-10-14",
  notChecked: [
    "the university-wide 120-hour minimum, advanced-hour minimum, residence, and overall GPA rules of the Degree and Program Requirements section (navoid=4689), which the major page requires.",
    "the three fields are student-chosen and counselor-approved; the engine cannot see which courses belong to a student's field.",
    "a minimum of 6 advanced hours in each field.",
    "the CLASS distribution lists are not exhaustive; see an academic advisor for additional approved courses.",
    "3 hours from an approved Study Abroad program can substitute for the Cultural Diversity and Global Issues distribution group.",
    "the CLASS Foreign Language requirement varies from 3 to 12 hours by placement (or proficiency) and must reach the Intermediate II (2050) level.",
    "no minor is required.",
    "the page's four-year example uses 'Major Field' placeholders, confirming the individualized encoding.",
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
          // "Must attain Intermediate II (2050) level (prerequisite for 2050 course is 2040;
      // prerequisite for 2040 course is 1020; prerequisite for 1020 course is 1010)." Hours
      // vary by placement and proficiency, so the engine cannot measure this pool.
    {
      kind: "pool",
      name: "CLASS Foreign Language, 3-12 hours (or proficiency)",
      hours: 3,
    }
,
          // "3 advanced hours in one course taken at UNT"; 3 hours from an approved Study Abroad program can substitute.
    {
      kind: "choose",
      name: "CLASS Distribution: Cultural Diversity and Global Issues, 3 advanced hours",
      count: 1,
      options: [
        "COMM 3320", "COMM 3620", "COMM 4260", "COMM 4545", "COMM 4640", "DANC 3800",
        "ECON 3150", "ECON 4100", "ECON 4650", "ENGL 4220", "ENGL 4245", "ENGL 4250",
        "ENGL 4255", "ENGL 4260", "ENGL 4270", "ENGL 4280", "ENGL 4285", "ENGL 4650",
        "ENGL 4670", "FREN 3310", "FREN 3210", "GEOG 3010", "GERM 3050", "GERM 3052",
        "GERM 3060", "HIST 4060", "HIST 4171", "HIST 3495", "JAPN 3020", "JOUR 4240",
        "JOUR 4250", "MRTS 3420", "MRTS 3470", "MRTS 3475", "MRTS 4360", "PHIL 4700",
        "PSCI 3105", "PSCI 3702", "PSCI 3704", "PSYC 4030", "PSYC 4040", "SOCI 4250",
        "SPAN 3110", "SPAN 4360", "TECM 3550", "WGST 3100", "WGST 3500", "WGST 4100",
        "WLLC 3000", "WLLC 3010", "WLLC 3020", "WLLC 3100", "WLLC 3310", "WLLC 3530",
        "WLLC 3600", "WLLC 3700",
      ],
    }
,
          // "3 advanced hours in one course taken at UNT".
    {
      kind: "choose",
      name: "CLASS Distribution: Communication and Digital Skills, 3 advanced hours",
      count: 1,
      options: [
        "ANTH 4210", "ANTH 4760", "COMM 3420", "COMM 3720", "COMM 3820", "COMM 4240",
        "COMM 4320", "ECON 4450", "ECON 4630", "ENGL 3110", "ENGL 4430", "ENGL 4440",
        "FREN 3020", "FREN 4040", "FREN 4150", "GEOG 3000", "GEOG 3500", "GEOG 4580",
        "GERM 3034", "GERM 3070", "GERM 4150", "HIST 3450", "HIST 4271", "HIST 4830",
        "JAPN 3030", "JAPN 4150", "JOUR 4270", "MRTS 3210", "MRTS 3220", "MRTS 3230",
        "MRTS 3500", "MRTS 3525", "PHIL 3450", "PSCI 3160", "PSCI 3300", "PSCI 3310",
        "PSCI 3320", "PSYC 4600", "SOCI 3280", "SOCI 4850", "SPAN 4150", "TECM 3100",
        "TECM 3200", "TECM 4300", "UCRS 3050", "THEA 3046", "THEA 4051", "WLLC 3200",
        "WLLC 3400", "WLLC 3410",
      ],
    }
,
          // "The 36-hour integrative studies major is comprised of 12 hours in each of three fields
      // chosen by the student and approved by his or her academic counselor." No course list is
      // published; the counselor approves the field.
    {
      kind: "pool",
      name: "Field 1, 12 hours",
      hours: 12,
    }
,
    {
      kind: "pool",
      name: "Field 2, 12 hours",
      hours: 12,
    }
,
    {
      kind: "pool",
      name: "Field 3, 12 hours",
      hours: 12,
    },
  ],
};
