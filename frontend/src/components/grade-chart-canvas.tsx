"use client";

import { useState } from "react";
import type { GradeData } from "@/lib/grades";
import styles from "./grade-chart.module.css";

/** A B C D F W; one brand ramp, darkest for the best grade (DESIGN.md §4 Grade distribution). */
export const chartGrades = [
  { grade: "A", key: "gradeA", opacity: 1 },
  { grade: "B", key: "gradeB", opacity: 0.8 },
  { grade: "C", key: "gradeC", opacity: 0.6 },
  { grade: "D", key: "gradeD", opacity: 0.45 },
  { grade: "F", key: "gradeF", opacity: 0.35 },
  { grade: "W", key: "gradeW", opacity: 0.25 },
] as const satisfies ReadonlyArray<{ grade: string; key: keyof GradeData; opacity: number }>;

/**
 * Shares are of every enrolled student (`totalEnroll`), so a course with many
 * P, NP or I grades does not inflate its A share. `otherCount` is the
 * students in grades the chart does not draw.
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
      return {
        ...entry,
        count,
        percent: total === 0 ? 0 : Math.round((count / total) * 100),
        height: (count / max) * 100,
      };
    }),
  };
}

/** One dataset's bars. Hover shows count and share; the parent supplies the text table for screen readers. */
export function GradeChartCanvas({ grades, motion }: { grades: GradeData; motion?: "in" | "out" }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className={styles.layer} data-motion={motion} aria-hidden="true">
      {gradeBars(grades).bars.map((bar) => (
        <div
          key={bar.grade}
          className={styles.col}
          onPointerEnter={() => setHover(bar.grade)}
          onPointerLeave={() => setHover((current) => (current === bar.grade ? null : current))}
        >
          <div className={styles.bar} data-grade-bar style={{ height: `${bar.height}%`, opacity: bar.opacity }} />
          <span className={styles.value} style={{ bottom: `calc(${bar.height}% + 4px)` }}>
            {bar.percent}%
          </span>
          <span className={styles.label}>{bar.grade}</span>
          {hover === bar.grade && motion !== "out" ? (
            <span className={styles.tip}>
              {bar.count.toLocaleString()} with {bar.grade} ({bar.percent}%)
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
