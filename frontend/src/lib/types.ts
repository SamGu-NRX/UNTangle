export const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export type WeekDay = (typeof weekDays)[number];
export type CourseStatus = "completed" | "inProgress" | "notTaken";
export type TranscriptAppliedStatus = "completed" | "inProgress" | "ignored" | "needsReview";
export type TranscriptSourceKind = "unt" | "transfer" | "exam" | "current" | "unknown";
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
  mnemonic?: string;
  buildingNumber?: string;
  lat: number;
  lng: number;
  aliases?: string[];
  address?: string;
  isOffCampus?: boolean;
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

export type MapResolutionStatus = "local" | "geocoded" | "unresolved";

export type MapResolvedLocation = {
  location: string;
  buildingId?: string;
  buildingName: string;
  shortName: string;
  lat?: number;
  lng?: number;
  resolutionStatus: MapResolutionStatus;
  geocodeQuery: string;
  unsupportedReason?: string;
  /**
   * Set on an unresolved answer when the geocoder failed rather than said
   * "not found": try the lookup again later instead of remembering it.
   */
  retryable?: true;
};

export type MapRoutePoint = {
  lat: number;
  lng: number;
};

/**
 * Where a leg's path came from:
 * - `campus-network`: A* over the committed OpenStreetMap walkway graph;
 * - `ors`: OpenRouteService foot-walking, only when a deployment sets a key;
 * - `fallback`: a straight line between the two stops. It carries a distance
 *   but never a walking time, because nobody walks a straight line.
 */
export type MapRouteSource = "ors" | "campus-network" | "fallback";

type MapRouteLegBase = {
  /** Indexes into the request's `stops` of the leg's start and end. */
  fromIndex: number;
  toIndex: number;
  geometry: MapRoutePoint[];
  distanceMeters: number;
};

export type MapRouteLeg =
  | (MapRouteLegBase & { source: "campus-network" | "ors"; durationSeconds: number })
  | (MapRouteLegBase & { source: "fallback"; durationSeconds: null });

export type MapRouteResponse = {
  legs: MapRouteLeg[];
  /** All legs joined end to end, for callers that draw one line. */
  geometry: MapRoutePoint[];
  distanceMeters: number;
  /** Null when any leg is a straight-line fallback, since its time is unknown. */
  durationSeconds: number | null;
  /** The least certain source among the legs: fallback, then ors, then campus-network. */
  source: MapRouteSource;
};

export type TranscriptCourseRecord = {
  id: string;
  code: string;
  title: string;
  term: string;
  grade: string;
  credits: number | null;
  sourceKind: TranscriptSourceKind;
  confidence: number;
  rationale: string;
  duplicateExcluded: boolean;
  appliedStatus: TranscriptAppliedStatus;
  prerequisiteSatisfied: boolean;
  reviewRequired: boolean;
};

export type TranscriptImportSummary = {
  detected: number;
  applied: number;
  ignored: number;
  needsReview: number;
  modelUsed: string;
  extractionMode: "text" | "rendered-pages" | "local";
};

export type PlannerState = {
  courseStatuses: Record<string, CourseStatus>;
  selectedSections: Record<string, string>;
  optimization: OptimizationKey;
  activeDay: WeekDay;
  selectedMajor: MajorId | null;
  transcriptRecords: TranscriptCourseRecord[];
  updatedAt: string;
  /**
   * Sections the user pinned: course code -> section id. Optimizing passes
   * these as fixed selections, so it never changes them. Optional so plans
   * saved before locks existed still load; normalizePlannerState always sets
   * it (missing becomes no locks).
   */
  lockedSections?: Record<string, string>;
};

export type PlannerApiPayload = PlannerState & {
  routeStops: Record<WeekDay, MapStop[]>;
};
