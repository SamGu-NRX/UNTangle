// Browser-safe planner API. Server code uses `sectionsProxy` from ./server.
export { getCourseSections } from "./client";
export { supportedTerms } from "./config";
export type {
  CourseSections,
  Day,
  Diagnostic,
  LinkedComponent,
  Meeting,
  RealCourseSections,
  SampleCourseSections,
  Section,
} from "./model";
