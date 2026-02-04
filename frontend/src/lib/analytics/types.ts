/**
 * Analytics event types and categories for SplicR usage tracking.
 * Used by client and server to ensure consistent event naming.
 */

export type AnalyticsEventCategory =
  | "analysis"
  | "collaboration"
  | "export"
  | "feature"
  | "file"
  | "session"
  | "settings";

export type AnalyticsEventType =
  // Analysis
  | "analysis_created"
  | "analysis_started"
  | "analysis_completed"
  | "analysis_failed"
  | "analysis_shared"
  | "analysis_exported"
  | "analysis_deleted"
  | "analysis_parameters_modified"
  | "analysis_retried"
  // Feature usage
  | "mageck_run"
  | "bagel2_run"
  | "drugz_run"
  | "qc_metrics_viewed"
  | "volcano_plot_generated"
  | "pathway_analysis_performed"
  | "hit_calling_viewed"
  | "multi_screen_comparison"
  | "comments_added"
  | "version_created"
  | "methods_generation"
  // Collaboration
  | "lab_created"
  | "lab_joined"
  | "team_member_invited"
  | "analysis_shared_with_team"
  | "comment_received"
  | "mention_notification"
  // File
  | "fastq_uploaded"
  | "library_selected"
  | "results_downloaded"
  | "package_exported"
  // Session
  | "login"
  | "logout"
  | "page_viewed"
  // Screen
  | "screen_started";

export type AnalyticsResourceType =
  | "analysis"
  | "file"
  | "comment"
  | "lab"
  | "report";

export interface AnalyticsEventPayload {
  event_type: AnalyticsEventType;
  event_category: AnalyticsEventCategory;
  resource_id?: string;
  resource_type?: AnalyticsResourceType;
  metadata?: Record<string, unknown>;
  lab_id?: string;
}

export interface AnalyticsEventRow {
  event_type: string;
  event_category: string;
  resource_id?: string;
  resource_type?: string;
  metadata?: Record<string, unknown>;
  lab_id?: string;
  session_id?: string;
}
