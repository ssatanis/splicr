-- Structure cache for screen-to-structure integration
-- Caches gene -> PDB IDs and AlphaFold UniProt ID to reduce external API calls

CREATE TABLE IF NOT EXISTS public.structure_cache (
  gene_name TEXT PRIMARY KEY,
  pdb_matches JSONB DEFAULT '[]',
  alphafold_id TEXT,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cache_version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_structure_cache_last_updated
  ON public.structure_cache(last_updated);

COMMENT ON TABLE public.structure_cache IS 'Cache for RCSB PDB and AlphaFold lookups by gene symbol; invalidate after 30 days';
