-- =====================================================================
-- TxScore Schema Fix Migration
-- =====================================================================
-- Created: 2026-02-14
-- Description: Comprehensive fix for TxScore schema issues
--              1. Drops all incorrectly named indexes (missing tx_ prefix)
--              2. Recreates all indexes with correct tx_ prefix
--              3. Adds missing user_saved_targets table
--              4. Ensures idempotent execution
-- =====================================================================

-- =====================================================================
-- 1. DROP ALL INCORRECTLY NAMED INDEXES
-- =====================================================================
-- Drop indexes from genes_master (should be tx_genes_master)
DROP INDEX IF EXISTS idx_genes_master_symbol;
DROP INDEX IF EXISTS idx_genes_master_uniprot;
DROP INDEX IF EXISTS idx_genes_master_chromosome;
DROP INDEX IF EXISTS idx_genes_master_coordinates;
DROP INDEX IF EXISTS idx_genes_master_gene_type;
DROP INDEX IF EXISTS idx_genes_master_protein_class;
DROP INDEX IF EXISTS idx_genes_master_aliases_gin;
DROP INDEX IF EXISTS idx_genes_master_symbol_trgm;

-- Drop indexes from depmap_data (should be tx_depmap_data)
DROP INDEX IF EXISTS idx_depmap_gene_id;
DROP INDEX IF EXISTS idx_depmap_cell_line;
DROP INDEX IF EXISTS idx_depmap_cancer_type;
DROP INDEX IF EXISTS idx_depmap_tissue;
DROP INDEX IF EXISTS idx_depmap_chronos;
DROP INDEX IF EXISTS idx_depmap_dependency_prob;
DROP INDEX IF EXISTS idx_depmap_release;
DROP INDEX IF EXISTS idx_depmap_composite;
DROP INDEX IF EXISTS idx_depmap_mutation_gin;

-- Drop indexes from gtex_expression (should be tx_gtex_expression)
DROP INDEX IF EXISTS idx_gtex_gene_id;
DROP INDEX IF EXISTS idx_gtex_tissue;
DROP INDEX IF EXISTS idx_gtex_median_tpm;
DROP INDEX IF EXISTS idx_gtex_tissue_category;
DROP INDEX IF EXISTS idx_gtex_composite;
DROP INDEX IF EXISTS idx_gtex_high_expr_gene;

-- Drop indexes from gnomad_constraint (should be tx_gnomad_constraint)
DROP INDEX IF EXISTS idx_gnomad_loeuf;
DROP INDEX IF EXISTS idx_gnomad_pli;
DROP INDEX IF EXISTS idx_gnomad_mis_z;
DROP INDEX IF EXISTS idx_gnomad_constrained;
DROP INDEX IF EXISTS idx_gnomad_flags_gin;

-- Drop indexes from alphafold_structures (should be tx_alphafold_structures)
DROP INDEX IF EXISTS idx_alphafold_gene_id;
DROP INDEX IF EXISTS idx_alphafold_uniprot;
DROP INDEX IF EXISTS idx_alphafold_mean_plddt;
DROP INDEX IF EXISTS idx_alphafold_druggable_pockets;
DROP INDEX IF EXISTS idx_alphafold_high_quality;
DROP INDEX IF EXISTS idx_alphafold_pockets_gin;
DROP INDEX IF EXISTS idx_alphafold_domains_gin;

-- Drop indexes from clinvar_variants (should be tx_clinvar_variants)
DROP INDEX IF EXISTS idx_clinvar_gene_id;
DROP INDEX IF EXISTS idx_clinvar_significance;
DROP INDEX IF EXISTS idx_clinvar_pathogenic;
DROP INDEX IF EXISTS idx_clinvar_coordinates;
DROP INDEX IF EXISTS idx_clinvar_conditions_gin;
DROP INDEX IF EXISTS idx_clinvar_variant_type;

-- Drop indexes from drug_interactions (should be tx_drug_interactions)
DROP INDEX IF EXISTS idx_drug_gene_id;
DROP INDEX IF EXISTS idx_drug_name;
DROP INDEX IF EXISTS idx_drug_approval_status;
DROP INDEX IF EXISTS idx_drug_approved;
DROP INDEX IF EXISTS idx_drug_phase;
DROP INDEX IF EXISTS idx_drug_source;
DROP INDEX IF EXISTS idx_drug_chembl;
DROP INDEX IF EXISTS idx_drug_drugbank;

-- Drop indexes from clinical_trials (should be tx_clinical_trials)
DROP INDEX IF EXISTS idx_trials_gene_id;
DROP INDEX IF EXISTS idx_trials_phase;
DROP INDEX IF EXISTS idx_trials_status;
DROP INDEX IF EXISTS idx_trials_conditions_gin;
DROP INDEX IF EXISTS idx_trials_interventions_gin;
DROP INDEX IF EXISTS idx_trials_advanced_phase;
DROP INDEX IF EXISTS idx_trials_failed;
DROP INDEX IF EXISTS idx_trials_start_date;

-- Drop indexes from txscore_cache (should be tx_txscore_cache)
DROP INDEX IF EXISTS idx_txscore_gene_id;
DROP INDEX IF EXISTS idx_txscore_cancer_type;
DROP INDEX IF EXISTS idx_txscore_tvs_desc;
DROP INDEX IF EXISTS idx_txscore_cancer_tvs;
DROP INDEX IF EXISTS idx_txscore_efficacy;
DROP INDEX IF EXISTS idx_txscore_safety;
DROP INDEX IF EXISTS idx_txscore_druggability;
DROP INDEX IF EXISTS idx_txscore_high_tvs;
DROP INDEX IF EXISTS idx_txscore_computed_at;
DROP INDEX IF EXISTS idx_txscore_tissue_risks_gin;
DROP INDEX IF EXISTS idx_txscore_modality_gin;
DROP INDEX IF EXISTS idx_txscore_valid;

-- Drop indexes from cell_line_metadata (should be tx_cell_line_metadata)
DROP INDEX IF EXISTS idx_cell_line_cancer_type;
DROP INDEX IF EXISTS idx_cell_line_tissue;
DROP INDEX IF EXISTS idx_cell_line_mutation_gin;

-- Drop indexes from tissue_metadata (should be tx_tissue_metadata)
DROP INDEX IF EXISTS idx_tissue_category;
DROP INDEX IF EXISTS idx_tissue_critical;

-- Drop indexes from cancer_type_metadata (should be tx_cancer_type_metadata)
DROP INDEX IF EXISTS idx_cancer_tissue;

-- =====================================================================
-- 2. RECREATE ALL INDEXES WITH CORRECT tx_ PREFIX
-- =====================================================================

-- tx_genes_master indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_genes_master_symbol ON tx_genes_master(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_uniprot ON tx_genes_master(uniprot_id) WHERE uniprot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_chromosome ON tx_genes_master(chromosome);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_coordinates ON tx_genes_master(chromosome, start_position, end_position);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_gene_type ON tx_genes_master(gene_type);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_protein_class ON tx_genes_master(protein_class);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_aliases_gin ON tx_genes_master USING GIN(aliases);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_symbol_trgm ON tx_genes_master USING GIN(gene_symbol gin_trgm_ops);

-- tx_depmap_data indexes
CREATE INDEX IF NOT EXISTS idx_tx_depmap_gene_id ON tx_depmap_data(gene_id);
CREATE INDEX IF NOT EXISTS idx_tx_depmap_cell_line ON tx_depmap_data(cell_line_id);
CREATE INDEX IF NOT EXISTS idx_tx_depmap_cancer_type ON tx_depmap_data(cancer_type);
CREATE INDEX IF NOT EXISTS idx_tx_depmap_tissue ON tx_depmap_data(tissue_origin);
CREATE INDEX IF NOT EXISTS idx_tx_depmap_chronos ON tx_depmap_data(chronos_effect);
CREATE INDEX IF NOT EXISTS idx_tx_depmap_dependency_prob ON tx_depmap_data(dependency_probability);
CREATE INDEX IF NOT EXISTS idx_tx_depmap_release ON tx_depmap_data(depmap_release);
CREATE INDEX IF NOT EXISTS idx_tx_depmap_composite ON tx_depmap_data(gene_id, cancer_type, chronos_effect);
CREATE INDEX IF NOT EXISTS idx_tx_depmap_mutation_gin ON tx_depmap_data USING GIN(mutation_profile);

-- tx_gtex_expression indexes
CREATE INDEX IF NOT EXISTS idx_tx_gtex_gene_id ON tx_gtex_expression(gene_id);
CREATE INDEX IF NOT EXISTS idx_tx_gtex_tissue ON tx_gtex_expression(tissue_name);
CREATE INDEX IF NOT EXISTS idx_tx_gtex_median_tpm ON tx_gtex_expression(median_tpm);
CREATE INDEX IF NOT EXISTS idx_tx_gtex_tissue_category ON tx_gtex_expression(tissue_category);
CREATE INDEX IF NOT EXISTS idx_tx_gtex_composite ON tx_gtex_expression(gene_id, tissue_name, median_tpm);

-- tx_gnomad_constraint indexes
CREATE INDEX IF NOT EXISTS idx_tx_gnomad_loeuf ON tx_gnomad_constraint(loeuf) WHERE loeuf IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_gnomad_pli ON tx_gnomad_constraint(pli) WHERE pli IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_gnomad_mis_z ON tx_gnomad_constraint(mis_z);
CREATE INDEX IF NOT EXISTS idx_tx_gnomad_constrained ON tx_gnomad_constraint(loeuf, pli) WHERE loeuf < 0.6 OR pli > 0.9;
CREATE INDEX IF NOT EXISTS idx_tx_gnomad_flags_gin ON tx_gnomad_constraint USING GIN(lof_flags);

-- tx_alphafold_structures indexes
CREATE INDEX IF NOT EXISTS idx_tx_alphafold_gene_id ON tx_alphafold_structures(gene_id);
CREATE INDEX IF NOT EXISTS idx_tx_alphafold_uniprot ON tx_alphafold_structures(uniprot_id);
CREATE INDEX IF NOT EXISTS idx_tx_alphafold_mean_plddt ON tx_alphafold_structures(mean_plddt);
CREATE INDEX IF NOT EXISTS idx_tx_alphafold_druggable_pockets ON tx_alphafold_structures(num_druggable_pockets) WHERE num_druggable_pockets > 0;
CREATE INDEX IF NOT EXISTS idx_tx_alphafold_high_quality ON tx_alphafold_structures(gene_id, mean_plddt) WHERE mean_plddt > 70;
CREATE INDEX IF NOT EXISTS idx_tx_alphafold_pockets_gin ON tx_alphafold_structures USING GIN(pockets);
CREATE INDEX IF NOT EXISTS idx_tx_alphafold_domains_gin ON tx_alphafold_structures USING GIN(domains);

-- tx_clinvar_variants indexes
CREATE INDEX IF NOT EXISTS idx_tx_clinvar_gene_id ON tx_clinvar_variants(gene_id);
CREATE INDEX IF NOT EXISTS idx_tx_clinvar_significance ON tx_clinvar_variants(clinical_significance);
CREATE INDEX IF NOT EXISTS idx_tx_clinvar_pathogenic ON tx_clinvar_variants(gene_id, clinical_significance) 
    WHERE clinical_significance IN ('Pathogenic', 'Likely pathogenic');
CREATE INDEX IF NOT EXISTS idx_tx_clinvar_coordinates ON tx_clinvar_variants(chromosome, position);
CREATE INDEX IF NOT EXISTS idx_tx_clinvar_conditions_gin ON tx_clinvar_variants USING GIN(conditions);
CREATE INDEX IF NOT EXISTS idx_tx_clinvar_variant_type ON tx_clinvar_variants(variant_type);

-- tx_drug_interactions indexes
CREATE INDEX IF NOT EXISTS idx_tx_drug_gene_id ON tx_drug_interactions(gene_id);
CREATE INDEX IF NOT EXISTS idx_tx_drug_name ON tx_drug_interactions(drug_name);
CREATE INDEX IF NOT EXISTS idx_tx_drug_approval_status ON tx_drug_interactions(approval_status);
CREATE INDEX IF NOT EXISTS idx_tx_drug_approved ON tx_drug_interactions(gene_id, approval_status) WHERE approval_status = 'approved';
CREATE INDEX IF NOT EXISTS idx_tx_drug_phase ON tx_drug_interactions(clinical_trial_phase);
CREATE INDEX IF NOT EXISTS idx_tx_drug_source ON tx_drug_interactions(source);
CREATE INDEX IF NOT EXISTS idx_tx_drug_chembl ON tx_drug_interactions(drug_chembl_id) WHERE drug_chembl_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_drug_drugbank ON tx_drug_interactions(drug_drugbank_id) WHERE drug_drugbank_id IS NOT NULL;

-- tx_clinical_trials indexes
CREATE INDEX IF NOT EXISTS idx_tx_trials_gene_id ON tx_clinical_trials(gene_id);
CREATE INDEX IF NOT EXISTS idx_tx_trials_phase ON tx_clinical_trials(phase);
CREATE INDEX IF NOT EXISTS idx_tx_trials_status ON tx_clinical_trials(status);
CREATE INDEX IF NOT EXISTS idx_tx_trials_conditions_gin ON tx_clinical_trials USING GIN(conditions);
CREATE INDEX IF NOT EXISTS idx_tx_trials_interventions_gin ON tx_clinical_trials USING GIN(interventions);
CREATE INDEX IF NOT EXISTS idx_tx_trials_advanced_phase ON tx_clinical_trials(gene_id, phase, status) 
    WHERE phase IN ('Phase 2', 'Phase 3', 'Phase 4') AND status IN ('Completed', 'Active, not recruiting');
CREATE INDEX IF NOT EXISTS idx_tx_trials_failed ON tx_clinical_trials(gene_id, phase, status) 
    WHERE status IN ('Terminated', 'Withdrawn') AND phase IN ('Phase 2', 'Phase 3');
CREATE INDEX IF NOT EXISTS idx_tx_trials_start_date ON tx_clinical_trials(start_date);

-- tx_txscore_cache indexes
CREATE INDEX IF NOT EXISTS idx_tx_txscore_gene_id ON tx_txscore_cache(gene_id);
CREATE INDEX IF NOT EXISTS idx_tx_txscore_cancer_type ON tx_txscore_cache(cancer_type);
CREATE INDEX IF NOT EXISTS idx_tx_txscore_tvs_desc ON tx_txscore_cache(tvs DESC);
CREATE INDEX IF NOT EXISTS idx_tx_txscore_cancer_tvs ON tx_txscore_cache(cancer_type, tvs DESC);
CREATE INDEX IF NOT EXISTS idx_tx_txscore_efficacy ON tx_txscore_cache(efficacy_score DESC);
CREATE INDEX IF NOT EXISTS idx_tx_txscore_safety ON tx_txscore_cache(safety_score DESC);
CREATE INDEX IF NOT EXISTS idx_tx_txscore_druggability ON tx_txscore_cache(druggability_score DESC);
CREATE INDEX IF NOT EXISTS idx_tx_txscore_high_tvs ON tx_txscore_cache(gene_id, tvs) WHERE tvs > 0.7;
CREATE INDEX IF NOT EXISTS idx_tx_txscore_computed_at ON tx_txscore_cache(computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_txscore_tissue_risks_gin ON tx_txscore_cache USING GIN(tissue_risks);
CREATE INDEX IF NOT EXISTS idx_tx_txscore_modality_gin ON tx_txscore_cache USING GIN(modality_recommendation);
CREATE INDEX IF NOT EXISTS idx_tx_txscore_valid ON tx_txscore_cache(gene_id, cancer_type, tvs) 
    WHERE expires_at IS NULL OR expires_at > NOW();

-- tx_cell_line_metadata indexes
CREATE INDEX IF NOT EXISTS idx_tx_cell_line_cancer_type ON tx_cell_line_metadata(cancer_type);
CREATE INDEX IF NOT EXISTS idx_tx_cell_line_tissue ON tx_cell_line_metadata(tissue_origin);
CREATE INDEX IF NOT EXISTS idx_tx_cell_line_mutation_gin ON tx_cell_line_metadata USING GIN(mutation_profile);

-- tx_tissue_metadata indexes
CREATE INDEX IF NOT EXISTS idx_tx_tissue_category ON tx_tissue_metadata(tissue_category);
CREATE INDEX IF NOT EXISTS idx_tx_tissue_critical ON tx_tissue_metadata(is_critical) WHERE is_critical = TRUE;

-- tx_cancer_type_metadata indexes
CREATE INDEX IF NOT EXISTS idx_tx_cancer_tissue ON tx_cancer_type_metadata(tissue_of_origin);

-- =====================================================================
-- 3. ADD MISSING USER_SAVED_TARGETS TABLE
-- =====================================================================

CREATE TABLE IF NOT EXISTS tx_user_saved_targets (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- User reference
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Gene reference
    gene_id TEXT NOT NULL REFERENCES tx_genes_master(gene_id) ON DELETE CASCADE,
    
    -- Optional cancer type context
    cancer_type TEXT, -- NULL means saved across all cancers
    
    -- User notes
    notes TEXT,
    tags TEXT[] DEFAULT '{}',
    
    -- Priority/ranking
    priority INTEGER DEFAULT 0,
    
    -- Folder organization
    folder TEXT DEFAULT 'default',
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_viewed_at TIMESTAMP WITH TIME ZONE,
    
    -- Unique constraint
    CONSTRAINT tx_unique_user_saved_target UNIQUE (user_id, gene_id, cancer_type)
);

-- Indexes for tx_user_saved_targets
CREATE INDEX IF NOT EXISTS idx_tx_user_saved_targets_user_id ON tx_user_saved_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_user_saved_targets_gene_id ON tx_user_saved_targets(gene_id);
CREATE INDEX IF NOT EXISTS idx_tx_user_saved_targets_cancer_type ON tx_user_saved_targets(cancer_type) WHERE cancer_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_user_saved_targets_priority ON tx_user_saved_targets(user_id, priority DESC);
CREATE INDEX IF NOT EXISTS idx_tx_user_saved_targets_folder ON tx_user_saved_targets(user_id, folder);
CREATE INDEX IF NOT EXISTS idx_tx_user_saved_targets_created ON tx_user_saved_targets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_user_saved_targets_tags_gin ON tx_user_saved_targets USING GIN(tags);

-- Comments
COMMENT ON TABLE tx_user_saved_targets IS 'TxScore: User-saved/bookmarked therapeutic targets';
COMMENT ON COLUMN tx_user_saved_targets.cancer_type IS 'Optional cancer type context; NULL = saved across all cancers';
COMMENT ON COLUMN tx_user_saved_targets.priority IS 'User-defined priority ranking (higher = more important)';
COMMENT ON COLUMN tx_user_saved_targets.folder IS 'Folder for organization';

-- =====================================================================
-- 4. ENABLE RLS FOR NEW TABLE
-- =====================================================================

ALTER TABLE tx_user_saved_targets ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own saved targets" ON tx_user_saved_targets
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved targets" ON tx_user_saved_targets
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own saved targets" ON tx_user_saved_targets
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved targets" ON tx_user_saved_targets
    FOR DELETE USING (auth.uid() = user_id);

-- =====================================================================
-- 5. AUTO-UPDATE TRIGGER
-- =====================================================================

CREATE TRIGGER tx_update_user_saved_targets_updated_at 
    BEFORE UPDATE ON tx_user_saved_targets
    FOR EACH ROW 
    EXECUTE FUNCTION tx_update_updated_at_column();

-- =====================================================================
-- 6. HELPER VIEW WITH ENRICHED DATA
-- =====================================================================

CREATE OR REPLACE VIEW tx_user_saved_targets_enriched AS
SELECT 
    ust.id,
    ust.user_id,
    ust.gene_id,
    g.gene_symbol,
    g.gene_name,
    g.protein_class,
    ust.cancer_type,
    ust.notes,
    ust.tags,
    ust.priority,
    ust.folder,
    ust.created_at,
    ust.updated_at,
    ust.last_viewed_at,
    tc.tvs,
    tc.efficacy_score,
    tc.safety_score,
    tc.druggability_score,
    tc.precedent_score,
    tc.modality_recommendation->>'recommended_modality' AS recommended_modality,
    (SELECT COUNT(*) FROM tx_drug_interactions di WHERE di.gene_id = ust.gene_id) AS drug_count,
    (SELECT COUNT(*) FROM tx_clinical_trials ct WHERE ct.gene_id = ust.gene_id) AS clinical_trial_count
FROM tx_user_saved_targets ust
JOIN tx_genes_master g ON ust.gene_id = g.gene_id
LEFT JOIN tx_txscore_cache tc ON ust.gene_id = tc.gene_id 
    AND (ust.cancer_type IS NULL OR tc.cancer_type = ust.cancer_type OR tc.cancer_type = 'pan-cancer')
ORDER BY ust.priority DESC, ust.created_at DESC;

COMMENT ON VIEW tx_user_saved_targets_enriched IS 'TxScore: User saved targets with enriched gene and score data';

-- =====================================================================
-- 7. BACKWARD COMPATIBILITY VIEW
-- =====================================================================

CREATE OR REPLACE VIEW user_saved_targets AS
SELECT * FROM tx_user_saved_targets;

COMMENT ON VIEW user_saved_targets IS 'TxScore: Compatibility view for tx_user_saved_targets';

-- =====================================================================
-- MIGRATION COMPLETE
-- =====================================================================
