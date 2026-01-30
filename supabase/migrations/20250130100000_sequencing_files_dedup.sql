-- Sequencing files dedup: map file_hash -> R2 key for global deduplication.
-- First upload wins; concurrent uploads of same content reuse the same key.
-- Index on file_hash for fast lookup before upload.

CREATE TABLE IF NOT EXISTS sequencing_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_hash TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  content_type TEXT,
  user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sequencing_files_file_hash ON sequencing_files(file_hash);
CREATE INDEX IF NOT EXISTS idx_sequencing_files_user_id ON sequencing_files(user_id);
CREATE INDEX IF NOT EXISTS idx_sequencing_files_created_at ON sequencing_files(created_at);

COMMENT ON TABLE sequencing_files IS 'Global dedup: same content (file_hash) maps to one R2 key. Access control enforced at app level.';
