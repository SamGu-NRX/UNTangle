"use client";

import dynamic from "next/dynamic";
import { toChartData, type GradeData } from "@/lib/grades";

const GradeChartCanvas = dynamic(
  () => import("@/components/grade-chart-canvas").then((module) => module.GradeChartCanvas),
  {
    ssr: false,
    loading: () => <div className="grade-chart-empty">Loading distribution...</div>,
  },
);

export function GradeChart({ data, height = 260 }: { data: GradeData; height?: number }) {
  const chartData = toChartData(data);

  if (chartData.length === 0) {
    return <div className="grade-chart-empty">No distribution data available.</div>;
  }

  return <GradeChartCanvas chartData={chartData} height={height} />;
}
