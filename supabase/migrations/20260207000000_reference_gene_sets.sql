-- ============================================================================
-- REFERENCE GENE SETS FOR BENCHMARKING AND QC
-- ============================================================================
-- Create tables for storing reference gene sets used in CRISPR screen analysis
-- These include essential genes, non-essential genes, cancer drivers, etc.

-- Reference Gene Set Categories Table
CREATE TABLE IF NOT EXISTS public.reference_gene_set_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add comments
COMMENT ON TABLE public.reference_gene_set_categories IS 'Categories of reference gene sets (e.g., Essential, Non-Essential, Cancer Drivers)';

-- Reference Gene Sets Table
CREATE TABLE IF NOT EXISTS public.reference_gene_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.reference_gene_set_categories(id) ON DELETE CASCADE,
  description TEXT,
  source TEXT, -- Citation or database source
  organism TEXT DEFAULT 'Homo sapiens',
  gene_count INTEGER DEFAULT 0,
  publication_year INTEGER,
  pubmed_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB, -- Additional metadata (cell lines, conditions, etc.)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(name, organism)
);

-- Add comments
COMMENT ON TABLE public.reference_gene_sets IS 'Reference gene sets for CRISPR screen analysis';
COMMENT ON COLUMN public.reference_gene_sets.source IS 'Citation: e.g., "Hart et al. 2015", "COSMIC v98"';
COMMENT ON COLUMN public.reference_gene_sets.metadata IS 'Additional info: cell_lines, screen_type, method, etc.';

-- Reference Genes Table (Many-to-Many relationship)
CREATE TABLE IF NOT EXISTS public.reference_genes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gene_set_id UUID NOT NULL REFERENCES public.reference_gene_sets(id) ON DELETE CASCADE,
  gene_symbol TEXT NOT NULL,
  gene_id TEXT, -- Entrez gene ID
  ensembl_id TEXT,
  score DECIMAL, -- Optional: essentiality score, Bayes Factor, etc.
  rank INTEGER, -- Optional: rank within the set
  metadata JSONB, -- Additional gene-specific metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(gene_set_id, gene_symbol)
);

-- Add comments
COMMENT ON TABLE public.reference_genes IS 'Individual genes in reference sets';
COMMENT ON COLUMN public.reference_genes.score IS 'Optional score: essentiality, dependency, Bayes Factor, etc.';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_reference_gene_sets_category ON public.reference_gene_sets(category_id);
CREATE INDEX IF NOT EXISTS idx_reference_gene_sets_organism ON public.reference_gene_sets(organism);
CREATE INDEX IF NOT EXISTS idx_reference_gene_sets_name ON public.reference_gene_sets(name);
CREATE INDEX IF NOT EXISTS idx_reference_genes_gene_set ON public.reference_genes(gene_set_id);
CREATE INDEX IF NOT EXISTS idx_reference_genes_symbol ON public.reference_genes(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_reference_genes_gene_id ON public.reference_genes(gene_id);

-- Enable Row Level Security
ALTER TABLE public.reference_gene_set_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_gene_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_genes ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow all authenticated users to read reference data
CREATE POLICY "Allow read access to reference categories" ON public.reference_gene_set_categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow read access to reference gene sets" ON public.reference_gene_sets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow read access to reference genes" ON public.reference_genes
  FOR SELECT TO authenticated USING (true);

-- Only service role can insert/update/delete (via backend API or migrations)
CREATE POLICY "Service role can manage categories" ON public.reference_gene_set_categories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage gene sets" ON public.reference_gene_sets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage genes" ON public.reference_genes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- INSERT DEFAULT CATEGORIES
-- ============================================================================

INSERT INTO public.reference_gene_set_categories (name, description) VALUES
  ('Essential', 'Core essential genes required for cell survival'),
  ('Non-Essential', 'Non-essential genes with minimal fitness effect'),
  ('Cancer Drivers', 'Genes frequently mutated or altered in cancer'),
  ('Druggable', 'Genes targetable by small molecules or biologics'),
  ('Pathway', 'Genes grouped by biological pathway'),
  ('Tissue-Specific', 'Genes with tissue-specific essentiality'),
  ('Control', 'Control gene sets for normalization and QC')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- INSERT REFERENCE GENE SETS (METADATA ONLY - GENES ADDED VIA SEEDING SCRIPT)
-- ============================================================================

-- Hart et al. 2015 - Core Essential Genes
INSERT INTO public.reference_gene_sets (
  name,
  category_id,
  description,
  source,
  organism,
  publication_year,
  pubmed_id,
  metadata
)
SELECT
  'Hart Core Essential 2015',
  c.id,
  '217 core essential genes identified via CRISPR screens across 5 cell lines. Genes essential in all tested contexts.',
  'Hart et al., Cell 2015',
  'Homo sapiens',
  2015,
  '26771497',
  '{"cell_lines": ["HeLa", "GBM", "RPE1", "DLD1", "A375"], "screen_type": "dropout", "method": "CRISPR/Cas9"}'::jsonb
FROM public.reference_gene_set_categories c
WHERE c.name = 'Essential'
ON CONFLICT (name, organism) DO NOTHING;

-- Hart et al. 2014 - Non-Essential Genes
INSERT INTO public.reference_gene_sets (
  name,
  category_id,
  description,
  source,
  organism,
  publication_year,
  pubmed_id,
  metadata
)
SELECT
  'Hart Non-Essential 2014',
  c.id,
  '927 non-essential genes with minimal fitness effect. Used as negative controls.',
  'Hart & Moffat, G3 2014',
  'Homo sapiens',
  2014,
  '24759140',
  '{"screen_type": "reference", "method": "compiled"}'::jsonb
FROM public.reference_gene_set_categories c
WHERE c.name = 'Non-Essential'
ON CONFLICT (name, organism) DO NOTHING;

-- DepMap Common Essentials (Placeholder - genes added via API/seeding)
INSERT INTO public.reference_gene_sets (
  name,
  category_id,
  description,
  source,
  organism,
  publication_year,
  metadata
)
SELECT
  'DepMap Common Essential 23Q4',
  c.id,
  'Approximately 1500 genes essential in >90% of cancer cell lines. Updated quarterly from DepMap.',
  'Broad Institute DepMap',
  'Homo sapiens',
  2023,
  '{"depmap_version": "23Q4", "threshold": "90% cell lines", "source_url": "https://depmap.org/portal/"}'::jsonb
FROM public.reference_gene_set_categories c
WHERE c.name = 'Essential'
ON CONFLICT (name, organism) DO NOTHING;

-- COSMIC Cancer Gene Census
INSERT INTO public.reference_gene_sets (
  name,
  category_id,
  description,
  source,
  organism,
  publication_year,
  metadata
)
SELECT
  'COSMIC Cancer Gene Census v98',
  c.id,
  'Curated catalogue of genes with validated roles in cancer. Includes oncogenes and tumor suppressors.',
  'COSMIC Database (Wellcome Sanger Institute)',
  'Homo sapiens',
  2023,
  '{"cosmic_version": "v98", "gene_types": ["oncogene", "tumor_suppressor", "fusion"], "source_url": "https://cancer.sanger.ac.uk/cosmic"}'::jsonb
FROM public.reference_gene_set_categories c
WHERE c.name = 'Cancer Drivers'
ON CONFLICT (name, organism) DO NOTHING;

-- Druggable Genome
INSERT INTO public.reference_gene_sets (
  name,
  category_id,
  description,
  source,
  organism,
  publication_year,
  metadata
)
SELECT
  'Druggable Genome',
  c.id,
  'Genes encoding proteins targetable by small molecules. Includes kinases, GPCRs, ion channels, nuclear receptors.',
  'DGIdb - Drug Gene Interaction Database',
  'Homo sapiens',
  2023,
  '{"categories": ["kinase", "gpcr", "ion_channel", "nuclear_receptor", "protease"], "source_url": "https://www.dgidb.org/"}'::jsonb
FROM public.reference_gene_set_categories c
WHERE c.name = 'Druggable'
ON CONFLICT (name, organism) DO NOTHING;

-- Ribosomal Genes
INSERT INTO public.reference_gene_sets (
  name,
  category_id,
  description,
  source,
  organism,
  metadata
)
SELECT
  'Ribosomal Proteins',
  c.id,
  'Ribosomal protein genes (RPL and RPS families). Typically essential and used as positive controls.',
  'Gene Ontology: GO:0003735',
  'Homo sapiens',
  '{"go_term": "GO:0003735", "go_name": "structural constituent of ribosome"}'::jsonb
FROM public.reference_gene_set_categories c
WHERE c.name = 'Control'
ON CONFLICT (name, organism) DO NOTHING;

-- DNA Repair Genes
INSERT INTO public.reference_gene_sets (
  name,
  category_id,
  description,
  source,
  organism,
  metadata
)
SELECT
  'DNA Repair Genes',
  c.id,
  'Genes involved in DNA repair pathways. Relevant for synthetic lethality screens with DNA damaging agents.',
  'KEGG: DNA Repair Pathways',
  'Homo sapiens',
  '{"kegg_pathways": ["hsa03410", "hsa03420", "hsa03430", "hsa03440", "hsa03450", "hsa03460"], "pathways": ["Base excision repair", "Nucleotide excision repair", "Mismatch repair", "Homologous recombination", "Non-homologous end joining", "Fanconi anemia"]}'::jsonb
FROM public.reference_gene_set_categories c
WHERE c.name = 'Pathway'
ON CONFLICT (name, organism) DO NOTHING;

-- OncoKB Cancer Genes
INSERT INTO public.reference_gene_sets (
  name,
  category_id,
  description,
  source,
  organism,
  publication_year,
  metadata
)
SELECT
  'OncoKB Cancer Genes',
  c.id,
  'Curated list of cancer genes with clinical and biological evidence from OncoKB.',
  'OncoKB (Memorial Sloan Kettering)',
  'Homo sapiens',
  2023,
  '{"oncogenicity_levels": ["Oncogenic", "Likely Oncogenic"], "source_url": "https://www.oncokb.org/"}'::jsonb
FROM public.reference_gene_set_categories c
WHERE c.name = 'Cancer Drivers'
ON CONFLICT (name, organism) DO NOTHING;

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================

-- Function to update gene_count when genes are added/removed
CREATE OR REPLACE FUNCTION update_gene_set_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.reference_gene_sets
    SET gene_count = gene_count + 1,
        updated_at = NOW()
    WHERE id = NEW.gene_set_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.reference_gene_sets
    SET gene_count = GREATEST(gene_count - 1, 0),
        updated_at = NOW()
    WHERE id = OLD.gene_set_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update gene_count
DROP TRIGGER IF EXISTS trigger_update_gene_set_count ON public.reference_genes;
CREATE TRIGGER trigger_update_gene_set_count
  AFTER INSERT OR DELETE ON public.reference_genes
  FOR EACH ROW
  EXECUTE FUNCTION update_gene_set_count();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_reference_gene_sets_updated_at ON public.reference_gene_sets;
CREATE TRIGGER update_reference_gene_sets_updated_at
  BEFORE UPDATE ON public.reference_gene_sets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reference_gene_set_categories_updated_at ON public.reference_gene_set_categories;
CREATE TRIGGER update_reference_gene_set_categories_updated_at
  BEFORE UPDATE ON public.reference_gene_set_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- View: Reference gene sets with category info and gene count
CREATE OR REPLACE VIEW public.reference_gene_sets_with_category AS
SELECT
  rgs.id,
  rgs.name,
  rgs.description,
  rgs.source,
  rgs.organism,
  rgs.publication_year,
  rgs.pubmed_id,
  rgs.gene_count,
  rgs.is_active,
  rgs.metadata,
  rgsc.name AS category_name,
  rgsc.description AS category_description,
  rgs.created_at,
  rgs.updated_at
FROM public.reference_gene_sets rgs
LEFT JOIN public.reference_gene_set_categories rgsc ON rgs.category_id = rgsc.id;

COMMENT ON VIEW public.reference_gene_sets_with_category IS 'Reference gene sets joined with category information';

-- Grant access to authenticated users
GRANT SELECT ON public.reference_gene_sets_with_category TO authenticated;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Reference gene sets schema created successfully!';
  RAISE NOTICE 'Categories: Essential, Non-Essential, Cancer Drivers, Druggable, Pathway, Tissue-Specific, Control';
  RAISE NOTICE 'Gene sets: Hart Essential/Non-Essential, DepMap, COSMIC, OncoKB, Druggable Genome, Ribosomal, DNA Repair';
  RAISE NOTICE 'Next step: Populate reference_genes table with actual gene lists via seeding script';
END $$;
