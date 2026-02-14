-- ============================================================================
-- TxScore (Therapeutic Translation Score) Database Schema
-- ============================================================================
-- Run this script in your Supabase SQL Editor
-- Last updated: February 14, 2026
-- ============================================================================

-- Drop existing table if recreating
-- DROP TABLE IF EXISTS txscore_analyses CASCADE;

-- Create txscore_analyses table
CREATE TABLE IF NOT EXISTS txscore_analyses (
  -- Primary identifiers
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Analysis metadata
  name TEXT NOT NULL,
  file_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  -- Gene list information
  gene_list TEXT[] NOT NULL,
  gene_count INTEGER NOT NULL,
  gene_source TEXT CHECK (gene_source IN ('manual', 'csv', 'tsv', 'txt', 'xlsx', 'screen_import')),
  source_analysis_id TEXT, -- Reference to CRISPR screen if imported
  
  -- Analysis parameters
  parameters JSONB DEFAULT '{}'::jsonb,
  filters JSONB DEFAULT '{}'::jsonb,
  
  -- Analysis results
  results JSONB,
  average_tvs NUMERIC,
  top_target TEXT,
  targetable_count INTEGER, -- Count of genes with TVS > 50
  
  -- Status tracking
  status TEXT DEFAULT 'created' CHECK (status IN ('created', 'running', 'complete', 'failed', 'cancelled')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_step TEXT,
  error_message TEXT,
  
  -- Constraints
  CONSTRAINT txscore_analyses_gene_count_check CHECK (gene_count > 0),
  CONSTRAINT txscore_analyses_gene_list_not_empty CHECK (array_length(gene_list, 1) > 0)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_txscore_analyses_user_id ON txscore_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_txscore_analyses_status ON txscore_analyses(status);
CREATE INDEX IF NOT EXISTS idx_txscore_analyses_created_at ON txscore_analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txscore_analyses_source ON txscore_analyses(source_analysis_id) WHERE source_analysis_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_txscore_analyses_gene_list ON txscore_analyses USING GIN (gene_list);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_txscore_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS txscore_analyses_updated_at ON txscore_analyses;
CREATE TRIGGER txscore_analyses_updated_at
  BEFORE UPDATE ON txscore_analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_txscore_analyses_updated_at();

-- Set completed_at when status changes to complete
CREATE OR REPLACE FUNCTION set_txscore_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'complete' AND OLD.status != 'complete' THEN
    NEW.completed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS txscore_set_completed_at ON txscore_analyses;
CREATE TRIGGER txscore_set_completed_at
  BEFORE UPDATE ON txscore_analyses
  FOR EACH ROW
  EXECUTE FUNCTION set_txscore_completed_at();

-- Create function to generate TxScore IDs
CREATE OR REPLACE FUNCTION generate_txscore_id()
RETURNS TEXT AS $$
DECLARE
  new_id TEXT;
  timestamp_part TEXT;
  random_part TEXT;
BEGIN
  timestamp_part := TO_CHAR(EXTRACT(EPOCH FROM NOW()), 'FM999999999999');
  random_part := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
  new_id := 'TXS-' || timestamp_part || '-' || random_part;
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security
ALTER TABLE txscore_analyses ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DROP POLICY IF EXISTS "Users can view their own TxScore analyses" ON txscore_analyses;
CREATE POLICY "Users can view their own TxScore analyses"
  ON txscore_analyses FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own TxScore analyses" ON txscore_analyses;
CREATE POLICY "Users can insert their own TxScore analyses"
  ON txscore_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own TxScore analyses" ON txscore_analyses;
CREATE POLICY "Users can update their own TxScore analyses"
  ON txscore_analyses FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own TxScore analyses" ON txscore_analyses;
CREATE POLICY "Users can delete their own TxScore analyses"
  ON txscore_analyses FOR DELETE
  USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON txscore_analyses TO authenticated;
GRANT SELECT ON txscore_analyses TO anon;

-- Create view for analysis summaries
CREATE OR REPLACE VIEW txscore_analyses_summary AS
SELECT 
  id,
  user_id,
  name,
  gene_count,
  gene_source,
  average_tvs,
  top_target,
  targetable_count,
  status,
  progress,
  created_at,
  completed_at
FROM txscore_analyses;

GRANT SELECT ON txscore_analyses_summary TO authenticated;

-- Create helper function to search genes in analyses
CREATE OR REPLACE FUNCTION search_txscore_by_gene(search_gene TEXT)
RETURNS SETOF txscore_analyses AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM txscore_analyses
  WHERE search_gene = ANY(gene_list)
    AND user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Sample data insertion (for testing)
-- ============================================================================
-- Uncomment to insert test data
/*
INSERT INTO txscore_analyses (
  id,
  user_id,
  name,
  gene_list,
  gene_count,
  gene_source,
  status,
  average_tvs,
  top_target,
  targetable_count
) VALUES (
  'TXS-TEST-001',
  auth.uid(), -- Replace with actual user ID
  'Test Gene List',
  ARRAY['TP53', 'BRCA1', 'EGFR', 'KRAS', 'MYC'],
  5,
  'manual',
  'complete',
  72.5,
  'TP53',
  4
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
WHERE table_name = 'txscore_analyses'
ORDER BY ordinal_position;

-- Test ID generation
SELECT generate_txscore_id();

-- Test gene search function (after inserting sample data)
-- SELECT * FROM search_txscore_by_gene('TP53');

-- ============================================================================
-- Analytics Views (Optional - for dashboards)
-- ============================================================================

-- View: Top genes across all analyses
CREATE OR REPLACE VIEW txscore_top_genes AS
SELECT 
  unnest(gene_list) AS gene_symbol,
  COUNT(*) AS analysis_count,
  AVG((results->>'average_tvs')::numeric) AS avg_tvs
FROM txscore_analyses
WHERE status = 'complete'
  AND results IS NOT NULL
GROUP BY gene_symbol
ORDER BY analysis_count DESC, avg_tvs DESC
LIMIT 100;

GRANT SELECT ON txscore_top_genes TO authenticated;

-- View: User analysis statistics
CREATE OR REPLACE VIEW txscore_user_stats AS
SELECT 
  user_id,
  COUNT(*) AS total_analyses,
  COUNT(*) FILTER (WHERE status = 'complete') AS completed_analyses,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_analyses,
  SUM(gene_count) AS total_genes_analyzed,
  AVG(average_tvs) FILTER (WHERE status = 'complete') AS avg_tvs_score
FROM txscore_analyses
GROUP BY user_id;

GRANT SELECT ON txscore_user_stats TO authenticated;

-- ============================================================================
-- Success!
-- ============================================================================
-- TxScore analyses table created successfully
-- Remember to:
-- 1. Test RLS policies with actual users
-- 2. Adjust indexes based on query patterns
-- 3. Monitor table size and performance
-- 4. Set up backups and archival policies
-- 5. Consider partitioning for large datasets
-- ============================================================================
