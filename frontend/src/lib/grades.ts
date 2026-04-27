export type GradeData = {
  gradeA: number;
  gradeB: number;
  gradeC: number;
  gradeD: number;
  gradeF: number;
  gradeP: number;
  gradeNP: number;
  gradeW: number;
  gradeWF: number;
  gradeI: number;
  gradePR: number;
  gradeNPR: number;
  gradeZ: number;
  gradeSuppressed: number;
  totalEnroll: number;
};

export type ChartDataPoint = {
  color: string;
  count: number;
  grade: string;
  percentage: number;
};

const gradeOrder = [
  "A",
  "B",
  "C",
  "D",
  "F",
  "P",
  "NP",
  "W",
  "WF",
  "I",
  "PR",
  "NPR",
  "Z",
  "Hidden",
] as const;

const gradeColors: Record<(typeof gradeOrder)[number], string> = {
  A: "#2e7d50",
  B: "#6f8f42",
  C: "#b88a2b",
  D: "#b96d32",
  F: "#8a2f2c",
  P: "#4f7f63",
  NP: "#89745d",
  W: "#6b826b",
  WF: "#7d5530",
  I: "#93a393",
  PR: "#007a40",
  NPR: "#8f6d6a",
  Z: "#667066",
  Hidden: "#c8d8c8",
};

export function toChartData(data: GradeData): ChartDataPoint[] {
  const values: Record<(typeof gradeOrder)[number], number> = {
    A: data.gradeA,
    B: data.gradeB,
    C: data.gradeC,
    D: data.gradeD,
    F: data.gradeF,
    P: data.gradeP,
    NP: data.gradeNP,
    W: data.gradeW,
    WF: data.gradeWF,
    I: data.gradeI,
    PR: data.gradePR,
    NPR: data.gradeNPR,
    Z: data.gradeZ,
    Hidden: data.gradeSuppressed,
  };
  const total = data.totalEnroll || 1;

  return gradeOrder
    .map((grade) => ({
      color: gradeColors[grade],
      count: values[grade],
      grade,
      percentage: Math.round((values[grade] / total) * 1000) / 10,
    }))
    .filter((entry) => entry.count > 0);
}

export function formatGpa(gpa: number | null) {
  return gpa === null ? "N/A" : gpa.toFixed(2);
}

export function gpaTone(gpa: number | null) {
  if (gpa === null) return "neutral";
  if (gpa >= 3.5) return "strong";
  if (gpa >= 2.5) return "steady";
  if (gpa >= 2) return "warning";
  return "risk";
}
