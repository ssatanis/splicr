-- Add current_step to analyses if missing (for real-time progress display).
-- Run this in Supabase SQL Editor if your analyses table was created without this column.

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS current_step TEXT;

COMMENT ON COLUMN analyses.current_step IS 'Current processing step (e.g., Parsing FASTQ, Running MAGeCK)';
