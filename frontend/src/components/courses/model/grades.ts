/**
 * Grade history as the detail draws it: horizontal bars for A to F and W,
 * and the instructor names that tie a section to its grade records.
 */
import type { GradeData } from "@/lib/grades";

export const chartGrades = [
  { grade: "A", key: "gradeA" },
  { grade: "B", key: "gradeB" },
  { grade: "C", key: "gradeC" },
  { grade: "D", key: "gradeD" },
  { grade: "F", key: "gradeF" },
  { grade: "W", key: "gradeW" },
] as const satisfies ReadonlyArray<{ grade: string; key: keyof GradeData }>;

/**
 * Shares are of every enrolled student (`totalEnroll`), so a course with many
 * P, NP or I grades does not inflate its A share. `width` is relative to the
 * largest bar, so the commonest grade fills the track.
 */
export function gradeBars(grades: GradeData) {
  const drawn = chartGrades.reduce((sum, entry) => sum + grades[entry.key], 0);
  const total = Math.max(grades.totalEnroll, drawn);
  const max = Math.max(1, ...chartGrades.map((entry) => grades[entry.key]));
  return {
    total,
    otherCount: total - drawn,
    bars: chartGrades.map((entry) => {
      const count = grades[entry.key];
      return { ...entry, count, percent: total === 0 ? 0 : Math.round((count / total) * 100), width: count / max };
    }),
  };
}

/** "Pradhumna L. Shrestha" and "Shrestha, Pradhumna" both become "pradhumna shrestha". */
export function instructorKey(name: string, first?: string, last?: string): string {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (first !== undefined && last !== undefined && (first || last)) {
    return `${clean(first)[0] ?? ""} ${clean(last).at(-1) ?? ""}`.trim();
  }
  const parts = name.includes(",") ? clean(name.split(",").reverse().join(" ")) : clean(name);
  return `${parts[0] ?? ""} ${parts.at(-1) ?? ""}`.trim();
}
