"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { motion } from "framer-motion";

interface FeatureItem {
  feature: string;
  count: number;
  avg_duration?: number;
}

interface FeatureUsageChartProps {
  data: FeatureItem[];
  className?: string;
}

export function FeatureUsageChart({ data, className }: FeatureUsageChartProps) {
  const chartData = useMemo(
    () => data.slice(0, 10).map((d) => ({ name: d.feature, count: d.count, avg: d.avg_duration })),
    [data]
  );
  const hasData = chartData.length > 0 && chartData.some((d) => d.count > 0);

  if (!hasData) {
    return (
      <div
        className={`rounded-2xl border border-border bg-surface p-8 flex flex-col items-center justify-center min-h-[320px] ${className ?? ""}`}
      >
        <p className="text-text-secondary font-serif text-center">No feature usage yet.</p>
        <p className="text-sm text-text-tertiary mt-2">Use QC, volcano plots, exports, and sharing to see stats.</p>
      </div>
    );
  }

  const maxCount = Math.max(...chartData.map((d) => d.count), 1);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`rounded-2xl border border-border bg-surface p-6 shadow-card ${className ?? ""}`}
    >
      <h3 className="text-lg font-serif text-text-primary mb-4">Most used features</h3>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={140}
              tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "12px",
                fontFamily: "var(--font-instrument-serif)",
              }}
              formatter={(value: number, name: string, props: { payload?: { avg?: number } }) => [
                props.payload?.avg ? `${value} uses (avg ${Math.round(props.payload.avg / 60)} min)` : `${value} uses`,
                name,
              ]}
            />
            <Bar dataKey="count" name="Uses" radius={[0, 6, 6, 0]} maxBarSize={32}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={`var(--color-accent)`}
                  fillOpacity={0.5 + (entry.count / maxCount) * 0.5}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
