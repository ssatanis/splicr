import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  subMonths,
  subYears,
  startOfDay,
  format,
  eachDayOfInterval,
  parseISO,
} from "date-fns";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RangeKey = "1M" | "3M" | "6M" | "1Y" | "all";

function getDateRange(range: RangeKey): { start: Date; end: Date } {
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

export async function GET(request: Request) {
  try {
    const { user, error: authError } = await getApiUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const range = (searchParams.get("range") || "6M") as RangeKey;
    const { start, end } = getDateRange(range);
    const startStr = start.toISOString();
    const endStr = end.toISOString();

    // 1) Analyses summary from analyses table
    const { data: analysesRows } = await supabaseAdmin
      .from("analyses")
      .select("id, status, created_at, completed_at, method, library, parameters")
      .eq("user_id", user.id)
      .gte("created_at", startStr)
      .lte("created_at", endStr);

    const analyses = analysesRows ?? [];
    const totalAnalyses = analyses.length;
    const completedAnalyses = analyses.filter(
      (a: { status: string }) => a.status === "complete"
    ).length;
    const failedAnalyses = analyses.filter(
      (a: { status: string }) => a.status === "failed"
    ).length;

    // 2) Usage over time (by day)
    const days = eachDayOfInterval({ start, end });
    const usageByDay: Record<string, { total: number; completed: number; failed: number }> = {};
    days.forEach((d) => {
      const key = format(d, "yyyy-MM-dd");
      usageByDay[key] = { total: 0, completed: 0, failed: 0 };
    });
    analyses.forEach((a: { created_at: string; status: string }) => {
      const key = format(startOfDay(parseISO(a.created_at)), "yyyy-MM-dd");
      if (usageByDay[key]) {
        usageByDay[key].total += 1;
        if (a.status === "complete") usageByDay[key].completed += 1;
        if (a.status === "failed") usageByDay[key].failed += 1;
      }
    });
    const usage_over_time = days.map((d) => {
      const key = format(d, "yyyy-MM-dd");
      const u = usageByDay[key] || { total: 0, completed: 0, failed: 0 };
      return {
        date: key,
        total: u.total,
        completed: u.completed,
        failed: u.failed,
      };
    });

    // 3) Screen types (algorithm distribution)
    const algoCount: Record<string, number> = {};
    analyses.forEach((a: { method?: string | string[]; parameters?: { algorithms?: string[] }; library?: string }) => {
      const algorithms = a.parameters?.algorithms;
      const methods = Array.isArray(algorithms)
        ? algorithms
        : Array.isArray(a.method)
          ? a.method
          : [a.method || "mageck"];
      methods.forEach((m: string) => {
        const key = (m || "mageck").toLowerCase();
        algoCount[key] = (algoCount[key] || 0) + 1;
      });
    });
    const totalAlgo = Object.values(algoCount).reduce((s, n) => s + n, 0) || 1;
    const screen_types = Object.entries(algoCount).map(([type, count]) => ({
      type: type.toUpperCase(),
      count,
      percentage: Math.round((count / totalAlgo) * 1000) / 10,
    }));

    // 4) Feature usage from analytics_events
    const { data: events } = await supabaseAdmin
      .from("analytics_events")
      .select("event_type, created_at, metadata")
      .eq("user_id", user.id)
      .gte("created_at", startStr)
      .lte("created_at", endStr)
      .order("created_at", { ascending: false });

    const eventList = events ?? [];
    const featureCount: Record<string, number> = {};
    const featureDurations: Record<string, number[]> = {};
    const featureEventTypes = [
      "qc_metrics_viewed",
      "volcano_plot_generated",
      "pathway_analysis_performed",
      "hit_calling_viewed",
      "multi_screen_comparison",
      "analysis_exported",
      "analysis_shared",
      "comments_added",
      "version_created",
      "methods_generation",
    ];
    const featureLabels: Record<string, string> = {
      qc_metrics_viewed: "Quality Control",
      volcano_plot_generated: "Volcano Plot",
      pathway_analysis_performed: "Pathway Analysis",
      hit_calling_viewed: "Hit Calling",
      multi_screen_comparison: "Multi-Screen Comparison",
      analysis_exported: "Export to PDF",
      analysis_shared: "Share Analysis",
      comments_added: "Add Comments",
      version_created: "Version History",
      methods_generation: "Methods Generation",
    };
    eventList.forEach((e: { event_type: string; metadata?: { duration_seconds?: number } }) => {
      if (featureEventTypes.includes(e.event_type)) {
        featureCount[e.event_type] = (featureCount[e.event_type] || 0) + 1;
        const dur = e.metadata?.duration_seconds;
        if (typeof dur === "number") {
          if (!featureDurations[e.event_type]) featureDurations[e.event_type] = [];
          featureDurations[e.event_type].push(dur);
        }
      }
    });
    const feature_usage = Object.entries(featureCount)
      .map(([feature, count]) => ({
        feature: featureLabels[feature] || feature,
        count,
        avg_duration:
          featureDurations[feature]?.length &&
          featureDurations[feature].reduce((a, b) => a + b, 0) / featureDurations[feature].length,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 5) Activity heatmap (analyses per day)
    const heatmapDates: { date: string; count: number }[] = Object.entries(usageByDay).map(
      ([date, u]) => ({ date, count: u.total })
    );
    const busiestDay =
      heatmapDates.length > 0
        ? heatmapDates.reduce((a, b) => (a.count >= b.count ? a : b), heatmapDates[0])
        : null;
    const busiestDate = busiestDay ? parseISO(busiestDay.date) : null;
    const activity_heatmap = {
      dates: heatmapDates,
      insights: {
        busiest_day: busiestDate ? format(busiestDate, "EEEE") : null,
        current_streak: 0,
        longest_streak: 0,
      },
    };

    // 6) Recent activity (last 20 events)
    const recentRaw = eventList.slice(0, 20);
    const eventDescriptions: Record<string, string> = {
      analysis_created: "Analysis created",
      analysis_started: "Analysis started",
      analysis_completed: "Analysis completed",
      analysis_failed: "Analysis failed",
      analysis_shared: "Analysis shared",
      analysis_exported: "Results exported",
      analysis_deleted: "Analysis deleted",
      mageck_run: "MAGeCK run",
      bagel2_run: "BAGEL2 run",
      drugz_run: "DrugZ run",
      qc_metrics_viewed: "Viewed QC metrics",
      volcano_plot_generated: "Generated volcano plot",
      pathway_analysis_performed: "Pathway analysis performed",
      fastq_uploaded: "FASTQ uploaded",
      results_downloaded: "Results downloaded",
      page_viewed: "Page viewed",
    };
    const recent_activity = recentRaw.map(
      (e: { event_type: string; created_at: string; resource_id?: string; resource_type?: string; metadata?: { name?: string } }) => ({
        event_type: e.event_type,
        description:
          e.metadata?.name ? `"${e.metadata.name}"` : eventDescriptions[e.event_type] || e.event_type,
        timestamp: e.created_at,
        resource_id: e.resource_id,
        resource_type: e.resource_type || "analysis",
      })
    );

    // 7) Storage: placeholder (would need storage bucket stats)
    const total_storage_bytes = 0;

    // 8) Active time: sum from session/page events if we stored duration; else 0
    const active_time_seconds = 0;

    // 9) Comparison to previous period (same length, immediately before)
    const months = range === "1M" ? 1 : range === "3M" ? 3 : range === "6M" ? 6 : 12;
    const prevEnd = start;
    const prevStart = subMonths(prevEnd, months);
    const { count: prevAnalysesCount } = await supabaseAdmin
      .from("analyses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", prevStart.toISOString())
      .lt("created_at", prevEnd.toISOString());
    const prevTotal = typeof prevAnalysesCount === "number" ? prevAnalysesCount : 0;
    const analyses_change_pct =
      prevTotal === 0 ? (totalAnalyses > 0 ? 100 : 0) : Math.round(((totalAnalyses - prevTotal) / prevTotal) * 100);

    const summary = {
      total_analyses: totalAnalyses,
      completed_screens: completedAnalyses,
      storage_used_bytes: total_storage_bytes,
      active_time_seconds,
      success_rate_pct: totalAnalyses ? Math.round((completedAnalyses / totalAnalyses) * 100) : 0,
      comparisons: {
        analyses_change_pct,
        storage_change_pct: 0,
      },
    };

    const payload = {
      summary,
      usage_over_time,
      screen_types,
      feature_usage,
      activity_heatmap,
      recent_activity,
      range,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("Analytics dashboard API error:", err);
    return NextResponse.json(
      { error: "Failed to load analytics" },
      { status: 500 }
    );
  }
}
