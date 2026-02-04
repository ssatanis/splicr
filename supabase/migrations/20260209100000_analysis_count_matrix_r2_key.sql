-- Store R2 key for count matrix separately so we can fetch it without loading the full results JSONB (avoids OOM).
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS count_matrix_r2_key TEXT;

COMMENT ON COLUMN public.analyses.count_matrix_r2_key IS 'R2 object key for analysis count matrix JSON; fetched on demand to avoid huge results payload.';
