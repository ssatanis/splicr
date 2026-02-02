-- Create drug_gene_cache table for caching DGIdb API responses
CREATE TABLE IF NOT EXISTS drug_gene_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gene_symbol TEXT NOT NULL UNIQUE,
  drugs JSONB NOT NULL DEFAULT '[]'::jsonb,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add index on gene_symbol for faster lookups
CREATE INDEX IF NOT EXISTS idx_drug_gene_cache_gene_symbol ON drug_gene_cache(gene_symbol);

-- Add index on cached_at to efficiently find stale entries
CREATE INDEX IF NOT EXISTS idx_drug_gene_cache_cached_at ON drug_gene_cache(cached_at);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_drug_gene_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER drug_gene_cache_updated_at
  BEFORE UPDATE ON drug_gene_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_drug_gene_cache_updated_at();

-- Enable RLS (Row Level Security)
ALTER TABLE drug_gene_cache ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read from cache
CREATE POLICY "Allow authenticated users to read drug_gene_cache"
  ON drug_gene_cache
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to insert/update cache entries
CREATE POLICY "Allow service role to manage drug_gene_cache"
  ON drug_gene_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
