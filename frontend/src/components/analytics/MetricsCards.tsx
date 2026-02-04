"use client";

import { motion } from "framer-motion";
import { FlaskConical, CheckCircle2, Database, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Summary {
  total_analyses: number;
  completed_screens: number;
  storage_used_bytes: number;
  active_time_seconds: number;
  success_rate_pct: number;
  comparisons: {
    analyses_change_pct: number;
    storage_change_pct: number;
  };
}

interface MetricsCardsProps {
  summary: Summary;
  className?: string;
}

function formatStorage(bytes: number): string {
  if (bytes === 0) return "—";
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hrs`;
}

export function MetricsCards({ summary, className }: MetricsCardsProps) {
  const { total_analyses, completed_screens, storage_used_bytes, active_time_seconds, success_rate_pct, comparisons } =
    summary;
  const trendUp = comparisons.analyses_change_pct >= 0;

  const cards = [
    {
      title: "Total analyses",
      value: total_analyses,
      sub: comparisons.analyses_change_pct !== 0 && (
        <span className={cn("text-sm", trendUp ? "text-success" : "text-error")}>
          {trendUp ? "↑" : "↓"} {Math.abs(comparisons.analyses_change_pct)}% vs previous period
        </span>
      ),
      icon: FlaskConical,
      gradient: "from-blue-500/10 to-transparent",
    },
    {
      title: "Completed screens",
      value: completed_screens,
      sub: total_analyses > 0 && (
        <span className="text-sm text-text-secondary">{success_rate_pct}% success rate</span>
      ),
      icon: CheckCircle2,
      gradient: "from-emerald-500/10 to-transparent",
    },
    {
      title: "Storage used",
      value: formatStorage(storage_used_bytes),
      sub: "of quota",
      icon: Database,
      gradient: "from-violet-500/10 to-transparent",
    },
    {
      title: "Active time",
      value: formatDuration(active_time_seconds),
      sub: "this period",
      icon: Clock,
      gradient: "from-amber-500/10 to-transparent",
    },
  ];

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6", className)}>
      {cards.map((card, i) => (
        <motion.div
          key={card.title}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className={cn(
            "rounded-2xl border border-border bg-surface p-6 shadow-card hover:shadow-card-hover transition-all duration-200",
            `bg-gradient-to-br ${card.gradient}`
          )}
        >
          <div className="flex items-start justify-between mb-3">
            <card.icon className="w-6 h-6 text-text-tertiary" strokeWidth={1.5} />
          </div>
          <div className="text-3xl font-serif text-text-primary mb-1">{card.value}</div>
          <div className="text-sm font-serif text-text-secondary">{card.title}</div>
          {card.sub && <div className="mt-2">{card.sub}</div>}
        </motion.div>
      ))}
    </div>
  );
}
