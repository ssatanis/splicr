"use client";

import { useMemo } from "react";
import { format, parseISO, eachDayOfInterval } from "date-fns";
import { motion } from "framer-motion";

interface HeatmapDay {
  date: string;
  count: number;
}

interface ActivityHeatmapProps {
  dates: HeatmapDay[];
  insights?: { busiest_day?: string | null; current_streak?: number; longest_streak?: number };
  startDate: string;
  endDate: string;
  className?: string;
}

export function ActivityHeatmap({
  dates,
  insights,
  startDate,
  endDate,
  className,
}: ActivityHeatmapProps) {
  const countByDate = useMemo(() => {
    const m = new Map<string, number>();
    dates.forEach((d) => m.set(d.date, d.count));
    return m;
  }, [dates]);

  const { start, end } = useMemo(() => {
    const s = parseISO(startDate);
    const e = parseISO(endDate);
    return { start: s, end: e };
  }, [startDate, endDate]);

  const maxCount = useMemo(() => Math.max(1, ...dates.map((d) => d.count)), [dates]);

  const gridDays = useMemo(() => {
    const allDays = eachDayOfInterval({ start, end });
    return allDays.map((day) => {
      const key = format(day, "yyyy-MM-dd");
      return { date: day, count: countByDate.get(key) ?? 0, key };
    });
  }, [start, end, countByDate]);

  const hasData = dates.some((d) => d.count > 0);

  if (!hasData) {
    return (
      <div
        className={`rounded-2xl border border-border bg-surface p-8 flex flex-col items-center justify-center min-h-[240px] ${className ?? ""}`}
      >
        <p className="text-text-secondary font-serif text-center">No activity in this period.</p>
        <p className="text-sm text-text-tertiary mt-2">Analyses will show as daily activity.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`rounded-2xl border border-border bg-surface p-6 shadow-card ${className ?? ""}`}
    >
      <h3 className="text-lg font-serif text-text-primary mb-4">Activity heatmap</h3>
      <div className="overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {gridDays.map(({ date, count, key }) => {
            const intensity = maxCount > 0 ? count / maxCount : 0;
            const opacity = 0.15 + intensity * 0.85;
            return (
              <div
                key={key}
                className="w-3 h-3 rounded-sm flex-shrink-0 transition-transform hover:scale-110"
                style={{
                  backgroundColor: "var(--color-success)",
                  opacity,
                }}
                title={`${format(date, "PPP")}: ${count} analyses`}
              />
            );
          })}
        </div>
      </div>
      {insights?.busiest_day && (
        <p className="text-sm text-text-tertiary mt-4 font-serif">
          Busiest day: <span className="text-text-secondary">{insights.busiest_day}</span>
        </p>
      )}
    </motion.div>
  );
}
