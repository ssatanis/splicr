-- Fix: allow multiple email invites per analysis (one row per invite).
-- The previous constraint UNIQUE(analysis_id, is_link_share) allowed only ONE row per
-- (analysis_id, is_link_share), so only one email invite per analysis. We need:
-- - Multiple rows with (analysis_id, is_link_share = false) for multiple collaborators.
-- - One row with (analysis_id, is_link_share = true) for link share config.
-- So drop the composite unique and add a partial unique: one link share per analysis only.

-- Drop the constraint that blocks multiple email invites
ALTER TABLE public.analysis_shares
  DROP CONSTRAINT IF EXISTS analysis_shares_one_link_per_analysis;

-- One link-share config per analysis (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_shares_one_link_per_analysis
  ON public.analysis_shares(analysis_id)
  WHERE is_link_share = true;

COMMENT ON INDEX idx_analysis_shares_one_link_per_analysis IS 'Ensures at most one link share config per analysis; email invites are unlimited.';
