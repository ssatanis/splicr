"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";

interface DayPoint {
  date: string;
  total: number;
  completed: number;
  failed: number;
}

interface UsageOverTimeChartProps {
  data: DayPoint[];
  className?: string;
}

export function UsageOverTimeChart({ data, className }: UsageOverTimeChartProps) {
  const chartData = useMemo(() => {
    return data.map((d) => ({
      ...d,
      displayDate: format(parseISO(d.date), "MMM d"),
    }));
  }, [data]);

  const hasData = chartData.some((d) => d.total > 0 || d.completed > 0 || d.failed > 0);

  if (!hasData) {
    return (
      <div
        className={`rounded-2xl border border-border bg-surface p-8 flex flex-col items-center justify-center min-h-[320px] ${className ?? ""}`}
      >
        <p className="text-text-secondary font-serif text-center">No usage data in this period.</p>
        <p className="text-sm text-text-tertiary mt-2">Analyses will appear here over time.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`rounded-2xl border border-border bg-surface p-6 shadow-card ${className ?? ""}`}
    >
      <h3 className="text-lg font-serif text-text-primary mb-4">Usage over time</h3>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "12px",
                fontFamily: "var(--font-instrument-serif)",
              }}
              labelFormatter={(label, payload) =>
                payload?.[0]?.payload?.date
                  ? format(parseISO(payload[0].payload.date), "PPP")
                  : label
              }
              formatter={(value: number | undefined) => [value ?? 0, ""]}
            />
            <Legend
              wrapperStyle={{ paddingTop: 8 }}
              formatter={(value) => <span className="text-sm font-serif text-text-secondary">{value}</span>}
            />
            <Area
              type="monotone"
              dataKey="total"
              name="Total"
              stroke="var(--color-accent)"
              strokeWidth={2}
              fill="url(#totalGradient)"
            />
            <Line
              type="monotone"
              dataKey="completed"
              name="Completed"
              stroke="var(--color-success)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="failed"
              name="Failed"
              stroke="var(--color-error)"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
