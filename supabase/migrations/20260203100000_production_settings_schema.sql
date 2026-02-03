-- ============================================================================
-- PRODUCTION-GRADE SETTINGS SYSTEM - COMPREHENSIVE SCHEMA
-- ============================================================================
-- This migration adds all tables needed for a complete settings system
-- including analysis defaults, QC thresholds, lab management, and more.

-- ============================================================================
-- ANALYSIS DEFAULTS & PRESETS
-- ============================================================================

-- Analysis defaults per user
CREATE TABLE IF NOT EXISTS analysis_defaults (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Statistical thresholds
  fdr_cutoff DECIMAL DEFAULT 0.05,
  log2_fold_change DECIMAL DEFAULT 1.0,
  p_value_threshold DECIMAL DEFAULT 0.05,
  
  -- Normalization
  normalization_method VARCHAR(50) DEFAULT 'deseq2',
  
  -- Guide RNA design
  default_library VARCHAR(100) DEFAULT 'brunello_v2',
  organism VARCHAR(50) DEFAULT 'human',
  guides_per_gene INTEGER DEFAULT 4,
  gene_annotation VARCHAR(50) DEFAULT 'ensembl_110',
  
  -- Visualization defaults
  chart_type VARCHAR(50) DEFAULT 'volcano',
  color_scheme VARCHAR(50) DEFAULT 'viridis',
  show_gene_labels BOOLEAN DEFAULT true,
  label_top_n INTEGER DEFAULT 20,
  point_size VARCHAR(20) DEFAULT 'medium',
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Analysis presets (saved configurations)
CREATE TABLE IF NOT EXISTS analysis_presets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lab_id UUID REFERENCES labs(id) ON DELETE CASCADE,
  
  name VARCHAR(100) NOT NULL,
  description TEXT,
  settings JSONB NOT NULL,
  is_shared BOOLEAN DEFAULT false,
  is_lab_default BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_presets_user_id ON analysis_presets(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_presets_lab_id ON analysis_presets(lab_id);

-- ============================================================================
-- QUALITY CONTROL SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS qc_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Read quality thresholds
  min_read_depth_per_sample INTEGER DEFAULT 1000000,
  max_low_quality_guides_pct DECIMAL DEFAULT 10.0,
  min_guide_representation INTEGER DEFAULT 100,
  max_gini_coefficient DECIMAL DEFAULT 0.2,
  
  -- Automated flags
  auto_flag_low_quality BOOLEAN DEFAULT true,
  warn_before_analyzing_flagged BOOLEAN DEFAULT true,
  include_qc_report_in_exports BOOLEAN DEFAULT true,
  
  -- Replicate correlation
  min_replicate_correlation DECIMAL DEFAULT 0.7,
  replicate_correlation_action VARCHAR(50) DEFAULT 'warn', -- 'warn', 'block', 'auto_suggest'
  
  -- Control gene checks
  verify_essential_gene_depletion BOOLEAN DEFAULT true,
  expected_essential_gene_lfc DECIMAL DEFAULT -2.0,
  check_nontargeting_distribution BOOLEAN DEFAULT true,
  expected_nt_guide_lfc_range DECIMAL DEFAULT 0.5,
  validate_positive_controls BOOLEAN DEFAULT true,
  
  -- Automated QC reports
  generate_qc_report_always BOOLEAN DEFAULT true,
  include_fastqc_metrics BOOLEAN DEFAULT true,
  flag_outliers_automatically BOOLEAN DEFAULT true,
  compare_to_historical_qc BOOLEAN DEFAULT true,
  qc_report_format VARCHAR(20) DEFAULT 'pdf', -- 'pdf', 'html', 'both'
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- ============================================================================
-- LAB & TEAM MANAGEMENT
-- ============================================================================

-- Labs (research groups)
CREATE TABLE IF NOT EXISTS labs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  pi_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  department VARCHAR(200),
  institution VARCHAR(200),
  lab_website VARCHAR(500),
  logo_url VARCHAR(500),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Lab members
CREATE TABLE IF NOT EXISTS lab_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  role VARCHAR(50) NOT NULL DEFAULT 'member', -- 'admin', 'member', 'viewer', 'guest'
  title VARCHAR(100), -- 'Postdoc', 'PhD Student', 'Research Associate', etc.
  
  joined_at TIMESTAMPTZ DEFAULT now(),
  guest_expires_at TIMESTAMPTZ, -- For guest role only
  last_active_at TIMESTAMPTZ,
  
  UNIQUE(lab_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_members_lab_id ON lab_members(lab_id);
CREATE INDEX IF NOT EXISTS idx_lab_members_user_id ON lab_members(user_id);

-- Shared resources (libraries, presets, etc.)
CREATE TABLE IF NOT EXISTS shared_resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  resource_type VARCHAR(50) NOT NULL, -- 'library', 'preset', 'template'
  resource_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_resources_lab_id ON shared_resources(lab_id);
CREATE INDEX IF NOT EXISTS idx_shared_resources_type ON shared_resources(resource_type);

-- ============================================================================
-- DATA MANAGEMENT SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_management_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Auto-save
  auto_save_enabled BOOLEAN DEFAULT true,
  auto_save_interval_minutes INTEGER DEFAULT 5,
  save_intermediate_results BOOLEAN DEFAULT true,
  create_checkpoint_before_major_ops BOOLEAN DEFAULT true,
  
  -- Data retention
  keep_failed_analyses_days INTEGER DEFAULT 7,
  archive_old_analyses_days INTEGER DEFAULT 90,
  auto_delete_archived_days INTEGER, -- NULL = never
  
  -- Export preferences
  default_export_format VARCHAR(20) DEFAULT 'csv', -- 'csv', 'excel', 'json'
  include_metadata BOOLEAN DEFAULT true,
  include_parameters BOOLEAN DEFAULT true,
  compress_large_files BOOLEAN DEFAULT true,
  compress_large_files_threshold_mb INTEGER DEFAULT 100,
  compression_format VARCHAR(20) DEFAULT 'zip', -- 'zip', 'tar.gz'
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- ============================================================================
-- COLLABORATION SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS collaboration_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Default sharing
  default_sharing_level VARCHAR(50) DEFAULT 'private', -- 'private', 'lab_view', 'lab_edit', 'public_read'
  
  -- Citation preferences
  default_citation_format VARCHAR(20) DEFAULT 'apa', -- 'apa', 'mla', 'chicago', 'nature', 'cell'
  auto_generate_methods_section BOOLEAN DEFAULT true,
  include_all_authors BOOLEAN DEFAULT true,
  include_software_versions BOOLEAN DEFAULT true,
  
  -- Comments & annotations
  allow_comments_on_shared BOOLEAN DEFAULT true,
  notify_on_new_comments BOOLEAN DEFAULT true,
  enable_realtime_collaboration BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- ============================================================================
-- COMPUTE & PERFORMANCE SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS compute_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Analysis priority
  default_queue_priority VARCHAR(20) DEFAULT 'standard', -- 'low', 'standard', 'high', 'express'
  
  -- Resource allocation
  max_concurrent_analyses INTEGER DEFAULT 3,
  memory_allocation_gb INTEGER DEFAULT 8,
  cpu_cores INTEGER DEFAULT 4,
  
  -- Auto-pause
  auto_pause_enabled BOOLEAN DEFAULT true,
  inactivity_timeout_hours INTEGER DEFAULT 2,
  auto_resume BOOLEAN DEFAULT true,
  
  -- Caching & performance
  cache_intermediate_results BOOLEAN DEFAULT true,
  reuse_normalization BOOLEAN DEFAULT true,
  precompute_aggregations BOOLEAN DEFAULT true,
  cache_size_limit_gb INTEGER DEFAULT 5,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- ============================================================================
-- PRIVACY & SECURITY SETTINGS
-- ============================================================================

-- Extended user_settings with privacy options
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notification_position VARCHAR(20) DEFAULT 'top-right';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS theme VARCHAR(20) DEFAULT 'dark';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS display_density VARCHAR(20) DEFAULT 'comfortable';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS color_scheme_viz VARCHAR(50) DEFAULT 'viridis';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS allow_data_for_research BOOLEAN DEFAULT false;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS share_usage_statistics BOOLEAN DEFAULT false;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS gdpr_compliance_mode BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS hipaa_compliance_mode BOOLEAN DEFAULT false;

-- Two-factor authentication settings
CREATE TABLE IF NOT EXISTS two_factor_auth (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  enabled BOOLEAN DEFAULT false,
  method VARCHAR(50) DEFAULT 'authenticator', -- 'authenticator', 'sms', 'email'
  secret TEXT, -- Encrypted TOTP secret
  backup_codes TEXT[], -- Encrypted backup codes
  backup_codes_remaining INTEGER DEFAULT 10,
  
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Active sessions tracking
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  session_token TEXT NOT NULL UNIQUE,
  device_info JSONB, -- {browser, os, device_type}
  ip_address INET,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- ============================================================================
-- REPRODUCIBILITY & VERSIONING
-- ============================================================================

CREATE TABLE IF NOT EXISTS reproducibility_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Versioning
  auto_save_versions BOOLEAN DEFAULT true,
  track_parameter_changes BOOLEAN DEFAULT true,
  enable_rollback BOOLEAN DEFAULT true,
  show_version_diffs BOOLEAN DEFAULT true,
  version_retention VARCHAR(20) DEFAULT 'all', -- 'all', '90_days', 'latest_10'
  auto_version_trigger VARCHAR(50) DEFAULT 'any_parameter_change',
  
  -- Methods generation
  auto_generate_methods BOOLEAN DEFAULT true,
  citation_style VARCHAR(20) DEFAULT 'nature',
  include_software_versions_methods BOOLEAN DEFAULT true,
  include_all_parameters_methods BOOLEAN DEFAULT true,
  include_qc_metrics_methods BOOLEAN DEFAULT true,
  include_statistical_methods BOOLEAN DEFAULT true,
  
  -- Data provenance
  track_data_lineage BOOLEAN DEFAULT true,
  record_all_transformations BOOLEAN DEFAULT true,
  include_environment_details BOOLEAN DEFAULT true,
  log_software_versions BOOLEAN DEFAULT true,
  attach_provenance_to_exports BOOLEAN DEFAULT true,
  provenance_format VARCHAR(20) DEFAULT 'w3c_prov',
  
  -- Code export
  default_code_export_format VARCHAR(20) DEFAULT 'python', -- 'python', 'r', 'jupyter'
  include_dependencies BOOLEAN DEFAULT true,
  generate_docker_container BOOLEAN DEFAULT false,
  create_jupyter_notebook BOOLEAN DEFAULT false,
  include_sample_data BOOLEAN DEFAULT false,
  
  -- DOI generation
  enable_doi_generation BOOLEAN DEFAULT false,
  doi_provider VARCHAR(20) DEFAULT 'zenodo', -- 'zenodo', 'figshare', 'dryad'
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Analysis versions (track changes over time)
CREATE TABLE IF NOT EXISTS analysis_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  version_number INTEGER NOT NULL,
  parameters JSONB NOT NULL,
  results JSONB,
  changes_summary TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(analysis_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_analysis_versions_analysis_id ON analysis_versions(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_versions_user_id ON analysis_versions(user_id);

-- ============================================================================
-- BATCH OPERATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS batch_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Batch processing
  enable_batch_mode BOOLEAN DEFAULT true,
  max_concurrent_batch_jobs INTEGER DEFAULT 10,
  batch_priority VARCHAR(20) DEFAULT 'standard',
  
  -- Scheduling
  allow_scheduled_analyses BOOLEAN DEFAULT false,
  queue_during_off_peak BOOLEAN DEFAULT false,
  off_peak_start_hour INTEGER DEFAULT 22, -- 10 PM
  off_peak_end_hour INTEGER DEFAULT 6, -- 6 AM
  notify_on_batch_complete BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Automation rules
CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  name VARCHAR(200) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  file_pattern VARCHAR(500) NOT NULL, -- e.g., *_T18_*.fastq.gz
  preset_id UUID REFERENCES analysis_presets(id) ON DELETE SET NULL,
  notify_on_complete BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON automation_rules(user_id);

-- ============================================================================
-- COMPLIANCE & AUDIT
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lab_id UUID REFERENCES labs(id) ON DELETE CASCADE,
  
  -- Audit logging
  enable_comprehensive_audit_logs BOOLEAN DEFAULT false,
  audit_retention_years INTEGER DEFAULT 7,
  audit_detail_level VARCHAR(20) DEFAULT 'standard', -- 'minimal', 'standard', 'verbose'
  
  -- Compliance modes
  glp_mode BOOLEAN DEFAULT false, -- Good Laboratory Practice
  hipaa_mode BOOLEAN DEFAULT false,
  cfr21_part11_mode BOOLEAN DEFAULT false, -- FDA Electronic Records
  gxp_mode BOOLEAN DEFAULT false, -- Good Practice Quality Guidelines
  
  -- Electronic signatures
  require_electronic_signatures BOOLEAN DEFAULT false,
  enable_change_control BOOLEAN DEFAULT false,
  require_audit_trail BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  details JSONB,
  
  ip_address INET,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- ============================================================================
-- BACKUP & RECOVERY SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS backup_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Automatic backups
  enable_auto_backups BOOLEAN DEFAULT true,
  backup_frequency VARCHAR(20) DEFAULT 'daily', -- 'daily', 'weekly', 'monthly'
  backup_time_hour INTEGER DEFAULT 2, -- 2 AM
  backup_retention_days INTEGER DEFAULT 30,
  
  -- Secondary backup location
  secondary_backup_enabled BOOLEAN DEFAULT false,
  secondary_backup_provider VARCHAR(50), -- 'aws_s3', 'google_cloud', 'azure_blob', 'custom'
  secondary_backup_config JSONB, -- Encrypted connection details
  
  -- Recovery options
  point_in_time_recovery_days INTEGER DEFAULT 7,
  enable_one_click_restore BOOLEAN DEFAULT true,
  maintain_deleted_file_recovery BOOLEAN DEFAULT true,
  deleted_file_recovery_window_days INTEGER DEFAULT 30,
  
  last_backup_at TIMESTAMPTZ,
  next_backup_scheduled_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Backup history
CREATE TABLE IF NOT EXISTS backup_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  backup_type VARCHAR(50) NOT NULL, -- 'automatic', 'manual', 'pre_migration'
  size_bytes BIGINT,
  duration_seconds INTEGER,
  status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'partial'
  error_message TEXT,
  
  storage_location TEXT,
  backup_id TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_history_user_id ON backup_history(user_id);
CREATE INDEX IF NOT EXISTS idx_backup_history_created_at ON backup_history(created_at DESC);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE analysis_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE labs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_management_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE compute_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE two_factor_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reproducibility_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_history ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES (Users can access their own data)
-- ============================================================================

-- Analysis defaults
CREATE POLICY "Users can view own analysis defaults" ON analysis_defaults FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own analysis defaults" ON analysis_defaults FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own analysis defaults" ON analysis_defaults FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Analysis presets
CREATE POLICY "Users can view own presets" ON analysis_presets FOR SELECT USING (auth.uid() = user_id OR is_shared = true);
CREATE POLICY "Users can update own presets" ON analysis_presets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own presets" ON analysis_presets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own presets" ON analysis_presets FOR DELETE USING (auth.uid() = user_id);

-- QC settings
CREATE POLICY "Users can view own qc settings" ON qc_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own qc settings" ON qc_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own qc settings" ON qc_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Labs (members can view their labs)
CREATE POLICY "Lab members can view lab" ON labs FOR SELECT 
  USING (EXISTS (SELECT 1 FROM lab_members WHERE lab_members.lab_id = labs.id AND lab_members.user_id = auth.uid()));
CREATE POLICY "Lab admins can update lab" ON labs FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM lab_members WHERE lab_members.lab_id = labs.id AND lab_members.user_id = auth.uid() AND lab_members.role = 'admin'));
CREATE POLICY "Users can create labs" ON labs FOR INSERT WITH CHECK (pi_user_id = auth.uid());

-- Lab members
CREATE POLICY "Lab members can view members" ON lab_members FOR SELECT 
  USING (lab_id IN (SELECT lab_id FROM lab_members WHERE user_id = auth.uid()));
CREATE POLICY "Lab admins can manage members" ON lab_members FOR ALL 
  USING (lab_id IN (SELECT lab_id FROM lab_members WHERE user_id = auth.uid() AND role = 'admin'));

-- Other settings tables (standard pattern)
CREATE POLICY "Users can view own data management settings" ON data_management_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own data management settings" ON data_management_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own data management settings" ON data_management_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own collaboration settings" ON collaboration_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own collaboration settings" ON collaboration_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own collaboration settings" ON collaboration_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own compute settings" ON compute_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own compute settings" ON compute_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own compute settings" ON compute_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own 2FA settings" ON two_factor_auth FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own 2FA settings" ON two_factor_auth FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own 2FA settings" ON two_factor_auth FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own sessions" ON user_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON user_sessions FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own reproducibility settings" ON reproducibility_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own reproducibility settings" ON reproducibility_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own reproducibility settings" ON reproducibility_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own analysis versions" ON analysis_versions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service can insert analysis versions" ON analysis_versions FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can view own batch settings" ON batch_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own batch settings" ON batch_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own batch settings" ON batch_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own automation rules" ON automation_rules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own automation rules" ON automation_rules FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own compliance settings" ON compliance_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own compliance settings" ON compliance_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own compliance settings" ON compliance_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own audit logs" ON audit_logs FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own backup settings" ON backup_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own backup settings" ON backup_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own backup settings" ON backup_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own backup history" ON backup_history FOR SELECT USING (auth.uid() = user_id);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp (reuse existing function)
-- CREATE OR REPLACE FUNCTION update_updated_at_column() is already created

-- Add triggers for all tables with updated_at
CREATE TRIGGER update_analysis_defaults_updated_at BEFORE UPDATE ON analysis_defaults 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_analysis_presets_updated_at BEFORE UPDATE ON analysis_presets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_qc_settings_updated_at BEFORE UPDATE ON qc_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_labs_updated_at BEFORE UPDATE ON labs 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_data_management_settings_updated_at BEFORE UPDATE ON data_management_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_collaboration_settings_updated_at BEFORE UPDATE ON collaboration_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_compute_settings_updated_at BEFORE UPDATE ON compute_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reproducibility_settings_updated_at BEFORE UPDATE ON reproducibility_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_batch_settings_updated_at BEFORE UPDATE ON batch_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_automation_rules_updated_at BEFORE UPDATE ON automation_rules 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_compliance_settings_updated_at BEFORE UPDATE ON compliance_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_backup_settings_updated_at BEFORE UPDATE ON backup_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT ALL ON analysis_defaults TO authenticated;
GRANT ALL ON analysis_presets TO authenticated;
GRANT ALL ON qc_settings TO authenticated;
GRANT ALL ON labs TO authenticated;
GRANT ALL ON lab_members TO authenticated;
GRANT ALL ON shared_resources TO authenticated;
GRANT ALL ON data_management_settings TO authenticated;
GRANT ALL ON collaboration_settings TO authenticated;
GRANT ALL ON compute_settings TO authenticated;
GRANT ALL ON two_factor_auth TO authenticated;
GRANT ALL ON user_sessions TO authenticated;
GRANT ALL ON reproducibility_settings TO authenticated;
GRANT ALL ON analysis_versions TO authenticated;
GRANT ALL ON batch_settings TO authenticated;
GRANT ALL ON automation_rules TO authenticated;
GRANT ALL ON compliance_settings TO authenticated;
GRANT ALL ON audit_logs TO authenticated;
GRANT ALL ON backup_settings TO authenticated;
GRANT ALL ON backup_history TO authenticated;

-- ============================================================================
-- INSERT DEFAULT SETTINGS FOR EXISTING USERS
-- ============================================================================

-- Insert default analysis defaults for all existing users
INSERT INTO analysis_defaults (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM analysis_defaults)
ON CONFLICT (user_id) DO NOTHING;

-- Insert default QC settings for all existing users
INSERT INTO qc_settings (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM qc_settings)
ON CONFLICT (user_id) DO NOTHING;

-- Insert default data management settings for all existing users
INSERT INTO data_management_settings (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM data_management_settings)
ON CONFLICT (user_id) DO NOTHING;

-- Insert default collaboration settings for all existing users
INSERT INTO collaboration_settings (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM collaboration_settings)
ON CONFLICT (user_id) DO NOTHING;

-- Insert default compute settings for all existing users
INSERT INTO compute_settings (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM compute_settings)
ON CONFLICT (user_id) DO NOTHING;

-- Insert default reproducibility settings for all existing users
INSERT INTO reproducibility_settings (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM reproducibility_settings)
ON CONFLICT (user_id) DO NOTHING;

-- Insert default batch settings for all existing users
INSERT INTO batch_settings (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM batch_settings)
ON CONFLICT (user_id) DO NOTHING;

-- Insert default compliance settings for all existing users
INSERT INTO compliance_settings (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM compliance_settings)
ON CONFLICT (user_id) DO NOTHING;

-- Insert default backup settings for all existing users
INSERT INTO backup_settings (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM backup_settings)
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE analysis_defaults IS 'User-specific default analysis parameters and visualization preferences';
COMMENT ON TABLE analysis_presets IS 'Saved analysis configurations that can be reused and shared';
COMMENT ON TABLE qc_settings IS 'Quality control thresholds and automated check settings';
COMMENT ON TABLE labs IS 'Research groups and lab organizations';
COMMENT ON TABLE lab_members IS 'Lab membership with roles and permissions';
COMMENT ON TABLE data_management_settings IS 'Auto-save, retention, and export preferences';
COMMENT ON TABLE collaboration_settings IS 'Sharing, citation, and collaboration preferences';
COMMENT ON TABLE compute_settings IS 'Resource allocation and caching preferences';
COMMENT ON TABLE two_factor_auth IS 'Two-factor authentication configuration';
COMMENT ON TABLE user_sessions IS 'Active user sessions for security monitoring';
COMMENT ON TABLE reproducibility_settings IS 'Versioning, methods generation, and provenance tracking';
COMMENT ON TABLE analysis_versions IS 'Version history of analysis parameter changes';
COMMENT ON TABLE batch_settings IS 'Batch processing and scheduling preferences';
COMMENT ON TABLE automation_rules IS 'Rules for automatic analysis triggering';
COMMENT ON TABLE compliance_settings IS 'GLP, HIPAA, and regulatory compliance settings';
COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail for all user actions';
COMMENT ON TABLE backup_settings IS 'Backup frequency and recovery preferences';
COMMENT ON TABLE backup_history IS 'History of backup operations';
