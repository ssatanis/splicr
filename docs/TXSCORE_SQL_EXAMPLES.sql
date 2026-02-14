-- =====================================================================
-- TXSCORE QUICK REFERENCE - SQL QUERY EXAMPLES
-- =====================================================================
-- All queries use the revised tx_ prefixed table names
-- Compatible with SplicR database schema
-- =====================================================================

-- =====================================================================
-- 1. GENE QUERIES
-- =====================================================================

-- Get gene by symbol
SELECT * FROM tx_genes_master WHERE gene_symbol = 'TP53';

-- Search genes by partial match
SELECT gene_symbol, gene_name, protein_class 
FROM tx_genes_master 
WHERE gene_symbol LIKE 'BRCA%';

-- Fuzzy search with ranking
SELECT * FROM tx_search_genes_ranked('tp53', 10);

-- Get all kinases
SELECT gene_symbol, gene_name 
FROM tx_genes_master 
WHERE protein_class = 'kinase'
ORDER BY gene_symbol;

-- =====================================================================
-- 2. DEPMAP ESSENTIALITY QUERIES
-- =====================================================================

-- Get DepMap data for a gene in lung cancer
SELECT 
    d.cell_line_id,
    d.chronos_effect,
    d.dependency_probability,
    d.cancer_type,
    d.tissue_origin
FROM tx_depmap_data d
JOIN tx_genes_master g ON d.gene_id = g.gene_id
WHERE g.gene_symbol = 'KRAS'
  AND d.cancer_type = 'LUAD'
ORDER BY d.chronos_effect ASC;

-- Find essential genes in a cancer type (using function)
SELECT * FROM tx_get_essential_genes('BRCA', -0.75, 0.5);

-- Get mean essentiality across all cancer types
SELECT 
    g.gene_symbol,
    d.cancer_type,
    AVG(d.chronos_effect) as avg_chronos,
    COUNT(*) as cell_line_count
FROM tx_depmap_data d
JOIN tx_genes_master g ON d.gene_id = g.gene_id
WHERE g.gene_symbol IN ('EGFR', 'KRAS', 'TP53')
GROUP BY g.gene_symbol, d.cancer_type
ORDER BY d.cancer_type, avg_chronos ASC;

-- =====================================================================
-- 3. GTEX EXPRESSION QUERIES
-- =====================================================================

-- Get tissue expression for a gene
SELECT 
    tissue_name,
    median_tpm,
    samples_count
FROM tx_gtex_expression
WHERE gene_id = (SELECT gene_id FROM tx_genes_master WHERE gene_symbol = 'EGFR')
ORDER BY median_tpm DESC;

-- Find highly expressed tissues (TPM > 10)
SELECT 
    g.gene_symbol,
    e.tissue_name,
    e.median_tpm,
    e.tissue_category
FROM tx_gtex_expression e
JOIN tx_genes_master g ON e.gene_id = g.gene_id
WHERE g.gene_symbol = 'MYC'
  AND e.median_tpm > 10
ORDER BY e.median_tpm DESC;

-- Use materialized view for quick lookup
SELECT * FROM tx_gtex_high_expression
WHERE gene_id = (SELECT gene_id FROM tx_genes_master WHERE gene_symbol = 'BRCA1');

-- =====================================================================
-- 4. GNOMAD CONSTRAINT QUERIES
-- =====================================================================

-- Get constraint metrics for a gene
SELECT 
    g.gene_symbol,
    c.loeuf,
    c.pli,
    c.mis_z,
    CASE 
        WHEN c.loeuf < 0.35 THEN 'Highly constrained'
        WHEN c.loeuf < 0.6 THEN 'Constrained'
        ELSE 'Unconstrained'
    END as constraint_category
FROM tx_gnomad_constraint c
JOIN tx_genes_master g ON c.gene_id = g.gene_id
WHERE g.gene_symbol = 'TP53';

-- Find highly constrained genes (LoF intolerant)
SELECT 
    g.gene_symbol,
    c.loeuf,
    c.pli,
    c.obs_lof,
    c.exp_lof
FROM tx_gnomad_constraint c
JOIN tx_genes_master g ON c.gene_id = g.gene_id
WHERE c.loeuf < 0.35 OR c.pli > 0.9
ORDER BY c.loeuf ASC;

-- =====================================================================
-- 5. ALPHAFOLD STRUCTURE QUERIES
-- =====================================================================

-- Get structure quality for a gene
SELECT 
    g.gene_symbol,
    s.mean_plddt,
    s.num_druggable_pockets,
    s.structure_url,
    CASE 
        WHEN s.mean_plddt > 90 THEN 'Very high confidence'
        WHEN s.mean_plddt > 70 THEN 'Confident'
        WHEN s.mean_plddt > 50 THEN 'Low confidence'
        ELSE 'Very low confidence'
    END as quality_category
FROM tx_alphafold_structures s
JOIN tx_genes_master g ON s.gene_id = g.gene_id
WHERE g.gene_symbol = 'EGFR';

-- Find druggable targets (high-quality structures with pockets)
SELECT 
    g.gene_symbol,
    g.protein_class,
    s.mean_plddt,
    s.num_druggable_pockets,
    s.pockets
FROM tx_alphafold_structures s
JOIN tx_genes_master g ON s.gene_id = g.gene_id
WHERE s.mean_plddt > 70
  AND s.num_druggable_pockets > 0
ORDER BY s.num_druggable_pockets DESC, s.mean_plddt DESC
LIMIT 20;

-- =====================================================================
-- 6. CLINVAR VARIANT QUERIES
-- =====================================================================

-- Get pathogenic variants for a gene
SELECT 
    g.gene_symbol,
    v.variant_id,
    v.clinical_significance,
    v.hgvs_c,
    v.hgvs_p,
    v.conditions
FROM tx_clinvar_variants v
JOIN tx_genes_master g ON v.gene_id = g.gene_id
WHERE g.gene_symbol = 'BRCA1'
  AND v.clinical_significance IN ('Pathogenic', 'Likely pathogenic')
ORDER BY v.clinical_significance, v.variant_id;

-- Count pathogenic variants per gene
SELECT 
    g.gene_symbol,
    COUNT(*) FILTER (WHERE v.clinical_significance = 'Pathogenic') as pathogenic_count,
    COUNT(*) FILTER (WHERE v.clinical_significance = 'Likely pathogenic') as likely_pathogenic_count,
    COUNT(*) as total_variants
FROM tx_genes_master g
LEFT JOIN tx_clinvar_variants v ON g.gene_id = v.gene_id
WHERE g.gene_symbol IN ('TP53', 'BRCA1', 'BRCA2')
GROUP BY g.gene_symbol;

-- =====================================================================
-- 7. DRUG INTERACTION QUERIES
-- =====================================================================

-- Get approved drugs for a gene
SELECT 
    g.gene_symbol,
    d.drug_name,
    d.interaction_type,
    d.mechanism_of_action,
    d.approval_status
FROM tx_drug_interactions d
JOIN tx_genes_master g ON d.gene_id = g.gene_id
WHERE g.gene_symbol = 'EGFR'
  AND d.approval_status = 'approved'
ORDER BY d.drug_name;

-- Count drugs by development phase
SELECT 
    g.gene_symbol,
    d.approval_status,
    COUNT(*) as drug_count
FROM tx_drug_interactions d
JOIN tx_genes_master g ON d.gene_id = g.gene_id
WHERE g.gene_symbol IN ('EGFR', 'BRAF', 'ALK')
GROUP BY g.gene_symbol, d.approval_status
ORDER BY g.gene_symbol, d.approval_status;

-- Find genes with no approved drugs (undrugged targets)
SELECT 
    g.gene_symbol,
    g.protein_class,
    COUNT(d.drug_name) as investigational_drugs
FROM tx_genes_master g
LEFT JOIN tx_drug_interactions d ON g.gene_id = d.gene_id 
    AND d.approval_status != 'approved'
WHERE NOT EXISTS (
    SELECT 1 FROM tx_drug_interactions d2 
    WHERE d2.gene_id = g.gene_id 
    AND d2.approval_status = 'approved'
)
AND g.protein_class IN ('kinase', 'GPCR')
GROUP BY g.gene_symbol, g.protein_class
ORDER BY investigational_drugs DESC;

-- =====================================================================
-- 8. CLINICAL TRIAL QUERIES
-- =====================================================================

-- Get trials for a gene
SELECT 
    g.gene_symbol,
    t.nct_id,
    t.title,
    t.phase,
    t.status,
    t.conditions
FROM tx_clinical_trials t
JOIN tx_genes_master g ON t.gene_id = g.gene_id
WHERE g.gene_symbol = 'KRAS'
  AND t.phase IN ('Phase 2', 'Phase 3')
ORDER BY t.phase, t.status;

-- Count trials by phase and status
SELECT 
    g.gene_symbol,
    t.phase,
    t.status,
    COUNT(*) as trial_count
FROM tx_clinical_trials t
JOIN tx_genes_master g ON t.gene_id = g.gene_id
WHERE g.gene_symbol IN ('PD1', 'PDL1', 'CTLA4')
GROUP BY g.gene_symbol, t.phase, t.status
ORDER BY g.gene_symbol, t.phase;

-- =====================================================================
-- 9. TXSCORE QUERIES
-- =====================================================================

-- Get TxScore for a gene in a cancer type
SELECT 
    g.gene_symbol,
    t.cancer_type,
    t.tvs,
    t.efficacy_score,
    t.safety_score,
    t.druggability_score,
    t.precedent_score,
    t.stratification_score
FROM tx_txscore_cache t
JOIN tx_genes_master g ON t.gene_id = g.gene_id
WHERE g.gene_symbol = 'EGFR'
  AND t.cancer_type = 'LUAD';

-- Get top 10 targets for lung cancer
SELECT 
    g.gene_symbol,
    t.tvs,
    t.efficacy_score,
    t.safety_score,
    t.druggability_score,
    t.modality_recommendation->>'recommended_modality' as recommended_modality
FROM tx_txscore_cache t
JOIN tx_genes_master g ON t.gene_id = g.gene_id
WHERE t.cancer_type = 'LUAD'
ORDER BY t.tvs DESC
LIMIT 10;

-- Use view for top targets
SELECT * FROM tx_top_targets_by_cancer
WHERE cancer_type = 'BRCA'
  AND rank_in_cancer <= 20;

-- Find pan-cancer targets (using function)
SELECT * FROM tx_get_pan_cancer_targets(3, 0.7);

-- Custom weighted ranking
SELECT * FROM tx_rank_targets_custom(
    'LUAD',  -- cancer type
    0.40,    -- efficacy weight
    0.30,    -- safety weight
    0.15,    -- druggability weight
    0.10,    -- precedent weight
    0.05,    -- stratification weight
    50       -- limit
);

-- =====================================================================
-- 10. ADVANCED ANALYTICS
-- =====================================================================

-- Get TxScore distribution
SELECT * FROM tx_get_tvs_distribution('LUAD', 0.1);

-- Get subscore correlations
SELECT * FROM tx_get_subscore_correlations('BRCA');

-- Protein class enrichment
SELECT * FROM tx_get_protein_class_enrichment('LUAD', 0.7, 5);

-- Find similar targets to EGFR in lung cancer
SELECT * FROM tx_find_similar_targets(
    (SELECT gene_id FROM tx_genes_master WHERE gene_symbol = 'EGFR'),
    'LUAD',
    10
);

-- =====================================================================
-- 11. COMPREHENSIVE GENE PROFILE
-- =====================================================================

-- Get complete profile for a gene in a cancer type
WITH gene_profile AS (
    SELECT 
        g.gene_id,
        g.gene_symbol,
        g.gene_name,
        g.protein_class,
        g.chromosome,
        -- DepMap essentiality
        AVG(d.chronos_effect) FILTER (WHERE d.cancer_type = 'LUAD') as avg_chronos_luad,
        AVG(d.dependency_probability) FILTER (WHERE d.cancer_type = 'LUAD') as avg_dep_prob,
        -- GTEx expression
        (SELECT median_tpm FROM tx_gtex_expression e 
         WHERE e.gene_id = g.gene_id AND e.tissue_name = 'Lung' LIMIT 1) as lung_expression,
        -- gnomAD constraint
        gc.loeuf,
        gc.pli,
        -- AlphaFold
        af.mean_plddt,
        af.num_druggable_pockets,
        -- Clinical evidence
        COUNT(DISTINCT cv.variant_id) FILTER (WHERE cv.clinical_significance IN ('Pathogenic', 'Likely pathogenic')) as pathogenic_variants,
        COUNT(DISTINCT di.drug_name) FILTER (WHERE di.approval_status = 'approved') as approved_drugs,
        COUNT(DISTINCT ct.nct_id) as clinical_trials,
        -- TxScore
        ts.tvs,
        ts.efficacy_score,
        ts.safety_score,
        ts.druggability_score
    FROM tx_genes_master g
    LEFT JOIN tx_depmap_data d ON g.gene_id = d.gene_id
    LEFT JOIN tx_gnomad_constraint gc ON g.gene_id = gc.gene_id
    LEFT JOIN tx_alphafold_structures af ON g.gene_id = af.gene_id
    LEFT JOIN tx_clinvar_variants cv ON g.gene_id = cv.gene_id
    LEFT JOIN tx_drug_interactions di ON g.gene_id = di.gene_id
    LEFT JOIN tx_clinical_trials ct ON g.gene_id = ct.gene_id
    LEFT JOIN tx_txscore_cache ts ON g.gene_id = ts.gene_id AND ts.cancer_type = 'LUAD'
    WHERE g.gene_symbol = 'EGFR'
    GROUP BY g.gene_id, g.gene_symbol, g.gene_name, g.protein_class, g.chromosome,
             gc.loeuf, gc.pli, af.mean_plddt, af.num_druggable_pockets,
             ts.tvs, ts.efficacy_score, ts.safety_score, ts.druggability_score
)
SELECT * FROM gene_profile;

-- =====================================================================
-- 12. COMPARISON QUERIES
-- =====================================================================

-- Compare two genes across all metrics
SELECT 
    metric,
    gene1_value,
    gene2_value,
    gene2_value - gene1_value as difference
FROM (
    SELECT 'TVS' as metric, 
           MAX(CASE WHEN g.gene_symbol = 'EGFR' THEN t.tvs END) as gene1_value,
           MAX(CASE WHEN g.gene_symbol = 'KRAS' THEN t.tvs END) as gene2_value
    FROM tx_txscore_cache t
    JOIN tx_genes_master g ON t.gene_id = g.gene_id
    WHERE t.cancer_type = 'LUAD' AND g.gene_symbol IN ('EGFR', 'KRAS')
    
    UNION ALL
    
    SELECT 'Efficacy',
           MAX(CASE WHEN g.gene_symbol = 'EGFR' THEN t.efficacy_score END),
           MAX(CASE WHEN g.gene_symbol = 'KRAS' THEN t.efficacy_score END)
    FROM tx_txscore_cache t
    JOIN tx_genes_master g ON t.gene_id = g.gene_id
    WHERE t.cancer_type = 'LUAD' AND g.gene_symbol IN ('EGFR', 'KRAS')
    
    UNION ALL
    
    SELECT 'Safety',
           MAX(CASE WHEN g.gene_symbol = 'EGFR' THEN t.safety_score END),
           MAX(CASE WHEN g.gene_symbol = 'KRAS' THEN t.safety_score END)
    FROM tx_txscore_cache t
    JOIN tx_genes_master g ON t.gene_id = g.gene_id
    WHERE t.cancer_type = 'LUAD' AND g.gene_symbol IN ('EGFR', 'KRAS')
) subq;

-- =====================================================================
-- END OF QUICK REFERENCE
-- =====================================================================
