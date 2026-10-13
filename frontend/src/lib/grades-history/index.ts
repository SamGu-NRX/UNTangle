// Runtime exports enter through a server-only module. Types can be imported by the UI.
export { gradesHistory } from "./server";
export type { CourseHistory, CourseIdentity, GradeCounts, GradeSearch, GradeTotals, HistoryResult, HistorySection, HistoryTerm, InstructorHistory, InstructorIdentity, UnavailableReason } from "./types";
