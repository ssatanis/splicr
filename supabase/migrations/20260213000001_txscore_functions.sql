-- =====================================================================
-- TxScore PostgreSQL Functions
-- Supporting functions for TxScore computation and queries
-- =====================================================================

-- =====================================================================
-- 1. ESSENTIAL GENES DETECTION
-- =====================================================================

CREATE OR REPLACE FUNCTION get_essential_genes(
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
        FROM depmap_data
        WHERE cancer_type = p_cancer_type
        GROUP BY gene_id
        HAVING COUNT(*) FILTER (WHERE chronos_effect < p_chronos_threshold)::REAL / COUNT(*)::REAL >= p_prevalence_threshold
    ) subq;
    
    RETURN COALESCE(v_gene_ids, ARRAY[]::TEXT[]);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_essential_genes IS 'Get genes essential in a cancer type based on DepMap Chronos threshold and prevalence';

-- =====================================================================
-- 2. PAN-CANCER TARGETS
-- =====================================================================

CREATE OR REPLACE FUNCTION get_pan_cancer_targets(
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
    FROM txscore_cache t
    WHERE t.tvs >= p_min_tvs
    GROUP BY t.gene_id
    HAVING COUNT(DISTINCT t.cancer_type) >= p_min_cancer_types
    ORDER BY AVG(t.tvs) DESC, COUNT(DISTINCT t.cancer_type) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_pan_cancer_targets IS 'Find targets with high TVS across multiple cancer types';

-- =====================================================================
-- 3. CUSTOM RANKING WITH WEIGHTS
-- =====================================================================

CREATE OR REPLACE FUNCTION rank_targets_custom(
    p_cancer_type TEXT,
    p_weights JSONB DEFAULT '{"efficacy": 0.3, "safety": 0.25, "druggability": 0.2, "precedent": 0.15, "stratification": 0.1}'::JSONB,
    p_limit INT DEFAULT 100
) RETURNS TABLE (
    gene_id TEXT,
    cancer_type TEXT,
    tvs REAL,
    custom_score REAL,
    efficacy_score REAL,
    safety_score REAL,
    druggability_score REAL,
    precedent_score REAL,
    stratification_score REAL
) AS $$
DECLARE
    w_efficacy REAL := COALESCE((p_weights->>'efficacy')::REAL, 0.3);
    w_safety REAL := COALESCE((p_weights->>'safety')::REAL, 0.25);
    w_druggability REAL := COALESCE((p_weights->>'druggability')::REAL, 0.2);
    w_precedent REAL := COALESCE((p_weights->>'precedent')::REAL, 0.15);
    w_stratification REAL := COALESCE((p_weights->>'stratification')::REAL, 0.1);
BEGIN
    RETURN QUERY
    SELECT 
        t.gene_id,
        t.cancer_type,
        t.tvs,
        (
            POW(t.efficacy_score::NUMERIC, w_efficacy) *
            POW(t.safety_score::NUMERIC, w_safety) *
            POW(t.druggability_score::NUMERIC, w_druggability) *
            POW(t.precedent_score::NUMERIC, w_precedent) *
            POW(t.stratification_score::NUMERIC, w_stratification)
        )::REAL AS custom_score,
        t.efficacy_score,
        t.safety_score,
        t.druggability_score,
        t.precedent_score,
        t.stratification_score
    FROM txscore_cache t
    WHERE t.cancer_type = p_cancer_type
    ORDER BY custom_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION rank_targets_custom IS 'Rank targets with custom subscore weights';

-- =====================================================================
-- 4. FIND SIMILAR TARGETS
-- =====================================================================

CREATE OR REPLACE FUNCTION find_similar_targets(
    p_gene_id TEXT,
    p_cancer_type TEXT,
    p_limit INT DEFAULT 10
) RETURNS TABLE (
    gene_id TEXT,
    cancer_type TEXT,
    tvs REAL,
    similarity_score REAL,
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
    FROM txscore_cache
    WHERE txscore_cache.gene_id = p_gene_id 
      AND txscore_cache.cancer_type = p_cancer_type;
    
    IF v_ref_efficacy IS NULL THEN
        RAISE EXCEPTION 'Gene % not found in TxScore cache for cancer type %', p_gene_id, p_cancer_type;
    END IF;
    
    -- Find similar genes using Euclidean distance
    RETURN QUERY
    SELECT 
        t.gene_id,
        t.cancer_type,
        t.tvs,
        (1.0 - SQRT(
            POW(t.efficacy_score - v_ref_efficacy, 2) +
            POW(t.safety_score - v_ref_safety, 2) +
            POW(t.druggability_score - v_ref_druggability, 2) +
            POW(t.precedent_score - v_ref_precedent, 2) +
            POW(t.stratification_score - v_ref_stratification, 2)
        ) / SQRT(5.0))::REAL AS similarity_score,
        t.efficacy_score,
        t.safety_score,
        t.druggability_score
    FROM txscore_cache t
    WHERE t.cancer_type = p_cancer_type
      AND t.gene_id != p_gene_id
    ORDER BY similarity_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION find_similar_targets IS 'Find targets with similar TxScore profiles using Euclidean distance';

-- =====================================================================
-- 5. TVS DISTRIBUTION STATISTICS
-- =====================================================================

CREATE OR REPLACE FUNCTION get_tvs_distribution(
    p_cancer_type TEXT
) RETURNS TABLE (
    bin_start REAL,
    bin_end REAL,
    count BIGINT,
    percentage REAL
) AS $$
DECLARE
    v_total BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_total
    FROM txscore_cache
    WHERE cancer_type = p_cancer_type;
    
    RETURN QUERY
    SELECT 
        (floor(tvs * 10) / 10.0)::REAL AS bin_start,
        (floor(tvs * 10) / 10.0 + 0.1)::REAL AS bin_end,
        COUNT(*)::BIGINT AS count,
        (COUNT(*)::REAL / v_total * 100.0)::REAL AS percentage
    FROM txscore_cache
    WHERE cancer_type = p_cancer_type
    GROUP BY floor(tvs * 10)
    ORDER BY bin_start;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_tvs_distribution IS 'Get TVS distribution histogram for a cancer type';

-- =====================================================================
-- 6. SUBSCORE CORRELATIONS
-- =====================================================================

CREATE OR REPLACE FUNCTION get_subscore_correlations(
    p_cancer_type TEXT DEFAULT NULL
) RETURNS TABLE (
    subscore1 TEXT,
    subscore2 TEXT,
    correlation REAL,
    p_value REAL
) AS $$
BEGIN
    -- This is a simplified version
    -- In practice, you'd compute Pearson correlation coefficients
    -- For now, we'll return correlations between subscores
    
    RETURN QUERY
    WITH scores AS (
        SELECT 
            efficacy_score,
            safety_score,
            druggability_score,
            precedent_score,
            stratification_score
        FROM txscore_cache
        WHERE p_cancer_type IS NULL OR cancer_type = p_cancer_type
    )
    SELECT 
        'efficacy' AS subscore1,
        'safety' AS subscore2,
        CORR(efficacy_score, safety_score)::REAL AS correlation,
        NULL::REAL AS p_value
    FROM scores
    UNION ALL
    SELECT 
        'efficacy',
        'druggability',
        CORR(efficacy_score, druggability_score)::REAL,
        NULL::REAL
    FROM scores
    UNION ALL
    SELECT 
        'efficacy',
        'precedent',
        CORR(efficacy_score, precedent_score)::REAL,
        NULL::REAL
    FROM scores
    UNION ALL
    SELECT 
        'safety',
        'druggability',
        CORR(safety_score, druggability_score)::REAL,
        NULL::REAL
    FROM scores
    UNION ALL
    SELECT 
        'safety',
        'precedent',
        CORR(safety_score, precedent_score)::REAL,
        NULL::REAL
    FROM scores
    UNION ALL
    SELECT 
        'druggability',
        'precedent',
        CORR(druggability_score, precedent_score)::REAL,
        NULL::REAL
    FROM scores;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_subscore_correlations IS 'Compute pairwise correlations between TxScore subscores';

-- =====================================================================
-- 7. PROTEIN CLASS ENRICHMENT
-- =====================================================================

CREATE OR REPLACE FUNCTION get_protein_class_enrichment(
    p_cancer_type TEXT,
    p_top_n INT DEFAULT 100
) RETURNS TABLE (
    protein_class TEXT,
    count_in_top BIGINT,
    count_total BIGINT,
    enrichment_ratio REAL,
    avg_tvs_in_class REAL
) AS $$
BEGIN
    RETURN QUERY
    WITH top_targets AS (
        SELECT gene_id
        FROM txscore_cache
        WHERE cancer_type = p_cancer_type
        ORDER BY tvs DESC
        LIMIT p_top_n
    )
    SELECT 
        g.protein_class,
        COUNT(DISTINCT CASE WHEN tt.gene_id IS NOT NULL THEN g.gene_id END)::BIGINT AS count_in_top,
        COUNT(DISTINCT g.gene_id)::BIGINT AS count_total,
        (COUNT(DISTINCT CASE WHEN tt.gene_id IS NOT NULL THEN g.gene_id END)::REAL / 
         NULLIF(COUNT(DISTINCT g.gene_id)::REAL, 0))::REAL AS enrichment_ratio,
        AVG(t.tvs) FILTER (WHERE tt.gene_id IS NOT NULL)::REAL AS avg_tvs_in_class
    FROM genes_master g
    LEFT JOIN top_targets tt ON g.gene_id = tt.gene_id
    LEFT JOIN txscore_cache t ON g.gene_id = t.gene_id AND t.cancer_type = p_cancer_type
    WHERE g.protein_class IS NOT NULL
    GROUP BY g.protein_class
    HAVING COUNT(DISTINCT g.gene_id) >= 5  -- At least 5 genes in class
    ORDER BY enrichment_ratio DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_protein_class_enrichment IS 'Analyze protein class enrichment in top targets';

-- =====================================================================
-- 8. TXSCORE COMPUTATION (PLACEHOLDER)
-- =====================================================================

CREATE OR REPLACE FUNCTION compute_txscore(
    p_gene_id TEXT,
    p_cancer_type TEXT,
    p_model_version TEXT DEFAULT 'v1.0'
) RETURNS JSONB AS $$
DECLARE
    v_efficacy REAL;
    v_safety REAL;
    v_druggability REAL;
    v_precedent REAL;
    v_stratification REAL;
    v_tvs REAL;
    v_result JSONB;
BEGIN
    -- This is a placeholder that would call the actual TxScore computation
    -- In practice, this would involve complex calculations across multiple tables
    
    -- For now, check if already cached
    SELECT jsonb_build_object(
        'gene_id', gene_id,
        'cancer_type', cancer_type,
        'tvs', tvs,
        'efficacy_score', efficacy_score,
        'safety_score', safety_score,
        'druggability_score', druggability_score,
        'precedent_score', precedent_score,
        'stratification_score', stratification_score
    )
    INTO v_result
    FROM txscore_cache
    WHERE gene_id = p_gene_id AND cancer_type = p_cancer_type;
    
    IF v_result IS NOT NULL THEN
        RETURN v_result;
    END IF;
    
    -- If not cached, would compute here
    -- For now, raise exception
    RAISE EXCEPTION 'TxScore not computed for gene % in cancer type %. Use Python compute pipeline.', p_gene_id, p_cancer_type;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION compute_txscore IS 'Compute TxScore for a gene (placeholder - actual computation in Python)';

-- =====================================================================
-- 9. CACHE REFRESH
-- =====================================================================

CREATE OR REPLACE FUNCTION refresh_stale_cache(
    p_cutoff_date TIMESTAMPTZ
) RETURNS INT AS $$
DECLARE
    v_count INT;
BEGIN
    -- Delete stale cache entries
    DELETE FROM txscore_cache
    WHERE computed_at < p_cutoff_date
      AND (expires_at IS NULL OR expires_at < NOW());
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION refresh_stale_cache IS 'Delete cache entries older than cutoff date';

-- =====================================================================
-- 10. GENE SEARCH WITH RANKING
-- =====================================================================

CREATE OR REPLACE FUNCTION search_genes_ranked(
    p_query TEXT,
    p_limit INT DEFAULT 20
) RETURNS TABLE (
    gene_id TEXT,
    gene_symbol TEXT,
    gene_name TEXT,
    protein_class TEXT,
    match_score REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        g.gene_id,
        g.gene_symbol,
        g.gene_name,
        g.protein_class,
        CASE 
            WHEN LOWER(g.gene_symbol) = LOWER(p_query) THEN 1.0
            WHEN LOWER(g.gene_symbol) LIKE LOWER(p_query) || '%' THEN 0.9
            WHEN LOWER(g.gene_name) LIKE '%' || LOWER(p_query) || '%' THEN 0.7
            ELSE SIMILARITY(LOWER(g.gene_symbol), LOWER(p_query))
        END::REAL AS match_score
    FROM genes_master g
    WHERE 
        LOWER(g.gene_symbol) LIKE LOWER(p_query) || '%'
        OR LOWER(g.gene_name) LIKE '%' || LOWER(p_query) || '%'
        OR g.gene_symbol % p_query  -- trigram similarity
    ORDER BY match_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION search_genes_ranked IS 'Search genes with fuzzy matching and relevance ranking';

-- =====================================================================
-- GRANTS (adjust based on your auth setup)
-- =====================================================================

-- Grant execute permissions to authenticated users
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
