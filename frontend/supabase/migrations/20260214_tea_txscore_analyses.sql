-- Migration: TEA and TxScore Analyses Tables
-- Created: 2026-02-14
-- Purpose: Add support for Therapeutic Editability Atlas and Therapeutic Translation Platform analyses

-- ============================================================================
-- TEA Analyses Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS tea_analyses (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sequence TEXT NOT NULL,
  sequence_length INTEGER NOT NULL,
  sequence_source TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'fasta', 'genbank', 'vcf', 'clinvar', 'dbsnp'
  variant_id TEXT, -- ClinVar or dbSNP ID if applicable
  status TEXT NOT NULL DEFAULT 'created', -- 'created', 'running', 'complete', 'failed'
  progress INTEGER DEFAULT 0,
  current_step TEXT DEFAULT 'Initializing',
  
  -- Analysis parameters
  parameters JSONB DEFAULT '{}'::jsonb,
  
  -- Results
  results JSONB,
  edit_score INTEGER, -- 0-100
  base_editor_feasible BOOLEAN,
  prime_editor_feasible BOOLEAN,
  
  -- Metadata
  error_message TEXT,
  file_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes for tea_analyses
CREATE INDEX IF NOT EXISTS idx_tea_analyses_user_id ON tea_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_status ON tea_analyses(status);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_created_at ON tea_analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tea_analyses_user_status ON tea_analyses(user_id, status);

-- RLS for tea_analyses
ALTER TABLE tea_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own TEA analyses"
  ON tea_analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own TEA analyses"
  ON tea_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own TEA analyses"
  ON tea_analyses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own TEA analyses"
  ON tea_analyses FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- TxScore Analyses Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS txscore_analyses (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gene_list TEXT[] NOT NULL,
  gene_count INTEGER NOT NULL,
  gene_source TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'csv', 'tsv', 'txt', 'xlsx', 'screen_import'
  source_analysis_id TEXT, -- Reference to CRISPR screen analysis if imported
  status TEXT NOT NULL DEFAULT 'created',
  progress INTEGER DEFAULT 0,
  current_step TEXT DEFAULT 'Initializing',
  
  -- Analysis parameters
  parameters JSONB DEFAULT '{}'::jsonb,
  filters JSONB DEFAULT '{}'::jsonb,
  
  -- Results
  results JSONB,
  top_target TEXT, -- Top-ranked gene symbol
  average_tvs NUMERIC(5,2), -- Average Therapeutic Viability Score
  
  -- Metadata
  error_message TEXT,
  file_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes for txscore_analyses
CREATE INDEX IF NOT EXISTS idx_txscore_analyses_user_id ON txscore_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_txscore_analyses_status ON txscore_analyses(status);
CREATE INDEX IF NOT EXISTS idx_txscore_analyses_created_at ON txscore_analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txscore_analyses_user_status ON txscore_analyses(user_id, status);
CREATE INDEX IF NOT EXISTS idx_txscore_analyses_source ON txscore_analyses(source_analysis_id) WHERE source_analysis_id IS NOT NULL;

-- RLS for txscore_analyses
ALTER TABLE txscore_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own TxScore analyses"
  ON txscore_analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own TxScore analyses"
  ON txscore_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own TxScore analyses"
  ON txscore_analyses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own TxScore analyses"
  ON txscore_analyses FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Update Triggers
-- ============================================================================

-- TEA updated_at trigger
CREATE OR REPLACE FUNCTION update_tea_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  IF NEW.status = 'complete' AND OLD.status != 'complete' THEN
    NEW.completed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tea_analyses_updated_at ON tea_analyses;
CREATE TRIGGER tea_analyses_updated_at
  BEFORE UPDATE ON tea_analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_tea_analyses_updated_at();

-- TxScore updated_at trigger
CREATE OR REPLACE FUNCTION update_txscore_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  IF NEW.status = 'complete' AND OLD.status != 'complete' THEN
    NEW.completed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS txscore_analyses_updated_at ON txscore_analyses;
CREATE TRIGGER txscore_analyses_updated_at
  BEFORE UPDATE ON txscore_analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_txscore_analyses_updated_at();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Generate unique TEA analysis ID
CREATE OR REPLACE FUNCTION generate_tea_id()
RETURNS TEXT AS $$
DECLARE
  new_id TEXT;
  exists BOOLEAN;
BEGIN
  LOOP
    -- Format: TEA-2026-XXXX (using random 4-char alphanumeric)
    new_id := 'TEA-' || 
              TO_CHAR(NOW(), 'YYYY') || '-' ||
              UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 4));
    
    -- Check if ID exists
    SELECT EXISTS(SELECT 1 FROM tea_analyses WHERE id = new_id) INTO exists;
    EXIT WHEN NOT exists;
  END LOOP;
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- Generate unique TxScore analysis ID
CREATE OR REPLACE FUNCTION generate_txscore_id()
RETURNS TEXT AS $$
DECLARE
  new_id TEXT;
  exists BOOLEAN;
BEGIN
  LOOP
    -- Format: TVS-2026-XXXX (using random 4-char alphanumeric)
    new_id := 'TVS-' || 
              TO_CHAR(NOW(), 'YYYY') || '-' ||
              UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 4));
    
    -- Check if ID exists
    SELECT EXISTS(SELECT 1 FROM txscore_analyses WHERE id = new_id) INTO exists;
    EXIT WHEN NOT exists;
  END LOOP;
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE tea_analyses IS 'Therapeutic Editability Atlas analyses - base/prime editor efficiency predictions';
COMMENT ON TABLE txscore_analyses IS 'Therapeutic Translation Platform analyses - gene target prioritization using TVS';

COMMENT ON COLUMN tea_analyses.edit_score IS 'Composite EDIT score (0-100) - higher is more editable';
COMMENT ON COLUMN txscore_analyses.average_tvs IS 'Average Therapeutic Viability Score across gene list';
