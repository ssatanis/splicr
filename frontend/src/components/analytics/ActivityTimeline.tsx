"use client";

import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  FileText,
  BarChart3,
  Share2,
  Download,
  MessageSquare,
  FlaskConical,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { motion } from "framer-motion";

interface ActivityItem {
  event_type: string;
  description: string;
  timestamp: string;
  resource_id?: string;
  resource_type?: string;
}

interface ActivityTimelineProps {
  items: ActivityItem[];
  className?: string;
}

const EVENT_ICONS: Record<string, LucideIcon> = {
  analysis_completed: CheckCircle2,
  analysis_created: FileText,
  analysis_started: FlaskConical,
  analysis_failed: AlertCircle,
  analysis_shared: Share2,
  analysis_exported: Download,
  volcano_plot_generated: BarChart3,
  pathway_analysis_performed: BarChart3,
  qc_metrics_viewed: BarChart3,
  comments_added: MessageSquare,
  mageck_run: FlaskConical,
  bagel2_run: FlaskConical,
  drugz_run: FlaskConical,
};

function getIcon(eventType: string) {
  return EVENT_ICONS[eventType] ?? FileText;
}

export function ActivityTimeline({ items, className }: ActivityTimelineProps) {
  if (items.length === 0) {
    return (
      <div
        className={`rounded-2xl border border-border bg-surface p-8 flex flex-col items-center justify-center min-h-[200px] ${className ?? ""}`}
      >
        <p className="text-text-secondary font-serif text-center">No recent activity.</p>
        <p className="text-sm text-text-tertiary mt-2">Events will appear here as you use SplicR.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`rounded-2xl border border-border bg-surface p-6 shadow-card ${className ?? ""}`}
    >
      <h3 className="text-lg font-serif text-text-primary mb-4">Recent activity</h3>
      <div className="space-y-0">
        {items.map((item, i) => {
          const Icon = getIcon(item.event_type);
          const href = item.resource_type === "analysis" && item.resource_id ? `/results/${item.resource_id}` : null;
          const content = (
            <>
              <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-background/50 transition-colors">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-accent" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-serif text-text-primary truncate">{item.description}</p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
                  </p>
                </div>
                {href && <ChevronRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />}
              </div>
              {i < items.length - 1 && (
                <div className="ml-5 pl-4 border-l border-border-light h-2" />
              )}
            </>
          );
          return (
            <div key={`${item.timestamp}-${i}`}>
              {href ? (
                <Link href={href} className="block">
                  {content}
                </Link>
              ) : (
                content
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
