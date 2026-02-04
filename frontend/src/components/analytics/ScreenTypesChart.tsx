"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { motion } from "framer-motion";

interface ScreenTypeItem {
  type: string;
  count: number;
  percentage: number;
}

const COLORS = [
  "var(--color-accent)",
  "var(--color-success)",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
];

interface ScreenTypesChartProps {
  data: ScreenTypeItem[];
  className?: string;
}

export function ScreenTypesChart({ data, className }: ScreenTypesChartProps) {
  const chartData = useMemo(
    () => data.map((d) => ({ name: d.type, value: d.count, percentage: d.percentage })),
    [data]
  );
  const total = chartData.reduce((s, d) => s + d.value, 0);
  const hasData = total > 0;

  if (!hasData) {
    return (
      <div
        className={`rounded-2xl border border-border bg-surface p-8 flex flex-col items-center justify-center min-h-[320px] ${className ?? ""}`}
      >
        <p className="text-text-secondary font-serif text-center">No screen types yet.</p>
        <p className="text-sm text-text-tertiary mt-2">Run analyses to see MAGeCK, BAGEL2, DrugZ breakdown.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`rounded-2xl border border-border bg-surface p-6 shadow-card ${className ?? ""}`}
    >
      <h3 className="text-lg font-serif text-text-primary mb-4">Screen types</h3>
      <div className="h-[320px] w-full flex items-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={2}
              dataKey="value"
              nameKey="name"
              animationBegin={0}
              animationDuration={600}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="var(--color-surface)" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "12px",
                fontFamily: "var(--font-instrument-serif)",
              }}
              formatter={(value: number, name: string, props: { payload?: { percentage?: number } }) => [
                `${value} (${props.payload?.percentage ?? 0}%)`,
                name,
              ]}
            />
            <Legend
              formatter={(value, entry: { payload?: { value: number; percentage?: number } }) => (
                <span className="text-sm font-serif text-text-secondary">
                  {value}: {entry.payload?.value ?? 0} ({entry.payload?.percentage ?? 0}%)
                </span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="text-center -mt-4">
        <span className="text-2xl font-serif text-text-primary">{total}</span>
        <span className="text-sm text-text-tertiary ml-1">total screens</span>
      </div>
    </motion.div>
  );
}
