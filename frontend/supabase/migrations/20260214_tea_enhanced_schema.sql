-- ================================================
-- TEA (Therapeutic Editability Atlas) Schema
-- Enhanced with persistent reports, unique IDs, and external integrations
-- ================================================

-- Main TEA analyses table
CREATE TABLE IF NOT EXISTS tea_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Unique report identifier (TEA-2026-XXXX-XXXX)
  report_id TEXT UNIQUE NOT NULL,
  
  -- Variant and gene information
  variant_id TEXT NOT NULL, -- e.g., "c.6046G>A" or "chr11:5227071:C:T"
  gene_symbol TEXT NOT NULL,
  chromosome TEXT,
  position BIGINT,
  ref_allele TEXT,
  alt_allele TEXT,
  hgvs_notation TEXT,
  
  -- Target sequence and context
  target_sequence TEXT NOT NULL,
  sequence_context JSONB DEFAULT '{}'::jsonb,
  -- {
  --   "gc_content": 0.52,
  --   "length": 200,
  --   "pam_sites": [{"sequence": "NGG", "position": 45, "distance": 12, "strand": "+", "type": "SpCas9"}],
  --   "secondary_structures": [{"position": 30, "delta_g": -15.2, "structure": "hairpin"}]
  -- }
  
  -- Analysis parameters
  tissue TEXT NOT NULL, -- "liver", "neurons", "hsc", etc.
  genome_build TEXT DEFAULT 'hg38',
  patient_vcf_url TEXT, -- Optional: patient-specific off-target analysis
  
  -- EDIT score and components
  edit_score NUMERIC(5,2) NOT NULL, -- 0-100
  base_editability NUMERIC(5,2),
  prime_editability NUMERIC(5,2),
  therapeutic_window NUMERIC(5,2),
  cell_type_specificity NUMERIC(5,2),
  off_target_safety NUMERIC(5,2),
  deliverability NUMERIC(5,2),
  
  -- Recommended strategy
  optimal_strategy TEXT, -- "base_editing", "prime_editing", "nuclease", "none"
  optimal_editor TEXT, -- "ABE8e", "BE4max", "PE5", etc.
  
  -- Predictions
  predicted_efficiency NUMERIC(5,2), -- 0-100%
  on_target_score NUMERIC(5,2),
  off_target_count INTEGER DEFAULT 0,
  
  -- Full results object
  results JSONB DEFAULT '{}'::jsonb,
  -- {
  --   "efficiency": 72.5,
  --   "therapeuticWindow": 8.2,
  --   "offTargets": [...],
  --   "editScore": 76.3,
  --   "optimalStrategy": "base_editing",
  --   "pamAnalysis": {...},
  --   "chromatinAccessibility": {...}
  -- }
  
  -- External API data
  external_links JSONB DEFAULT '{}'::jsonb,
  -- {
  --   "depmap": "https://depmap.org/portal/gene/BRCA1",
  --   "clinvar": "https://www.ncbi.nlm.nih.gov/clinvar/variation/12345/",
  --   "gtex": "https://gtexportal.org/home/gene/BRCA1",
  --   "encode": "https://www.encodeproject.org/..."
  -- }
  
  -- Intelligent explanations
  explanations JSONB DEFAULT '{}'::jsonb,
  -- {
  --   "efficiency": "High efficiency predicted (76%) due to...",
  --   "window": "Excellent therapeutic window...",
  --   "offTarget": "Low off-target risk...",
  --   "recommendation": "Base editing with ABE8e recommended because..."
  -- }
  
  -- Related publications
  related_papers JSONB DEFAULT '[]'::jsonb,
  -- [{"pmid": "12345", "title": "...", "authors": "...", "year": 2023, "journal": "Nature"}]
  
  -- Chromatin accessibility data
  chromatin_data JSONB DEFAULT '{}'::jsonb,
  -- {"accessibility_score": 0.85, "tissue": "liver", "source": "ENCODE", "dnase_signal": 12.5}
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  version TEXT DEFAULT '1.0',
  
  -- Status tracking
  status TEXT DEFAULT 'completed', -- 'pending', 'running', 'completed', 'failed'
  error_message TEXT
);

-- Shareable reports
CREATE TABLE IF NOT EXISTS tea_shareable_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES tea_analyses(id) ON DELETE CASCADE,
  share_token TEXT UNIQUE NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  view_count INTEGER DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Sequence uploads
CREATE TABLE IF NOT EXISTS tea_sequence_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  format TEXT NOT NULL, -- 'fasta', 'txt', 'vcf'
  sequence TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- External API cache
CREATE TABLE IF NOT EXISTS tea_external_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL,
  cache_type TEXT NOT NULL, -- 'depmap', 'clinvar', 'encode', 'pubmed'
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tea_report_id ON tea_analyses(report_id);
CREATE INDEX IF NOT EXISTS idx_tea_user_id ON tea_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_tea_gene_symbol ON tea_analyses(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_tea_created_at ON tea_analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tea_edit_score ON tea_analyses(edit_score DESC);
CREATE INDEX IF NOT EXISTS idx_tea_share_token ON tea_shareable_reports(share_token);
CREATE INDEX IF NOT EXISTS idx_tea_cache_key ON tea_external_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_tea_cache_expires ON tea_external_cache(expires_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tea_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at
CREATE TRIGGER tea_analyses_updated_at
  BEFORE UPDATE ON tea_analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_tea_updated_at();

-- Function to clean up expired cache
CREATE OR REPLACE FUNCTION cleanup_expired_tea_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM tea_external_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (RLS)
ALTER TABLE tea_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE tea_shareable_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tea_sequence_uploads ENABLE ROW LEVEL SECURITY;

-- Users can view their own analyses
CREATE POLICY tea_analyses_select_own ON tea_analyses
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own analyses
CREATE POLICY tea_analyses_insert_own ON tea_analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own analyses
CREATE POLICY tea_analyses_update_own ON tea_analyses
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own analyses
CREATE POLICY tea_analyses_delete_own ON tea_analyses
  FOR DELETE USING (auth.uid() = user_id);

-- Public can view shared reports
CREATE POLICY tea_shareable_reports_select_public ON tea_shareable_reports
  FOR SELECT USING (is_public = true OR auth.uid() IN (
    SELECT user_id FROM tea_analyses WHERE id = analysis_id
  ));

-- Users can create share links for their analyses
CREATE POLICY tea_shareable_reports_insert_own ON tea_shareable_reports
  FOR INSERT WITH CHECK (
    auth.uid() IN (SELECT user_id FROM tea_analyses WHERE id = analysis_id)
  );

-- Comments for documentation
COMMENT ON TABLE tea_analyses IS 'Main table for TEA (Therapeutic Editability Atlas) analyses with persistent reports';
COMMENT ON COLUMN tea_analyses.report_id IS 'Unique shareable ID in format TEA-YYYY-XXXX-XXXX';
COMMENT ON COLUMN tea_analyses.edit_score IS 'Composite EDIT score (0-100) predicting clinical success';
COMMENT ON COLUMN tea_analyses.optimal_strategy IS 'Recommended editing approach based on variant type and context';
COMMENT ON TABLE tea_shareable_reports IS 'Shareable links for TEA reports with view tracking';
COMMENT ON TABLE tea_external_cache IS 'Cache for external API responses (DepMap, ClinVar, ENCODE, PubMed)';
