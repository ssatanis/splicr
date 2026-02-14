-- ============================================================================
-- TEA (Therapeutic Editing Assessment) Database Schema
-- ============================================================================
-- Run this script in your Supabase SQL Editor
-- Last updated: February 14, 2026
-- ============================================================================

-- Drop existing table if recreating
-- DROP TABLE IF EXISTS tea_analyses CASCADE;

-- Create tea_analyses table
CREATE TABLE IF NOT EXISTS tea_analyses (
  -- Primary identifiers
  id TEXT PRIMARY KEY,
  report_id TEXT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Analysis metadata
  name TEXT,
  file_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  -- Sequence information
  sequence TEXT NOT NULL,
  sequence_length INTEGER NOT NULL,
  sequence_source TEXT CHECK (sequence_source IN ('manual', 'fasta', 'genbank', 'vcf', 'clinvar', 'dbsnp')),
  sequence_context JSONB,
  
  -- Variant/gene information
  variant_id TEXT,
  gene_symbol TEXT,
  chromosome TEXT,
  position INTEGER,
  ref_allele TEXT,
  alt_allele TEXT,
  hgvs_notation TEXT,
  
  -- Analysis parameters
  tissue TEXT,
  genome_build TEXT DEFAULT 'hg38',
  patient_vcf_url TEXT,
  parameters JSONB DEFAULT '{}'::jsonb,
  
  -- Analysis results - component scores
  edit_score NUMERIC,
  base_editability NUMERIC,
  prime_editability NUMERIC,
  therapeutic_window NUMERIC,
  cell_type_specificity NUMERIC,
  off_target_safety NUMERIC,
  deliverability NUMERIC,
  
  -- Analysis results - predictions
  optimal_strategy TEXT CHECK (optimal_strategy IN ('base_editing', 'prime_editing', 'nuclease', 'other')),
  optimal_editor TEXT,
  predicted_efficiency NUMERIC,
  off_target_count INTEGER,
  
  -- Full results and metadata
  results JSONB,
  external_links JSONB,
  explanations JSONB,
  related_papers JSONB,
  chromatin_data JSONB,
  
  -- Status tracking
  status TEXT DEFAULT 'created' CHECK (status IN ('created', 'running', 'complete', 'failed', 'cancelled')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_step TEXT,
  error_message TEXT,
  
  -- Constraints
  CONSTRAINT tea_analyses_sequence_length_check CHECK (sequence_length > 0),
  CONSTRAINT tea_analyses_position_check CHECK (position IS NULL OR position > 0)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tea_analyses_user_id ON tea_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_report_id ON tea_analyses(report_id);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_status ON tea_analyses(status);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_gene_symbol ON tea_analyses(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_created_at ON tea_analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_variant_id ON tea_analyses(variant_id) WHERE variant_id IS NOT NULL;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_tea_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tea_analyses_updated_at ON tea_analyses;
CREATE TRIGGER tea_analyses_updated_at
  BEFORE UPDATE ON tea_analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_tea_analyses_updated_at();

-- Create function to generate TEA report IDs
CREATE OR REPLACE FUNCTION generate_tea_id()
RETURNS TEXT AS $$
DECLARE
  new_id TEXT;
  timestamp_part TEXT;
  random_part TEXT;
BEGIN
  timestamp_part := TO_CHAR(EXTRACT(EPOCH FROM NOW()), 'FM999999999999');
  random_part := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
  new_id := 'TEA-' || timestamp_part || '-' || random_part;
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

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
  name,
  gene_symbol,
  tissue,
  edit_score,
  optimal_strategy,
  optimal_editor,
  status,
  progress,
  created_at,
  completed_at
FROM tea_analyses;

GRANT SELECT ON tea_analyses_summary TO authenticated;

-- ============================================================================
-- Sample data insertion (for testing)
-- ============================================================================
-- Uncomment to insert test data
/*
INSERT INTO tea_analyses (
  id,
  report_id,
  user_id,
  name,
  sequence,
  sequence_length,
  sequence_source,
  gene_symbol,
  tissue,
  status
) VALUES (
  'TEA-TEST-001',
  'TEA-1708041600-ABC12345',
  auth.uid(), -- Replace with actual user ID
  'Test BRCA1 Analysis',
  'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
  44,
  'manual',
  'BRCA1',
  'liver',
  'complete'
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

-- Test ID generation
SELECT generate_tea_id();

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
