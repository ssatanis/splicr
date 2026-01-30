-- Add file_names and other missing columns to analyses so the create API works.
-- Run this in Supabase Dashboard → SQL Editor if you get "Could not find the 'file_names' column".

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS file_names TEXT[] DEFAULT '{}';
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS parameters JSONB DEFAULT '{}';
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS sample_labels JSONB DEFAULT '[]';
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS results JSONB;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS logs JSONB;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS current_step TEXT;

COMMENT ON COLUMN analyses.file_names IS 'R2 object keys for uploaded FASTQ files';
