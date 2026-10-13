"use client";

import { useEffect, useState } from "react";
import type { GradeData } from "@/lib/grades";
import { GradeChartCanvas, gradeBars } from "./grade-chart-canvas";
import styles from "./grade-chart.module.css";

type Outgoing = { key: string; grades: GradeData };

/**
 * Grade bars for the selected instructor. Changing `dataKey` crossfades the old
 * bars out and the new ones in over 120ms, in place; nothing moves. Remount
 * (a new React key) to switch courses without a crossfade.
 */
export function GradeChart({ grades, dataKey, label }: { grades: GradeData; dataKey: string; label: string }) {
  const [shown, setShown] = useState<{ key: string; grades: GradeData }>({ key: dataKey, grades });
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const [changed, setChanged] = useState(false);

  if (shown.key !== dataKey) {
    setOutgoing({ key: `${shown.key}:out`, grades: shown.grades });
    setShown({ key: dataKey, grades });
    setChanged(true);
  } else if (shown.grades !== grades) {
    setShown({ key: dataKey, grades });
  }

  useEffect(() => {
    if (!outgoing) return;
    const timer = window.setTimeout(() => setOutgoing(null), 140);
    return () => window.clearTimeout(timer);
  }, [outgoing]);

  const bars = gradeBars(grades);
  return (
    <div className={styles.chart}>
      <div className={styles.grid} />
      {outgoing ? <GradeChartCanvas key={outgoing.key} grades={outgoing.grades} motion="out" /> : null}
      <GradeChartCanvas key={shown.key} grades={shown.grades} motion={changed ? "in" : undefined} />
      <table style={{ position: "absolute", width: 1, height: 1, margin: -1, overflow: "hidden", clipPath: "inset(50%)" }}>
        <caption>Grade distribution, {label}</caption>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.grade}>
              <th scope="row">{bar.grade}</th>
              <td>
                {bar.count} students, {bar.percent}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
