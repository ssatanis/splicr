-- CRISPR libraries and sgRNA sequences for analysis (Brunello, etc.)
-- Used by scripts/seed-libraries.mjs
-- Idempotent: safe to run when tables exist or have different schema.

-- 1. Libraries table
CREATE TABLE IF NOT EXISTS public.libraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  organism TEXT NOT NULL,
  library_type TEXT NOT NULL,
  total_sgrnas INTEGER NOT NULL,
  genes_targeted INTEGER NOT NULL,
  sgrnas_per_gene INTEGER NOT NULL,
  description TEXT,
  addgene_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. sgRNA sequences table (create if not exists)
CREATE TABLE IF NOT EXISTS public.sgrna_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  sgrna_sequence TEXT NOT NULL,
  gene_symbol TEXT NOT NULL,
  gene_id TEXT NOT NULL,
  chromosome TEXT,
  position BIGINT,
  strand TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Ensure columns exist (if table was created elsewhere with different names)
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS sgrna_sequence TEXT;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS gene_symbol TEXT;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS gene_id TEXT;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS chromosome TEXT;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS position BIGINT;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS strand TEXT;
ALTER TABLE public.sgrna_sequences ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Indexes (create only if column exists to avoid 42703)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sgrna_sequences' AND column_name = 'library_id') THEN
    CREATE INDEX IF NOT EXISTS idx_sgrna_sequences_library_id ON public.sgrna_sequences(library_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sgrna_sequences' AND column_name = 'gene_symbol') THEN
    CREATE INDEX IF NOT EXISTS idx_sgrna_sequences_gene_symbol ON public.sgrna_sequences(gene_symbol);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sgrna_sequences' AND column_name = 'sgrna_sequence') THEN
    CREATE INDEX IF NOT EXISTS idx_sgrna_sequences_sequence ON public.sgrna_sequences(sgrna_sequence);
  END IF;
END $$;

-- 5. RLS
ALTER TABLE public.libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sgrna_sequences ENABLE ROW LEVEL SECURITY;

-- 6. Policies (drop first so re-run is idempotent)
DROP POLICY IF EXISTS "Anyone can read libraries" ON public.libraries;
CREATE POLICY "Anyone can read libraries"
  ON public.libraries FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can read sgrna_sequences" ON public.sgrna_sequences;
CREATE POLICY "Anyone can read sgrna_sequences"
  ON public.sgrna_sequences FOR SELECT
  USING (true);

-- 7. Comments
COMMENT ON TABLE public.libraries IS 'CRISPR sgRNA libraries (e.g. Brunello from Addgene)';
COMMENT ON TABLE public.sgrna_sequences IS 'Individual sgRNA sequences per library';
