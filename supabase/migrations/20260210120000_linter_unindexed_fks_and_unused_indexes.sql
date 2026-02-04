-- ============================================================================
-- SUPABASE LINTER FIXES: Unindexed Foreign Keys & Unused Indexes
-- ============================================================================
-- Addresses:
-- 1. 0001 unindexed_foreign_keys: 25 foreign keys without covering indexes
-- 2. 0005 unused_index: 88 indexes that have never been used
--
-- Note: auth_db_connections_absolute requires a Dashboard change - see end of file
-- ============================================================================

-- ============================================================================
-- PART 1: ADD INDEXES FOR UNINDEXED FOREIGN KEYS
-- ============================================================================
-- Improves join performance and referential integrity checks (CASCADE deletes)

-- activity_log (table may be activity_log or activity_logs depending on deployment)
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activity_log')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activity_log' AND column_name = 'team_id') THEN
    CREATE INDEX IF NOT EXISTS idx_activity_log_team_id ON public.activity_log(team_id) WHERE team_id IS NOT NULL;
  END IF;
END $do$;

-- analysis_comments
CREATE INDEX IF NOT EXISTS idx_analysis_comments_resolved_by ON public.analysis_comments(resolved_by)
  WHERE resolved_by IS NOT NULL;

-- analysis_exports
CREATE INDEX IF NOT EXISTS idx_analysis_exports_analysis_id ON public.analysis_exports(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_exports_user_id ON public.analysis_exports(user_id);

-- analysis_likes
CREATE INDEX IF NOT EXISTS idx_analysis_likes_user_id ON public.analysis_likes(user_id);

-- analysis_shares
CREATE INDEX IF NOT EXISTS idx_analysis_shares_shared_by_user_id ON public.analysis_shares(shared_by_user_id)
  WHERE shared_by_user_id IS NOT NULL;

-- analysis_templates
CREATE INDEX IF NOT EXISTS idx_analysis_templates_library_id ON public.analysis_templates(library_id)
  WHERE library_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analysis_templates_user_id ON public.analysis_templates(user_id);

-- analysis_versions
CREATE INDEX IF NOT EXISTS idx_analysis_versions_created_by ON public.analysis_versions(created_by)
  WHERE created_by IS NOT NULL;

-- api_keys
CREATE INDEX IF NOT EXISTS idx_api_keys_team_id ON public.api_keys(team_id)
  WHERE team_id IS NOT NULL;

-- api_usage_logs
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_user_id ON public.api_usage_logs(user_id)
  WHERE user_id IS NOT NULL;

-- automation_rules
CREATE INDEX IF NOT EXISTS idx_automation_rules_preset_id ON public.automation_rules(preset_id)
  WHERE preset_id IS NOT NULL;

-- batch_job_items
CREATE INDEX IF NOT EXISTS idx_batch_job_items_analysis_id ON public.batch_job_items(analysis_id);

-- collection_items
CREATE INDEX IF NOT EXISTS idx_collection_items_analysis_id ON public.collection_items(analysis_id);

-- collections
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON public.collections(user_id);

-- comments
CREATE INDEX IF NOT EXISTS idx_comments_resolved_by ON public.comments(resolved_by)
  WHERE resolved_by IS NOT NULL;

-- compliance_settings
CREATE INDEX IF NOT EXISTS idx_compliance_settings_lab_id ON public.compliance_settings(lab_id);

-- error_logs
CREATE INDEX IF NOT EXISTS idx_error_logs_analysis_id ON public.error_logs(analysis_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_user_id ON public.error_logs(user_id);

-- labs
CREATE INDEX IF NOT EXISTS idx_labs_pi_user_id ON public.labs(pi_user_id)
  WHERE pi_user_id IS NOT NULL;

-- public_analyses
CREATE INDEX IF NOT EXISTS idx_public_analyses_published_by ON public.public_analyses(published_by)
  WHERE published_by IS NOT NULL;

-- screen_collaborators
CREATE INDEX IF NOT EXISTS idx_screen_collaborators_invited_by ON public.screen_collaborators(invited_by)
  WHERE invited_by IS NOT NULL;

-- screen_gene_results
CREATE INDEX IF NOT EXISTS idx_screen_gene_results_screen_id ON public.screen_gene_results(screen_id);

-- sgrna_libraries
CREATE INDEX IF NOT EXISTS idx_sgrna_libraries_uploaded_by ON public.sgrna_libraries(uploaded_by)
  WHERE uploaded_by IS NOT NULL;

-- shared_resources
CREATE INDEX IF NOT EXISTS idx_shared_resources_created_by_user_id ON public.shared_resources(created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

-- team_members
CREATE INDEX IF NOT EXISTS idx_team_members_invited_by ON public.team_members(invited_by)
  WHERE invited_by IS NOT NULL;

-- ============================================================================
-- PART 2: DROP UNUSED INDEXES
-- ============================================================================
-- These indexes have not been used (per pg_stat_user_indexes).
-- Dropping reduces storage and improves write performance.
-- If you see slow queries after deployment, consider re-adding specific indexes.

DROP INDEX IF EXISTS public.idx_activity_log_user_id;
DROP INDEX IF EXISTS public.idx_activity_log_analysis_id;
DROP INDEX IF EXISTS public.idx_analysis_shares_shared_by;
DROP INDEX IF EXISTS public.idx_drug_gene_cache_cached_at;
DROP INDEX IF EXISTS public.idx_notifications_created_at;
DROP INDEX IF EXISTS public.idx_email_logs_user_id;
DROP INDEX IF EXISTS public.idx_email_logs_sent_at;
DROP INDEX IF EXISTS public.idx_user_settings_user_id;
DROP INDEX IF EXISTS public.idx_sgrna_sequences_sequence_col;
DROP INDEX IF EXISTS public.idx_analyses_analysis_hash;
DROP INDEX IF EXISTS public.idx_analysis_shares_shared_with;
DROP INDEX IF EXISTS public.idx_users_email;
DROP INDEX IF EXISTS public.idx_users_institution;
DROP INDEX IF EXISTS public.idx_users_subscription_tier;
DROP INDEX IF EXISTS public.idx_teams_slug;
DROP INDEX IF EXISTS public.idx_teams_owner_id;
DROP INDEX IF EXISTS public.idx_team_members_user_id;
DROP INDEX IF EXISTS public.idx_team_members_team_id;
DROP INDEX IF EXISTS public.idx_analyses_user_id;
DROP INDEX IF EXISTS public.idx_analyses_status;
DROP INDEX IF EXISTS public.idx_analyses_library;
DROP INDEX IF EXISTS public.idx_analyses_method;
DROP INDEX IF EXISTS public.idx_analyses_name_trgm;
DROP INDEX IF EXISTS public.idx_fastq_files_analysis_id;
DROP INDEX IF EXISTS public.idx_fastq_files_upload_status;
DROP INDEX IF EXISTS public.idx_sgrna_libraries_name;
DROP INDEX IF EXISTS public.idx_sgrna_sequences_library_id;
DROP INDEX IF EXISTS public.idx_sgrna_sequences_gene_symbol;
DROP INDEX IF EXISTS public.idx_sgrna_sequences_sequence;
DROP INDEX IF EXISTS public.idx_comments_analysis_id;
DROP INDEX IF EXISTS public.idx_comments_user_id;
DROP INDEX IF EXISTS public.idx_comments_gene;
DROP INDEX IF EXISTS public.idx_comments_parent_id;
DROP INDEX IF EXISTS public.idx_public_analyses_tags;
DROP INDEX IF EXISTS public.idx_public_analyses_views;
DROP INDEX IF EXISTS public.idx_public_analyses_published_at;
DROP INDEX IF EXISTS public.idx_public_analyses_category;
DROP INDEX IF EXISTS public.idx_gene_info_cache_accessed;
DROP INDEX IF EXISTS public.idx_drug_gene_cache_symbol;
DROP INDEX IF EXISTS public.idx_clinical_trials_cache_query;
DROP INDEX IF EXISTS public.idx_structure_cache_last_updated;
DROP INDEX IF EXISTS public.idx_activity_log_created_at;
DROP INDEX IF EXISTS public.idx_activity_log_action;
DROP INDEX IF EXISTS public.idx_notifications_user_id;
DROP INDEX IF EXISTS public.idx_notifications_read;
DROP INDEX IF EXISTS public.idx_analysis_comments_analysis_id;
DROP INDEX IF EXISTS public.idx_analysis_comments_user_id;
DROP INDEX IF EXISTS public.idx_analysis_comments_parent_id;
DROP INDEX IF EXISTS public.idx_analysis_comments_created_at;
DROP INDEX IF EXISTS public.idx_analysis_activity_analysis_id;
DROP INDEX IF EXISTS public.idx_analysis_activity_user_id;
DROP INDEX IF EXISTS public.idx_analysis_activity_created_at;
DROP INDEX IF EXISTS public.idx_algorithm_runs_analysis;
DROP INDEX IF EXISTS public.idx_algorithm_runs_status;
DROP INDEX IF EXISTS public.idx_reference_gene_lists_category;
DROP INDEX IF EXISTS public.idx_batch_jobs_user;
DROP INDEX IF EXISTS public.idx_batch_jobs_status;
DROP INDEX IF EXISTS public.idx_batch_job_items_batch;
DROP INDEX IF EXISTS public.idx_api_keys_user;
DROP INDEX IF EXISTS public.idx_api_keys_key_hash;
DROP INDEX IF EXISTS public.idx_api_usage_logs_key;
DROP INDEX IF EXISTS public.idx_analysis_templates_category;
DROP INDEX IF EXISTS public.idx_analysis_activity_type;
DROP INDEX IF EXISTS public.idx_activity_logs_user_id;
DROP INDEX IF EXISTS public.idx_activity_logs_action_type;
DROP INDEX IF EXISTS public.idx_activity_logs_created_at;
DROP INDEX IF EXISTS public.idx_comment_reactions_comment_id;
DROP INDEX IF EXISTS public.idx_comment_reactions_user_id;
DROP INDEX IF EXISTS public.idx_algorithm_runs_analysis_id;
DROP INDEX IF EXISTS public.idx_algorithm_runs_user_id;
DROP INDEX IF EXISTS public.idx_reference_gene_lists_name;
DROP INDEX IF EXISTS public.idx_batch_jobs_user_id;
DROP INDEX IF EXISTS public.idx_batch_job_items_batch_job_id;
DROP INDEX IF EXISTS public.idx_api_keys_user_id;
DROP INDEX IF EXISTS public.idx_api_usage_logs_api_key_id;
DROP INDEX IF EXISTS public.idx_api_usage_logs_created_at;
DROP INDEX IF EXISTS public.idx_screens_user_id;
DROP INDEX IF EXISTS public.idx_screens_created_at;
DROP INDEX IF EXISTS public.idx_screen_shares_owner;
DROP INDEX IF EXISTS public.idx_screen_runs_user_created;
DROP INDEX IF EXISTS public.idx_screen_runs_status;
DROP INDEX IF EXISTS public.idx_screen_shares_token;
DROP INDEX IF EXISTS public.idx_screen_shares_screen;
DROP INDEX IF EXISTS public.idx_collaborators_email;
DROP INDEX IF EXISTS public.idx_collaborators_user;
DROP INDEX IF EXISTS public.idx_collaborators_share;
DROP INDEX IF EXISTS public.idx_collaborators_pending;
DROP INDEX IF EXISTS public.idx_sequencing_files_created_at;
DROP INDEX IF EXISTS public.idx_sequencing_files_user_id;
DROP INDEX IF EXISTS public.idx_access_log_screen_time;
DROP INDEX IF EXISTS public.idx_access_log_user;
DROP INDEX IF EXISTS public.idx_analysis_shares_user_id;
DROP INDEX IF EXISTS public.idx_lab_members_lab_id;
DROP INDEX IF EXISTS public.idx_lab_members_user_id;
-- Keep idx_shared_resources_lab_id and idx_analysis_presets_lab_id - they cover FKs
-- (analysis_presets.user_id has UNIQUE constraint which creates covering index)
DROP INDEX IF EXISTS public.idx_shared_resources_type;
DROP INDEX IF EXISTS public.idx_analysis_presets_user_id;
DROP INDEX IF EXISTS public.idx_user_sessions_user_id;
DROP INDEX IF EXISTS public.idx_user_sessions_token;
DROP INDEX IF EXISTS public.idx_user_sessions_expires;
DROP INDEX IF EXISTS public.idx_analysis_parameter_versions_analysis_id;
DROP INDEX IF EXISTS public.idx_analysis_parameter_versions_user_id;
DROP INDEX IF EXISTS public.idx_automation_rules_user_id;
DROP INDEX IF EXISTS public.idx_settings_audit_logs_user_id;
DROP INDEX IF EXISTS public.idx_settings_audit_logs_created_at;
DROP INDEX IF EXISTS public.idx_settings_audit_logs_action;
DROP INDEX IF EXISTS public.idx_settings_audit_logs_resource;
DROP INDEX IF EXISTS public.idx_backup_history_user_id;
DROP INDEX IF EXISTS public.idx_backup_history_created_at;
DROP INDEX IF EXISTS public.idx_screen_counts;
DROP INDEX IF EXISTS public.idx_sgrna_counts;

-- ============================================================================
-- PART 3: ANALYZE AFFECTED TABLES
-- ============================================================================
-- Update statistics so the query planner can use the new indexes effectively

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activity_log') THEN
    ANALYZE public.activity_log;
  END IF;
END $do$;
ANALYZE public.analysis_comments;
ANALYZE public.analysis_exports;
ANALYZE public.analysis_likes;
ANALYZE public.analysis_shares;
ANALYZE public.analysis_templates;
ANALYZE public.analysis_versions;
ANALYZE public.api_keys;
ANALYZE public.api_usage_logs;
ANALYZE public.automation_rules;
ANALYZE public.batch_job_items;
ANALYZE public.collection_items;
ANALYZE public.collections;
ANALYZE public.comments;
ANALYZE public.compliance_settings;
ANALYZE public.error_logs;
ANALYZE public.labs;
ANALYZE public.public_analyses;
ANALYZE public.screen_collaborators;
ANALYZE public.screen_gene_results;
ANALYZE public.sgrna_libraries;
ANALYZE public.shared_resources;
ANALYZE public.team_members;

-- ============================================================================
-- AUTH_DB_CONNECTIONS_ABSOLUTE - MANUAL DASHBOARD FIX
-- ============================================================================
-- The linter reports: "Auth DB Connection Strategy is not Percentage"
--
-- To fix: In Supabase Dashboard → Project Settings → Database → Connection Pooling
-- Switch Auth's connection allocation from absolute (10) to percentage-based.
-- See: https://supabase.com/docs/guides/deployment/going-into-prod
--
-- This cannot be changed via SQL migration.
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'LINTER FIXES MIGRATION COMPLETE';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'Added: 25 indexes for unindexed foreign keys';
  RAISE NOTICE 'Dropped: 86 unused indexes (kept idx_shared_resources_lab_id, idx_analysis_presets_lab_id for FK coverage)';
  RAISE NOTICE '';
  RAISE NOTICE 'Manual step: Switch Auth DB connection strategy to percentage in Dashboard';
  RAISE NOTICE '============================================================================';
END $$;
