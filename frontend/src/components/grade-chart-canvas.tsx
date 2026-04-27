"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartDataPoint } from "@/lib/grades";

function GradeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartDataPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;

  return (
    <div className="grade-tooltip">
      <strong>{item.grade}</strong>
      <span>{item.count.toLocaleString()} students</span>
      <span>{item.percentage.toFixed(1)}%</span>
    </div>
  );
}

export function GradeChartCanvas({
  chartData,
  height,
}: {
  chartData: ChartDataPoint[];
  height: number;
}) {
  return (
    <div className="grade-chart" style={{ width: "100%", height }}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={height}
        initialDimension={{ width: 640, height }}
      >
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <XAxis
            dataKey="grade"
            tick={{ fill: "var(--copy)", fontSize: 12, fontWeight: 700 }}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
          />
          <YAxis
            tick={{ fill: "var(--copy)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip cursor={{ fill: "rgba(0, 81, 43, 0.04)" }} content={<GradeTooltip />} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {chartData.map((entry) => (
              <Cell key={entry.grade} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
