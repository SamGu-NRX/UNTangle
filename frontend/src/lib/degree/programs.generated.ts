// GENERATED from packages/ingest/data/degree/programs.json by packages/ingest/src/degree/build.ts.
// Do not edit by hand: rebuild with `bun packages/ingest/src/degree/build.ts`.
// Source: UNT 2026-2027 catalog pages captured in packages/ingest/data/catalog/unt-2026-27.
import type { DegreeData } from "@untangle/core/degree/types";

export const DEGREE_DATA: DegreeData = {
  "catalogId": "unt-2026-27",
  "catalogYear": "2026-2027",
  "builtAt": "2026-10-23T04:55:31.144Z",
  "pages": [
    {
      "file": "cs-bs.html",
      "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
      "title": "Program: Computer Science, BS - University of North Texas",
      "capturedAt": "2026-10-15T12:22:01.320Z",
      "sha256": "7fa35a53bcf8483e81c45d676852728ba2a9eeb36d6d1ae7cf2e8437cf809267"
    },
    {
      "file": "ce-bs.html",
      "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
      "title": "Program: Computer Engineering, BS - University of North Texas",
      "capturedAt": "2026-10-15T12:22:01.320Z",
      "sha256": "d7feeb0c09892efec3a5621a90c3ce1e365d0be7e1c227c7aecfca8bd904c390"
    },
    {
      "file": "core-curriculum.html",
      "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
      "title": "Program: University Core Curriculum - University of North Texas",
      "capturedAt": "2026-10-15T12:22:01.320Z",
      "sha256": "0a858d23606ac9863007c52420e1fbc1d60ca86d9a69ec0222094d5f87b25f14"
    },
    {
      "file": "degree-requirements.html",
      "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
      "title": "Degree and Program Requirements - University of North Texas",
      "capturedAt": "2026-10-15T12:22:01.320Z",
      "sha256": "4e50a88e161b681bd1e2c7bf9b264e8e0aa71546397f4d566c5072fc535e0f50"
    },
    {
      "file": "it-bs.html",
      "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
      "title": "Program: Information Technology, BS - University of North Texas",
      "capturedAt": "2026-10-22T13:49:52.419Z",
      "sha256": "77bd316a744c4f08e7a32216464ae3046b9e853bc295726890666c740d0c4252"
    },
    {
      "file": "cybersecurity-bs.html",
      "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21644",
      "title": "Program: Cybersecurity, BS - University of North Texas",
      "capturedAt": "2026-10-22T13:49:52.419Z",
      "sha256": "0be4a44f5afe1e77f4404abe2a9e849913fd421d243c0d2687c85144412aa43d"
    },
    {
      "file": "ee-bs.html",
      "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
      "title": "Program: Electrical Engineering, BS - University of North Texas",
      "capturedAt": "2026-10-22T13:49:52.419Z",
      "sha256": "1c34ae01ef3e6041acbe049ec5d6240f7671eec42e995427e37a95d2e4161a4e"
    }
  ],
  "programs": [
    {
      "id": "cs-bs",
      "name": "Computer Science, BS",
      "catalogId": "unt-2026-27",
      "sourceUrl": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
      "requirements": [
        {
          "kind": "policy",
          "name": "Total hours: 120",
          "policy": {
            "type": "totalHours",
            "hours": 120
          },
          "quote": "A minimum of 120 semester hours, of which 42 must be advanced, and fulfillment of degree requirements for the Bachelor’s degree as specified in the University Core Curriculum in the Degree and Program Requirements of this catalog and the College of Engineering requirements.",
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "HoursRequiredAndGeneralcollegeRequirements",
            "heading": "Hours required and general/college requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours: 42",
          "policy": {
            "type": "advancedHours",
            "hours": 42
          },
          "quote": "A minimum of 120 semester hours, of which 42 must be advanced, and fulfillment of degree requirements for the Bachelor’s degree as specified in the University Core Curriculum in the Degree and Program Requirements of this catalog and the College of Engineering requirements.",
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "HoursRequiredAndGeneralcollegeRequirements",
            "heading": "Hours required and general/college requirements"
          }
        },
        {
          "kind": "group",
          "name": "Major requirements",
          "children": [
            {
              "kind": "all",
              "name": "Required courses",
              "items": [
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 1010"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 1015"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 1030"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 1040"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 2100"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 2110"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 2120"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 2130"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 2610"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 3444"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 3550"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 3600"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 4010"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 4110"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 4350"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 4901"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 4902"
                      ]
                    }
                  ]
                }
              ],
              "citation": {
                "page": "cs-bs.html",
                "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
                "anchor": "MajorRequirements",
                "heading": "Major requirements"
              }
            },
            {
              "kind": "note",
              "name": "55-hour major minimum",
              "text": "A minimum of 55 semester hours, including:",
              "citation": {
                "page": "cs-bs.html",
                "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
                "anchor": "MajorRequirements",
                "heading": "Major requirements"
              }
            },
            {
              "kind": "pool",
              "name": "CSCE advanced electives, 6 hours",
              "hours": 6,
              "match": {
                "subjects": [
                  "CSCE"
                ],
                "minLevel": 3000,
                "maxLevel": 4999
              },
              "note": "UNT's CSCE Advanced Elective Courses list is not captured here, so the audit lists any 3000- or 4000-level CSCE course on your record as a possible elective. A 5000-level graduate course is not counted; ask an advisor whether it can be.",
              "citation": {
                "page": "cs-bs.html",
                "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
                "anchor": "MajorRequirements",
                "heading": "Major requirements"
              }
            }
          ],
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "MajorRequirements",
            "heading": "Major requirements"
          }
        },
        {
          "kind": "all",
          "name": "Other required courses",
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 2710"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 1710"
                  ]
                },
                {
                  "must": [
                    "MATH 1810",
                    "MATH 1820"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "TECM 2700"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "OtherRequiredCourses",
            "heading": "Other required courses"
          }
        },
        {
          "kind": "hours",
          "name": "CSCE core, 6 hours",
          "hours": 6,
          "options": [
            {
              "must": [
                "CSCE 3530"
              ]
            },
            {
              "must": [
                "CSCE 4115"
              ]
            },
            {
              "must": [
                "CSCE 4430"
              ]
            },
            {
              "must": [
                "CSCE 4600"
              ]
            },
            {
              "must": [
                "CSCE 4650"
              ]
            }
          ],
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "CSCECore6Hours",
            "heading": "CSCE core, 6 hours"
          }
        },
        {
          "kind": "hours",
          "name": "CSCE breadth courses, 6 hours",
          "hours": 6,
          "options": [
            {
              "must": [
                "CSCE 4201"
              ]
            },
            {
              "must": [
                "CSCE 4210"
              ]
            },
            {
              "must": [
                "CSCE 4230"
              ]
            },
            {
              "must": [
                "CSCE 4240"
              ]
            },
            {
              "must": [
                "CSCE 4290"
              ]
            },
            {
              "must": [
                "CSCE 4460"
              ]
            }
          ],
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "CSCEBreadthCourses6Hours",
            "heading": "CSCE breadth courses, 6 hours"
          }
        },
        {
          "kind": "choose",
          "name": "Laboratory science, 6-8 hours (choose 2)",
          "count": 2,
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 1112"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 1132"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 1710",
                    "BIOL 1760"
                  ]
                },
                {
                  "must": [
                    "BIOL 1720",
                    "BIOL 1760"
                  ]
                },
                {
                  "must": [
                    "BIOL 1710",
                    "BIOL 1720",
                    "BIOL 1760"
                  ],
                  "counts": 2
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 2301",
                    "BIOL 2311"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 2302",
                    "BIOL 2312"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CHEM 1410",
                    "CHEM 1430"
                  ]
                },
                {
                  "must": [
                    "CHEM 1415",
                    "CHEM 1435"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CHEM 1420",
                    "CHEM 1440"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "GEOG 1710"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "GEOL 1610"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1052"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1062"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1270"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1410",
                    "PHYS 1430"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1420",
                    "PHYS 1440"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1710",
                    "PHYS 1730"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 2220",
                    "PHYS 2240"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "Choose2Courses68HoursFromTheFollowingCourses",
            "heading": "Choose 2 courses (6-8 hours) from the following courses"
          }
        },
        {
          "kind": "pool",
          "name": "Technical writing, 3 hours",
          "hours": 3,
          "match": {
            "subjects": [
              "TECM"
            ],
            "minLevel": 4000,
            "maxLevel": 4999
          },
          "note": "The catalog names no list, only \"any 4000-level TECM course\"; the audit cannot tell which TECM course numbers exist.",
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "3HoursSelectedFrom",
            "heading": "3 hours selected from"
          }
        },
        {
          "kind": "note",
          "name": "Note",
          "text": "A maximum of 6 hours of credit in CSCE 2900, CSCE 4890, CSCE 4920, CSCE 4940 or CSCE 4950 will count toward this degree. The 6 hours may include at most 3 hours in CSCE 4920.",
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "Note",
            "heading": "Note"
          }
        },
        {
          "kind": "note",
          "name": "Minor",
          "text": "Optional.",
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "Minor",
            "heading": "Minor"
          }
        },
        {
          "kind": "note",
          "name": "Electives",
          "text": "Hours required for electives may vary based on course selection and the University Core Curriculum requirements. Electives may be required to satisfy the advanced hour requirement (42) and/or the minimum total hours required for the degree. For specific information see an academic advisor in the College of Engineering. Currently, there should be approximately 15 hours of CSCE electives available.",
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "Electives",
            "heading": "Electives"
          }
        },
        {
          "kind": "policy",
          "name": "Minimum grade of C (major courses)",
          "policy": {
            "type": "minGrade",
            "grade": "C",
            "scope": "all courses required in the major",
            "courseScope": {
              "kind": "applied"
            }
          },
          "quote": "A minimum grade of C is required in all courses required in a student’s major for degree completion. Courses include, but are not limited to, engineering, computing, mathematics, laboratory sciences, supporting area, technical elective, technical option, energy elective, and specialization courses.",
          "citation": {
            "page": "cs-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227",
            "anchor": "DepartmentPolicies",
            "heading": "Department policies"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours at UNT: 24",
          "policy": {
            "type": "advancedHoursAtUnt",
            "hours": 24
          },
          "quote": "A minimum of 24 hours of advanced work (3000 or 4000 level) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Residence",
            "heading": "Residence"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours in the major at UNT: 12",
          "policy": {
            "type": "advancedHoursAtUnt",
            "hours": 12,
            "courseScope": {
              "kind": "applied"
            }
          },
          "quote": "A minimum of 12 hours of advanced work in the major (except for the BAAS degree) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Residence",
            "heading": "Residence"
          }
        },
        {
          "kind": "policy",
          "name": "Residency",
          "policy": {
            "type": "residencyPercent",
            "percent": 25
          },
          "quote": "Residence: minimum of 25 percent of the total hours for the degree (e.g., 30 hours for a 120-hour degree) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Minimum Hour Requirements",
            "heading": "Minimum Hour Requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Overall GPA",
          "policy": {
            "type": "gpa",
            "minimum": 2,
            "scope": "overall",
            "courseScope": {
              "kind": "overall"
            }
          },
          "quote": "A minimum overall grade point average (OGPA) of 2.000 (C) on all work attempted, including all transfer, correspondence, extension and residence work.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Grade Point Average (GPA)",
            "heading": "Grade Point Average (GPA)"
          }
        },
        {
          "kind": "policy",
          "name": "UNT GPA",
          "policy": {
            "type": "gpa",
            "minimum": 2,
            "scope": "unt",
            "courseScope": {
              "kind": "unt"
            }
          },
          "quote": "A minimum cumulative GPA (UNT-CGPA) of 2.000 (C) on all work at UNT. Students may not use transfer credit to raise the GPA of work done at UNT.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Grade Point Average (GPA)",
            "heading": "Grade Point Average (GPA)"
          }
        },
        {
          "kind": "policy",
          "name": "Communication core grade",
          "policy": {
            "type": "minGrade",
            "grade": "C",
            "scope": "Communication core requirement",
            "courseScope": {
              "kind": "codes",
              "codes": [
                "ENGL 1310",
                "ENGL 1311",
                "ENGL 1315",
                "ENGL 1320",
                "ENGL 1321",
                "ENGL 1325",
                "TECM 1700",
                "TECM 2700"
              ]
            }
          },
          "quote": "Students must have a grade of C or better in courses that meet the Communication requirement of the University Core Curriculum to show proficiency in English composition. Students who have earned a D in one or more of these two required courses must repeat the course and raise the grade to a C or better. Transfer students with more than 90 hours and who have earned a D in any of the basic English writing courses must retake the course during their first term/semester in residence.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "English Composition Proficiency",
            "heading": "English Composition Proficiency"
          }
        }
      ],
      "coreSharedCourses": [
        "BIOL 1112",
        "BIOL 1132",
        "BIOL 1710",
        "BIOL 1720",
        "BIOL 2301",
        "BIOL 2302",
        "CHEM 1410",
        "CHEM 1420",
        "CSCE 1010",
        "GEOG 1710",
        "GEOL 1610",
        "MATH 1710",
        "MATH 1810",
        "PHYS 1052",
        "PHYS 1062",
        "PHYS 1270",
        "PHYS 1410",
        "PHYS 1420",
        "PHYS 1710",
        "PHYS 2220",
        "TECM 2700"
      ],
      "courseSharing": "advisor"
    },
    {
      "id": "ce-bs",
      "name": "Computer Engineering, BS",
      "catalogId": "unt-2026-27",
      "sourceUrl": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
      "requirements": [
        {
          "kind": "policy",
          "name": "Total hours: 121",
          "policy": {
            "type": "totalHours",
            "hours": 121
          },
          "quote": "A minimum of 121 semester hours, of which 39 must be advanced, and fulfillment of degree requirements for the Bachelor’s degree as specified in the University Core Curriculum in the Degree and Program Requirements of this catalog and the College of Engineering requirements.",
          "citation": {
            "page": "ce-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
            "anchor": "HoursRequiredAndGeneralcollegeRequirements",
            "heading": "Hours required and general/college requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours: 39",
          "policy": {
            "type": "advancedHours",
            "hours": 39
          },
          "quote": "A minimum of 121 semester hours, of which 39 must be advanced, and fulfillment of degree requirements for the Bachelor’s degree as specified in the University Core Curriculum in the Degree and Program Requirements of this catalog and the College of Engineering requirements.",
          "citation": {
            "page": "ce-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
            "anchor": "HoursRequiredAndGeneralcollegeRequirements",
            "heading": "Hours required and general/college requirements"
          }
        },
        {
          "kind": "group",
          "name": "Major requirements",
          "children": [
            {
              "kind": "all",
              "name": "Required courses",
              "items": [
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 1010"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 1015"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 1030"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 1040"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 2100"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 2110"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 2120"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 2130"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 2610"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 3010"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 3020"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 3600"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 3610"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 3612"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 3730"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 4010"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 4910"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "CSCE 4915"
                      ]
                    }
                  ]
                }
              ],
              "citation": {
                "page": "ce-bs.html",
                "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
                "anchor": "MajorRequirements",
                "heading": "Major requirements"
              }
            },
            {
              "kind": "note",
              "name": "52-hour major minimum",
              "text": "A minimum of 52 semester hours, including:",
              "citation": {
                "page": "ce-bs.html",
                "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
                "anchor": "MajorRequirements",
                "heading": "Major requirements"
              }
            }
          ],
          "citation": {
            "page": "ce-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
            "anchor": "MajorRequirements",
            "heading": "Major requirements"
          }
        },
        {
          "kind": "all",
          "name": "Other required courses",
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "CHEM 1410",
                    "CHEM 1430"
                  ]
                },
                {
                  "must": [
                    "CHEM 1415",
                    "CHEM 1435"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 2610",
                    "EENG 2611"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 2710",
                    "EENG 2711"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 3510"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 1710"
                  ]
                },
                {
                  "must": [
                    "MATH 1810",
                    "MATH 1820"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 1720"
                  ]
                },
                {
                  "must": [
                    "MATH 1830"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 2730"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1710",
                    "PHYS 1730"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 2220",
                    "PHYS 2240"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "TECM 2700"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "ce-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
            "anchor": "OtherRequiredCourses",
            "heading": "Other required courses"
          }
        },
        {
          "kind": "choice",
          "name": "Specialization area, 9 hours",
          "branches": [
            {
              "name": "Real-Time and Embedded Systems",
              "node": {
                "kind": "choose",
                "name": "Three courses from Real-Time and Embedded Systems",
                "count": 3,
                "items": [
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 3444"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4440"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4600"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4610"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4620"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4730"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4890"
                        ]
                      }
                    ]
                  }
                ],
                "citation": {
                  "page": "ce-bs.html",
                  "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
                  "anchor": "RealTimeAndEmbeddedSystems",
                  "heading": "Real-Time and Embedded Systems"
                }
              }
            },
            {
              "name": "VLSI and Electronics",
              "node": {
                "kind": "choose",
                "name": "Three courses from VLSI and Electronics",
                "count": 3,
                "items": [
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 3610"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4610"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4730"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4890"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "PHYS 4500"
                        ]
                      }
                    ]
                  }
                ],
                "citation": {
                  "page": "ce-bs.html",
                  "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
                  "anchor": "VLSIAndElectronics",
                  "heading": "VLSI and Electronics"
                }
              }
            },
            {
              "name": "Communication and Networks",
              "node": {
                "kind": "choose",
                "name": "Three courses from Communication and Networks",
                "count": 3,
                "items": [
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 3420"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 3530"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 3550"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4510"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4520"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4530"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4560"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4890"
                        ]
                      }
                    ]
                  }
                ],
                "citation": {
                  "page": "ce-bs.html",
                  "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
                  "anchor": "CommunicationAndNetworks",
                  "heading": "Communication and Networks"
                }
              }
            },
            {
              "name": "Computer Systems",
              "node": {
                "kind": "choose",
                "name": "Three courses from Computer Systems",
                "count": 3,
                "items": [
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4160"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4050"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4240"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4600"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4610"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4620"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4650"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4730"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4890"
                        ]
                      }
                    ]
                  }
                ],
                "citation": {
                  "page": "ce-bs.html",
                  "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
                  "anchor": "ComputerSystems",
                  "heading": "Computer Systems"
                }
              }
            },
            {
              "name": "Artificial intelligence and machine learning",
              "node": {
                "kind": "choose",
                "name": "Three courses from Artificial intelligence and machine learning",
                "count": 3,
                "items": [
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4200"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4201"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4205"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4290"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4380"
                        ]
                      }
                    ]
                  },
                  {
                    "alternatives": [
                      {
                        "must": [
                          "CSCE 4890"
                        ]
                      }
                    ]
                  }
                ],
                "citation": {
                  "page": "ce-bs.html",
                  "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
                  "anchor": "ArtificialIntelligenceAndMachineLearning",
                  "heading": "Artificial intelligence and machine learning"
                }
              }
            }
          ],
          "citation": {
            "page": "ce-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
            "anchor": "SpecializationArea9Hours",
            "heading": "Specialization area, 9 hours"
          }
        },
        {
          "kind": "note",
          "name": "Note",
          "text": "A maximum of 6 hours of credit in CSCE 4890, CSCE 4920, CSCE 4940, or CSCE 4950 will count toward this degree. The 6 hours may include at most 3 hours in CSCE 4920.",
          "citation": {
            "page": "ce-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
            "anchor": "Note",
            "heading": "Note"
          }
        },
        {
          "kind": "note",
          "name": "Minor",
          "text": "Optional.",
          "citation": {
            "page": "ce-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
            "anchor": "Minor",
            "heading": "Minor"
          }
        },
        {
          "kind": "note",
          "name": "Electives",
          "text": "See CSE faculty advisor.",
          "citation": {
            "page": "ce-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
            "anchor": "Electives",
            "heading": "Electives"
          }
        },
        {
          "kind": "policy",
          "name": "Minimum grade of C (major courses)",
          "policy": {
            "type": "minGrade",
            "grade": "C",
            "scope": "all courses required in the major",
            "courseScope": {
              "kind": "applied"
            }
          },
          "quote": "A minimum grade of C is required in all courses required in a student’s major for degree completion. Courses include, but are not limited to, engineering, computing, mathematics, laboratory sciences, supporting area, technical elective, technical option, energy elective, and specialization courses.",
          "citation": {
            "page": "ce-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21225",
            "anchor": "DepartmentPolicies",
            "heading": "Department policies"
          }
        },
        {
          "kind": "policy",
          "name": "Total hours: 120",
          "policy": {
            "type": "totalHours",
            "hours": 120
          },
          "quote": "Students must complete a minimum of 120 semester hours to earn a degree at UNT. One course may be used to meet multiple requirements. Students should speak to an advisor to determine which courses can be used to meet more than one requirement. Schools, colleges and departments may have additional requirements to qualify for graduation. Students must complete:",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Minimum Hour Requirements",
            "heading": "Minimum Hour Requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours at UNT: 24",
          "policy": {
            "type": "advancedHoursAtUnt",
            "hours": 24
          },
          "quote": "A minimum of 24 hours of advanced work (3000 or 4000 level) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Residence",
            "heading": "Residence"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours in the major at UNT: 12",
          "policy": {
            "type": "advancedHoursAtUnt",
            "hours": 12,
            "courseScope": {
              "kind": "applied"
            }
          },
          "quote": "A minimum of 12 hours of advanced work in the major (except for the BAAS degree) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Residence",
            "heading": "Residence"
          }
        },
        {
          "kind": "policy",
          "name": "Residency",
          "policy": {
            "type": "residencyPercent",
            "percent": 25
          },
          "quote": "Residence: minimum of 25 percent of the total hours for the degree (e.g., 30 hours for a 120-hour degree) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Minimum Hour Requirements",
            "heading": "Minimum Hour Requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Overall GPA",
          "policy": {
            "type": "gpa",
            "minimum": 2,
            "scope": "overall",
            "courseScope": {
              "kind": "overall"
            }
          },
          "quote": "A minimum overall grade point average (OGPA) of 2.000 (C) on all work attempted, including all transfer, correspondence, extension and residence work.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Grade Point Average (GPA)",
            "heading": "Grade Point Average (GPA)"
          }
        },
        {
          "kind": "policy",
          "name": "UNT GPA",
          "policy": {
            "type": "gpa",
            "minimum": 2,
            "scope": "unt",
            "courseScope": {
              "kind": "unt"
            }
          },
          "quote": "A minimum cumulative GPA (UNT-CGPA) of 2.000 (C) on all work at UNT. Students may not use transfer credit to raise the GPA of work done at UNT.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Grade Point Average (GPA)",
            "heading": "Grade Point Average (GPA)"
          }
        },
        {
          "kind": "policy",
          "name": "Communication core grade",
          "policy": {
            "type": "minGrade",
            "grade": "C",
            "scope": "Communication core requirement",
            "courseScope": {
              "kind": "codes",
              "codes": [
                "ENGL 1310",
                "ENGL 1311",
                "ENGL 1315",
                "ENGL 1320",
                "ENGL 1321",
                "ENGL 1325",
                "TECM 1700",
                "TECM 2700"
              ]
            }
          },
          "quote": "Students must have a grade of C or better in courses that meet the Communication requirement of the University Core Curriculum to show proficiency in English composition. Students who have earned a D in one or more of these two required courses must repeat the course and raise the grade to a C or better. Transfer students with more than 90 hours and who have earned a D in any of the basic English writing courses must retake the course during their first term/semester in residence.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "English Composition Proficiency",
            "heading": "English Composition Proficiency"
          }
        }
      ],
      "coreSharedCourses": [
        "CHEM 1410",
        "CSCE 1010",
        "MATH 1710",
        "MATH 1720",
        "MATH 1810",
        "PHYS 1710",
        "PHYS 2220",
        "TECM 2700"
      ],
      "courseSharing": "advisor"
    },
    {
      "id": "it-bs",
      "name": "Information Technology, BS",
      "catalogId": "unt-2026-27",
      "sourceUrl": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
      "requirements": [
        {
          "kind": "policy",
          "name": "Total hours: 121",
          "policy": {
            "type": "totalHours",
            "hours": 121
          },
          "quote": "A minimum of 121 semester hours, of which 42 must be advanced, and fulfillment of degree requirements for the Bachelor of Science degree as specified in the University Core Curriculum in the Degree and Program Requirements of this catalog, and college requirements as specified in the College of Engineering section of this catalog. A minimum of 31 semester hours must be completed at UNT.",
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "HoursRequiredAndGeneralcollegeRequirements",
            "heading": "Hours required and general/college requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours: 42",
          "policy": {
            "type": "advancedHours",
            "hours": 42
          },
          "quote": "A minimum of 121 semester hours, of which 42 must be advanced, and fulfillment of degree requirements for the Bachelor of Science degree as specified in the University Core Curriculum in the Degree and Program Requirements of this catalog, and college requirements as specified in the College of Engineering section of this catalog. A minimum of 31 semester hours must be completed at UNT.",
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "HoursRequiredAndGeneralcollegeRequirements",
            "heading": "Hours required and general/college requirements"
          }
        },
        {
          "kind": "all",
          "name": "Required courses",
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "TECM 2700"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 1710"
                  ]
                },
                {
                  "must": [
                    "MATH 1810"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "RequiredCourses",
            "heading": "Required courses"
          }
        },
        {
          "kind": "choose",
          "name": "Laboratory science, 6-8 hours (choose 2)",
          "count": 2,
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 1112"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 1132"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 1710",
                    "BIOL 1760"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 2301",
                    "BIOL 2311"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 2302",
                    "BIOL 2312"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CHEM 1410",
                    "CHEM 1430"
                  ]
                },
                {
                  "must": [
                    "CHEM 1415",
                    "CHEM 1435"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "GEOG 1710"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "GEOL 1610"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1052"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1062"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1410",
                    "PHYS 1430"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1420",
                    "PHYS 1440"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1710",
                    "PHYS 1730"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1270"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "RequiredCourses",
            "heading": "Required courses"
          }
        },
        {
          "kind": "all",
          "name": "Major requirements",
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 1010"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 1015"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 1030"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 1040"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 2100"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 2110"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 2130"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3055"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3220"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3420"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3444"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3530"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3550"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3600"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3605"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4010"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4350"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4355"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4535"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4905"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4925"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "MajorRequirements",
            "heading": "Major requirements"
          }
        },
        {
          "kind": "pool",
          "name": "Supporting area, 18 hours",
          "hours": 18,
          "match": {
            "subjects": null,
            "minLevel": null,
            "maxLevel": null
          },
          "note": "The catalog says 18-20 hours may be chosen from many UNT departments and directs the student to a CSE faculty advisor; eligible courses are not listed.",
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "SupportingArea1820Hours",
            "heading": "Supporting area, 18-20 hours"
          }
        },
        {
          "kind": "note",
          "name": "Note",
          "text": "A maximum of 6 hours of credit in the following will count toward this degree: CSCE 4890, CSCE 4920, CSCE 4940, or CSCE 4950. The 6 hours may include at most 3 hours in CSCE 4920.",
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "Note",
            "heading": "Note"
          }
        },
        {
          "kind": "note",
          "name": "Minor",
          "text": "Optional.",
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "Minor",
            "heading": "Minor"
          }
        },
        {
          "kind": "note",
          "name": "Electives",
          "text": "See your academic advisor to discuss electives needed to reach the required 121 credit hours needed to graduate.",
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "Electives",
            "heading": "Electives"
          }
        },
        {
          "kind": "note",
          "name": "Other requirements",
          "text": "A maximum of 24 hours of technical credit from an accredited college may be applied to the supporting area.",
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "OtherRequirements",
            "heading": "Other requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Minimum grade of C (major courses)",
          "policy": {
            "type": "minGrade",
            "grade": "C",
            "scope": "all courses required in the major",
            "courseScope": {
              "kind": "applied"
            }
          },
          "quote": "A minimum grade of C is required in all courses required in a student’s major for degree completion. Courses include, but are not limited to, engineering, computing, mathematics, laboratory sciences, supporting area, technical elective, technical option, energy elective, and specialization courses.",
          "citation": {
            "page": "it-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21301",
            "anchor": "DepartmentPolicies",
            "heading": "Department policies"
          }
        },
        {
          "kind": "policy",
          "name": "Total hours: 120",
          "policy": {
            "type": "totalHours",
            "hours": 120
          },
          "quote": "Students must complete a minimum of 120 semester hours to earn a degree at UNT. One course may be used to meet multiple requirements. Students should speak to an advisor to determine which courses can be used to meet more than one requirement. Schools, colleges and departments may have additional requirements to qualify for graduation. Students must complete:",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Minimum Hour Requirements",
            "heading": "Minimum Hour Requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours at UNT: 24",
          "policy": {
            "type": "advancedHoursAtUnt",
            "hours": 24
          },
          "quote": "A minimum of 24 hours of advanced work (3000 or 4000 level) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Residence",
            "heading": "Residence"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours in the major at UNT: 12",
          "policy": {
            "type": "advancedHoursAtUnt",
            "hours": 12,
            "courseScope": {
              "kind": "applied"
            }
          },
          "quote": "A minimum of 12 hours of advanced work in the major (except for the BAAS degree) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Residence",
            "heading": "Residence"
          }
        },
        {
          "kind": "policy",
          "name": "Residency",
          "policy": {
            "type": "residencyPercent",
            "percent": 25
          },
          "quote": "Residence: minimum of 25 percent of the total hours for the degree (e.g., 30 hours for a 120-hour degree) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Minimum Hour Requirements",
            "heading": "Minimum Hour Requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Overall GPA",
          "policy": {
            "type": "gpa",
            "minimum": 2,
            "scope": "overall",
            "courseScope": {
              "kind": "overall"
            }
          },
          "quote": "A minimum overall grade point average (OGPA) of 2.000 (C) on all work attempted, including all transfer, correspondence, extension and residence work.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Grade Point Average (GPA)",
            "heading": "Grade Point Average (GPA)"
          }
        },
        {
          "kind": "policy",
          "name": "UNT GPA",
          "policy": {
            "type": "gpa",
            "minimum": 2,
            "scope": "unt",
            "courseScope": {
              "kind": "unt"
            }
          },
          "quote": "A minimum cumulative GPA (UNT-CGPA) of 2.000 (C) on all work at UNT. Students may not use transfer credit to raise the GPA of work done at UNT.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Grade Point Average (GPA)",
            "heading": "Grade Point Average (GPA)"
          }
        },
        {
          "kind": "policy",
          "name": "Communication core grade",
          "policy": {
            "type": "minGrade",
            "grade": "C",
            "scope": "Communication core requirement",
            "courseScope": {
              "kind": "codes",
              "codes": [
                "ENGL 1310",
                "ENGL 1311",
                "ENGL 1315",
                "ENGL 1320",
                "ENGL 1321",
                "ENGL 1325",
                "TECM 1700",
                "TECM 2700"
              ]
            }
          },
          "quote": "Students must have a grade of C or better in courses that meet the Communication requirement of the University Core Curriculum to show proficiency in English composition. Students who have earned a D in one or more of these two required courses must repeat the course and raise the grade to a C or better. Transfer students with more than 90 hours and who have earned a D in any of the basic English writing courses must retake the course during their first term/semester in residence.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "English Composition Proficiency",
            "heading": "English Composition Proficiency"
          }
        }
      ],
      "coreSharedCourses": [
        "BIOL 1112",
        "BIOL 1132",
        "BIOL 1710",
        "BIOL 2301",
        "BIOL 2302",
        "CHEM 1410",
        "CSCE 1010",
        "GEOG 1710",
        "GEOL 1610",
        "MATH 1710",
        "MATH 1810",
        "PHYS 1052",
        "PHYS 1062",
        "PHYS 1270",
        "PHYS 1410",
        "PHYS 1420",
        "PHYS 1710",
        "TECM 2700"
      ],
      "courseSharing": "advisor"
    },
    {
      "id": "cybersecurity-bs",
      "name": "Cybersecurity, BS",
      "catalogId": "unt-2026-27",
      "sourceUrl": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21644",
      "requirements": [
        {
          "kind": "note",
          "name": "70-hour major minimum",
          "text": "Major of 70 hours, including:",
          "citation": {
            "page": "cybersecurity-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21644",
            "anchor": "MajorRequirements",
            "heading": "Major requirements"
          }
        },
        {
          "kind": "all",
          "name": "Major requirements",
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 1010"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 1015"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 1030"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 1040"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 2100"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 2110"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 2120"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 2130"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3530"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3550"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3560"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 3600"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4010"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4535"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4555"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4560"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4565"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4575"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4907"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4927"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "cybersecurity-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21644",
            "anchor": "MajorRequirements",
            "heading": "Major requirements"
          }
        },
        {
          "kind": "choose",
          "name": "Major electives, 12 hours (choose 4)",
          "count": 4,
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4050"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4350"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4357"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4520"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4570"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 4600"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CJUS 3340"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CJUS 4330"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "INFO 4670"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "INFO 4710"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "INFO 4745"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "cybersecurity-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21644",
            "anchor": "Electives",
            "heading": "Electives"
          }
        },
        {
          "kind": "all",
          "name": "Other course requirements",
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 1710"
                  ]
                },
                {
                  "must": [
                    "MATH 1810"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "TECM 2700"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "cybersecurity-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21644",
            "anchor": "OtherCourseRequirements",
            "heading": "Other course requirements"
          }
        },
        {
          "kind": "choose",
          "name": "Laboratory science, 6-8 hours (choose 2)",
          "count": 2,
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 1112"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 1132"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "GEOG 1710"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "GEOL 1610"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1052"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1062"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1270"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 1710",
                    "BIOL 1760"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 1720",
                    "BIOL 1760"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 2301",
                    "BIOL 2311"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "BIOL 2302",
                    "BIOL 2312"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CHEM 1410",
                    "CHEM 1430"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CHEM 1420",
                    "CHEM 1440"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1410",
                    "PHYS 1430"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1420",
                    "PHYS 1440"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1710",
                    "PHYS 1730"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 2220",
                    "PHYS 2240"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "cybersecurity-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21644",
            "anchor": "Choose2Courses68HoursIncludingLabsFromTheFollowing",
            "heading": "Choose 2 courses (6-8 hours including labs) from the following:"
          }
        },
        {
          "kind": "note",
          "name": "Laboratory science lab pairing",
          "text": "Note: courses that have a separate lab must include both the lecture and lab components (e.g., PHYS 1710 AND PHYS 1730).",
          "citation": {
            "page": "cybersecurity-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21644",
            "anchor": "Choose2Courses68HoursIncludingLabsFromTheFollowing",
            "heading": "Choose 2 courses (6-8 hours including labs) from the following:"
          }
        },
        {
          "kind": "note",
          "name": "Minor",
          "text": "No minor is required.",
          "citation": {
            "page": "cybersecurity-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21644",
            "anchor": "Minor",
            "heading": "Minor"
          }
        },
        {
          "kind": "note",
          "name": "Electives",
          "text": "Students choose four courses from the following list:",
          "citation": {
            "page": "cybersecurity-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21644",
            "anchor": "Electives",
            "heading": "Electives"
          }
        },
        {
          "kind": "policy",
          "name": "Total hours: 120",
          "policy": {
            "type": "totalHours",
            "hours": 120
          },
          "quote": "Students must complete a minimum of 120 semester hours to earn a degree at UNT. One course may be used to meet multiple requirements. Students should speak to an advisor to determine which courses can be used to meet more than one requirement. Schools, colleges and departments may have additional requirements to qualify for graduation. Students must complete:",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Minimum Hour Requirements",
            "heading": "Minimum Hour Requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours at UNT: 24",
          "policy": {
            "type": "advancedHoursAtUnt",
            "hours": 24
          },
          "quote": "A minimum of 24 hours of advanced work (3000 or 4000 level) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Residence",
            "heading": "Residence"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours in the major at UNT: 12",
          "policy": {
            "type": "advancedHoursAtUnt",
            "hours": 12,
            "courseScope": {
              "kind": "applied"
            }
          },
          "quote": "A minimum of 12 hours of advanced work in the major (except for the BAAS degree) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Residence",
            "heading": "Residence"
          }
        },
        {
          "kind": "policy",
          "name": "Residency",
          "policy": {
            "type": "residencyPercent",
            "percent": 25
          },
          "quote": "Residence: minimum of 25 percent of the total hours for the degree (e.g., 30 hours for a 120-hour degree) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Minimum Hour Requirements",
            "heading": "Minimum Hour Requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Overall GPA",
          "policy": {
            "type": "gpa",
            "minimum": 2,
            "scope": "overall",
            "courseScope": {
              "kind": "overall"
            }
          },
          "quote": "A minimum overall grade point average (OGPA) of 2.000 (C) on all work attempted, including all transfer, correspondence, extension and residence work.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Grade Point Average (GPA)",
            "heading": "Grade Point Average (GPA)"
          }
        },
        {
          "kind": "policy",
          "name": "UNT GPA",
          "policy": {
            "type": "gpa",
            "minimum": 2,
            "scope": "unt",
            "courseScope": {
              "kind": "unt"
            }
          },
          "quote": "A minimum cumulative GPA (UNT-CGPA) of 2.000 (C) on all work at UNT. Students may not use transfer credit to raise the GPA of work done at UNT.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Grade Point Average (GPA)",
            "heading": "Grade Point Average (GPA)"
          }
        },
        {
          "kind": "policy",
          "name": "Communication core grade",
          "policy": {
            "type": "minGrade",
            "grade": "C",
            "scope": "Communication core requirement",
            "courseScope": {
              "kind": "codes",
              "codes": [
                "ENGL 1310",
                "ENGL 1311",
                "ENGL 1315",
                "ENGL 1320",
                "ENGL 1321",
                "ENGL 1325",
                "TECM 1700",
                "TECM 2700"
              ]
            }
          },
          "quote": "Students must have a grade of C or better in courses that meet the Communication requirement of the University Core Curriculum to show proficiency in English composition. Students who have earned a D in one or more of these two required courses must repeat the course and raise the grade to a C or better. Transfer students with more than 90 hours and who have earned a D in any of the basic English writing courses must retake the course during their first term/semester in residence.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "English Composition Proficiency",
            "heading": "English Composition Proficiency"
          }
        }
      ],
      "coreSharedCourses": [
        "BIOL 1112",
        "BIOL 1132",
        "BIOL 1710",
        "BIOL 1720",
        "BIOL 2301",
        "BIOL 2302",
        "CHEM 1410",
        "CHEM 1420",
        "CSCE 1010",
        "GEOG 1710",
        "GEOL 1610",
        "MATH 1710",
        "MATH 1810",
        "PHYS 1052",
        "PHYS 1062",
        "PHYS 1270",
        "PHYS 1410",
        "PHYS 1420",
        "PHYS 1710",
        "PHYS 2220",
        "TECM 2700"
      ],
      "courseSharing": "advisor"
    },
    {
      "id": "ee-bs",
      "name": "Electrical Engineering, BS",
      "catalogId": "unt-2026-27",
      "sourceUrl": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
      "requirements": [
        {
          "kind": "policy",
          "name": "Total hours: 128",
          "policy": {
            "type": "totalHours",
            "hours": 128
          },
          "quote": "A minimum of 128 semester hours, of which 42 must be advanced courses, and fulfillment of degree requirements for the Bachelor of Science degree as specified in the University Core Curriculum in the Degree and Program Requirements section of this catalog and in the College of Engineering section of this catalog.",
          "citation": {
            "page": "ee-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
            "anchor": "HoursRequiredAndGeneralcollegeRequirements",
            "heading": "Hours required and general/college requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours: 42",
          "policy": {
            "type": "advancedHours",
            "hours": 42
          },
          "quote": "A minimum of 128 semester hours, of which 42 must be advanced courses, and fulfillment of degree requirements for the Bachelor of Science degree as specified in the University Core Curriculum in the Degree and Program Requirements section of this catalog and in the College of Engineering section of this catalog.",
          "citation": {
            "page": "ee-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
            "anchor": "HoursRequiredAndGeneralcollegeRequirements",
            "heading": "Hours required and general/college requirements"
          }
        },
        {
          "kind": "group",
          "name": "Major requirements",
          "children": [
            {
              "kind": "all",
              "name": "Required EENG courses",
              "items": [
                {
                  "alternatives": [
                    {
                      "must": [
                        "EENG 2610"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "EENG 2620"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "EENG 2710"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "EENG 3410"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "EENG 3510"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "EENG 3520"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "EENG 3710"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "EENG 3810"
                      ]
                    }
                  ]
                }
              ],
              "citation": {
                "page": "ee-bs.html",
                "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
                "anchor": "MajorRequirements",
                "heading": "Major requirements"
              }
            },
            {
              "kind": "note",
              "name": "39-hour major minimum",
              "text": "A minimum of 39 semester hours of coursework, including:",
              "citation": {
                "page": "ee-bs.html",
                "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
                "anchor": "MajorRequirements",
                "heading": "Major requirements"
              }
            }
          ],
          "citation": {
            "page": "ee-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
            "anchor": "MajorRequirements",
            "heading": "Major requirements"
          }
        },
        {
          "kind": "choose",
          "name": "EENG 4000-level electives, 15 hours (choose 5)",
          "count": 5,
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4010"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4210"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4310"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4320"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4330"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4340"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4350"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4410"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4450"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4510"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4520"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4530"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4580"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4610"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4710"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4720"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4740"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4760"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4810"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4820"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4850"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4900"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "ee-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
            "anchor": "FiveEENG4000levelElectivesChosenFrom",
            "heading": "Five EENG 4000-level electives chosen from:"
          }
        },
        {
          "kind": "all",
          "name": "Project and Laboratory courses, 27 hours",
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 1910"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 2611"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 2621"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 2711"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 2905"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 2920"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 3411"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 3511"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 3811"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 3910"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 3920"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4910"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "EENG 4990"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "ee-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
            "anchor": "ProjectAndLaboratoryCourses27Hours",
            "heading": "Project and Laboratory courses, 27 hours"
          }
        },
        {
          "kind": "all",
          "name": "Other required courses",
          "items": [
            {
              "alternatives": [
                {
                  "must": [
                    "CHEM 1410",
                    "CHEM 1430"
                  ]
                },
                {
                  "must": [
                    "CHEM 1415",
                    "CHEM 1435"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "CSCE 1030",
                    "CSCE 1015"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 1710",
                    "MATH 1720"
                  ]
                },
                {
                  "must": [
                    "MATH 1810",
                    "MATH 1820",
                    "MATH 1830"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 2700"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 2730"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 3180"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "MATH 3410"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 1710",
                    "PHYS 1730"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "PHYS 2220",
                    "PHYS 2240"
                  ]
                }
              ]
            },
            {
              "alternatives": [
                {
                  "must": [
                    "TECM 2700"
                  ]
                }
              ]
            }
          ],
          "citation": {
            "page": "ee-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
            "anchor": "OtherRequiredCourses",
            "heading": "Other required courses"
          }
        },
        {
          "kind": "note",
          "name": "Minor",
          "text": "Optional.",
          "citation": {
            "page": "ee-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
            "anchor": "Minor",
            "heading": "Minor"
          }
        },
        {
          "kind": "note",
          "name": "Electives",
          "text": "Hours required for electives may vary based on course selection and the University Core Curriculum requirements. Electives may be required to satisfy the advanced hour requirement (42) and/or the minimum total hours required for the degree. For specific information, see an academic advisor in the College of Engineering.",
          "citation": {
            "page": "ee-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
            "anchor": "Electives",
            "heading": "Electives"
          }
        },
        {
          "kind": "note",
          "name": "Other requirements",
          "text": "The catalog provides no additional text in this section.",
          "citation": {
            "page": "ee-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
            "anchor": "OtherRequirements",
            "heading": "Other requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Minimum grade of C (major courses)",
          "policy": {
            "type": "minGrade",
            "grade": "C",
            "scope": "all courses required in the major",
            "courseScope": {
              "kind": "applied"
            }
          },
          "quote": "A minimum grade of C is required in all courses required in a student’s major for degree completion. Courses include, but are not limited to, engineering, computing, mathematics, laboratory sciences, supporting area, technical elective, technical option, energy elective and specialization courses.",
          "citation": {
            "page": "ee-bs.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21250",
            "anchor": "DepartmentPolicies",
            "heading": "Department policies"
          }
        },
        {
          "kind": "policy",
          "name": "Total hours: 120",
          "policy": {
            "type": "totalHours",
            "hours": 120
          },
          "quote": "Students must complete a minimum of 120 semester hours to earn a degree at UNT. One course may be used to meet multiple requirements. Students should speak to an advisor to determine which courses can be used to meet more than one requirement. Schools, colleges and departments may have additional requirements to qualify for graduation. Students must complete:",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Minimum Hour Requirements",
            "heading": "Minimum Hour Requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours at UNT: 24",
          "policy": {
            "type": "advancedHoursAtUnt",
            "hours": 24
          },
          "quote": "A minimum of 24 hours of advanced work (3000 or 4000 level) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Residence",
            "heading": "Residence"
          }
        },
        {
          "kind": "policy",
          "name": "Advanced hours in the major at UNT: 12",
          "policy": {
            "type": "advancedHoursAtUnt",
            "hours": 12,
            "courseScope": {
              "kind": "applied"
            }
          },
          "quote": "A minimum of 12 hours of advanced work in the major (except for the BAAS degree) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Residence",
            "heading": "Residence"
          }
        },
        {
          "kind": "policy",
          "name": "Residency",
          "policy": {
            "type": "residencyPercent",
            "percent": 25
          },
          "quote": "Residence: minimum of 25 percent of the total hours for the degree (e.g., 30 hours for a 120-hour degree) at UNT",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Minimum Hour Requirements",
            "heading": "Minimum Hour Requirements"
          }
        },
        {
          "kind": "policy",
          "name": "Overall GPA",
          "policy": {
            "type": "gpa",
            "minimum": 2,
            "scope": "overall",
            "courseScope": {
              "kind": "overall"
            }
          },
          "quote": "A minimum overall grade point average (OGPA) of 2.000 (C) on all work attempted, including all transfer, correspondence, extension and residence work.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Grade Point Average (GPA)",
            "heading": "Grade Point Average (GPA)"
          }
        },
        {
          "kind": "policy",
          "name": "UNT GPA",
          "policy": {
            "type": "gpa",
            "minimum": 2,
            "scope": "unt",
            "courseScope": {
              "kind": "unt"
            }
          },
          "quote": "A minimum cumulative GPA (UNT-CGPA) of 2.000 (C) on all work at UNT. Students may not use transfer credit to raise the GPA of work done at UNT.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "Grade Point Average (GPA)",
            "heading": "Grade Point Average (GPA)"
          }
        },
        {
          "kind": "policy",
          "name": "Communication core grade",
          "policy": {
            "type": "minGrade",
            "grade": "C",
            "scope": "Communication core requirement",
            "courseScope": {
              "kind": "codes",
              "codes": [
                "ENGL 1310",
                "ENGL 1311",
                "ENGL 1315",
                "ENGL 1320",
                "ENGL 1321",
                "ENGL 1325",
                "TECM 1700",
                "TECM 2700"
              ]
            }
          },
          "quote": "Students must have a grade of C or better in courses that meet the Communication requirement of the University Core Curriculum to show proficiency in English composition. Students who have earned a D in one or more of these two required courses must repeat the course and raise the grade to a C or better. Transfer students with more than 90 hours and who have earned a D in any of the basic English writing courses must retake the course during their first term/semester in residence.",
          "citation": {
            "page": "degree-requirements.html",
            "url": "https://catalog.unt.edu/content.php?catoid=40&navoid=4689",
            "anchor": "English Composition Proficiency",
            "heading": "English Composition Proficiency"
          }
        }
      ],
      "coreSharedCourses": [
        "CHEM 1410",
        "MATH 1710",
        "MATH 1720",
        "MATH 1810",
        "PHYS 1710",
        "PHYS 2220",
        "TECM 2700"
      ],
      "courseSharing": "advisor"
    },
    {
      "id": "core",
      "name": "University Core Curriculum",
      "catalogId": "unt-2026-27",
      "sourceUrl": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
      "requirements": [
        {
          "kind": "policy",
          "name": "Core total: 42 hours",
          "policy": {
            "type": "totalHours",
            "hours": 42,
            "courseScope": {
              "kind": "applied"
            }
          },
          "quote": "Students are required to complete 42 semester credit hours in specific areas. Students select core courses to meet the state semester credit hour requirements for each foundational component area. More information about the Core Curriculum at UNT may be found in the UNT Student Success Guidebook on the Advising web site.",
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "UniversityCoreCurriculumRequirements",
            "heading": "University Core Curriculum Requirements"
          }
        },
        {
          "kind": "group",
          "name": "Communication, 6 hours",
          "children": [
            {
              "kind": "choose",
              "name": "Communication Group 1",
              "count": 1,
              "items": [
                {
                  "alternatives": [
                    {
                      "must": [
                        "ENGL 1310"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "ENGL 1311"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "ENGL 1315"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "TECM 1700"
                      ]
                    }
                  ]
                }
              ],
              "citation": {
                "page": "core-curriculum.html",
                "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
                "anchor": "Group1",
                "heading": "Group 1"
              }
            },
            {
              "kind": "choose",
              "name": "Communication Group 2",
              "count": 1,
              "items": [
                {
                  "alternatives": [
                    {
                      "must": [
                        "ENGL 1320"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "ENGL 1321"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "ENGL 1325"
                      ]
                    }
                  ]
                },
                {
                  "alternatives": [
                    {
                      "must": [
                        "TECM 2700"
                      ]
                    }
                  ]
                }
              ],
              "citation": {
                "page": "core-curriculum.html",
                "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
                "anchor": "Group2",
                "heading": "Group 2"
              }
            },
            {
              "kind": "policy",
              "name": "Communication core grade",
              "policy": {
                "type": "minGrade",
                "grade": "C",
                "scope": "Communication core requirement",
                "courseScope": {
                  "kind": "codes",
                  "codes": [
                    "ENGL 1310",
                    "ENGL 1311",
                    "ENGL 1315",
                    "ENGL 1320",
                    "ENGL 1321",
                    "ENGL 1325",
                    "TECM 1700",
                    "TECM 2700"
                  ]
                }
              },
              "quote": "Students must take one course from Group 1 and one course from group 2. The courses are often taken in sequence (for example, students first take ENGL 1310, then take ENGL 1320 in the following semester). Students must receive a grade of C or higher in both courses to fulfill this core requirement.",
              "citation": {
                "page": "core-curriculum.html",
                "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
                "anchor": "Communication6Hours",
                "heading": "Communication, 6 hours"
              }
            }
          ],
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "Communication6Hours",
            "heading": "Communication, 6 hours"
          }
        },
        {
          "kind": "hours",
          "name": "Mathematics, 3 hours",
          "hours": 3,
          "options": [
            {
              "must": [
                "DSCI 2710"
              ]
            },
            {
              "must": [
                "MATH 1180"
              ]
            },
            {
              "must": [
                "MATH 1190"
              ]
            },
            {
              "must": [
                "MATH 1580"
              ]
            },
            {
              "must": [
                "MATH 1650"
              ]
            },
            {
              "must": [
                "MATH 1680"
              ]
            },
            {
              "must": [
                "MATH 1710"
              ]
            },
            {
              "must": [
                "MATH 1810"
              ]
            }
          ],
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "Mathematics3Hours",
            "heading": "Mathematics, 3 hours"
          }
        },
        {
          "kind": "hours",
          "name": "Life and Physical Sciences, 6 hours",
          "hours": 6,
          "options": [
            {
              "must": [
                "ANTH 2700"
              ]
            },
            {
              "must": [
                "ARCH 2800"
              ]
            },
            {
              "must": [
                "BIOL 1082"
              ]
            },
            {
              "must": [
                "BIOL 1112"
              ]
            },
            {
              "must": [
                "BIOL 1132"
              ]
            },
            {
              "must": [
                "BIOL 1710"
              ]
            },
            {
              "must": [
                "BIOL 1711"
              ]
            },
            {
              "must": [
                "BIOL 1720"
              ]
            },
            {
              "must": [
                "BIOL 1722"
              ]
            },
            {
              "must": [
                "BIOL 2301"
              ]
            },
            {
              "must": [
                "BIOL 2302"
              ]
            },
            {
              "must": [
                "BIOL 2700"
              ]
            },
            {
              "must": [
                "CHEM 1360"
              ]
            },
            {
              "must": [
                "CHEM 1410"
              ]
            },
            {
              "must": [
                "CHEM 1412"
              ]
            },
            {
              "must": [
                "CHEM 1413"
              ]
            },
            {
              "must": [
                "CHEM 1420"
              ]
            },
            {
              "must": [
                "CHEM 1422"
              ]
            },
            {
              "must": [
                "CHEM 1423"
              ]
            },
            {
              "must": [
                "GEOG 1710"
              ]
            },
            {
              "must": [
                "GEOL 1610"
              ]
            },
            {
              "must": [
                "LING 3050"
              ]
            },
            {
              "must": [
                "MTSE 2000"
              ]
            },
            {
              "must": [
                "NUTR 2460"
              ]
            },
            {
              "must": [
                "NUTR 3460"
              ]
            },
            {
              "must": [
                "PHYS 1052"
              ]
            },
            {
              "must": [
                "PHYS 1062"
              ]
            },
            {
              "must": [
                "PHYS 1270"
              ]
            },
            {
              "must": [
                "PHYS 1315"
              ]
            },
            {
              "must": [
                "PHYS 1410"
              ]
            },
            {
              "must": [
                "PHYS 1420"
              ]
            },
            {
              "must": [
                "PHYS 1510"
              ]
            },
            {
              "must": [
                "PHYS 1520"
              ]
            },
            {
              "must": [
                "PHYS 1710"
              ]
            },
            {
              "must": [
                "PHYS 2220"
              ]
            }
          ],
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "LifeAndPhysicalSciences6Hours",
            "heading": "Life and Physical Sciences, 6 hours"
          }
        },
        {
          "kind": "hours",
          "name": "Language, Philosophy and Culture, 3 hours",
          "hours": 3,
          "options": [
            {
              "must": [
                "AGER 2250"
              ]
            },
            {
              "must": [
                "ANTH 3101"
              ]
            },
            {
              "must": [
                "ANTH 3110"
              ]
            },
            {
              "must": [
                "ANTH 3120"
              ]
            },
            {
              "must": [
                "ANTH 3130"
              ]
            },
            {
              "must": [
                "ANTH 3140"
              ]
            },
            {
              "must": [
                "ANTH 3200"
              ]
            },
            {
              "must": [
                "ANTH 3210"
              ]
            },
            {
              "must": [
                "ANTH 3220"
              ]
            },
            {
              "must": [
                "ANTH 3300"
              ]
            },
            {
              "must": [
                "ANTH 3400"
              ]
            },
            {
              "must": [
                "ANTH 3500"
              ]
            },
            {
              "must": [
                "ANTH 3700"
              ]
            },
            {
              "must": [
                "ANTH 3710"
              ]
            },
            {
              "must": [
                "ART 2350"
              ]
            },
            {
              "must": [
                "ENGL 2321"
              ]
            },
            {
              "must": [
                "ENGL 2326"
              ]
            },
            {
              "must": [
                "ENGL 2331"
              ]
            },
            {
              "must": [
                "ENGL 2341"
              ]
            },
            {
              "must": [
                "ENGL 2351"
              ]
            },
            {
              "must": [
                "ENGL 3450"
              ]
            },
            {
              "must": [
                "GEOG 1000"
              ]
            },
            {
              "must": [
                "HDFS 2313"
              ]
            },
            {
              "must": [
                "HIST 1050"
              ]
            },
            {
              "must": [
                "HIST 1060"
              ]
            },
            {
              "must": [
                "KINE 2050"
              ]
            },
            {
              "must": [
                "LING 2050"
              ]
            },
            {
              "must": [
                "LING 3010"
              ]
            },
            {
              "must": [
                "MUET 2000"
              ]
            },
            {
              "must": [
                "MUET 3030"
              ]
            },
            {
              "must": [
                "PHIL 1050"
              ]
            },
            {
              "must": [
                "PHIL 1400"
              ]
            },
            {
              "must": [
                "PHIL 2050"
              ]
            },
            {
              "must": [
                "PHIL 2070"
              ]
            },
            {
              "must": [
                "PHIL 2600"
              ]
            },
            {
              "must": [
                "THEA 3040"
              ]
            }
          ],
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "LanguagePhilosophyAndCulture3Hours",
            "heading": "Language, Philosophy and Culture, 3 hours"
          }
        },
        {
          "kind": "hours",
          "name": "Creative Arts, 3 hours",
          "hours": 3,
          "options": [
            {
              "must": [
                "ANTH 2400"
              ]
            },
            {
              "must": [
                "ART 1300"
              ]
            },
            {
              "must": [
                "ART 1301"
              ]
            },
            {
              "must": [
                "ART 2360"
              ]
            },
            {
              "must": [
                "ART 2370"
              ]
            },
            {
              "must": [
                "COMM 2060"
              ]
            },
            {
              "must": [
                "DANC 1200"
              ]
            },
            {
              "must": [
                "DANC 2800"
              ]
            },
            {
              "must": [
                "MUCO 1200"
              ]
            },
            {
              "must": [
                "MUCO 3500"
              ]
            },
            {
              "must": [
                "MUET 3060"
              ]
            },
            {
              "must": [
                "MUJS 3400"
              ]
            },
            {
              "must": [
                "MUMH 1610"
              ]
            },
            {
              "must": [
                "MUMH 2040"
              ]
            },
            {
              "must": [
                "MUMH 2050"
              ]
            },
            {
              "must": [
                "MUMH 2060"
              ]
            },
            {
              "must": [
                "MUMH 2080"
              ]
            },
            {
              "must": [
                "MUMH 3000"
              ]
            },
            {
              "must": [
                "MUMH 3010"
              ]
            },
            {
              "must": [
                "MUMH 3100"
              ]
            },
            {
              "must": [
                "MUMH 3200"
              ]
            },
            {
              "must": [
                "MUMH 3520"
              ]
            },
            {
              "must": [
                "PHIL 1900"
              ]
            },
            {
              "must": [
                "THEA 1340"
              ]
            },
            {
              "must": [
                "THEA 2340"
              ]
            },
            {
              "must": [
                "THEA 3030"
              ]
            }
          ],
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "CreativeArts3Hours",
            "heading": "Creative Arts, 3 hours"
          }
        },
        {
          "kind": "hours",
          "name": "American History, 6 hours",
          "hours": 6,
          "options": [
            {
              "must": [
                "HIST 2610"
              ]
            },
            {
              "must": [
                "HIST 2620"
              ]
            },
            {
              "must": [
                "HIST 2675"
              ]
            },
            {
              "must": [
                "HIST 2685"
              ]
            }
          ],
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "AmericanHistory6Hours",
            "heading": "American History, 6 hours"
          }
        },
        {
          "kind": "hours",
          "name": "Government/Political Science, 6 hours",
          "hours": 6,
          "options": [
            {
              "must": [
                "PSCI 2305"
              ]
            },
            {
              "must": [
                "PSCI 2315"
              ]
            },
            {
              "must": [
                "PSCI 2306"
              ]
            },
            {
              "must": [
                "PSCI 2316"
              ]
            }
          ],
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "GovernmentPoliticalScience6Hours",
            "heading": "Government/Political Science, 6 hours"
          }
        },
        {
          "kind": "hours",
          "name": "Social and Behavioral Sciences, 3 hours",
          "hours": 3,
          "options": [
            {
              "must": [
                "AGER 4560"
              ]
            },
            {
              "must": [
                "AGER 4800"
              ]
            },
            {
              "must": [
                "ANTH 1010"
              ]
            },
            {
              "must": [
                "ANTH 2300"
              ]
            },
            {
              "must": [
                "BAAS 3000"
              ]
            },
            {
              "must": [
                "BEHV 2300"
              ]
            },
            {
              "must": [
                "CJUS 2100"
              ]
            },
            {
              "must": [
                "COMM 2020"
              ]
            },
            {
              "must": [
                "EADP 1010"
              ]
            },
            {
              "must": [
                "EADP 4050"
              ]
            },
            {
              "must": [
                "ECON 1100"
              ]
            },
            {
              "must": [
                "ECON 1110"
              ]
            },
            {
              "must": [
                "FIPL 2770"
              ]
            },
            {
              "must": [
                "GEOG 1200"
              ]
            },
            {
              "must": [
                "GEOG 1500"
              ]
            },
            {
              "must": [
                "HDFS 1013"
              ]
            },
            {
              "must": [
                "HLTH 2200"
              ]
            },
            {
              "must": [
                "JOUR 1210"
              ]
            },
            {
              "must": [
                "LING 3060"
              ]
            },
            {
              "must": [
                "MDSE 2750"
              ]
            },
            {
              "must": [
                "PADM 2100"
              ]
            },
            {
              "must": [
                "PSYC 1630"
              ]
            },
            {
              "must": [
                "RESM 3450"
              ]
            },
            {
              "must": [
                "RHAB 3100"
              ]
            },
            {
              "must": [
                "SOCI 1510"
              ]
            },
            {
              "must": [
                "SOWK 1450"
              ]
            }
          ],
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "SocialAndBehavioralSciences3Hours",
            "heading": "Social and Behavioral Sciences, 3 hours"
          }
        },
        {
          "kind": "choice",
          "name": "Component Area Option, 6 hours",
          "branches": [
            {
              "name": "6 hours from Component Area Option A",
              "node": {
                "kind": "hours",
                "name": "Six hours from Component Area Option A",
                "hours": 6,
                "options": [
                  {
                    "must": [
                      "ANTH 1150"
                    ]
                  },
                  {
                    "must": [
                      "COMM 2040"
                    ]
                  },
                  {
                    "must": [
                      "COMM 2140"
                    ]
                  },
                  {
                    "must": [
                      "COUN 2620"
                    ]
                  },
                  {
                    "must": [
                      "HDFS 3423"
                    ]
                  },
                  {
                    "must": [
                      "NUTR 1450"
                    ]
                  },
                  {
                    "must": [
                      "JOUR 2250"
                    ]
                  },
                  {
                    "must": [
                      "MATH 1720"
                    ]
                  },
                  {
                    "must": [
                      "MDSE 3370"
                    ]
                  },
                  {
                    "must": [
                      "MKTG 3010"
                    ]
                  },
                  {
                    "must": [
                      "MTSE 1100"
                    ]
                  },
                  {
                    "must": [
                      "MUJS 3070"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 3500"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 3510"
                    ]
                  },
                  {
                    "must": [
                      "PHIL 2500"
                    ]
                  },
                  {
                    "must": [
                      "PHIL 3900"
                    ]
                  },
                  {
                    "must": [
                      "PHIL 4150"
                    ]
                  },
                  {
                    "must": [
                      "PHIL 4200"
                    ]
                  },
                  {
                    "must": [
                      "SOCI 2070"
                    ]
                  },
                  {
                    "must": [
                      "SOWK 4540"
                    ]
                  },
                  {
                    "must": [
                      "TECM 1600"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 1310"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 1311"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 1315"
                    ]
                  },
                  {
                    "must": [
                      "TECM 1700"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 1320"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 1321"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 1325"
                    ]
                  },
                  {
                    "must": [
                      "TECM 2700"
                    ]
                  },
                  {
                    "must": [
                      "DSCI 2710"
                    ]
                  },
                  {
                    "must": [
                      "MATH 1180"
                    ]
                  },
                  {
                    "must": [
                      "MATH 1190"
                    ]
                  },
                  {
                    "must": [
                      "MATH 1580"
                    ]
                  },
                  {
                    "must": [
                      "MATH 1650"
                    ]
                  },
                  {
                    "must": [
                      "MATH 1680"
                    ]
                  },
                  {
                    "must": [
                      "MATH 1710"
                    ]
                  },
                  {
                    "must": [
                      "MATH 1810"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 2700"
                    ]
                  },
                  {
                    "must": [
                      "ARCH 2800"
                    ]
                  },
                  {
                    "must": [
                      "BIOL 1082"
                    ]
                  },
                  {
                    "must": [
                      "BIOL 1112"
                    ]
                  },
                  {
                    "must": [
                      "BIOL 1132"
                    ]
                  },
                  {
                    "must": [
                      "BIOL 1710"
                    ]
                  },
                  {
                    "must": [
                      "BIOL 1711"
                    ]
                  },
                  {
                    "must": [
                      "BIOL 1720"
                    ]
                  },
                  {
                    "must": [
                      "BIOL 1722"
                    ]
                  },
                  {
                    "must": [
                      "BIOL 2301"
                    ]
                  },
                  {
                    "must": [
                      "BIOL 2302"
                    ]
                  },
                  {
                    "must": [
                      "BIOL 2700"
                    ]
                  },
                  {
                    "must": [
                      "CHEM 1360"
                    ]
                  },
                  {
                    "must": [
                      "CHEM 1410"
                    ]
                  },
                  {
                    "must": [
                      "CHEM 1412"
                    ]
                  },
                  {
                    "must": [
                      "CHEM 1413"
                    ]
                  },
                  {
                    "must": [
                      "CHEM 1420"
                    ]
                  },
                  {
                    "must": [
                      "CHEM 1422"
                    ]
                  },
                  {
                    "must": [
                      "CHEM 1423"
                    ]
                  },
                  {
                    "must": [
                      "GEOG 1710"
                    ]
                  },
                  {
                    "must": [
                      "GEOL 1610"
                    ]
                  },
                  {
                    "must": [
                      "LING 3050"
                    ]
                  },
                  {
                    "must": [
                      "MTSE 2000"
                    ]
                  },
                  {
                    "must": [
                      "NUTR 2460"
                    ]
                  },
                  {
                    "must": [
                      "NUTR 3460"
                    ]
                  },
                  {
                    "must": [
                      "PHYS 1052"
                    ]
                  },
                  {
                    "must": [
                      "PHYS 1062"
                    ]
                  },
                  {
                    "must": [
                      "PHYS 1270"
                    ]
                  },
                  {
                    "must": [
                      "PHYS 1315"
                    ]
                  },
                  {
                    "must": [
                      "PHYS 1410"
                    ]
                  },
                  {
                    "must": [
                      "PHYS 1420"
                    ]
                  },
                  {
                    "must": [
                      "PHYS 1510"
                    ]
                  },
                  {
                    "must": [
                      "PHYS 1520"
                    ]
                  },
                  {
                    "must": [
                      "PHYS 1710"
                    ]
                  },
                  {
                    "must": [
                      "PHYS 2220"
                    ]
                  },
                  {
                    "must": [
                      "AGER 2250"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3101"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3110"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3120"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3130"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3140"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3200"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3210"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3220"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3300"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3400"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3500"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3700"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 3710"
                    ]
                  },
                  {
                    "must": [
                      "ART 2350"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 2321"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 2326"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 2331"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 2341"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 2351"
                    ]
                  },
                  {
                    "must": [
                      "ENGL 3450"
                    ]
                  },
                  {
                    "must": [
                      "GEOG 1000"
                    ]
                  },
                  {
                    "must": [
                      "HDFS 2313"
                    ]
                  },
                  {
                    "must": [
                      "HIST 1050"
                    ]
                  },
                  {
                    "must": [
                      "HIST 1060"
                    ]
                  },
                  {
                    "must": [
                      "KINE 2050"
                    ]
                  },
                  {
                    "must": [
                      "LING 2050"
                    ]
                  },
                  {
                    "must": [
                      "LING 3010"
                    ]
                  },
                  {
                    "must": [
                      "MUET 2000"
                    ]
                  },
                  {
                    "must": [
                      "MUET 3030"
                    ]
                  },
                  {
                    "must": [
                      "PHIL 1050"
                    ]
                  },
                  {
                    "must": [
                      "PHIL 1400"
                    ]
                  },
                  {
                    "must": [
                      "PHIL 2050"
                    ]
                  },
                  {
                    "must": [
                      "PHIL 2070"
                    ]
                  },
                  {
                    "must": [
                      "PHIL 2600"
                    ]
                  },
                  {
                    "must": [
                      "THEA 3040"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 2400"
                    ]
                  },
                  {
                    "must": [
                      "ART 1300"
                    ]
                  },
                  {
                    "must": [
                      "ART 1301"
                    ]
                  },
                  {
                    "must": [
                      "ART 2360"
                    ]
                  },
                  {
                    "must": [
                      "ART 2370"
                    ]
                  },
                  {
                    "must": [
                      "COMM 2060"
                    ]
                  },
                  {
                    "must": [
                      "DANC 1200"
                    ]
                  },
                  {
                    "must": [
                      "DANC 2800"
                    ]
                  },
                  {
                    "must": [
                      "MUCO 1200"
                    ]
                  },
                  {
                    "must": [
                      "MUCO 3500"
                    ]
                  },
                  {
                    "must": [
                      "MUET 3060"
                    ]
                  },
                  {
                    "must": [
                      "MUJS 3400"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 1610"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 2040"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 2050"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 2060"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 2080"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 3000"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 3010"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 3100"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 3200"
                    ]
                  },
                  {
                    "must": [
                      "MUMH 3520"
                    ]
                  },
                  {
                    "must": [
                      "PHIL 1900"
                    ]
                  },
                  {
                    "must": [
                      "THEA 1340"
                    ]
                  },
                  {
                    "must": [
                      "THEA 2340"
                    ]
                  },
                  {
                    "must": [
                      "THEA 3030"
                    ]
                  },
                  {
                    "must": [
                      "HIST 2610"
                    ]
                  },
                  {
                    "must": [
                      "HIST 2620"
                    ]
                  },
                  {
                    "must": [
                      "HIST 2675"
                    ]
                  },
                  {
                    "must": [
                      "HIST 2685"
                    ]
                  },
                  {
                    "must": [
                      "PSCI 2305"
                    ]
                  },
                  {
                    "must": [
                      "PSCI 2315"
                    ]
                  },
                  {
                    "must": [
                      "PSCI 2306"
                    ]
                  },
                  {
                    "must": [
                      "PSCI 2316"
                    ]
                  },
                  {
                    "must": [
                      "AGER 4560"
                    ]
                  },
                  {
                    "must": [
                      "AGER 4800"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 1010"
                    ]
                  },
                  {
                    "must": [
                      "ANTH 2300"
                    ]
                  },
                  {
                    "must": [
                      "BAAS 3000"
                    ]
                  },
                  {
                    "must": [
                      "BEHV 2300"
                    ]
                  },
                  {
                    "must": [
                      "CJUS 2100"
                    ]
                  },
                  {
                    "must": [
                      "COMM 2020"
                    ]
                  },
                  {
                    "must": [
                      "EADP 1010"
                    ]
                  },
                  {
                    "must": [
                      "EADP 4050"
                    ]
                  },
                  {
                    "must": [
                      "ECON 1100"
                    ]
                  },
                  {
                    "must": [
                      "ECON 1110"
                    ]
                  },
                  {
                    "must": [
                      "FIPL 2770"
                    ]
                  },
                  {
                    "must": [
                      "GEOG 1200"
                    ]
                  },
                  {
                    "must": [
                      "GEOG 1500"
                    ]
                  },
                  {
                    "must": [
                      "HDFS 1013"
                    ]
                  },
                  {
                    "must": [
                      "HLTH 2200"
                    ]
                  },
                  {
                    "must": [
                      "JOUR 1210"
                    ]
                  },
                  {
                    "must": [
                      "LING 3060"
                    ]
                  },
                  {
                    "must": [
                      "MDSE 2750"
                    ]
                  },
                  {
                    "must": [
                      "PADM 2100"
                    ]
                  },
                  {
                    "must": [
                      "PSYC 1630"
                    ]
                  },
                  {
                    "must": [
                      "RESM 3450"
                    ]
                  },
                  {
                    "must": [
                      "RHAB 3100"
                    ]
                  },
                  {
                    "must": [
                      "SOCI 1510"
                    ]
                  },
                  {
                    "must": [
                      "SOWK 1450"
                    ]
                  }
                ],
                "citation": {
                  "page": "core-curriculum.html",
                  "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
                  "anchor": "ComponentAreaOptionA",
                  "heading": "Component Area Option A"
                }
              }
            },
            {
              "name": "3 hours from Option A and 3 hours from Option B",
              "node": {
                "kind": "group",
                "name": "Option A plus Option B",
                "children": [
                  {
                    "kind": "hours",
                    "name": "Three hours from Component Area Option A",
                    "hours": 3,
                    "options": [
                      {
                        "must": [
                          "ANTH 1150"
                        ]
                      },
                      {
                        "must": [
                          "COMM 2040"
                        ]
                      },
                      {
                        "must": [
                          "COMM 2140"
                        ]
                      },
                      {
                        "must": [
                          "COUN 2620"
                        ]
                      },
                      {
                        "must": [
                          "HDFS 3423"
                        ]
                      },
                      {
                        "must": [
                          "NUTR 1450"
                        ]
                      },
                      {
                        "must": [
                          "JOUR 2250"
                        ]
                      },
                      {
                        "must": [
                          "MATH 1720"
                        ]
                      },
                      {
                        "must": [
                          "MDSE 3370"
                        ]
                      },
                      {
                        "must": [
                          "MKTG 3010"
                        ]
                      },
                      {
                        "must": [
                          "MTSE 1100"
                        ]
                      },
                      {
                        "must": [
                          "MUJS 3070"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 3500"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 3510"
                        ]
                      },
                      {
                        "must": [
                          "PHIL 2500"
                        ]
                      },
                      {
                        "must": [
                          "PHIL 3900"
                        ]
                      },
                      {
                        "must": [
                          "PHIL 4150"
                        ]
                      },
                      {
                        "must": [
                          "PHIL 4200"
                        ]
                      },
                      {
                        "must": [
                          "SOCI 2070"
                        ]
                      },
                      {
                        "must": [
                          "SOWK 4540"
                        ]
                      },
                      {
                        "must": [
                          "TECM 1600"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 1310"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 1311"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 1315"
                        ]
                      },
                      {
                        "must": [
                          "TECM 1700"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 1320"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 1321"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 1325"
                        ]
                      },
                      {
                        "must": [
                          "TECM 2700"
                        ]
                      },
                      {
                        "must": [
                          "DSCI 2710"
                        ]
                      },
                      {
                        "must": [
                          "MATH 1180"
                        ]
                      },
                      {
                        "must": [
                          "MATH 1190"
                        ]
                      },
                      {
                        "must": [
                          "MATH 1580"
                        ]
                      },
                      {
                        "must": [
                          "MATH 1650"
                        ]
                      },
                      {
                        "must": [
                          "MATH 1680"
                        ]
                      },
                      {
                        "must": [
                          "MATH 1710"
                        ]
                      },
                      {
                        "must": [
                          "MATH 1810"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 2700"
                        ]
                      },
                      {
                        "must": [
                          "ARCH 2800"
                        ]
                      },
                      {
                        "must": [
                          "BIOL 1082"
                        ]
                      },
                      {
                        "must": [
                          "BIOL 1112"
                        ]
                      },
                      {
                        "must": [
                          "BIOL 1132"
                        ]
                      },
                      {
                        "must": [
                          "BIOL 1710"
                        ]
                      },
                      {
                        "must": [
                          "BIOL 1711"
                        ]
                      },
                      {
                        "must": [
                          "BIOL 1720"
                        ]
                      },
                      {
                        "must": [
                          "BIOL 1722"
                        ]
                      },
                      {
                        "must": [
                          "BIOL 2301"
                        ]
                      },
                      {
                        "must": [
                          "BIOL 2302"
                        ]
                      },
                      {
                        "must": [
                          "BIOL 2700"
                        ]
                      },
                      {
                        "must": [
                          "CHEM 1360"
                        ]
                      },
                      {
                        "must": [
                          "CHEM 1410"
                        ]
                      },
                      {
                        "must": [
                          "CHEM 1412"
                        ]
                      },
                      {
                        "must": [
                          "CHEM 1413"
                        ]
                      },
                      {
                        "must": [
                          "CHEM 1420"
                        ]
                      },
                      {
                        "must": [
                          "CHEM 1422"
                        ]
                      },
                      {
                        "must": [
                          "CHEM 1423"
                        ]
                      },
                      {
                        "must": [
                          "GEOG 1710"
                        ]
                      },
                      {
                        "must": [
                          "GEOL 1610"
                        ]
                      },
                      {
                        "must": [
                          "LING 3050"
                        ]
                      },
                      {
                        "must": [
                          "MTSE 2000"
                        ]
                      },
                      {
                        "must": [
                          "NUTR 2460"
                        ]
                      },
                      {
                        "must": [
                          "NUTR 3460"
                        ]
                      },
                      {
                        "must": [
                          "PHYS 1052"
                        ]
                      },
                      {
                        "must": [
                          "PHYS 1062"
                        ]
                      },
                      {
                        "must": [
                          "PHYS 1270"
                        ]
                      },
                      {
                        "must": [
                          "PHYS 1315"
                        ]
                      },
                      {
                        "must": [
                          "PHYS 1410"
                        ]
                      },
                      {
                        "must": [
                          "PHYS 1420"
                        ]
                      },
                      {
                        "must": [
                          "PHYS 1510"
                        ]
                      },
                      {
                        "must": [
                          "PHYS 1520"
                        ]
                      },
                      {
                        "must": [
                          "PHYS 1710"
                        ]
                      },
                      {
                        "must": [
                          "PHYS 2220"
                        ]
                      },
                      {
                        "must": [
                          "AGER 2250"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3101"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3110"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3120"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3130"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3140"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3200"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3210"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3220"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3300"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3400"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3500"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3700"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 3710"
                        ]
                      },
                      {
                        "must": [
                          "ART 2350"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 2321"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 2326"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 2331"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 2341"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 2351"
                        ]
                      },
                      {
                        "must": [
                          "ENGL 3450"
                        ]
                      },
                      {
                        "must": [
                          "GEOG 1000"
                        ]
                      },
                      {
                        "must": [
                          "HDFS 2313"
                        ]
                      },
                      {
                        "must": [
                          "HIST 1050"
                        ]
                      },
                      {
                        "must": [
                          "HIST 1060"
                        ]
                      },
                      {
                        "must": [
                          "KINE 2050"
                        ]
                      },
                      {
                        "must": [
                          "LING 2050"
                        ]
                      },
                      {
                        "must": [
                          "LING 3010"
                        ]
                      },
                      {
                        "must": [
                          "MUET 2000"
                        ]
                      },
                      {
                        "must": [
                          "MUET 3030"
                        ]
                      },
                      {
                        "must": [
                          "PHIL 1050"
                        ]
                      },
                      {
                        "must": [
                          "PHIL 1400"
                        ]
                      },
                      {
                        "must": [
                          "PHIL 2050"
                        ]
                      },
                      {
                        "must": [
                          "PHIL 2070"
                        ]
                      },
                      {
                        "must": [
                          "PHIL 2600"
                        ]
                      },
                      {
                        "must": [
                          "THEA 3040"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 2400"
                        ]
                      },
                      {
                        "must": [
                          "ART 1300"
                        ]
                      },
                      {
                        "must": [
                          "ART 1301"
                        ]
                      },
                      {
                        "must": [
                          "ART 2360"
                        ]
                      },
                      {
                        "must": [
                          "ART 2370"
                        ]
                      },
                      {
                        "must": [
                          "COMM 2060"
                        ]
                      },
                      {
                        "must": [
                          "DANC 1200"
                        ]
                      },
                      {
                        "must": [
                          "DANC 2800"
                        ]
                      },
                      {
                        "must": [
                          "MUCO 1200"
                        ]
                      },
                      {
                        "must": [
                          "MUCO 3500"
                        ]
                      },
                      {
                        "must": [
                          "MUET 3060"
                        ]
                      },
                      {
                        "must": [
                          "MUJS 3400"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 1610"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 2040"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 2050"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 2060"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 2080"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 3000"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 3010"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 3100"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 3200"
                        ]
                      },
                      {
                        "must": [
                          "MUMH 3520"
                        ]
                      },
                      {
                        "must": [
                          "PHIL 1900"
                        ]
                      },
                      {
                        "must": [
                          "THEA 1340"
                        ]
                      },
                      {
                        "must": [
                          "THEA 2340"
                        ]
                      },
                      {
                        "must": [
                          "THEA 3030"
                        ]
                      },
                      {
                        "must": [
                          "HIST 2610"
                        ]
                      },
                      {
                        "must": [
                          "HIST 2620"
                        ]
                      },
                      {
                        "must": [
                          "HIST 2675"
                        ]
                      },
                      {
                        "must": [
                          "HIST 2685"
                        ]
                      },
                      {
                        "must": [
                          "PSCI 2305"
                        ]
                      },
                      {
                        "must": [
                          "PSCI 2315"
                        ]
                      },
                      {
                        "must": [
                          "PSCI 2306"
                        ]
                      },
                      {
                        "must": [
                          "PSCI 2316"
                        ]
                      },
                      {
                        "must": [
                          "AGER 4560"
                        ]
                      },
                      {
                        "must": [
                          "AGER 4800"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 1010"
                        ]
                      },
                      {
                        "must": [
                          "ANTH 2300"
                        ]
                      },
                      {
                        "must": [
                          "BAAS 3000"
                        ]
                      },
                      {
                        "must": [
                          "BEHV 2300"
                        ]
                      },
                      {
                        "must": [
                          "CJUS 2100"
                        ]
                      },
                      {
                        "must": [
                          "COMM 2020"
                        ]
                      },
                      {
                        "must": [
                          "EADP 1010"
                        ]
                      },
                      {
                        "must": [
                          "EADP 4050"
                        ]
                      },
                      {
                        "must": [
                          "ECON 1100"
                        ]
                      },
                      {
                        "must": [
                          "ECON 1110"
                        ]
                      },
                      {
                        "must": [
                          "FIPL 2770"
                        ]
                      },
                      {
                        "must": [
                          "GEOG 1200"
                        ]
                      },
                      {
                        "must": [
                          "GEOG 1500"
                        ]
                      },
                      {
                        "must": [
                          "HDFS 1013"
                        ]
                      },
                      {
                        "must": [
                          "HLTH 2200"
                        ]
                      },
                      {
                        "must": [
                          "JOUR 1210"
                        ]
                      },
                      {
                        "must": [
                          "LING 3060"
                        ]
                      },
                      {
                        "must": [
                          "MDSE 2750"
                        ]
                      },
                      {
                        "must": [
                          "PADM 2100"
                        ]
                      },
                      {
                        "must": [
                          "PSYC 1630"
                        ]
                      },
                      {
                        "must": [
                          "RESM 3450"
                        ]
                      },
                      {
                        "must": [
                          "RHAB 3100"
                        ]
                      },
                      {
                        "must": [
                          "SOCI 1510"
                        ]
                      },
                      {
                        "must": [
                          "SOWK 1450"
                        ]
                      }
                    ],
                    "citation": {
                      "page": "core-curriculum.html",
                      "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
                      "anchor": "ComponentAreaOptionA",
                      "heading": "Component Area Option A"
                    }
                  },
                  {
                    "kind": "hours",
                    "name": "Three hours from Component Area Option B",
                    "hours": 3,
                    "options": [
                      {
                        "must": [
                          "ADES 3700"
                        ]
                      },
                      {
                        "must": [
                          "COMM 1010"
                        ]
                      },
                      {
                        "must": [
                          "COMM 1440"
                        ]
                      },
                      {
                        "must": [
                          "CSCE 1010"
                        ]
                      },
                      {
                        "must": [
                          "HDFS 2033"
                        ]
                      },
                      {
                        "must": [
                          "INST 2100"
                        ]
                      },
                      {
                        "must": [
                          "JOUR 2300"
                        ]
                      },
                      {
                        "must": [
                          "LING 2070"
                        ]
                      },
                      {
                        "must": [
                          "MKTG 2650"
                        ]
                      },
                      {
                        "must": [
                          "PHED 1000"
                        ]
                      },
                      {
                        "must": [
                          "RHAB 3000"
                        ]
                      },
                      {
                        "must": [
                          "TECM 1500"
                        ]
                      },
                      {
                        "must": [
                          "UNIV 2100"
                        ]
                      },
                      {
                        "must": [
                          "UNIV 2300"
                        ]
                      },
                      {
                        "must": [
                          "WGST 2100"
                        ]
                      }
                    ],
                    "citation": {
                      "page": "core-curriculum.html",
                      "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
                      "anchor": "ComponentAreaOptionB",
                      "heading": "Component Area Option B"
                    }
                  }
                ],
                "citation": {
                  "page": "core-curriculum.html",
                  "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
                  "anchor": "ComponentAreaOption6Hours",
                  "heading": "Component Area Option, 6 hours"
                }
              }
            }
          ],
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "ComponentAreaOption6Hours",
            "heading": "Component Area Option, 6 hours"
          }
        },
        {
          "kind": "note",
          "name": "Component Area Option double-dip rule",
          "text": "Note: Students may not “double-dip” courses to complete the University Core Curriculum. If a student completes PADM 2100 for the Social and Behavioral Sciences area, PADM 2100 may not count toward Component Area Option A.",
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "ComponentAreaOptionA",
            "heading": "Component Area Option A"
          }
        },
        {
          "kind": "note",
          "name": "Option A other-core courses",
          "text": "Or any course included in the other core areas listed above (Communication, Life and Physical Sciences, etc.)",
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "ComponentAreaOptionA",
            "heading": "Component Area Option A"
          }
        },
        {
          "kind": "note",
          "name": "Other ways to complete the core",
          "text": "A student who successfully completes the common core curriculum at a state-assisted institution of higher education in Texas may transfer as “core complete” to UNT. The student will receive academic credit for each of the courses transferred. See also the UNT transfer articulation web page on the Registrar’s Office web site, where you can find information on the online transfer course equivalency tool Transferology. Certain core areas may be completed, fully or in part, by the successful completion of the appropriate advanced standing examination (AP/IB/CLEP). More information about advanced standing examinations accepted by UNT may be found on the Test, Prior Learning and Transfer Credit page under “Advanced Placement and Credit by Examination.” Please speak to your advisor to determine how an advanced standing examination may be used in meeting your degree requirements.",
          "citation": {
            "page": "core-curriculum.html",
            "url": "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21275",
            "anchor": "TransferOfTheCoreCurriculum",
            "heading": "Transfer of the Core Curriculum"
          }
        }
      ],
      "coreSharedCourses": [
        "ADES 3700",
        "AGER 2250",
        "AGER 4560",
        "AGER 4800",
        "ANTH 1010",
        "ANTH 1150",
        "ANTH 2300",
        "ANTH 2400",
        "ANTH 2700",
        "ANTH 3101",
        "ANTH 3110",
        "ANTH 3120",
        "ANTH 3130",
        "ANTH 3140",
        "ANTH 3200",
        "ANTH 3210",
        "ANTH 3220",
        "ANTH 3300",
        "ANTH 3400",
        "ANTH 3500",
        "ANTH 3700",
        "ANTH 3710",
        "ARCH 2800",
        "ART 1300",
        "ART 1301",
        "ART 2350",
        "ART 2360",
        "ART 2370",
        "BAAS 3000",
        "BEHV 2300",
        "BIOL 1082",
        "BIOL 1112",
        "BIOL 1132",
        "BIOL 1710",
        "BIOL 1711",
        "BIOL 1720",
        "BIOL 1722",
        "BIOL 2301",
        "BIOL 2302",
        "BIOL 2700",
        "CHEM 1360",
        "CHEM 1410",
        "CHEM 1412",
        "CHEM 1413",
        "CHEM 1420",
        "CHEM 1422",
        "CHEM 1423",
        "CJUS 2100",
        "COMM 1010",
        "COMM 1440",
        "COMM 2020",
        "COMM 2040",
        "COMM 2060",
        "COMM 2140",
        "COUN 2620",
        "CSCE 1010",
        "DANC 1200",
        "DANC 2800",
        "DSCI 2710",
        "EADP 1010",
        "EADP 4050",
        "ECON 1100",
        "ECON 1110",
        "ENGL 1310",
        "ENGL 1311",
        "ENGL 1315",
        "ENGL 1320",
        "ENGL 1321",
        "ENGL 1325",
        "ENGL 2321",
        "ENGL 2326",
        "ENGL 2331",
        "ENGL 2341",
        "ENGL 2351",
        "ENGL 3450",
        "FIPL 2770",
        "GEOG 1000",
        "GEOG 1200",
        "GEOG 1500",
        "GEOG 1710",
        "GEOL 1610",
        "HDFS 1013",
        "HDFS 2033",
        "HDFS 2313",
        "HDFS 3423",
        "HIST 1050",
        "HIST 1060",
        "HIST 2610",
        "HIST 2620",
        "HIST 2675",
        "HIST 2685",
        "HLTH 2200",
        "INST 2100",
        "JOUR 1210",
        "JOUR 2250",
        "JOUR 2300",
        "KINE 2050",
        "LING 2050",
        "LING 2070",
        "LING 3010",
        "LING 3050",
        "LING 3060",
        "MATH 1180",
        "MATH 1190",
        "MATH 1580",
        "MATH 1650",
        "MATH 1680",
        "MATH 1710",
        "MATH 1720",
        "MATH 1810",
        "MDSE 2750",
        "MDSE 3370",
        "MKTG 2650",
        "MKTG 3010",
        "MTSE 1100",
        "MTSE 2000",
        "MUCO 1200",
        "MUCO 3500",
        "MUET 2000",
        "MUET 3030",
        "MUET 3060",
        "MUJS 3070",
        "MUJS 3400",
        "MUMH 1610",
        "MUMH 2040",
        "MUMH 2050",
        "MUMH 2060",
        "MUMH 2080",
        "MUMH 3000",
        "MUMH 3010",
        "MUMH 3100",
        "MUMH 3200",
        "MUMH 3500",
        "MUMH 3510",
        "MUMH 3520",
        "NUTR 1450",
        "NUTR 2460",
        "NUTR 3460",
        "PADM 2100",
        "PHED 1000",
        "PHIL 1050",
        "PHIL 1400",
        "PHIL 1900",
        "PHIL 2050",
        "PHIL 2070",
        "PHIL 2500",
        "PHIL 2600",
        "PHIL 3900",
        "PHIL 4150",
        "PHIL 4200",
        "PHYS 1052",
        "PHYS 1062",
        "PHYS 1270",
        "PHYS 1315",
        "PHYS 1410",
        "PHYS 1420",
        "PHYS 1510",
        "PHYS 1520",
        "PHYS 1710",
        "PHYS 2220",
        "PSCI 2305",
        "PSCI 2306",
        "PSCI 2315",
        "PSCI 2316",
        "PSYC 1630",
        "RESM 3450",
        "RHAB 3000",
        "RHAB 3100",
        "SOCI 1510",
        "SOCI 2070",
        "SOWK 1450",
        "SOWK 4540",
        "TECM 1500",
        "TECM 1600",
        "TECM 1700",
        "TECM 2700",
        "THEA 1340",
        "THEA 2340",
        "THEA 3030",
        "THEA 3040",
        "UNIV 2100",
        "UNIV 2300",
        "WGST 2100"
      ],
      "courseSharing": "forbidden"
    }
  ]
};
