import type {
  CampusBuilding,
  Course,
  CourseSection,
  PlannerState,
  PrerequisiteEdge,
} from "@/lib/types";

export const buildings: CampusBuilding[] = [
  {
    id: "gab",
    name: "General Academic Building",
    shortName: "GAB",
    lat: 33.210783,
    lng: -97.146668,
  },
  {
    id: "wh",
    name: "Wooten Hall",
    shortName: "WH",
    lat: 33.208907,
    lng: -97.146777,
  },
  {
    id: "sage",
    name: "Sage Hall",
    shortName: "SAGE",
    lat: 33.212188,
    lng: -97.149834,
  },
  {
    id: "sci",
    name: "Science Research Building",
    shortName: "SCI",
    lat: 33.208298,
    lng: -97.149315,
  },
  {
    id: "union",
    name: "UNT Union",
    shortName: "UNION",
    lat: 33.210042,
    lng: -97.145061,
  },
  {
    id: "willis",
    name: "Willis Library",
    shortName: "WILLIS",
    lat: 33.209414,
    lng: -97.143878,
  },
  {
    id: "music",
    name: "Music Annex",
    shortName: "MUSX",
    lat: 33.208353,
    lng: -97.14356,
  },
];

export const courses: Course[] = [
  {
    code: "CSCE 1030",
    title: "Computer Science I",
    department: "CSCE",
    creditHours: 3,
    description: "Introduction to programming and computational thinking.",
    prerequisites: [],
    planned: true,
  },
  {
    code: "CSCE 1040",
    title: "Computer Science II",
    department: "CSCE",
    creditHours: 3,
    description: "Data structures, recursion, and object-oriented fundamentals.",
    prerequisites: ["CSCE 1030"],
    planned: false,
  },
  {
    code: "CSCE 2100",
    title: "Foundations of Computing",
    department: "CSCE",
    creditHours: 3,
    description: "Discrete structures for computing.",
    prerequisites: ["MATH 1710"],
    planned: false,
  },
  {
    code: "MATH 1710",
    title: "Calculus I",
    department: "MATH",
    creditHours: 4,
    description: "Differential calculus and its applications.",
    prerequisites: [],
    planned: true,
  },
  {
    code: "MATH 1720",
    title: "Calculus II",
    department: "MATH",
    creditHours: 4,
    description: "Integral calculus and infinite series.",
    prerequisites: ["MATH 1710"],
    planned: false,
  },
  {
    code: "MATH 2700",
    title: "Linear Algebra",
    department: "MATH",
    creditHours: 3,
    description: "Vector spaces, matrices, and linear systems.",
    prerequisites: ["MATH 1710"],
    planned: false,
  },
  {
    code: "HIST 2610",
    title: "U.S. History to 1865",
    department: "HIST",
    creditHours: 3,
    description: "American history from colonization to the Civil War.",
    prerequisites: [],
    planned: false,
  },
  {
    code: "HIST 2620",
    title: "U.S. History from 1865",
    department: "HIST",
    creditHours: 3,
    description: "American history from Reconstruction to the present.",
    prerequisites: [],
    planned: false,
  },
  {
    code: "GOVT 2305",
    title: "U.S. Government",
    department: "GOVT",
    creditHours: 3,
    description: "Institutions and politics of the United States.",
    prerequisites: [],
    planned: true,
  },
  {
    code: "PHYS 2220",
    title: "General Physics I",
    department: "PHYS",
    creditHours: 4,
    description: "Mechanics, motion, and energy with lab alignment.",
    prerequisites: ["MATH 1710"],
    planned: true,
  },
];

export const prerequisiteEdges: PrerequisiteEdge[] = courses.flatMap((course) =>
  course.prerequisites.map((prerequisiteCode) => ({
    courseCode: course.code,
    prerequisiteCode,
  })),
);

export const sections: CourseSection[] = [
  {
    id: "csce-1030-a",
    courseCode: "CSCE 1030",
    title: "Computer Science I",
    professor: "Dr. Reed",
    rating: 4.2,
    meetings: [
      { day: "Mon", start: "08:00", end: "08:50", buildingId: "gab" },
      { day: "Wed", start: "08:00", end: "08:50", buildingId: "gab" },
      { day: "Fri", start: "08:00", end: "08:50", buildingId: "gab" },
    ],
  },
  {
    id: "csce-1030-b",
    courseCode: "CSCE 1030",
    title: "Computer Science I",
    professor: "Prof. Velasquez",
    rating: 4.8,
    meetings: [
      { day: "Tue", start: "09:30", end: "10:50", buildingId: "gab" },
      { day: "Thu", start: "09:30", end: "10:50", buildingId: "gab" },
    ],
  },
  {
    id: "math-1710-a",
    courseCode: "MATH 1710",
    title: "Calculus I",
    professor: "Dr. Gao",
    rating: 4.1,
    meetings: [
      { day: "Tue", start: "08:00", end: "09:20", buildingId: "wh" },
      { day: "Thu", start: "08:00", end: "09:20", buildingId: "wh" },
    ],
  },
  {
    id: "math-1710-b",
    courseCode: "MATH 1710",
    title: "Calculus I",
    professor: "Dr. Henson",
    rating: 4.7,
    meetings: [
      { day: "Mon", start: "11:00", end: "11:50", buildingId: "wh" },
      { day: "Wed", start: "11:00", end: "11:50", buildingId: "wh" },
      { day: "Fri", start: "11:00", end: "11:50", buildingId: "wh" },
    ],
  },
  {
    id: "govt-2305-a",
    courseCode: "GOVT 2305",
    title: "U.S. Government",
    professor: "Dr. Soto",
    rating: 3.9,
    meetings: [
      { day: "Mon", start: "09:00", end: "09:50", buildingId: "sage" },
      { day: "Wed", start: "09:00", end: "09:50", buildingId: "sage" },
      { day: "Fri", start: "09:00", end: "09:50", buildingId: "sage" },
    ],
  },
  {
    id: "govt-2305-b",
    courseCode: "GOVT 2305",
    title: "U.S. Government",
    professor: "Prof. Hamid",
    rating: 4.5,
    meetings: [
      { day: "Tue", start: "13:00", end: "14:20", buildingId: "sage" },
      { day: "Thu", start: "13:00", end: "14:20", buildingId: "sage" },
    ],
  },
  {
    id: "phys-2220-a",
    courseCode: "PHYS 2220",
    title: "General Physics I",
    professor: "Dr. Iyengar",
    rating: 4.0,
    meetings: [
      { day: "Mon", start: "12:00", end: "12:50", buildingId: "sci" },
      { day: "Wed", start: "12:00", end: "12:50", buildingId: "sci" },
      { day: "Fri", start: "12:00", end: "12:50", buildingId: "sci" },
    ],
  },
  {
    id: "phys-2220-b",
    courseCode: "PHYS 2220",
    title: "General Physics I",
    professor: "Prof. McDonald",
    rating: 4.9,
    meetings: [
      { day: "Tue", start: "15:30", end: "16:50", buildingId: "sci" },
      { day: "Thu", start: "15:30", end: "16:50", buildingId: "sci" },
    ],
  },
];

export const plannedCourseCodes = courses
  .filter((course) => course.planned)
  .map((course) => course.code);

export const defaultPlannerState: PlannerState = {
  courseStatuses: {
    "CSCE 1030": "completed",
    "CSCE 1040": "completed",
    "CSCE 2100": "notTaken",
    "MATH 1710": "inProgress",
    "MATH 1720": "notTaken",
    "MATH 2700": "notTaken",
    "HIST 2610": "completed",
    "HIST 2620": "notTaken",
    "GOVT 2305": "notTaken",
    "PHYS 2220": "notTaken",
  },
  selectedSections: {},
  optimization: "clusterMorning",
  activeDay: "Mon",
  updatedAt: new Date().toISOString(),
};
