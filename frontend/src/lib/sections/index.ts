// Client-safe contract. Import sections/server only from the server.
export type { SectionSource, Section, Meeting, LinkedComponent, CourseSections, Term, Provenance, Freshness, Day } from "./model";
export { createBrowserSectionSource, loadBrowserSectionSource } from "./client";
export { createSectionsConfig, type SectionsConfig } from "./config";
