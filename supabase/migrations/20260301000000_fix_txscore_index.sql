-- 20260301000000_fix_txscore_index.sql
-- Fixes "functions in index predicate must be marked IMMUTABLE" error
-- by replacing a time-based partial index with a boolean flag managed by triggers.

-- 1. Add persisted validity flag
ALTER TABLE txscore_cache
ADD COLUMN IF NOT EXISTS is_valid BOOLEAN;

-- 2. Backfill existing rows (if any)
UPDATE txscore_cache
SET is_valid = (expires_at IS NULL OR expires_at > NOW());

-- 3. Trigger function to maintain is_valid status
CREATE OR REPLACE FUNCTION txscore_cache_set_is_valid()
RETURNS TRIGGER AS $$
BEGIN
  -- Evaluates NOW() at write time, which is allowed. 
  -- The column value itself is static until the next update.
  NEW.is_valid := (NEW.expires_at IS NULL OR NEW.expires_at > NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Triggers for INSERT and UPDATE
DROP TRIGGER IF EXISTS txscore_cache_is_valid_ins ON txscore_cache;
CREATE TRIGGER txscore_cache_is_valid_ins
  BEFORE INSERT ON txscore_cache
  FOR EACH ROW
  EXECUTE FUNCTION txscore_cache_set_is_valid();

DROP TRIGGER IF EXISTS txscore_cache_is_valid_upd ON txscore_cache;
CREATE TRIGGER txscore_cache_is_valid_upd
  BEFORE UPDATE OF expires_at, computed_at ON txscore_cache
  FOR EACH ROW
  EXECUTE FUNCTION txscore_cache_set_is_valid();

-- 5. Drop the problematic index if it exists (it might not if creation failed)
DROP INDEX IF EXISTS idx_txscore_valid;

-- 6. Create immutable partial index using the boolean flag
-- This avoids the "functions in index predicate must be marked IMMUTABLE" error
CREATE INDEX IF NOT EXISTS idx_txscore_valid_flag
  ON txscore_cache(gene_id, cancer_type, tvs)
  WHERE is_valid = TRUE;
