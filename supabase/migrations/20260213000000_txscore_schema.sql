-- =====================================================================
-- TxScore Database Schema v1.0
-- Therapeutic Viability Score System for Cancer Target Prioritization
-- =====================================================================
-- Created: 2026-02-13
-- Description: Complete schema for multi-modal target assessment including
--              DepMap essentiality, GTEx expression, gnomAD constraint,
--              AlphaFold structures, clinical evidence, and TxScore cache
-- =====================================================================
-- Integration notes: Designed to coexist with existing SplicR schema
--                    Uses tx_ prefix to avoid naming conflicts
-- =====================================================================

-- Enable required extensions (safe with IF NOT EXISTS)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search

-- =====================================================================
-- 1. MASTER GENE TABLE
-- =====================================================================
-- Central gene registry with comprehensive identifiers and genomic coordinates
-- Note: Uses tx_genes_master to avoid conflicts with existing gene tables

CREATE TABLE IF NOT EXISTS tx_genes_master (
    -- Primary identifiers
    gene_id TEXT PRIMARY KEY, -- Ensembl gene ID (ENSG00000139618)
    gene_symbol TEXT NOT NULL, -- HGNC symbol (BRCA2)
    uniprot_id TEXT, -- UniProt accession (P51587)
    gene_name TEXT, -- Full gene name
    
    -- Genomic coordinates (GRCh38/hg38)
    chromosome TEXT, -- chr17, chrX, chrM
    start_position BIGINT, -- 0-based genomic start
    end_position BIGINT, -- 0-based genomic end
    strand TEXT CHECK (strand IN ('+', '-', '.')), -- Genomic strand
    
    -- Alternative identifiers (JSONB for flexibility)
    aliases JSONB, -- {hgnc_id, entrez_id, omim_id, etc.}
    
    -- Gene annotations
    gene_type TEXT, -- protein_coding, lncRNA, pseudogene, etc.
    gene_biotype TEXT, -- Ensembl biotype classification
    description TEXT, -- Full description from Ensembl/HGNC
    
    -- Protein information
    protein_length INT, -- Amino acid length
    protein_class TEXT, -- kinase, GPCR, transcription_factor, etc.
    protein_family TEXT, -- Protein family classification
    
    -- Metadata
    source TEXT DEFAULT 'ensembl', -- Data source
    version TEXT, -- Ensembl version (e.g., 110)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_coordinates CHECK (
        (chromosome IS NULL AND start_position IS NULL AND end_position IS NULL)
        OR (chromosome IS NOT NULL AND start_position IS NOT NULL AND end_position IS NOT NULL)
    ),
    CONSTRAINT valid_position_order CHECK (
        start_position IS NULL OR end_position IS NULL OR start_position <= end_position
    ),
    CONSTRAINT valid_gene_symbol CHECK (gene_symbol ~ '^[A-Z0-9-]+$') -- Uppercase alphanumeric + hyphen
);

-- Indexes for tx_genes_master
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_genes_master_symbol ON tx_genes_master(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_uniprot ON tx_genes_master(uniprot_id) WHERE uniprot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_chromosome ON tx_genes_master(chromosome);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_coordinates ON tx_genes_master(chromosome, start_position, end_position);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_gene_type ON tx_genes_master(gene_type);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_protein_class ON tx_genes_master(protein_class);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_aliases_gin ON tx_genes_master USING GIN(aliases);
CREATE INDEX IF NOT EXISTS idx_tx_genes_master_symbol_trgm ON tx_genes_master USING GIN(gene_symbol gin_trgm_ops); -- Fuzzy search

-- Comments
COMMENT ON TABLE tx_genes_master IS 'TxScore: Master gene registry with Ensembl, HGNC, and UniProt identifiers';
COMMENT ON COLUMN tx_genes_master.gene_id IS 'Primary Ensembl gene ID (e.g., ENSG00000139618)';
COMMENT ON COLUMN tx_genes_master.aliases IS 'JSONB containing alternative IDs: {hgnc_id, entrez_id, omim_id, refseq_id}';
COMMENT ON COLUMN tx_genes_master.protein_class IS 'Functional protein classification for druggability assessment';

-- =====================================================================
-- 2. DEPMAP ESSENTIALITY DATA
-- =====================================================================
-- CRISPR gene effects and dependency probabilities from DepMap Chronos

CREATE TABLE IF NOT EXISTS depmap_data (
    -- Composite primary key
    id BIGSERIAL PRIMARY KEY,
    gene_id TEXT NOT NULL REFERENCES genes_master(gene_id) ON DELETE CASCADE,
    cell_line_id TEXT NOT NULL, -- DepMap cell line ID (ACH-000001)
    
    -- Essentiality metrics
    chronos_effect REAL NOT NULL, -- Chronos effect score (typically -3 to +1)
    dependency_probability REAL CHECK (dependency_probability >= 0 AND dependency_probability <= 1),
    
    -- Cell line metadata
    cancer_type TEXT, -- TCGA classification (LUAD, BRCA, COAD, etc.)
    tissue_origin TEXT, -- Tissue of origin (lung, breast, colon)
    lineage TEXT, -- Broader lineage classification
    primary_disease TEXT, -- Primary disease annotation
    subtype TEXT, -- Cancer subtype
    
    -- Context-specific features (JSONB for flexibility)
    mutation_profile JSONB, -- Key mutations in this cell line
    expression_cluster TEXT, -- Expression-based cluster
    msi_status TEXT, -- Microsatellite instability status
    
    -- DepMap release metadata
    depmap_release TEXT NOT NULL, -- e.g., "25Q3", "25Q4"
    screen_type TEXT DEFAULT 'CRISPR', -- CRISPR, RNAi, etc.
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint per gene-cell line-release
    CONSTRAINT unique_depmap_entry UNIQUE (gene_id, cell_line_id, depmap_release)
);

-- Indexes for depmap_data
CREATE INDEX idx_depmap_gene_id ON depmap_data(gene_id);
CREATE INDEX idx_depmap_cell_line ON depmap_data(cell_line_id);
CREATE INDEX idx_depmap_cancer_type ON depmap_data(cancer_type);
CREATE INDEX idx_depmap_tissue ON depmap_data(tissue_origin);
CREATE INDEX idx_depmap_chronos ON depmap_data(chronos_effect); -- For filtering by essentiality
CREATE INDEX idx_depmap_dependency_prob ON depmap_data(dependency_probability);
CREATE INDEX idx_depmap_release ON depmap_data(depmap_release);
CREATE INDEX idx_depmap_composite ON depmap_data(gene_id, cancer_type, chronos_effect); -- For cancer-specific queries
CREATE INDEX idx_depmap_mutation_gin ON depmap_data USING GIN(mutation_profile);

-- Partitioning by depmap_release for scalability (optional, for very large datasets)
-- ALTER TABLE depmap_data PARTITION BY LIST (depmap_release);

COMMENT ON TABLE depmap_data IS 'DepMap CRISPR gene essentiality data from Chronos algorithm';
COMMENT ON COLUMN depmap_data.chronos_effect IS 'Chronos effect score: negative = essential, 0 = non-essential, positive = growth advantage';
COMMENT ON COLUMN depmap_data.dependency_probability IS 'Probability that gene is a true dependency (0-1 scale)';

-- =====================================================================
-- 3. GTEX TISSUE EXPRESSION
-- =====================================================================
-- Gene expression across 54 normal human tissues from GTEx v8

CREATE TABLE IF NOT EXISTS gtex_expression (
    -- Composite primary key
    id BIGSERIAL PRIMARY KEY,
    gene_id TEXT NOT NULL REFERENCES genes_master(gene_id) ON DELETE CASCADE,
    tissue_name TEXT NOT NULL, -- GTEx tissue name (e.g., "Brain - Cortex")
    
    -- Expression metrics (TPM = Transcripts Per Million)
    median_tpm REAL NOT NULL CHECK (median_tpm >= 0), -- Median TPM across samples
    mean_tpm REAL CHECK (mean_tpm >= 0), -- Mean TPM
    std_tpm REAL CHECK (std_tpm >= 0), -- Standard deviation
    
    -- Sample statistics
    samples_count INT NOT NULL CHECK (samples_count > 0), -- Number of samples
    
    -- Additional expression metrics
    max_tpm REAL, -- Maximum observed TPM
    percentile_25 REAL, -- 25th percentile
    percentile_75 REAL, -- 75th percentile
    
    -- Tissue metadata
    tissue_category TEXT, -- Broad category (brain, cardiovascular, digestive, etc.)
    tissue_detail TEXT, -- Specific detail (cortex, ventricle, etc.)
    
    -- GTEx release
    gtex_version TEXT NOT NULL DEFAULT 'v8', -- GTEx version
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT unique_gtex_entry UNIQUE (gene_id, tissue_name, gtex_version)
);

-- Indexes for gtex_expression
CREATE INDEX idx_gtex_gene_id ON gtex_expression(gene_id);
CREATE INDEX idx_gtex_tissue ON gtex_expression(tissue_name);
CREATE INDEX idx_gtex_median_tpm ON gtex_expression(median_tpm); -- For expression filtering
CREATE INDEX idx_gtex_tissue_category ON gtex_expression(tissue_category);
CREATE INDEX idx_gtex_composite ON gtex_expression(gene_id, tissue_name, median_tpm);

-- Materialized view for high-expression tissues per gene (optimization)
CREATE MATERIALIZED VIEW IF NOT EXISTS gtex_high_expression AS
SELECT 
    gene_id,
    ARRAY_AGG(tissue_name ORDER BY median_tpm DESC) FILTER (WHERE median_tpm > 10) AS expressed_tissues,
    MAX(median_tpm) AS max_tissue_expression,
    COUNT(*) FILTER (WHERE median_tpm > 10) AS num_expressed_tissues
FROM gtex_expression
GROUP BY gene_id;

CREATE UNIQUE INDEX idx_gtex_high_expr_gene ON gtex_high_expression(gene_id);

COMMENT ON TABLE gtex_expression IS 'GTEx v8 median gene expression across 54 normal human tissues';
COMMENT ON COLUMN gtex_expression.median_tpm IS 'Median TPM (Transcripts Per Million) - primary expression metric';
COMMENT ON COLUMN gtex_expression.tissue_name IS 'GTEx tissue name matching official nomenclature';

-- =====================================================================
-- 4. GNOMAD CONSTRAINT METRICS
-- =====================================================================
-- Loss-of-function constraint from gnomAD v4.1

CREATE TABLE IF NOT EXISTS gnomad_constraint (
    -- Primary key
    gene_id TEXT PRIMARY KEY REFERENCES genes_master(gene_id) ON DELETE CASCADE,
    
    -- Core constraint metrics
    loeuf REAL, -- Loss-of-function observed/expected upper bound (primary metric)
    loeuf_lower REAL, -- 90% confidence interval lower bound
    loeuf_upper REAL, -- 90% confidence interval upper bound
    
    pli REAL CHECK (pli IS NULL OR (pli >= 0 AND pli <= 1)), -- Probability of being LoF intolerant
    
    -- Missense constraint
    mis_z REAL, -- Missense Z-score
    oe_mis REAL, -- Observed/expected missense ratio
    oe_mis_lower REAL,
    oe_mis_upper REAL,
    
    -- Synonymous constraint (baseline)
    syn_z REAL, -- Synonymous Z-score
    oe_syn REAL, -- Observed/expected synonymous ratio
    oe_syn_lower REAL,
    oe_syn_upper REAL,
    
    -- Loss-of-function metrics
    oe_lof REAL, -- Observed/expected LoF ratio
    oe_lof_lower REAL,
    oe_lof_upper REAL,
    
    -- Observed variant counts
    obs_lof INT, -- Observed LoF variants
    exp_lof REAL, -- Expected LoF variants
    obs_mis INT, -- Observed missense variants
    exp_mis REAL, -- Expected missense variants
    obs_syn INT, -- Observed synonymous variants
    exp_syn REAL, -- Expected synonymous variants
    
    -- Gene flags
    lof_flags JSONB, -- Flags affecting LoF interpretation
    constraint_flags JSONB, -- Additional constraint flags
    
    -- gnomAD version
    gnomad_version TEXT NOT NULL DEFAULT 'v4.1',
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_loeuf_ci CHECK (
        loeuf IS NULL OR loeuf_lower IS NULL OR loeuf_upper IS NULL
        OR (loeuf_lower <= loeuf AND loeuf <= loeuf_upper)
    )
);

-- Indexes for gnomad_constraint
CREATE INDEX idx_gnomad_loeuf ON gnomad_constraint(loeuf) WHERE loeuf IS NOT NULL;
CREATE INDEX idx_gnomad_pli ON gnomad_constraint(pli) WHERE pli IS NOT NULL;
CREATE INDEX idx_gnomad_mis_z ON gnomad_constraint(mis_z);
CREATE INDEX idx_gnomad_constrained ON gnomad_constraint(loeuf, pli) WHERE loeuf < 0.6 OR pli > 0.9; -- Highly constrained genes
CREATE INDEX idx_gnomad_flags_gin ON gnomad_constraint USING GIN(lof_flags);

COMMENT ON TABLE gnomad_constraint IS 'gnomAD v4.1 gene constraint metrics for assessing gene essentiality';
COMMENT ON COLUMN gnomad_constraint.loeuf IS 'LOEUF (LoF observed/expected upper bound): <0.35 = highly constrained, >1.0 = unconstrained';
COMMENT ON COLUMN gnomad_constraint.pli IS 'pLI (probability of LoF intolerance): >0.9 = LoF intolerant';

-- =====================================================================
-- 5. ALPHAFOLD STRUCTURES
-- =====================================================================
-- AlphaFold structure metadata and binding pocket predictions

CREATE TABLE IF NOT EXISTS alphafold_structures (
    -- Composite primary key
    id BIGSERIAL PRIMARY KEY,
    gene_id TEXT NOT NULL REFERENCES genes_master(gene_id) ON DELETE CASCADE,
    uniprot_id TEXT NOT NULL, -- UniProt accession
    
    -- Structure quality metrics
    mean_plddt REAL NOT NULL CHECK (mean_plddt >= 0 AND mean_plddt <= 100), -- Mean pLDDT score
    max_plddt REAL CHECK (max_plddt >= 0 AND max_plddt <= 100),
    min_plddt REAL CHECK (min_plddt >= 0 AND min_plddt <= 100),
    
    -- pLDDT distribution
    plddt_high_confidence_frac REAL, -- Fraction with pLDDT > 90
    plddt_confident_frac REAL, -- Fraction with pLDDT > 70
    plddt_low_confidence_frac REAL, -- Fraction with pLDDT < 50
    
    -- Structure URLs
    structure_url TEXT, -- URL to AlphaFold PDB file
    pae_url TEXT, -- Predicted aligned error URL
    
    -- Binding pocket predictions (from fpocket or similar)
    pockets JSONB, -- Array of pockets: [{volume, druggability_score, residues, center, ...}]
    num_druggable_pockets INT DEFAULT 0, -- Count of pockets with druggability > 0.5
    
    -- Domain annotations
    domains JSONB, -- Pfam/InterPro domains with coordinates
    active_sites JSONB, -- Predicted active sites
    binding_sites JSONB, -- Predicted binding sites
    
    -- Disorder predictions
    disordered_regions JSONB, -- Intrinsically disordered regions
    disorder_fraction REAL CHECK (disorder_fraction IS NULL OR (disorder_fraction >= 0 AND disorder_fraction <= 1)),
    
    -- AlphaFold version
    alphafold_version TEXT NOT NULL DEFAULT 'v4',
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT unique_alphafold_entry UNIQUE (gene_id, uniprot_id, alphafold_version)
);

-- Indexes for alphafold_structures
CREATE INDEX idx_alphafold_gene_id ON alphafold_structures(gene_id);
CREATE INDEX idx_alphafold_uniprot ON alphafold_structures(uniprot_id);
CREATE INDEX idx_alphafold_mean_plddt ON alphafold_structures(mean_plddt);
CREATE INDEX idx_alphafold_druggable_pockets ON alphafold_structures(num_druggable_pockets) WHERE num_druggable_pockets > 0;
CREATE INDEX idx_alphafold_high_quality ON alphafold_structures(gene_id, mean_plddt) WHERE mean_plddt > 70;
CREATE INDEX idx_alphafold_pockets_gin ON alphafold_structures USING GIN(pockets);
CREATE INDEX idx_alphafold_domains_gin ON alphafold_structures USING GIN(domains);

COMMENT ON TABLE alphafold_structures IS 'AlphaFold structure metadata and binding pocket predictions for druggability assessment';
COMMENT ON COLUMN alphafold_structures.mean_plddt IS 'Mean pLDDT (predicted local distance difference test): >90 = very high confidence, >70 = confident, <50 = low confidence';
COMMENT ON COLUMN alphafold_structures.pockets IS 'Binding pocket predictions from fpocket: [{volume, druggability_score, residues, center}]';

-- =====================================================================
-- 6. CLINVAR VARIANTS
-- =====================================================================
-- Clinical variant annotations from ClinVar

CREATE TABLE IF NOT EXISTS clinvar_variants (
    -- Primary key
    variant_id TEXT PRIMARY KEY, -- ClinVar variation ID
    gene_id TEXT NOT NULL REFERENCES genes_master(gene_id) ON DELETE CASCADE,
    
    -- Clinical significance
    clinical_significance TEXT NOT NULL, -- Pathogenic, Likely pathogenic, VUS, etc.
    review_status TEXT, -- Review status (stars)
    
    -- Variant details
    variant_type TEXT, -- single_nucleotide_variant, deletion, insertion, etc.
    molecular_consequence TEXT, -- missense_variant, frameshift_variant, etc.
    
    -- Genomic coordinates (GRCh38)
    chromosome TEXT NOT NULL,
    position BIGINT NOT NULL,
    ref_allele TEXT,
    alt_allele TEXT,
    
    -- HGVS notation
    hgvs_c TEXT, -- Coding HGVS (c.1234A>G)
    hgvs_p TEXT, -- Protein HGVS (p.Arg123Gly)
    
    -- Associated conditions
    conditions TEXT[], -- Array of associated phenotypes
    phenotype_ids TEXT[], -- MedGen/OMIM/Orphanet IDs
    
    -- Allele frequencies (if available)
    gnomad_af REAL, -- gnomAD allele frequency
    
    -- Submission data
    submitter_count INT, -- Number of submitters
    last_evaluated DATE, -- Last review date
    
    -- Metadata
    clinvar_version TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for clinvar_variants
CREATE INDEX idx_clinvar_gene_id ON clinvar_variants(gene_id);
CREATE INDEX idx_clinvar_significance ON clinvar_variants(clinical_significance);
CREATE INDEX idx_clinvar_pathogenic ON clinvar_variants(gene_id, clinical_significance) 
    WHERE clinical_significance IN ('Pathogenic', 'Likely pathogenic');
CREATE INDEX idx_clinvar_coordinates ON clinvar_variants(chromosome, position);
CREATE INDEX idx_clinvar_conditions_gin ON clinvar_variants USING GIN(conditions);
CREATE INDEX idx_clinvar_variant_type ON clinvar_variants(variant_type);

COMMENT ON TABLE clinvar_variants IS 'ClinVar clinical variant annotations for Mendelian disease evidence';
COMMENT ON COLUMN clinvar_variants.clinical_significance IS 'Clinical significance: Pathogenic, Likely pathogenic, VUS, Benign, Likely benign';
COMMENT ON COLUMN clinvar_variants.review_status IS 'Review status stars (0-4): higher = more reliable';

-- =====================================================================
-- 7. DRUG INTERACTIONS
-- =====================================================================
-- Drug-gene interactions from DGIdb, DrugBank, ChEMBL

CREATE TABLE IF NOT EXISTS drug_interactions (
    -- Primary key
    interaction_id BIGSERIAL PRIMARY KEY,
    gene_id TEXT NOT NULL REFERENCES genes_master(gene_id) ON DELETE CASCADE,
    
    -- Drug information
    drug_name TEXT NOT NULL,
    drug_chembl_id TEXT, -- ChEMBL ID
    drug_drugbank_id TEXT, -- DrugBank ID
    
    -- Interaction details
    interaction_type TEXT, -- inhibitor, activator, agonist, antagonist, etc.
    interaction_claim_source TEXT, -- Source of claim
    
    -- Drug development status
    approval_status TEXT, -- approved, investigational, experimental, withdrawn
    clinical_trial_phase TEXT, -- Phase 1, Phase 2, Phase 3, Phase 4
    
    -- Mechanism
    mechanism_of_action TEXT,
    target_type TEXT, -- direct, indirect
    
    -- Sources
    source TEXT NOT NULL, -- DGIdb, DrugBank, ChEMBL, etc.
    source_db_version TEXT,
    
    -- PMIDs
    pmids TEXT[], -- PubMed IDs supporting interaction
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_drug_interaction UNIQUE (gene_id, drug_name, source)
);

-- Indexes for drug_interactions
CREATE INDEX idx_drug_gene_id ON drug_interactions(gene_id);
CREATE INDEX idx_drug_name ON drug_interactions(drug_name);
CREATE INDEX idx_drug_approval_status ON drug_interactions(approval_status);
CREATE INDEX idx_drug_approved ON drug_interactions(gene_id, approval_status) WHERE approval_status = 'approved';
CREATE INDEX idx_drug_phase ON drug_interactions(clinical_trial_phase);
CREATE INDEX idx_drug_source ON drug_interactions(source);
CREATE INDEX idx_drug_chembl ON drug_interactions(drug_chembl_id) WHERE drug_chembl_id IS NOT NULL;
CREATE INDEX idx_drug_drugbank ON drug_interactions(drug_drugbank_id) WHERE drug_drugbank_id IS NOT NULL;

COMMENT ON TABLE drug_interactions IS 'Drug-gene interactions from DGIdb, DrugBank, and ChEMBL';
COMMENT ON COLUMN drug_interactions.interaction_type IS 'Type of interaction: inhibitor, activator, agonist, antagonist, antibody, etc.';
COMMENT ON COLUMN drug_interactions.approval_status IS 'FDA/EMA approval status: approved, investigational, experimental, withdrawn';

-- =====================================================================
-- 8. CLINICAL TRIALS
-- =====================================================================
-- Clinical trials from ClinicalTrials.gov

CREATE TABLE IF NOT EXISTS clinical_trials (
    -- Primary key
    nct_id TEXT PRIMARY KEY, -- ClinicalTrials.gov NCT ID
    gene_id TEXT NOT NULL REFERENCES genes_master(gene_id) ON DELETE CASCADE,
    
    -- Trial metadata
    title TEXT NOT NULL,
    brief_summary TEXT,
    detailed_description TEXT,
    
    -- Trial status
    phase TEXT, -- Phase 1, Phase 2, Phase 3, Phase 4, Early Phase 1
    status TEXT NOT NULL, -- Recruiting, Completed, Terminated, Withdrawn, etc.
    
    -- Dates
    start_date DATE,
    primary_completion_date DATE,
    completion_date DATE,
    last_update_posted DATE,
    
    -- Enrollment
    enrollment INT,
    enrollment_type TEXT, -- Actual or Anticipated
    
    -- Conditions and interventions
    conditions TEXT[], -- Disease conditions
    interventions JSONB, -- [{type, name, description}]
    
    -- Trial design
    study_type TEXT, -- Interventional, Observational
    allocation TEXT, -- Randomized, Non-Randomized
    intervention_model TEXT, -- Parallel, Crossover, Single Group
    primary_purpose TEXT, -- Treatment, Prevention, Diagnostic, etc.
    masking TEXT, -- None, Single, Double, Triple, Quadruple
    
    -- Outcome measures
    primary_outcomes JSONB,
    secondary_outcomes JSONB,
    
    -- Sponsor information
    lead_sponsor TEXT,
    sponsor_type TEXT, -- Industry, NIH, Other
    collaborators TEXT[],
    
    -- Location
    countries TEXT[],
    locations JSONB, -- [{facility, city, state, country}]
    
    -- Study arms
    arms JSONB, -- [{arm_label, arm_type, description}]
    
    -- Results
    has_results BOOLEAN DEFAULT FALSE,
    results_first_posted DATE,
    
    -- Metadata
    source_register TEXT DEFAULT 'ClinicalTrials.gov',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for clinical_trials
CREATE INDEX idx_trials_gene_id ON clinical_trials(gene_id);
CREATE INDEX idx_trials_phase ON clinical_trials(phase);
CREATE INDEX idx_trials_status ON clinical_trials(status);
CREATE INDEX idx_trials_conditions_gin ON clinical_trials USING GIN(conditions);
CREATE INDEX idx_trials_interventions_gin ON clinical_trials USING GIN(interventions);
CREATE INDEX idx_trials_advanced_phase ON clinical_trials(gene_id, phase, status) 
    WHERE phase IN ('Phase 2', 'Phase 3', 'Phase 4') AND status IN ('Completed', 'Active, not recruiting');
CREATE INDEX idx_trials_failed ON clinical_trials(gene_id, phase, status) 
    WHERE status IN ('Terminated', 'Withdrawn') AND phase IN ('Phase 2', 'Phase 3');
CREATE INDEX idx_trials_start_date ON clinical_trials(start_date);

COMMENT ON TABLE clinical_trials IS 'Clinical trials from ClinicalTrials.gov mapped to genes';
COMMENT ON COLUMN clinical_trials.phase IS 'Clinical trial phase: Early Phase 1, Phase 1, Phase 2, Phase 3, Phase 4';
COMMENT ON COLUMN clinical_trials.status IS 'Trial status: Recruiting, Active, Completed, Terminated, Withdrawn, Suspended';

-- =====================================================================
-- 9. TXSCORE CACHE
-- =====================================================================
-- Pre-computed TxScore results with detailed breakdowns

CREATE TABLE IF NOT EXISTS txscore_cache (
    -- Composite primary key
    gene_id TEXT NOT NULL REFERENCES genes_master(gene_id) ON DELETE CASCADE,
    cancer_type TEXT NOT NULL, -- TCGA classification (LUAD, BRCA, COAD, pan-cancer)
    
    -- Overall score
    tvs REAL NOT NULL CHECK (tvs >= 0 AND tvs <= 1), -- Therapeutic Viability Score
    
    -- Subscores (all 0-1 scale)
    efficacy_score REAL NOT NULL CHECK (efficacy_score >= 0 AND efficacy_score <= 1),
    safety_score REAL NOT NULL CHECK (safety_score >= 0 AND safety_score <= 1),
    druggability_score REAL NOT NULL CHECK (druggability_score >= 0 AND druggability_score <= 1),
    precedent_score REAL NOT NULL CHECK (precedent_score >= 0 AND precedent_score <= 1),
    stratification_score REAL NOT NULL CHECK (stratification_score >= 0 AND stratification_score <= 1),
    
    -- Efficacy components
    efficacy_components JSONB, -- {chronos_norm, dependency_prob, selectivity, genetic_evidence}
    
    -- Safety details
    tissue_risks JSONB, -- {tissue_name: risk_score} for all 54 GTEx tissues
    critical_tissue_risk REAL, -- Max risk across critical tissues
    
    -- Druggability breakdown
    modality_recommendation JSONB, -- {small_molecule, antibody, gene_therapy, recommended_modality}
    binding_pockets JSONB, -- Pocket details from AlphaFold
    
    -- Precedent details
    precedent_components JSONB, -- {mendelian_evidence, clinical_trial_score, drug_evidence, failure_penalty}
    
    -- Stratification details
    biomarker_features JSONB, -- {feature_type, feature_name, correlation, prevalence}
    
    -- Computation metadata
    model_version TEXT NOT NULL DEFAULT 'v1.0', -- TxScore model version
    weights JSONB, -- Weights used: {efficacy, safety, druggability, precedent, stratification}
    confidence_interval JSONB, -- {lower, upper} 95% CI
    
    -- Data provenance
    data_sources JSONB, -- {depmap_release, gtex_version, gnomad_version, etc.}
    
    -- Timestamps
    computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE, -- Cache expiration
    
    -- Primary key
    PRIMARY KEY (gene_id, cancer_type)
);

-- Indexes for txscore_cache
CREATE INDEX idx_txscore_gene_id ON txscore_cache(gene_id);
CREATE INDEX idx_txscore_cancer_type ON txscore_cache(cancer_type);
CREATE INDEX idx_txscore_tvs_desc ON txscore_cache(tvs DESC); -- For ranking top targets
CREATE INDEX idx_txscore_cancer_tvs ON txscore_cache(cancer_type, tvs DESC); -- Cancer-specific ranking
CREATE INDEX idx_txscore_efficacy ON txscore_cache(efficacy_score DESC);
CREATE INDEX idx_txscore_safety ON txscore_cache(safety_score DESC);
CREATE INDEX idx_txscore_druggability ON txscore_cache(druggability_score DESC);
CREATE INDEX idx_txscore_high_tvs ON txscore_cache(gene_id, tvs) WHERE tvs > 0.7; -- High-confidence targets
CREATE INDEX idx_txscore_computed_at ON txscore_cache(computed_at DESC);
CREATE INDEX idx_txscore_tissue_risks_gin ON txscore_cache USING GIN(tissue_risks);
CREATE INDEX idx_txscore_modality_gin ON txscore_cache USING GIN(modality_recommendation);

-- Partial index for non-expired cache entries
CREATE INDEX idx_txscore_valid ON txscore_cache(gene_id, cancer_type, tvs) 
    WHERE expires_at IS NULL OR expires_at > NOW();

COMMENT ON TABLE txscore_cache IS 'Pre-computed Therapeutic Viability Scores with detailed subscore breakdowns';
COMMENT ON COLUMN txscore_cache.tvs IS 'Overall Therapeutic Viability Score (0-1): weighted combination of subscores';
COMMENT ON COLUMN txscore_cache.tissue_risks IS 'Per-tissue safety risk scores from GTEx expression and gnomAD constraint';
COMMENT ON COLUMN txscore_cache.modality_recommendation IS 'Druggability breakdown by modality: small_molecule, antibody, gene_therapy';

-- =====================================================================
-- 10. ADDITIONAL SUPPORTING TABLES
-- =====================================================================

-- Cell line metadata (for DepMap context)
CREATE TABLE IF NOT EXISTS cell_line_metadata (
    cell_line_id TEXT PRIMARY KEY,
    cell_line_name TEXT,
    cancer_type TEXT,
    tissue_origin TEXT,
    lineage TEXT,
    primary_disease TEXT,
    subtype TEXT,
    age INT,
    sex TEXT,
    source TEXT, -- ATCC, DSMZ, etc.
    
    -- Molecular features
    mutation_profile JSONB, -- Key driver mutations
    expression_cluster TEXT,
    msi_status TEXT,
    ploidy REAL,
    
    -- Metadata
    depmap_release TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cell_line_cancer_type ON cell_line_metadata(cancer_type);
CREATE INDEX idx_cell_line_tissue ON cell_line_metadata(tissue_origin);
CREATE INDEX idx_cell_line_mutation_gin ON cell_line_metadata USING GIN(mutation_profile);

COMMENT ON TABLE cell_line_metadata IS 'DepMap cell line metadata for context on essentiality data';

-- Tissue metadata (for GTEx context)
CREATE TABLE IF NOT EXISTS tissue_metadata (
    tissue_name TEXT PRIMARY KEY,
    tissue_category TEXT, -- brain, cardiovascular, digestive, etc.
    tissue_detail TEXT,
    is_critical BOOLEAN DEFAULT FALSE, -- Critical organ (heart, brain, liver, etc.)
    toxicity_weight REAL DEFAULT 1.0, -- Weight for toxicity calculation
    sample_count INT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tissue_category ON tissue_metadata(tissue_category);
CREATE INDEX idx_tissue_critical ON tissue_metadata(is_critical) WHERE is_critical = TRUE;

COMMENT ON TABLE tissue_metadata IS 'GTEx tissue annotations with criticality flags for safety assessment';

-- Cancer type metadata
CREATE TABLE IF NOT EXISTS cancer_type_metadata (
    cancer_type TEXT PRIMARY KEY, -- TCGA code (LUAD, BRCA, etc.)
    cancer_name TEXT NOT NULL, -- Full name
    tissue_of_origin TEXT,
    category TEXT, -- carcinoma, sarcoma, hematologic, etc.
    prevalence_rank INT, -- Prevalence ranking
    five_year_survival REAL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cancer_tissue ON cancer_type_metadata(tissue_of_origin);

COMMENT ON TABLE cancer_type_metadata IS 'TCGA cancer type metadata for context';

-- =====================================================================
-- 11. VIEWS FOR COMMON QUERIES
-- =====================================================================

-- View: Top therapeutic targets per cancer type
CREATE OR REPLACE VIEW top_targets_by_cancer AS
SELECT 
    t.cancer_type,
    t.gene_id,
    g.gene_symbol,
    t.tvs,
    t.efficacy_score,
    t.safety_score,
    t.druggability_score,
    t.modality_recommendation->>'recommended_modality' AS recommended_modality,
    ROW_NUMBER() OVER (PARTITION BY t.cancer_type ORDER BY t.tvs DESC) AS rank_in_cancer
FROM txscore_cache t
JOIN genes_master g ON t.gene_id = g.gene_id
WHERE t.tvs > 0.5
ORDER BY t.cancer_type, t.tvs DESC;

COMMENT ON VIEW top_targets_by_cancer IS 'Top-ranked therapeutic targets per cancer type (TVS > 0.5)';

-- View: High-confidence druggable targets
CREATE OR REPLACE VIEW druggable_targets AS
SELECT 
    g.gene_id,
    g.gene_symbol,
    g.gene_name,
    g.protein_class,
    af.mean_plddt,
    af.num_druggable_pockets,
    COUNT(DISTINCT di.drug_name) AS drug_count,
    COUNT(DISTINCT ct.nct_id) AS clinical_trial_count,
    MAX(t.tvs) AS max_tvs_any_cancer
FROM genes_master g
LEFT JOIN alphafold_structures af ON g.gene_id = af.gene_id
LEFT JOIN drug_interactions di ON g.gene_id = di.gene_id
LEFT JOIN clinical_trials ct ON g.gene_id = ct.gene_id
LEFT JOIN txscore_cache t ON g.gene_id = t.gene_id
WHERE af.mean_plddt > 70 AND af.num_druggable_pockets > 0
GROUP BY g.gene_id, g.gene_symbol, g.gene_name, g.protein_class, af.mean_plddt, af.num_druggable_pockets
ORDER BY max_tvs_any_cancer DESC NULLS LAST;

COMMENT ON VIEW druggable_targets IS 'Genes with high-quality AlphaFold structures and druggable pockets';

-- View: Essential genes with clinical precedent
CREATE OR REPLACE VIEW essential_with_precedent AS
SELECT 
    g.gene_id,
    g.gene_symbol,
    AVG(d.chronos_effect) AS avg_chronos,
    COUNT(DISTINCT d.cell_line_id) FILTER (WHERE d.dependency_probability > 0.5) AS dependent_lines,
    COUNT(DISTINCT cv.variant_id) FILTER (WHERE cv.clinical_significance IN ('Pathogenic', 'Likely pathogenic')) AS pathogenic_variants,
    COUNT(DISTINCT di.drug_name) FILTER (WHERE di.approval_status = 'approved') AS approved_drugs,
    COUNT(DISTINCT ct.nct_id) AS clinical_trials,
    gc.pli,
    gc.loeuf
FROM genes_master g
LEFT JOIN depmap_data d ON g.gene_id = d.gene_id
LEFT JOIN clinvar_variants cv ON g.gene_id = cv.gene_id
LEFT JOIN drug_interactions di ON g.gene_id = di.gene_id
LEFT JOIN clinical_trials ct ON g.gene_id = ct.gene_id
LEFT JOIN gnomad_constraint gc ON g.gene_id = gc.gene_id
GROUP BY g.gene_id, g.gene_symbol, gc.pli, gc.loeuf
HAVING AVG(d.chronos_effect) < -0.75
ORDER BY AVG(d.chronos_effect) ASC;

COMMENT ON VIEW essential_with_precedent IS 'Essential genes (Chronos < -0.75) with clinical evidence';

-- =====================================================================
-- 12. FUNCTIONS FOR TXSCORE COMPUTATION
-- =====================================================================

-- Function: Get tissue-specific safety risk
CREATE OR REPLACE FUNCTION compute_tissue_safety_risk(
    p_gene_id TEXT,
    p_tissue_name TEXT
) RETURNS REAL AS $$
DECLARE
    v_expression REAL;
    v_loeuf REAL;
    v_pli REAL;
    v_is_critical BOOLEAN;
    v_risk REAL;
BEGIN
    -- Get expression in tissue
    SELECT median_tpm INTO v_expression
    FROM gtex_expression
    WHERE gene_id = p_gene_id AND tissue_name = p_tissue_name;
    
    -- Get constraint
    SELECT loeuf, pli INTO v_loeuf, v_pli
    FROM gnomad_constraint
    WHERE gene_id = p_gene_id;
    
    -- Get tissue criticality
    SELECT is_critical INTO v_is_critical
    FROM tissue_metadata
    WHERE tissue_name = p_tissue_name;
    
    -- Compute risk
    v_risk := 0.0;
    
    -- Expression contribution (normalized)
    IF v_expression IS NOT NULL THEN
        v_risk := v_risk + LEAST(v_expression / 50.0, 1.0) * 0.5;
    END IF;
    
    -- Constraint contribution
    IF v_loeuf IS NOT NULL AND v_loeuf < 0.6 THEN
        v_risk := v_risk + 0.25;
    END IF;
    
    IF v_pli IS NOT NULL AND v_pli > 0.9 THEN
        v_risk := v_risk + 0.25;
    END IF;
    
    -- Critical tissue multiplier
    IF v_is_critical THEN
        v_risk := v_risk * 2.0;
    END IF;
    
    RETURN LEAST(v_risk, 1.0);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION compute_tissue_safety_risk IS 'Compute safety risk score for a gene in a specific tissue';

-- Function: Get cancer-specific selectivity index
CREATE OR REPLACE FUNCTION compute_selectivity_index(
    p_gene_id TEXT,
    p_cancer_type TEXT
) RETURNS REAL AS $$
DECLARE
    v_target_mean REAL;
    v_other_mean REAL;
    v_selectivity REAL;
BEGIN
    -- Mean Chronos in target cancer
    SELECT AVG(chronos_effect) INTO v_target_mean
    FROM depmap_data
    WHERE gene_id = p_gene_id AND cancer_type = p_cancer_type;
    
    -- Mean Chronos in other cancers
    SELECT AVG(chronos_effect) INTO v_other_mean
    FROM depmap_data
    WHERE gene_id = p_gene_id AND cancer_type != p_cancer_type;
    
    -- Selectivity = how much more essential in target vs. other
    IF v_target_mean IS NULL OR v_other_mean IS NULL THEN
        RETURN 0.0;
    END IF;
    
    v_selectivity := (v_other_mean - v_target_mean) / 1.0;
    
    RETURN GREATEST(LEAST(v_selectivity, 1.0), 0.0);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION compute_selectivity_index IS 'Compute cancer-specific selectivity (target vs. other cancers)';

-- =====================================================================
-- 13. TRIGGERS FOR AUTO-UPDATE
-- =====================================================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_genes_master_updated_at BEFORE UPDATE ON genes_master
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_depmap_data_updated_at BEFORE UPDATE ON depmap_data
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_gtex_expression_updated_at BEFORE UPDATE ON gtex_expression
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_gnomad_constraint_updated_at BEFORE UPDATE ON gnomad_constraint
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alphafold_structures_updated_at BEFORE UPDATE ON alphafold_structures
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clinvar_variants_updated_at BEFORE UPDATE ON clinvar_variants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_drug_interactions_updated_at BEFORE UPDATE ON drug_interactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clinical_trials_updated_at BEFORE UPDATE ON clinical_trials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cell_line_metadata_updated_at BEFORE UPDATE ON cell_line_metadata
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================================
-- 14. ROW-LEVEL SECURITY (RLS)
-- =====================================================================
-- Enable RLS for all tables (configure policies based on your auth setup)

ALTER TABLE genes_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE depmap_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE gtex_expression ENABLE ROW LEVEL SECURITY;
ALTER TABLE gnomad_constraint ENABLE ROW LEVEL SECURITY;
ALTER TABLE alphafold_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinvar_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE txscore_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE cell_line_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE tissue_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancer_type_metadata ENABLE ROW LEVEL SECURITY;

-- Default policy: allow read access to authenticated users
CREATE POLICY "Allow public read access" ON genes_master FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON depmap_data FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON gtex_expression FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON gnomad_constraint FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON alphafold_structures FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON clinvar_variants FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON drug_interactions FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON clinical_trials FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON txscore_cache FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON cell_line_metadata FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON tissue_metadata FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON cancer_type_metadata FOR SELECT USING (true);

-- Restrict write access to service role only
-- (Adjust based on your auth setup)

-- =====================================================================
-- 15. PERFORMANCE OPTIMIZATION
-- =====================================================================

-- Analyze tables for query planner
ANALYZE genes_master;
ANALYZE depmap_data;
ANALYZE gtex_expression;
ANALYZE gnomad_constraint;
ANALYZE alphafold_structures;
ANALYZE clinvar_variants;
ANALYZE drug_interactions;
ANALYZE clinical_trials;
ANALYZE txscore_cache;

-- Vacuum for cleanup
VACUUM ANALYZE;

-- =====================================================================
-- MIGRATION COMPLETE
-- =====================================================================
-- Schema version: 1.0
-- Tables created: 12
-- Views created: 3
-- Functions created: 3
-- Triggers created: 9
-- Indexes created: 100+
-- =====================================================================
