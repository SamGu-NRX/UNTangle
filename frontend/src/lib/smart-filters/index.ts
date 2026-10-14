// Pure section-fact filters and instructor-grade-history joins. The route
// wiring lives in the app/api route file; handlers.ts is the injected-sources
// version of the same logic.
export { campusesOf, meetingDays, modalityOf, sectionFacts } from "./facts";
export { sectionMatchesFilters } from "./filters";
export { candidatesFromHistory, joinSectionToHistory, MIN_GRADED_SECTIONS } from "./join";
export { createTermFilterHandler, MAX_COURSE_HISTORY_PER_REQUEST, parseFilters } from "./handlers";
export type { FilteredSection, SmartFiltersResponse } from "./handlers";
export type {
  Campus,
  GradeFactsResult,
  HistoryUnavailableReason,
  Modality,
  ModalityChoice,
  SectionFacts,
  SectionGradeFacts,
  SmartFilter,
} from "./model";
