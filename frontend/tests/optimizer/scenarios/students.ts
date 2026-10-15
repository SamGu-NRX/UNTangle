/**
 * Real-student scenarios for the optimizer evaluation. Every course list,
 * pick, and lock uses courses that exist in the planner catalog with real
 * Spring 2027 options in fixtures/spring-2027-trimmed.json. Section codes in
 * `picks`/`locks` are real sectionCode strings from that capture.
 */

import type { BlockedTime, MajorId, ScheduleConstraints, SchedulePreferences, WeekDay } from "@/lib/types";
import { GOAL_WEIGHTS, type GoalKey } from "@/lib/optimizer/presets";
import type { OptWeights } from "@/lib/optimizer/types";

export type StudentScenario = {
  id: string;
  description: string;
  major: MajorId;
  year: number;
  completed: Array<{ code: string; grade: string }>;
  nextTerm: string[];
  /** The student's chosen options, keyed by course code: sectionCode from the fixture. */
  picks?: Record<string, string>;
  /** Pinned options the optimizer must keep. */
  locks?: Record<string, string>;
  preferences: SchedulePreferences;
  expect: { feasible: boolean; note?: string };
};

const cons = (over: Partial<ScheduleConstraints>): ScheduleConstraints => ({
  earliestStart: null,
  latestEnd: null,
  daysOff: [],
  blocked: [],
  maxCredits: null,
  walkingBufferMinutes: null,
  excludedSections: [],
  openSeatsOnly: false,
  otherSites: false,
  ...over,
});

const block = (id: string, label: string, day: WeekDay, start: number, end: number): BlockedTime => ({
  id,
  label,
  day,
  start,
  end,
});

const goal = (key: GoalKey): { weights: OptWeights } => ({ weights: GOAL_WEIGHTS[key] });

export const scenarios: StudentScenario[] = [
  {
    // The CS plan puts 2100, 2110, and 1720 together; ENGL 1310 fills the core.
    // A warehouse job keeps 8:00-13:00 free every weekday.
    id: "cs-freshman-job-blocks",
    description: "CS freshman with CSCE 2100/2110 + MATH 1720 + ENGL 1310 and a weekday morning job",
    major: "cs",
    year: 1,
    completed: [
      { code: "CSCE 1030", grade: "A" },
      { code: "CSCE 1010", grade: "B" },
      { code: "MATH 1710", grade: "A" },
    ],
    nextTerm: ["CSCE 2100", "CSCE 2110", "MATH 1720", "ENGL 1310"],
    preferences: {
      constraints: cons({
        blocked: [block("job-weekdays", "warehouse shift", "Mon", 480, 780), block("job-tue", "warehouse shift", "Tue", 480, 780), block("job-wed", "warehouse shift", "Wed", 480, 780), block("job-thu", "warehouse shift", "Thu", 480, 780), block("job-fri", "warehouse shift", "Fri", 480, 780)],
      }),
      weights: goal("compact").weights,
    },
    expect: { feasible: true },
  },
  {
    id: "cs-sophomore-no-friday",
    description: "CS sophomore, four courses, refuses to come to campus on Friday",
    major: "cs",
    year: 2,
    completed: [
      { code: "CSCE 2100", grade: "B" },
      { code: "CSCE 2110", grade: "C" },
      { code: "MATH 1720", grade: "B" },
      { code: "ENGL 1310", grade: "B" },
    ],
    nextTerm: ["CSCE 2610", "CSCE 3444", "CSCE 3600", "MATH 2700"],
    preferences: { constraints: cons({ daysOff: ["Fri"] }), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    id: "cs-junior-late-start",
    description: "CS junior who never starts before 10:00, five courses including TECM",
    major: "cs",
    year: 3,
    completed: [
      { code: "CSCE 2610", grade: "B" },
      { code: "CSCE 3444", grade: "B" },
      { code: "MATH 2700", grade: "C" },
      { code: "ENGL 1310", grade: "A" },
    ],
    nextTerm: ["CSCE 4110", "CSCE 4350", "CSCE 4201", "TECM 2700"],
    preferences: { constraints: cons({ earliestStart: 600 }), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    id: "cs-senior-capstone-locks",
    description: "CS senior with one capstone section pinned and three courses to place",
    major: "cs",
    year: 4,
    completed: [
      { code: "CSCE 4110", grade: "B" },
      { code: "CSCE 4350", grade: "A" },
      { code: "CSCE 4201", grade: "B" },
      { code: "TECM 2700", grade: "B" },
    ],
    nextTerm: ["CSCE 4901", "CSCE 4902", "CSCE 4460", "CSCE 4610"],
    picks: { "CSCE 4901": "502" },
    locks: { "CSCE 4901": "502" },
    preferences: { constraints: cons({}), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    id: "cs-commuter-fewer-days",
    description: "Commuting CS senior weighing fewer campus days above all",
    major: "cs",
    year: 4,
    completed: [
      { code: "CSCE 2610", grade: "A" },
      { code: "CSCE 3550", grade: "B" },
      { code: "MATH 2700", grade: "B" },
      { code: "CSCE 3600", grade: "B" },
    ],
    nextTerm: ["CSCE 4220", "CSCE 4250", "CSCE 4290", "CSCE 4460", "CSCE 4902"],
    preferences: { constraints: cons({}), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    id: "cs-transfer-compact",
    description: "Transfer student rebuilding from CSCE 1030/1040, MATH 1650, COMM 1010",
    major: "cs",
    year: 1,
    completed: [{ code: "MATH 1650", grade: "A" }],
    nextTerm: ["CSCE 1030", "CSCE 1040", "COMM 1010", "ENGL 1310"],
    preferences: { constraints: cons({}), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    // CSCE 4220 001 and CSCE 4240 001 meet Tue/Thu 735-815: the only option of
    // each, identical, so nothing fits.
    id: "cs-clash-infeasible",
    description: "Student whose required CSCE 4220 and CSCE 4240 can only clash",
    major: "cs",
    year: 4,
    completed: [
      { code: "CSCE 3600", grade: "B" },
      { code: "CSCE 3530", grade: "B" },
      { code: "MATH 3410", grade: "B" },
    ],
    nextTerm: ["CSCE 4220", "CSCE 4240", "CSCE 4901", "COMM 1010"],
    preferences: { constraints: cons({}), weights: goal("compact").weights },
    expect: { feasible: false, note: "both single-option courses meet at the same time" },
  },
  {
    id: "cs-maxcredits-infeasible",
    description: "Fourteen credits marked Taking with maxCredits 13: too heavy by one",
    major: "cs",
    year: 1,
    completed: [{ code: "CSCE 1030", grade: "A" }],
    nextTerm: ["CSCE 2100", "CSCE 2110", "MATH 1650", "ENGL 1310"],
    preferences: { constraints: cons({ maxCredits: 13 }), weights: goal("compact").weights },
    expect: { feasible: false, note: "course credits sum past maxCredits; relaxing maxCredits fits" },
  },
  {
    id: "cs-excluded-one-section",
    description: "Same sophomore plan as no-Friday, but excluding CSCE 3444's Friday lecture instead",
    major: "cs",
    year: 2,
    completed: [
      { code: "CSCE 2100", grade: "B" },
      { code: "CSCE 2110", grade: "C" },
      { code: "MATH 1720", grade: "B" },
      { code: "ENGL 1310", grade: "B" },
    ],
    nextTerm: ["CSCE 2610", "CSCE 3444", "CSCE 3600", "MATH 2700"],
    picks: { "CSCE 3444": "001" },
    locks: { "CSCE 3444": "001" },
    preferences: { constraints: cons({ excludedSections: ["vsb:spring-2027:CSCE 3600:002 + 204"] }), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    // CSCE 3550 400 is an async internet section: nothing to place on the week
    // grid, so its three credits must ride along outside the optimizer.
    id: "cs-locked-async-rides-along",
    description: "Locked async-only pick (CSCE 3550 400) must ride along without a week slot",
    major: "cs",
    year: 3,
    completed: [
      { code: "CSCE 2610", grade: "B" },
      { code: "CSCE 3020", grade: "A" },
    ],
    nextTerm: ["CSCE 3550", "CSCE 3600", "CSCE 4110", "MATH 2700"],
    picks: { "CSCE 3550": "400" },
    locks: { "CSCE 3550": "400" },
    preferences: { constraints: cons({}), weights: goal("compact").weights },
    expect: { feasible: true, note: "3 of the 15 credits are the async pick's" },
  },
  {
    id: "ce-freshman-foundation",
    description: "CE freshman on CSCE 2110 + EENG 2610 + MATH 1720 + PHYS 2220 with labs",
    major: "ce",
    year: 1,
    completed: [
      { code: "MATH 1710", grade: "A" },
      { code: "CSCE 1030", grade: "B" },
      { code: "PHYS 1710", grade: "B" },
    ],
    nextTerm: ["CSCE 2110", "EENG 2610", "MATH 1720", "PHYS 2220"],
    preferences: { constraints: cons({}), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    id: "ce-sophomore-no-evening",
    description: "CE sophomore who must be home by 17:30, which rules out EENG 2710's evening labs",
    major: "ce",
    year: 2,
    completed: [
      { code: "EENG 2610", grade: "B" },
      { code: "MATH 1720", grade: "B" },
      { code: "PHYS 2220", grade: "C" },
    ],
    nextTerm: ["EENG 2710", "EENG 3510", "CSCE 2610", "MATH 2700"],
    preferences: { constraints: cons({ latestEnd: 1050 }), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    id: "ce-junior-commute",
    description: "CE junior minimizing walking with a 10-minute buffer between back-to-back buildings",
    major: "ce",
    year: 3,
    completed: [
      { code: "EENG 2710", grade: "B" },
      { code: "CSCE 2610", grade: "B" },
      { code: "MATH 2700", grade: "A" },
    ],
    nextTerm: ["EENG 3510", "CSCE 3020", "MATH 3410", "COMM 1010"],
    preferences: {
      constraints: cons({ walkingBufferMinutes: 10 }),
      weights: goal("minimizeDistance").weights,
    },
    expect: { feasible: true },
  },
  {
    id: "math-freshman-calculus",
    description: "Math freshman on 1710 + 1680 + BIOL 1710 + MATH 1190",
    major: "math",
    year: 1,
    completed: [{ code: "MATH 1650", grade: "A" }],
    nextTerm: ["MATH 1710", "MATH 1680", "BIOL 1710", "MATH 1190"],
    preferences: { constraints: cons({}), weights: goal("clusterMorning").weights },
    expect: { feasible: true },
  },
  {
    id: "math-sophomore-mornings",
    description: "Math sophomore who studies best before noon",
    major: "math",
    year: 2,
    completed: [
      { code: "MATH 1710", grade: "B" },
      { code: "MATH 1680", grade: "A" },
      { code: "BIOL 1710", grade: "B" },
    ],
    nextTerm: ["MATH 1720", "MATH 2700", "MATH 2730", "CSCE 1030"],
    preferences: { constraints: cons({}), weights: goal("clusterMorning").weights },
    expect: { feasible: true },
  },
  {
    id: "math-junior-cross-subject",
    description: "Math junior mixing 3410 with biology and chemistry electives",
    major: "math",
    year: 3,
    completed: [
      { code: "MATH 1720", grade: "A" },
      { code: "MATH 2700", grade: "B" },
      { code: "MATH 2730", grade: "B" },
      { code: "CHEM 1410", grade: "B" },
    ],
    nextTerm: ["MATH 3410", "BIOL 3451", "BIOL 3510", "CHEM 2370"],
    preferences: { constraints: cons({}), weights: goal("maximizeProfessor").weights },
    expect: { feasible: true },
  },
  {
    id: "math-busi-core-late-start",
    description: "Pre-business math-path student starting no earlier than 9:30",
    major: "math",
    year: 1,
    completed: [{ code: "ENGL 1310", grade: "A" }],
    nextTerm: ["MATH 1190", "ECON 1100", "ECON 1110", "COMM 1010"],
    preferences: { constraints: cons({ earliestStart: 630 }), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    id: "biol-freshman-intro-labs",
    description: "Biology freshman pairing BIOL 1720 with its 1760 lab course, CHEM 1410, and MATH 1680",
    major: "biol",
    year: 1,
    completed: [
      { code: "BIOL 1710", grade: "A" },
      { code: "ENGL 1310", grade: "B" },
    ],
    nextTerm: ["BIOL 1720", "BIOL 1760", "CHEM 1410", "MATH 1680"],
    preferences: { constraints: cons({}), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    id: "biol-sophomore-job-tuesdays",
    description: "Biology sophomore with a Tuesday afternoon lab shift and genetics to schedule",
    major: "biol",
    year: 2,
    completed: [
      { code: "BIOL 1720", grade: "B" },
      { code: "BIOL 1760", grade: "A" },
      { code: "CHEM 1410", grade: "B" },
      { code: "MATH 1680", grade: "C" },
    ],
    nextTerm: ["BIOL 2041", "BIOL 3451", "MATH 2730", "CHEM 2370"],
    preferences: {
      constraints: cons({ blocked: [block("lab-shift", "lab shift", "Tue", 660, 1020), block("lab-shift-thu", "lab shift", "Thu", 660, 1020)] }),
      weights: { compact: 3, mornings: 2, fewerDays: 0, evenings: 0, walking: 0, rating: 0 },
    },
    expect: { feasible: true },
  },
  {
    id: "biol-junior-no-mornings",
    description: "Biology junior who never schedules anything before 10:00",
    major: "biol",
    year: 3,
    completed: [
      { code: "BIOL 2041", grade: "B" },
      { code: "BIOL 3451", grade: "B" },
      { code: "MATH 1680", grade: "B" },
    ],
    nextTerm: ["BIOL 3510", "CHEM 2370", "PHYS 2220", "COMM 1010"],
    preferences: { constraints: cons({ earliestStart: 600 }), weights: goal("clusterNight").weights },
    expect: { feasible: true },
  },
  {
    id: "biol-freshman-friday-off",
    description: "Biology freshman refusing Friday classes across intro chemistry and labs",
    major: "biol",
    year: 1,
    completed: [{ code: "ENGL 1310", grade: "A" }],
    nextTerm: ["BIOL 1710", "BIOL 1760", "CHEM 1410", "COMM 1010"],
    preferences: { constraints: cons({ daysOff: ["Fri"] }), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    id: "busi-freshman-core",
    description: "Business freshman on the ECON pair + MATH 1190 + COMM 1010",
    major: "busi",
    year: 1,
    completed: [{ code: "ENGL 1310", grade: "B" }],
    nextTerm: ["ECON 1100", "ECON 1110", "MATH 1190", "COMM 1010"],
    preferences: { constraints: cons({}), weights: goal("compact").weights },
    expect: { feasible: true },
  },
  {
    // SPAN 2040 051 runs Tue/Thu 9:30-11:00 only in the first half of the term
    // and SPAN 2050 051 runs the same slot only in the second half, so both can
    // coexist — the dated-meeting rule, with real half-term sections.
    id: "busi-span-8week-stack",
    description: "SPAN sequence stacked in one term: both 051 sections share a slot across term halves",
    major: "busi",
    year: 2,
    completed: [{ code: "SPAN 1020", grade: "A" }],
    nextTerm: ["SPAN 2040", "SPAN 2050", "COMM 1010", "MATH 1190"],
    picks: { "SPAN 2040": "051", "SPAN 2050": "051" },
    locks: { "SPAN 2040": "051", "SPAN 2050": "051" },
    preferences: { constraints: cons({}), weights: goal("compact").weights },
    expect: { feasible: true, note: "the two 051 sections meet Tue/Thu 9:30-11:00 in disjoint halves" },
  },
  {
    id: "busi-mwf-job",
    description: "Business student with a 9:00-16:00 Monday/Wednesday/Friday job",
    major: "busi",
    year: 1,
    completed: [{ code: "MATH 1650", grade: "A" }],
    nextTerm: ["ECON 1100", "ECON 1110", "COMM 1010", "TECM 2700"],
    preferences: {
      constraints: cons({
        blocked: [block("job-mon", "job", "Mon", 540, 960), block("job-wed", "job", "Wed", 540, 960), block("job-fri", "job", "Fri", 540, 960)],
      }),
      weights: goal("clusterNight").weights,
    },
    expect: { feasible: true },
  },
  {
    id: "busi-evening-heavy",
    description: "Business student who prefers evening sections and later starts",
    major: "busi",
    year: 2,
    completed: [
      { code: "ECON 1100", grade: "B" },
    ],
    nextTerm: ["ECON 1110", "MATH 1190", "COMM 1010", "ENGL 1310"],
    preferences: { constraints: cons({}), weights: goal("clusterNight").weights },
    expect: { feasible: true },
  },
  {
    id: "cs-walking-buffer",
    description: "CS junior with a 15-minute walking buffer and cross-campus back-to-backs",
    major: "cs",
    year: 3,
    completed: [
      { code: "CSCE 2610", grade: "B" },
      { code: "CSCE 3444", grade: "B" },
      { code: "MATH 2700", grade: "B" },
    ],
    nextTerm: ["CSCE 3600", "CSCE 3530", "CSCE 4110", "MATH 3410"],
    preferences: {
      constraints: cons({ walkingBufferMinutes: 15 }),
      weights: goal("minimizeDistance").weights,
    },
    expect: { feasible: true },
  },
  {
    id: "cs-missing-lock-rides-along",
    description: "A locked section id that no longer exists must not break the plan",
    major: "cs",
    year: 3,
    completed: [
      { code: "CSCE 2610", grade: "B" },
      { code: "CSCE 3020", grade: "A" },
    ],
    nextTerm: ["CSCE 3600", "CSCE 4110", "MATH 2700", "CSCE 3530"],
    picks: { "CSCE 3600": "vsb:spring-2027:CSCE 3600:999999" },
    locks: { "CSCE 3600": "vsb:spring-2027:CSCE 3600:999999" },
    preferences: { constraints: cons({}), weights: goal("compact").weights },
    expect: { feasible: true, note: "lock-unavailable course rides along as credits only" },
  },
];
