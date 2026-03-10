export const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export type WeekDay = (typeof weekDays)[number];
export type CourseStatus = "completed" | "inProgress" | "notTaken";
export type OptimizationKey =
  | "clusterMorning"
  | "clusterNight"
  | "compact"
  | "minimizeDistance"
  | "maximizeProfessor";

export type SectionMeeting = {
  day: WeekDay;
  start: string;
  end: string;
  buildingId: string;
};

export type CourseSection = {
  id: string;
  courseCode: string;
  title: string;
  professor: string;
  rating: number;
  meetings: SectionMeeting[];
};

export type Course = {
  code: string;
  title: string;
  department: string;
  creditHours: number;
  description: string;
  prerequisites: string[];
  planned: boolean;
};

export type PrerequisiteEdge = {
  courseCode: string;
  prerequisiteCode: string;
};

export type CampusBuilding = {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
};

export type ScheduleEvent = {
  courseCode: string;
  title: string;
  sectionId: string;
  professor: string;
  rating: number;
  buildingId: string;
  day: WeekDay;
  start: string;
  end: string;
};

export type MapStop = {
  courseCode: string;
  title: string;
  buildingId: string;
  buildingName: string;
  shortName: string;
  lat: number;
  lng: number;
  day: WeekDay;
  start: string;
  end: string;
};

export type RouteLeg = {
  from: string;
  to: string;
  minutes: number;
  distanceMiles: number;
};

export type PlannerState = {
  courseStatuses: Record<string, CourseStatus>;
  selectedSections: Record<string, string>;
  optimization: OptimizationKey;
  activeDay: WeekDay;
  updatedAt: string;
};

export type PlannerApiPayload = PlannerState & {
  routeStops: Record<WeekDay, MapStop[]>;
};
