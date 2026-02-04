-- Add columns for seed-all-libraries script (sequence, start/end position, scores, sgrna_id)
-- Idempotent: ADD COLUMN IF NOT EXISTS

-- Allow null gene_symbol/gene_id for libraries that don't provide them (e.g. GeCKO)
ALTER TABLE public.sgrna_sequences ALTER COLUMN gene_symbol DROP NOT NULL;
ALTER TABLE public.sgrna_sequences ALTER COLUMN gene_id DROP NOT NULL;

ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS sequence TEXT;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS start_position INTEGER;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS end_position INTEGER;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS sgrna_id TEXT;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS off_target_score DECIMAL;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS on_target_score DECIMAL;

-- Backfill sequence from sgrna_sequence where sequence is null
UPDATE public.sgrna_sequences SET sequence = sgrna_sequence WHERE sequence IS NULL AND sgrna_sequence IS NOT NULL;

-- Index for sequence lookups
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sgrna_sequences' AND column_name = 'sequence') THEN
    CREATE INDEX IF NOT EXISTS idx_sgrna_sequences_sequence_col ON public.sgrna_sequences(sequence);
  END IF;
END $$;
