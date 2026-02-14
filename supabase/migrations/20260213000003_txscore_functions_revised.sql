-- =====================================================================
-- TxScore PostgreSQL Functions v1.1 (REVISED FOR SPLICR INTEGRATION)
-- Supporting functions for TxScore computation and queries
-- =====================================================================
-- All functions prefixed with tx_ to avoid conflicts
-- Compatible with revised tx_ table schema
-- =====================================================================

-- =====================================================================
-- 1. ESSENTIAL GENES DETECTION
-- =====================================================================

CREATE OR REPLACE FUNCTION tx_get_essential_genes(
    p_cancer_type TEXT,
    p_chronos_threshold REAL DEFAULT -0.75,
    p_prevalence_threshold REAL DEFAULT 0.5
) RETURNS TEXT[] AS $$
DECLARE
    v_gene_ids TEXT[];
BEGIN
    SELECT ARRAY_AGG(DISTINCT gene_id)
    INTO v_gene_ids
    FROM (
        SELECT 
            gene_id,
            COUNT(*) FILTER (WHERE chronos_effect < p_chronos_threshold) AS dependent_lines,
            COUNT(*) AS total_lines,
            COUNT(*) FILTER (WHERE chronos_effect < p_chronos_threshold)::REAL / COUNT(*)::REAL AS prevalence
        FROM tx_depmap_data
        WHERE cancer_type = p_cancer_type
        GROUP BY gene_id
        HAVING COUNT(*) FILTER (WHERE chronos_effect < p_chronos_threshold)::REAL / COUNT(*)::REAL >= p_prevalence_threshold
    ) subq;
    
    RETURN COALESCE(v_gene_ids, ARRAY[]::TEXT[]);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION tx_get_essential_genes IS 'TxScore: Get genes essential in a cancer type based on DepMap Chronos threshold and prevalence';

-- =====================================================================
-- 2. PAN-CANCER TARGETS
-- =====================================================================

CREATE OR REPLACE FUNCTION tx_get_pan_cancer_targets(
    p_min_cancer_types INT DEFAULT 3,
    p_min_tvs REAL DEFAULT 0.7
) RETURNS TABLE (
    gene_id TEXT,
    cancer_types TEXT[],
    avg_tvs REAL,
    num_cancer_types INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.gene_id,
        ARRAY_AGG(DISTINCT t.cancer_type ORDER BY t.cancer_type) AS cancer_types,
        AVG(t.tvs)::REAL AS avg_tvs,
        COUNT(DISTINCT t.cancer_type)::INT AS num_cancer_types
    FROM tx_txscore_cache t
    WHERE t.tvs >= p_min_tvs
    GROUP BY t.gene_id
    HAVING COUNT(DISTINCT t.cancer_type) >= p_min_cancer_types
    ORDER BY num_cancer_types DESC, avg_tvs DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION tx_get_pan_cancer_targets IS 'TxScore: Get genes that are therapeutic targets across multiple cancer types';

-- =====================================================================
-- 3. CUSTOM WEIGHTED RANKING
-- =====================================================================

CREATE OR REPLACE FUNCTION tx_rank_targets_custom(
    p_cancer_type TEXT,
    p_efficacy_weight REAL DEFAULT 0.30,
    p_safety_weight REAL DEFAULT 0.25,
    p_druggability_weight REAL DEFAULT 0.20,
    p_precedent_weight REAL DEFAULT 0.15,
    p_stratification_weight REAL DEFAULT 0.10,
    p_limit INT DEFAULT 100
) RETURNS TABLE (
    gene_id TEXT,
    gene_symbol TEXT,
    custom_score REAL,
    efficacy_score REAL,
    safety_score REAL,
    druggability_score REAL,
    precedent_score REAL,
    stratification_score REAL,
    rank INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.gene_id,
        g.gene_symbol,
        (
            POWER(t.efficacy_score, p_efficacy_weight) *
            POWER(t.safety_score, p_safety_weight) *
            POWER(t.druggability_score, p_druggability_weight) *
            POWER(t.precedent_score, p_precedent_weight) *
            POWER(t.stratification_score, p_stratification_weight)
        )::REAL AS custom_score,
        t.efficacy_score::REAL,
        t.safety_score::REAL,
        t.druggability_score::REAL,
        t.precedent_score::REAL,
        t.stratification_score::REAL,
        ROW_NUMBER() OVER (ORDER BY (
            POWER(t.efficacy_score, p_efficacy_weight) *
            POWER(t.safety_score, p_safety_weight) *
            POWER(t.druggability_score, p_druggability_weight) *
            POWER(t.precedent_score, p_precedent_weight) *
            POWER(t.stratification_score, p_stratification_weight)
        ) DESC)::INT AS rank
    FROM tx_txscore_cache t
    JOIN tx_genes_master g ON t.gene_id = g.gene_id
    WHERE t.cancer_type = p_cancer_type
    ORDER BY custom_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION tx_rank_targets_custom IS 'TxScore: Rank targets using custom weights for subscores (geometric mean)';

-- =====================================================================
-- 4. SIMILAR TARGETS (Euclidean Distance)
-- =====================================================================

CREATE OR REPLACE FUNCTION tx_find_similar_targets(
    p_reference_gene_id TEXT,
    p_cancer_type TEXT,
    p_limit INT DEFAULT 10
) RETURNS TABLE (
    gene_id TEXT,
    gene_symbol TEXT,
    similarity_score REAL,
    euclidean_distance REAL,
    efficacy_score REAL,
    safety_score REAL,
    druggability_score REAL
) AS $$
DECLARE
    v_ref_efficacy REAL;
    v_ref_safety REAL;
    v_ref_druggability REAL;
    v_ref_precedent REAL;
    v_ref_stratification REAL;
BEGIN
    -- Get reference gene's subscores
    SELECT 
        efficacy_score, 
        safety_score, 
        druggability_score,
        precedent_score,
        stratification_score
    INTO 
        v_ref_efficacy,
        v_ref_safety,
        v_ref_druggability,
        v_ref_precedent,
        v_ref_stratification
    FROM tx_txscore_cache
    WHERE gene_id = p_reference_gene_id AND cancer_type = p_cancer_type;
    
    IF v_ref_efficacy IS NULL THEN
        RAISE EXCEPTION 'Reference gene % not found for cancer type %', p_reference_gene_id, p_cancer_type;
    END IF;
    
    -- Find similar genes using Euclidean distance
    RETURN QUERY
    SELECT 
        t.gene_id,
        g.gene_symbol,
        (1.0 / (1.0 + SQRT(
            POWER(t.efficacy_score - v_ref_efficacy, 2) +
            POWER(t.safety_score - v_ref_safety, 2) +
            POWER(t.druggability_score - v_ref_druggability, 2) +
            POWER(t.precedent_score - v_ref_precedent, 2) +
            POWER(t.stratification_score - v_ref_stratification, 2)
        )))::REAL AS similarity_score,
        SQRT(
            POWER(t.efficacy_score - v_ref_efficacy, 2) +
            POWER(t.safety_score - v_ref_safety, 2) +
            POWER(t.druggability_score - v_ref_druggability, 2) +
            POWER(t.precedent_score - v_ref_precedent, 2) +
            POWER(t.stratification_score - v_ref_stratification, 2)
        )::REAL AS euclidean_distance,
        t.efficacy_score::REAL,
        t.safety_score::REAL,
        t.druggability_score::REAL
    FROM tx_txscore_cache t
    JOIN tx_genes_master g ON t.gene_id = g.gene_id
    WHERE t.cancer_type = p_cancer_type
      AND t.gene_id != p_reference_gene_id
    ORDER BY euclidean_distance ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION tx_find_similar_targets IS 'TxScore: Find genes with similar TxScore profiles using Euclidean distance';

-- =====================================================================
-- 5. CANCER-SPECIFIC SELECTIVITY INDEX
-- =====================================================================

CREATE OR REPLACE FUNCTION tx_compute_selectivity_index(
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
    FROM tx_depmap_data
    WHERE gene_id = p_gene_id AND cancer_type = p_cancer_type;
    
    -- Mean Chronos in other cancers
    SELECT AVG(chronos_effect) INTO v_other_mean
    FROM tx_depmap_data
    WHERE gene_id = p_gene_id AND cancer_type != p_cancer_type;
    
    -- Selectivity = how much more essential in target vs. other
    IF v_target_mean IS NULL OR v_other_mean IS NULL THEN
        RETURN 0.0;
    END IF;
    
    v_selectivity := (v_other_mean - v_target_mean) / 1.0;
    
    RETURN GREATEST(LEAST(v_selectivity, 1.0), 0.0);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION tx_compute_selectivity_index IS 'TxScore: Compute cancer-specific selectivity (target vs. other cancers)';

-- =====================================================================
-- 6. TISSUE-SPECIFIC SAFETY RISK
-- =====================================================================

CREATE OR REPLACE FUNCTION tx_compute_tissue_safety_risk(
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
    FROM tx_gtex_expression
    WHERE gene_id = p_gene_id AND tissue_name = p_tissue_name;
    
    -- Get constraint
    SELECT loeuf, pli INTO v_loeuf, v_pli
    FROM tx_gnomad_constraint
    WHERE gene_id = p_gene_id;
    
    -- Get tissue criticality
    SELECT is_critical INTO v_is_critical
    FROM tx_tissue_metadata
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

COMMENT ON FUNCTION tx_compute_tissue_safety_risk IS 'TxScore: Compute safety risk score for a gene in a specific tissue';

-- =====================================================================
-- 7. TXSCORE DISTRIBUTION ANALYSIS
-- =====================================================================

CREATE OR REPLACE FUNCTION tx_get_tvs_distribution(
    p_cancer_type TEXT DEFAULT NULL,
    p_bin_size REAL DEFAULT 0.1
) RETURNS TABLE (
    score_bin TEXT,
    bin_min REAL,
    bin_max REAL,
    gene_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH bins AS (
        SELECT 
            FLOOR(tvs / p_bin_size) * p_bin_size AS bin_start
        FROM tx_txscore_cache
        WHERE p_cancer_type IS NULL OR cancer_type = p_cancer_type
    )
    SELECT 
        (bin_start || ' - ' || (bin_start + p_bin_size))::TEXT AS score_bin,
        bin_start::REAL AS bin_min,
        (bin_start + p_bin_size)::REAL AS bin_max,
        COUNT(*)::BIGINT AS gene_count
    FROM bins
    GROUP BY bin_start
    ORDER BY bin_start;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION tx_get_tvs_distribution IS 'TxScore: Get distribution of TxScores in bins for histogram visualization';

-- =====================================================================
-- 8. SUBSCORE CORRELATION MATRIX
-- =====================================================================

CREATE OR REPLACE FUNCTION tx_get_subscore_correlations(
    p_cancer_type TEXT
) RETURNS TABLE (
    subscore_1 TEXT,
    subscore_2 TEXT,
    correlation_coefficient REAL,
    sample_size BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH scores AS (
        SELECT 
            efficacy_score,
            safety_score,
            druggability_score,
            precedent_score,
            stratification_score
        FROM tx_txscore_cache
        WHERE cancer_type = p_cancer_type
    )
    SELECT 
        s1::TEXT AS subscore_1,
        s2::TEXT AS subscore_2,
        CORR(
            CASE s1
                WHEN 'efficacy' THEN efficacy_score
                WHEN 'safety' THEN safety_score
                WHEN 'druggability' THEN druggability_score
                WHEN 'precedent' THEN precedent_score
                WHEN 'stratification' THEN stratification_score
            END,
            CASE s2
                WHEN 'efficacy' THEN efficacy_score
                WHEN 'safety' THEN safety_score
                WHEN 'druggability' THEN druggability_score
                WHEN 'precedent' THEN precedent_score
                WHEN 'stratification' THEN stratification_score
            END
        )::REAL AS correlation_coefficient,
        COUNT(*)::BIGINT AS sample_size
    FROM scores,
    LATERAL (VALUES ('efficacy'), ('safety'), ('druggability'), ('precedent'), ('stratification')) AS t1(s1),
    LATERAL (VALUES ('efficacy'), ('safety'), ('druggability'), ('precedent'), ('stratification')) AS t2(s2)
    WHERE s1 <= s2
    GROUP BY s1, s2
    ORDER BY s1, s2;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION tx_get_subscore_correlations IS 'TxScore: Compute Pearson correlation matrix for all subscores';

-- =====================================================================
-- 9. PROTEIN CLASS ENRICHMENT
-- =====================================================================

CREATE OR REPLACE FUNCTION tx_get_protein_class_enrichment(
    p_cancer_type TEXT,
    p_min_tvs REAL DEFAULT 0.7,
    p_min_class_size INT DEFAULT 5
) RETURNS TABLE (
    protein_class TEXT,
    total_genes BIGINT,
    high_tvs_genes BIGINT,
    enrichment_ratio REAL,
    avg_tvs REAL
) AS $$
BEGIN
    RETURN QUERY
    WITH class_stats AS (
        SELECT 
            g.protein_class,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE t.tvs >= p_min_tvs) AS high_tvs,
            AVG(t.tvs) AS avg_score
        FROM tx_genes_master g
        LEFT JOIN tx_txscore_cache t ON g.gene_id = t.gene_id AND t.cancer_type = p_cancer_type
        WHERE g.protein_class IS NOT NULL
        GROUP BY g.protein_class
        HAVING COUNT(*) >= p_min_class_size
    ),
    background AS (
        SELECT 
            COUNT(*) FILTER (WHERE t.tvs >= p_min_tvs)::REAL / COUNT(*)::REAL AS bg_rate
        FROM tx_genes_master g
        LEFT JOIN tx_txscore_cache t ON g.gene_id = t.gene_id AND t.cancer_type = p_cancer_type
    )
    SELECT 
        cs.protein_class::TEXT,
        cs.total::BIGINT,
        cs.high_tvs::BIGINT,
        (cs.high_tvs::REAL / cs.total::REAL / bg.bg_rate)::REAL AS enrichment_ratio,
        cs.avg_score::REAL AS avg_tvs
    FROM class_stats cs, background bg
    ORDER BY enrichment_ratio DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION tx_get_protein_class_enrichment IS 'TxScore: Compute enrichment of high-TVS genes by protein class';

-- =====================================================================
-- 10. FUZZY GENE SEARCH WITH RANKING
-- =====================================================================

CREATE OR REPLACE FUNCTION tx_search_genes_ranked(
    p_query TEXT,
    p_limit INT DEFAULT 20
) RETURNS TABLE (
    gene_id TEXT,
    gene_symbol TEXT,
    gene_name TEXT,
    protein_class TEXT,
    similarity_score REAL,
    match_type TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        g.gene_id,
        g.gene_symbol,
        g.gene_name,
        g.protein_class,
        GREATEST(
            similarity(g.gene_symbol, p_query),
            similarity(g.gene_name, p_query)
        )::REAL AS similarity_score,
        CASE 
            WHEN g.gene_symbol ILIKE p_query THEN 'exact'
            WHEN g.gene_symbol ILIKE p_query || '%' THEN 'prefix'
            WHEN g.gene_name ILIKE '%' || p_query || '%' THEN 'partial'
            ELSE 'fuzzy'
        END::TEXT AS match_type
    FROM tx_genes_master g
    WHERE 
        g.gene_symbol % p_query
        OR g.gene_name % p_query
        OR g.gene_symbol ILIKE '%' || p_query || '%'
        OR g.gene_name ILIKE '%' || p_query || '%'
    ORDER BY 
        CASE 
            WHEN g.gene_symbol ILIKE p_query THEN 1
            WHEN g.gene_symbol ILIKE p_query || '%' THEN 2
            ELSE 3
        END,
        similarity_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION tx_search_genes_ranked IS 'TxScore: Fuzzy search genes with trigram similarity ranking';

-- =====================================================================
-- FUNCTIONS SUMMARY
-- =====================================================================
-- Function count: 10
-- All functions prefixed with tx_ for namespace isolation
-- Compatible with revised tx_ table schema
-- Safe to use alongside existing SplicR functions
-- =====================================================================
