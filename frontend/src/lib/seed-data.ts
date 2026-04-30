import data from "@/lib/generated/seed-data.json";
import type {
  CampusBuilding,
  Course,
  CourseSection,
  Major,
  PlannerState,
  PrerequisiteEdge,
} from "@/lib/types";
import { campusBuildings } from "@/lib/campus-locations";

const generatedBuildings = data.buildings as CampusBuilding[];
const aliasById = new Map(campusBuildings.map((building) => [building.id, building] as const));

export const buildings = generatedBuildings.map((building) => {
  const aliasSource = aliasById.get(building.id);
  return aliasSource
    ? {
        ...building,
        ...aliasSource,
        id: building.id,
        aliases: aliasSource.aliases,
        address: aliasSource.address,
      }
    : building;
});

export const courses = data.courses as Course[];

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

type GeneratedMeeting = {
  day: CourseSection["meetings"][number]["day"];
  start: string;
  end: string;
  buildingId?: string;
};

type GeneratedSection = Omit<CourseSection, "meetings"> & {
  meetings: GeneratedMeeting[];
};

const buildingNameById = new Map(buildings.map((building) => [building.id, building.name] as const));
const buildingShortNameById = new Map(buildings.map((building) => [building.id, building.shortName] as const));

export const sections = (data.sections as GeneratedSection[]).map((section) => ({
  ...section,
  meetings: section.meetings.map((meeting) => ({
    ...meeting,
    location:
      (meeting.buildingId && buildingNameById.get(meeting.buildingId)) ??
      (meeting.buildingId && buildingShortNameById.get(meeting.buildingId)) ??
      meeting.buildingId ??
      "TBA",
    buildingId: meeting.buildingId,
  })),
})) as CourseSection[];

export const plannedCourseCodes = courses
  .filter((course) => course.planned)
  .map((course) => course.code);

export const defaultPlannerState: PlannerState = {
  courseStatuses: data.courseStatuses as PlannerState["courseStatuses"],
  selectedSections: {},
  optimization: "clusterMorning",
  activeDay: "Mon",
  selectedMajor: null,
  updatedAt: new Date().toISOString(),
};
