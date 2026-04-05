export const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export type WeekDay = (typeof weekDays)[number];
export type CourseStatus = "completed" | "inProgress" | "notTaken";
export type OptimizationKey =
  | "clusterMorning"
  | "clusterNight"
  | "compact"
  | "minimizeDistance"
  | "maximizeProfessor";

export type MajorId =
  | "cs"
  | "ce"
  | "math"
  | "biol"
  | "busi"
  | "psyc"
  | "engl"
  | "other";

export type Major = {
  id: MajorId;
  name: string;
  department: string;
  icon: string;
  coreCourseCodes: string[];
};

export type SectionMeeting = {
  day: WeekDay;
  start: string;
  end: string;
  location: string;
  buildingId?: string;
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
  aliases?: string[];
  address?: string;
};

export type ScheduleEvent = {
  courseCode: string;
  title: string;
  sectionId: string;
  professor: string;
  rating: number;
  location: string;
  buildingId?: string;
  day: WeekDay;
  start: string;
  end: string;
};

export type MapStop = {
  courseCode: string;
  title: string;
  location: string;
  buildingId?: string;
  buildingName: string;
  shortName: string;
  lat?: number;
  lng?: number;
  resolutionStatus: "local" | "unresolved";
  geocodeQuery: string;
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
  selectedMajor: MajorId | null;
  updatedAt: string;
};

export type PlannerApiPayload = PlannerState & {
  routeStops: Record<WeekDay, MapStop[]>;
};
