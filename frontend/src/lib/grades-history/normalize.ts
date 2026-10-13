import type { GradeData } from "@/lib/grades";
import type { CourseIdentity, GradeCounts, GradeTotals, CourseHistory, HistoryTerm } from "./types";
import type { SourceSection } from "./parse";

export function toGradeData(counts: GradeCounts): GradeData {
  return {
    gradeA: counts.A ?? 0, gradeB: counts.B ?? 0, gradeC: counts.C ?? 0, gradeD: counts.D ?? 0, gradeF: counts.F ?? 0,
    gradeP: counts.P ?? 0, gradeNP: counts.NP ?? 0, gradeW: counts.W ?? 0, gradeWF: counts.WF ?? 0, gradeI: counts.I ?? 0,
    gradePR: counts.PR ?? 0, gradeNPR: counts.NPR ?? 0, gradeZ: counts.Z ?? 0,
    gradeSuppressed: (counts.Hidden ?? 0) + (counts.Suppressed ?? 0), totalEnroll: Object.values(counts).reduce((sum, n) => sum + n, 0),
  };
}
export function sumCounts(items: GradeCounts[]): GradeCounts {
  const total: GradeCounts = { A: 0, B: 0, C: 0, D: 0, F: 0, W: 0 };
  for (const counts of items) for (const [grade, count] of Object.entries(counts)) total[grade] = (Object.hasOwn(total, grade) ? total[grade] : 0) + count;
  return total;
}
export function totals(counts: GradeCounts): GradeTotals {
  const grades = toGradeData(counts);
  return { counts, total: grades.totalEnroll, grades };
}
export function gradeGpa(counts: GradeCounts): number | null {
  const graded = counts.A + counts.B + counts.C + counts.D + counts.F;
  return graded === 0 ? null : Math.round((counts.A * 4 + counts.B * 3 + counts.C * 2 + counts.D) / graded * 100) / 100;
}
const termOrder: Record<string, number> = { Spring: 1, Summer: 2, Fall: 3, Winter: 4 };
export function normalizeCourse(course: CourseIdentity, sections: SourceSection[]): CourseHistory {
  const groups = new Map<string, SourceSection[]>();
  for (const section of sections) {
    const key = `${section.year}:${section.term}`;
    const group = groups.get(key) ?? [];
    group.push(section);
    groups.set(key, group);
  }
  const terms: HistoryTerm[] = [...groups.values()].map((group) => ({
    year: group[0].year, term: group[0].term, ...totals(sumCounts(group.map((s) => s.counts))),
    sections: group.map((s) => ({ sectionNumber: s.sectionNumber, instructor: s.instructor, ...totals(s.counts) })),
  })).sort((a, b) => Number(b.year) - Number(a.year) || (termOrder[b.term] ?? 0) - (termOrder[a.term] ?? 0) || a.term.localeCompare(b.term));
  const counts = sumCounts(sections.map((s) => s.counts));
  return { course, terms, sectionCount: sections.length, ...totals(counts), gpa: gradeGpa(counts) };
}
