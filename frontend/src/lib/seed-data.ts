import type {
  Course,
  CourseSection,
  Major,
  PlannerState,
  PrerequisiteEdge,
} from "@/lib/types";
import { campusBuildings } from "@/lib/campus-locations";

export const buildings = campusBuildings;

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

export const majors: Major[] = [
  {
    id: "cs",
    name: "Computer Science",
    department: "CSCE",
    icon: "</>",
    coreCourseCodes: ["CSCE 1030", "CSCE 1040", "CSCE 2100", "MATH 1710", "MATH 1720"],
  },
  {
    id: "ce",
    name: "Computer Engineering",
    department: "CSCE",
    icon: "{}",
    coreCourseCodes: ["CSCE 1030", "CSCE 1040", "MATH 1710", "MATH 1720", "PHYS 2220"],
  },
  {
    id: "math",
    name: "Mathematics",
    department: "MATH",
    icon: "f(x)",
    coreCourseCodes: ["MATH 1710", "MATH 1720", "MATH 2700"],
  },
  {
    id: "biol",
    name: "Biology",
    department: "BIOL",
    icon: "DNA",
    coreCourseCodes: ["MATH 1710", "PHYS 2220"],
  },
  {
    id: "busi",
    name: "Business",
    department: "BUSI",
    icon: "$",
    coreCourseCodes: ["GOVT 2305", "MATH 1710"],
  },
  {
    id: "psyc",
    name: "Psychology",
    department: "PSYC",
    icon: "Ψ",
    coreCourseCodes: ["HIST 2610", "HIST 2620", "GOVT 2305"],
  },
  {
    id: "engl",
    name: "English",
    department: "ENGL",
    icon: "Aa",
    coreCourseCodes: ["HIST 2610", "HIST 2620"],
  },
  {
    id: "other",
    name: "Undeclared",
    department: "—",
    icon: "?",
    coreCourseCodes: [],
  },
];

export const sections: CourseSection[] = [
  {
    id: "csce-1030-a",
    courseCode: "CSCE 1030",
    title: "Computer Science I",
    professor: "Dr. Reed",
    rating: 4.2,
    meetings: [
      { day: "Mon", start: "08:00", end: "08:50", location: "General Academic Building", buildingId: "gab" },
      { day: "Wed", start: "08:00", end: "08:50", location: "General Academic Building", buildingId: "gab" },
      { day: "Fri", start: "08:00", end: "08:50", location: "General Academic Building", buildingId: "gab" },
    ],
  },
  {
    id: "csce-1030-b",
    courseCode: "CSCE 1030",
    title: "Computer Science I",
    professor: "Prof. Velasquez",
    rating: 4.8,
    meetings: [
      { day: "Tue", start: "09:30", end: "10:50", location: "BLB" },
      { day: "Thu", start: "09:30", end: "10:50", location: "BLB" },
    ],
  },
  {
    id: "math-1710-a",
    courseCode: "MATH 1710",
    title: "Calculus I",
    professor: "Dr. Gao",
    rating: 4.1,
    meetings: [
      { day: "Tue", start: "08:00", end: "09:20", location: "Wooten Hall", buildingId: "wh" },
      { day: "Thu", start: "08:00", end: "09:20", location: "Wooten Hall", buildingId: "wh" },
    ],
  },
  {
    id: "math-1710-b",
    courseCode: "MATH 1710",
    title: "Calculus I",
    professor: "Dr. Henson",
    rating: 4.7,
    meetings: [
      { day: "Mon", start: "11:00", end: "11:50", location: "Wooten Hall", buildingId: "wh" },
      { day: "Wed", start: "11:00", end: "11:50", location: "Wooten Hall", buildingId: "wh" },
      { day: "Fri", start: "11:00", end: "11:50", location: "Wooten Hall", buildingId: "wh" },
    ],
  },
  {
    id: "govt-2305-a",
    courseCode: "GOVT 2305",
    title: "U.S. Government",
    professor: "Dr. Soto",
    rating: 3.9,
    meetings: [
      { day: "Mon", start: "09:00", end: "09:50", location: "Sage Hall", buildingId: "sage" },
      { day: "Wed", start: "09:00", end: "09:50", location: "Sage Hall", buildingId: "sage" },
      { day: "Fri", start: "09:00", end: "09:50", location: "Sage Hall", buildingId: "sage" },
    ],
  },
  {
    id: "govt-2305-b",
    courseCode: "GOVT 2305",
    title: "U.S. Government",
    professor: "Prof. Hamid",
    rating: 4.5,
    meetings: [
      { day: "Tue", start: "13:00", end: "14:20", location: "Sage Hall", buildingId: "sage" },
      { day: "Thu", start: "13:00", end: "14:20", location: "Sage Hall", buildingId: "sage" },
    ],
  },
  {
    id: "phys-2220-a",
    courseCode: "PHYS 2220",
    title: "General Physics I",
    professor: "Dr. Iyengar",
    rating: 4.0,
    meetings: [
      { day: "Mon", start: "12:00", end: "12:50", location: "Science Research Building", buildingId: "sci" },
      { day: "Wed", start: "12:00", end: "12:50", location: "Science Research Building", buildingId: "sci" },
      { day: "Fri", start: "12:00", end: "12:50", location: "Science Research Building", buildingId: "sci" },
    ],
  },
  {
    id: "phys-2220-b",
    courseCode: "PHYS 2220",
    title: "General Physics I",
    professor: "Prof. McDonald",
    rating: 4.9,
    meetings: [
      { day: "Tue", start: "15:30", end: "16:50", location: "Chemistry Building" },
      { day: "Thu", start: "15:30", end: "16:50", location: "Chemistry Building" },
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
  selectedMajor: null,
  updatedAt: new Date().toISOString(),
};
