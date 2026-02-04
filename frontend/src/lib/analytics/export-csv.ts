/**
 * Build analytics dashboard data as CSV and trigger download.
 */

function escapeCsv(value: string | number): string {
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface DashboardDataForExport {
  summary?: {
    total_analyses: number;
    completed_screens: number;
    storage_used_bytes: number;
    active_time_seconds: number;
    success_rate_pct?: number;
    comparisons?: { analyses_change_pct: number };
  };
  usage_over_time?: Array<{ date: string; total: number; completed: number; failed: number }>;
  screen_types?: Array<{ type: string; count: number; percentage: number }>;
  feature_usage?: Array<{ feature: string; count: number; avg_duration?: number }>;
  recent_activity?: Array<{
    event_type: string;
    description: string;
    timestamp: string;
    resource_id?: string;
    resource_type?: string;
  }>;
  range?: string;
}

export function downloadAnalyticsCsv(data: DashboardDataForExport, filename?: string): void {
  const rows: string[] = [];
  const range = data.range ?? "Unknown";

  // Sheet 1: Summary
  rows.push("SplicR Usage Report - Summary");
  rows.push("Metric,Value,Period,Comparison");
  if (data.summary) {
    const s = data.summary;
    rows.push(
      `Total Analyses,${s.total_analyses},${range},${s.comparisons?.analyses_change_pct ?? 0}% vs previous`
    );
    rows.push(`Completed Screens,${s.completed_screens},${range},`);
    rows.push(`Storage Used (bytes),${s.storage_used_bytes},Current,`);
    rows.push(`Active Time (seconds),${s.active_time_seconds},${range},`);
    rows.push(`Success Rate (%),${s.success_rate_pct ?? 0},${range},`);
  }
  rows.push("");

  // Sheet 2: Daily activity
  rows.push("Daily Activity");
  rows.push("Date,Total Analyses,Completed,Failed");
  (data.usage_over_time ?? []).forEach((u) => {
    rows.push(`${u.date},${u.total},${u.completed},${u.failed}`);
  });
  rows.push("");

  // Sheet 3: Feature usage
  rows.push("Feature Usage");
  rows.push("Feature,Usage Count,Avg Duration (min)");
  (data.feature_usage ?? []).forEach((f) => {
    const avgMin = f.avg_duration != null ? Math.round(f.avg_duration / 60) : "";
    rows.push(`${escapeCsv(f.feature)},${f.count},${avgMin}`);
  });
  rows.push("");

  // Sheet 4: Screen types
  rows.push("Screen Types");
  rows.push("Type,Count,Percentage");
  (data.screen_types ?? []).forEach((s) => {
    rows.push(`${escapeCsv(s.type)},${s.count},${s.percentage}`);
  });
  rows.push("");

  // Sheet 5: Recent activity
  rows.push("Recent Activity");
  rows.push("Event Type,Description,Timestamp,Resource ID,Resource Type");
  (data.recent_activity ?? []).forEach((a) => {
    rows.push(
      `${escapeCsv(a.event_type)},${escapeCsv(a.description)},${a.timestamp},${a.resource_id ?? ""},${a.resource_type ?? ""}`
    );
  });

  const csv = "\uFEFF" + rows.join("\r\n"); // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `splicr-analytics-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
