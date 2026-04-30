import data from "@/lib/generated/seed-data.json";
import type {
  CampusBuilding,
  Course,
  CourseSection,
  PlannerState,
  PrerequisiteEdge,
} from "@/lib/types";

export const buildings = data.buildings as CampusBuilding[];

export const courses = data.courses as Course[];

export const prerequisiteEdges: PrerequisiteEdge[] = courses.flatMap((course) =>
  course.prerequisites.map((prerequisiteCode) => ({
    courseCode: course.code,
    prerequisiteCode,
  })),
);

export const sections = data.sections as CourseSection[];

export const defaultPlannerState: PlannerState = {
  courseStatuses: data.courseStatuses as PlannerState["courseStatuses"],
  selectedSections: {},
  optimization: "clusterMorning",
  activeDay: "Mon",
  updatedAt: new Date().toISOString(),
};
