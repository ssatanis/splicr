"use client";

import { useState, useCallback, useEffect } from "react";
import useSWR from "swr";
import { motion } from "framer-motion";
import { BarChart3, RefreshCw, Circle } from "lucide-react";
import { subMonths, subYears, format } from "date-fns";
import { MetricsCards } from "@/components/analytics/MetricsCards";
import { UsageOverTimeChart } from "@/components/analytics/UsageOverTimeChart";
import { ScreenTypesChart } from "@/components/analytics/ScreenTypesChart";
import { FeatureUsageChart } from "@/components/analytics/FeatureUsageChart";
import { ActivityHeatmap } from "@/components/analytics/ActivityHeatmap";
import { ActivityTimeline } from "@/components/analytics/ActivityTimeline";
import { DateRangePicker, type DateRangeKey } from "@/components/analytics/DateRangePicker";
import { ExportButton } from "@/components/analytics/ExportButton";
import { AnalyticsEmptyState } from "@/components/analytics/EmptyState";
import {
  MetricsCardsSkeleton,
  ChartSkeleton,
  TimelineSkeleton,
} from "@/components/analytics/LoadingState";
import { track } from "@/lib/analytics";
import { downloadAnalyticsCsv } from "@/lib/analytics/export-csv";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function getRangeDates(range: DateRangeKey) {
  const end = new Date();
  const start =
    range === "1M"
      ? subMonths(end, 1)
      : range === "3M"
        ? subMonths(end, 3)
        : range === "6M"
          ? subMonths(end, 6)
          : range === "1Y"
            ? subYears(end, 1)
            : subYears(end, 10);
  return { start, end };
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<DateRangeKey>("6M");
  const { data, error, isLoading, mutate } = useSWR(
    `/api/analytics/dashboard?range=${range}`,
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: true,
      dedupingInterval: 30_000,
    }
  );

  const { start, end } = getRangeDates(range);

  useEffect(() => {
    track("page_viewed", {
      event_category: "session",
      metadata: { page: "analytics" },
    });
  }, []);

  const handleExportPDF = useCallback(() => {
    track("analysis_exported", {
      event_category: "export",
      metadata: { format: "pdf", source: "analytics_dashboard" },
    });
    // Phase 4: trigger PDF export
    window.alert("PDF export will be available in the next update.");
  }, []);

  const handleExportCSV = useCallback(() => {
    track("analysis_exported", {
      event_category: "export",
      metadata: { format: "csv", source: "analytics_dashboard" },
    });
    if (data) {
      downloadAnalyticsCsv(data);
    } else {
      window.alert("Load analytics first, then export.");
    }
  }, [data]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-error font-serif mb-4">Failed to load analytics.</p>
          <button
            type="button"
            onClick={() => mutate()}
            className="px-4 py-2 rounded-xl bg-surface border border-border text-text-primary font-serif hover:bg-background"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isEmpty = !isLoading && data && data.summary?.total_analyses === 0 && !data.recent_activity?.length;

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-8 py-8 sm:py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8"
        >
          <div>
            <h1 className="text-4xl sm:text-5xl font-serif text-text-primary mb-2 flex items-center gap-3">
              <BarChart3 className="w-10 h-10 text-accent" strokeWidth={1.5} />
              Usage analytics
            </h1>
            <p className="text-text-secondary font-serif">
              Your CRISPR analysis activity and feature usage
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DateRangePicker value={range} onChange={setRange} />
            <button
              type="button"
              onClick={() => mutate()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-border text-text-primary font-serif text-sm hover:bg-background transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
              Refresh
            </button>
            <ExportButton onExportPDF={handleExportPDF} onExportCSV={handleExportCSV} />
            <div className="flex items-center gap-2 text-xs text-text-tertiary font-serif">
              <Circle className="w-2 h-2 fill-success text-success animate-pulse" />
              Live
            </div>
          </div>
        </motion.div>

        {isEmpty ? (
          <AnalyticsEmptyState />
        ) : (
          <>
            {isLoading ? (
              <MetricsCardsSkeleton className="mb-10" />
            ) : (
              data?.summary && (
                <MetricsCards summary={data.summary} className="mb-10" />
              )
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {isLoading ? (
                <>
                  <ChartSkeleton />
                  <ChartSkeleton />
                </>
              ) : (
                <>
                  <UsageOverTimeChart
                    data={data?.usage_over_time ?? []}
                  />
                  <ScreenTypesChart data={data?.screen_types ?? []} />
                </>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {isLoading ? (
                <>
                  <ChartSkeleton />
                  <ChartSkeleton />
                </>
              ) : (
                <>
                  <FeatureUsageChart data={data?.feature_usage ?? []} />
                  <ActivityHeatmap
                    dates={data?.activity_heatmap?.dates ?? []}
                    insights={data?.activity_heatmap?.insights}
                    startDate={format(start, "yyyy-MM-dd")}
                    endDate={format(end, "yyyy-MM-dd")}
                  />
                </>
              )}
            </div>

            {isLoading ? (
              <TimelineSkeleton />
            ) : (
              <ActivityTimeline items={data?.recent_activity ?? []} className="mb-8" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
