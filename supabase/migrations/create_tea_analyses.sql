-- ============================================================================
-- TEA (Therapeutic Editing Assessment) Database Schema
-- ============================================================================
-- Run this script in your Supabase SQL Editor
-- Last updated: February 14, 2026
-- ============================================================================

-- Drop existing table if recreating
-- DROP TABLE IF EXISTS tea_analyses CASCADE;

-- Create tea_analyses table (matches existing schema)
CREATE TABLE IF NOT EXISTS tea_analyses (
  -- Primary identifiers
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id TEXT UNIQUE,
  user_id UUID REFERENCES auth.users(id),
  
  -- Variant/gene information
  variant_id TEXT NOT NULL,
  gene_symbol TEXT,
  gene_id TEXT,
  
  -- Analysis parameters
  tissue TEXT,
  patient_vcf_path TEXT,
  
  -- Sequence information
  target_sequence TEXT,
  sequence_context JSONB,
  
  -- Analysis results - component scores
  edit_score DOUBLE PRECISION CHECK (edit_score >= 0 AND edit_score <= 100),
  therapeutic_window DOUBLE PRECISION,
  deliverability_score DOUBLE PRECISION CHECK (deliverability_score >= 0 AND deliverability_score <= 1),
  
  -- Analysis results - predictions
  optimal_strategy TEXT CHECK (optimal_strategy IN ('base_editing', 'prime_editing', 'nuclease')),
  recommended_editor TEXT,
  predicted_efficiency DOUBLE PRECISION CHECK (predicted_efficiency >= 0 AND predicted_efficiency <= 100),
  confidence_interval JSONB,
  
  -- Off-target information
  off_target_count INTEGER DEFAULT 0,
  high_risk_off_targets INTEGER DEFAULT 0,
  
  -- Full results and metadata
  results JSONB,
  external_links JSONB,
  explanations JSONB,
  
  -- Status tracking
  status TEXT DEFAULT 'complete' CHECK (status IN ('complete', 'failed')),
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tea_analyses_user_id ON tea_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_report_id ON tea_analyses(report_id);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_status ON tea_analyses(status);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_gene_symbol ON tea_analyses(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_created_at ON tea_analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_variant_id ON tea_analyses(variant_id) WHERE variant_id IS NOT NULL;

-- Remove update trigger functions (not needed for existing schema)
-- Updated_at is not in existing schema

-- Enable Row Level Security
ALTER TABLE tea_analyses ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DROP POLICY IF EXISTS "Users can view their own TEA analyses" ON tea_analyses;
CREATE POLICY "Users can view their own TEA analyses"
  ON tea_analyses FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own TEA analyses" ON tea_analyses;
CREATE POLICY "Users can insert their own TEA analyses"
  ON tea_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own TEA analyses" ON tea_analyses;
CREATE POLICY "Users can update their own TEA analyses"
  ON tea_analyses FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own TEA analyses" ON tea_analyses;
CREATE POLICY "Users can delete their own TEA analyses"
  ON tea_analyses FOR DELETE
  USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON tea_analyses TO authenticated;
GRANT SELECT ON tea_analyses TO anon;

-- Create view for analysis summaries
CREATE OR REPLACE VIEW tea_analyses_summary AS
SELECT 
  id,
  report_id,
  user_id,
  variant_id,
  gene_symbol,
  tissue,
  edit_score,
  optimal_strategy,
  recommended_editor AS optimal_editor,
  status,
  created_at
FROM tea_analyses;

GRANT SELECT ON tea_analyses_summary TO authenticated;

-- ============================================================================
-- Sample data insertion (for testing)
-- ============================================================================
-- Uncomment to insert test data
/*
INSERT INTO tea_analyses (
  report_id,
  user_id,
  variant_id,
  gene_symbol,
  tissue,
  status,
  edit_score,
  optimal_strategy,
  recommended_editor
) VALUES (
  'TEA-1708041600-ABC12345',
  auth.uid(), -- Replace with actual user ID
  'rs123456',
  'BRCA1',
  'liver',
  'complete',
  85.5,
  'base_editing',
  'ABE8e'
);
*/

-- ============================================================================
-- Verification
-- ============================================================================
-- Check table structure
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'tea_analyses'
ORDER BY ordinal_position;

-- ============================================================================
-- Success!
-- ============================================================================
-- TEA analyses table created successfully
-- Remember to:
-- 1. Test RLS policies with actual users
-- 2. Adjust indexes based on query patterns
-- 3. Monitor table size and performance
-- 4. Set up backups and archival policies
-- ============================================================================
