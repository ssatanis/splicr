-- Analyses table: stores CRISPR screen analysis jobs and their results
-- This is the core table for tracking analysis progress and storing results

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  library_type TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'mageck',
  file_names TEXT[] NOT NULL DEFAULT '{}',
  parameters JSONB DEFAULT '{}',
  sample_labels JSONB,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'complete', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_step TEXT,

  -- Results
  results JSONB,
  logs JSONB,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC);

-- Enable Row Level Security
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own analyses
CREATE POLICY "Users can view own analyses" ON analyses
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can insert their own analyses
CREATE POLICY "Users can create own analyses" ON analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own analyses
CREATE POLICY "Users can update own analyses" ON analyses
  FOR UPDATE USING (auth.uid() = user_id);

-- Policy: Users can delete their own analyses
CREATE POLICY "Users can delete own analyses" ON analyses
  FOR DELETE USING (auth.uid() = user_id);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS trigger_analyses_updated_at ON analyses;
CREATE TRIGGER trigger_analyses_updated_at
  BEFORE UPDATE ON analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_analyses_updated_at();

-- Enable realtime for analyses table (for live progress updates)
ALTER PUBLICATION supabase_realtime ADD TABLE analyses;

COMMENT ON TABLE analyses IS 'CRISPR screen analysis jobs with real-time progress tracking';
COMMENT ON COLUMN analyses.current_step IS 'Current processing step (e.g., "Parsing FASTQ", "Running MAGeCK")';
COMMENT ON COLUMN analyses.progress IS 'Progress percentage (0-100)';
COMMENT ON COLUMN analyses.results IS 'JSON containing analysis results, plots, and statistics';
