-- ============================================================================
-- REPRODUCIBILITY SYSTEM - COMPREHENSIVE SCHEMA
-- ============================================================================
-- This migration creates the complete database schema for scientific
-- reproducibility tracking including:
-- - Analysis versioning and snapshots
-- - W3C PROV provenance model
-- - Methods text generation and storage
-- - Reproducibility packages and scoring
-- ============================================================================

-- ============================================================================
-- 1. ANALYSIS VERSIONS
-- ============================================================================
-- Stores complete snapshots of analysis state at each run or parameter change
-- Enables rollback, comparison, and historical tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS analysis_versions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT REFERENCES profiles(id),

    -- Version metadata
    change_description TEXT,
    git_style_hash TEXT NOT NULL, -- SHA256 of all parameters for exact comparison
    parent_version_id TEXT REFERENCES analysis_versions(id),

    -- Complete snapshot of analysis state
    snapshot_data JSONB NOT NULL, -- Contains: parameters, inputs, metadata, environment

    -- Input data snapshot
    input_files JSONB NOT NULL, -- [{name, size, checksum, uploaded_at}]
    sample_metadata JSONB NOT NULL, -- Sample labels, groups, replicates
    library_info JSONB NOT NULL, -- {name, version, source, organism}

    -- Software environment snapshot
    software_environment JSONB NOT NULL, -- {splicr_version, mageck_version, python_version, etc.}

    -- Results snapshot (if analysis has completed)
    results_snapshot JSONB, -- {summary, qc_metrics, top_hits, plots}
    results_checksum TEXT, -- SHA256 of complete results

    -- Performance metrics
    execution_time_seconds INTEGER,
    memory_usage_mb INTEGER,
    compute_node TEXT,

    -- Status and flags
    is_current BOOLEAN DEFAULT false,
    is_published BOOLEAN DEFAULT false,
    tags TEXT[], -- User-defined tags for organization

    UNIQUE(analysis_id, version_number)
);

CREATE INDEX idx_analysis_versions_analysis_id ON analysis_versions(analysis_id);
CREATE INDEX idx_analysis_versions_created_at ON analysis_versions(created_at DESC);
CREATE INDEX idx_analysis_versions_git_hash ON analysis_versions(git_style_hash);
CREATE INDEX idx_analysis_versions_is_current ON analysis_versions(analysis_id, is_current) WHERE is_current = true;

-- Function to auto-increment version numbers
CREATE OR REPLACE FUNCTION get_next_version_number(p_analysis_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN COALESCE(
        (SELECT MAX(version_number) + 1 FROM analysis_versions WHERE analysis_id = p_analysis_id),
        1
    );
END;
$$ LANGUAGE plpgsql;

-- Function to mark version as current (only one current version per analysis)
CREATE OR REPLACE FUNCTION set_current_version()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_current = true THEN
        UPDATE analysis_versions
        SET is_current = false
        WHERE analysis_id = NEW.analysis_id
        AND id != NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_current_version
    AFTER INSERT OR UPDATE OF is_current ON analysis_versions
    FOR EACH ROW
    WHEN (NEW.is_current = true)
    EXECUTE FUNCTION set_current_version();

-- ============================================================================
-- 2. W3C PROV MODEL - PROVENANCE TRACKING
-- ============================================================================
-- Implements W3C PROV standard for complete data lineage tracking
-- https://www.w3.org/TR/prov-dm/
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PROV ENTITIES (Data objects: files, results, plots, tables)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prov_entities (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    version_id TEXT REFERENCES analysis_versions(id) ON DELETE CASCADE,

    -- Entity identification
    type TEXT NOT NULL, -- 'fastq_file', 'count_matrix', 'results_table', 'plot', 'report', etc.
    label TEXT NOT NULL,

    -- Entity location and attributes
    location TEXT, -- Storage path or URL
    checksum TEXT, -- SHA256 hash for integrity verification
    size_bytes BIGINT,
    format TEXT, -- MIME type or file format

    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Flexible metadata
    attributes JSONB, -- Any additional entity-specific metadata

    -- Relationships
    is_input BOOLEAN DEFAULT false,
    is_output BOOLEAN DEFAULT false,
    is_intermediate BOOLEAN DEFAULT false
);

CREATE INDEX idx_prov_entities_analysis_id ON prov_entities(analysis_id);
CREATE INDEX idx_prov_entities_version_id ON prov_entities(version_id);
CREATE INDEX idx_prov_entities_type ON prov_entities(type);
CREATE INDEX idx_prov_entities_created_at ON prov_entities(created_at DESC);

-- ----------------------------------------------------------------------------
-- PROV ACTIVITIES (Processing steps: QC, normalization, statistical tests)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prov_activities (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    version_id TEXT REFERENCES analysis_versions(id) ON DELETE CASCADE,

    -- Activity identification
    type TEXT NOT NULL, -- 'quality_control', 'normalization', 'statistical_test', 'visualization', etc.
    label TEXT NOT NULL,

    -- Algorithm details
    algorithm TEXT NOT NULL, -- e.g., "MAGeCK-RRA", "BAGEL2", "median_normalization"
    algorithm_version TEXT, -- e.g., "0.5.9.4"

    -- Parameters used
    parameters JSONB NOT NULL, -- All settings and thresholds

    -- Timing
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,

    -- Status
    status TEXT NOT NULL DEFAULT 'running', -- 'running', 'success', 'failed'
    error_message TEXT,

    -- Compute resources
    compute_resources JSONB, -- {cpu_seconds, memory_mb, node}

    -- Output summary
    output_summary JSONB -- Brief summary of what was produced
);

CREATE INDEX idx_prov_activities_analysis_id ON prov_activities(analysis_id);
CREATE INDEX idx_prov_activities_version_id ON prov_activities(version_id);
CREATE INDEX idx_prov_activities_type ON prov_activities(type);
CREATE INDEX idx_prov_activities_started_at ON prov_activities(started_at DESC);
CREATE INDEX idx_prov_activities_status ON prov_activities(status);

-- ----------------------------------------------------------------------------
-- PROV AGENTS (Who/what performed actions: users, software, algorithms)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prov_agents (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

    -- Agent identification
    type TEXT NOT NULL, -- 'user', 'software', 'algorithm', 'organization'
    label TEXT NOT NULL,

    -- Agent details
    version TEXT, -- For software agents
    user_id TEXT REFERENCES profiles(id), -- For human agents
    organization TEXT, -- Institution or lab

    -- Contact and attribution
    email TEXT,
    orcid TEXT, -- ORCID identifier for researchers
    url TEXT, -- Website or repository

    -- Metadata
    attributes JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(type, label, version)
);

CREATE INDEX idx_prov_agents_type ON prov_agents(type);
CREATE INDEX idx_prov_agents_user_id ON prov_agents(user_id);

-- ----------------------------------------------------------------------------
-- PROV RELATIONS (Connections between entities, activities, and agents)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prov_relations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    version_id TEXT REFERENCES analysis_versions(id) ON DELETE CASCADE,

    -- Relation type (W3C PROV standard relations)
    relation_type TEXT NOT NULL, -- See relation types below

    -- Source and target (flexible to support all PROV relation types)
    source_entity_id TEXT REFERENCES prov_entities(id) ON DELETE CASCADE,
    source_activity_id TEXT REFERENCES prov_activities(id) ON DELETE CASCADE,
    source_agent_id TEXT REFERENCES prov_agents(id) ON DELETE CASCADE,

    target_entity_id TEXT REFERENCES prov_entities(id) ON DELETE CASCADE,
    target_activity_id TEXT REFERENCES prov_activities(id) ON DELETE CASCADE,
    target_agent_id TEXT REFERENCES prov_agents(id) ON DELETE CASCADE,

    -- Timing and metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attributes JSONB,

    -- Ensure at least one source and one target
    CHECK (
        (source_entity_id IS NOT NULL OR source_activity_id IS NOT NULL OR source_agent_id IS NOT NULL) AND
        (target_entity_id IS NOT NULL OR target_activity_id IS NOT NULL OR target_agent_id IS NOT NULL)
    )
);

/*
W3C PROV Relation Types:
- wasGeneratedBy: Entity was generated by Activity
- used: Activity used Entity as input
- wasAttributedTo: Entity was attributed to Agent
- wasAssociatedWith: Activity was associated with Agent
- wasDerivedFrom: Entity was derived from another Entity
- wasInformedBy: Activity was informed by another Activity
- wasStartedBy: Activity was started by Entity/Agent
- wasEndedBy: Activity was ended by Entity/Agent
- actedOnBehalfOf: Agent acted on behalf of another Agent
- wasInfluencedBy: Generic influence relationship
*/

CREATE INDEX idx_prov_relations_analysis_id ON prov_relations(analysis_id);
CREATE INDEX idx_prov_relations_version_id ON prov_relations(version_id);
CREATE INDEX idx_prov_relations_type ON prov_relations(relation_type);
CREATE INDEX idx_prov_relations_source_entity ON prov_relations(source_entity_id);
CREATE INDEX idx_prov_relations_source_activity ON prov_relations(source_activity_id);
CREATE INDEX idx_prov_relations_target_entity ON prov_relations(target_entity_id);
CREATE INDEX idx_prov_relations_target_activity ON prov_relations(target_activity_id);

-- ============================================================================
-- 3. METHODS TEXT GENERATION
-- ============================================================================
-- Stores auto-generated and user-edited methods sections for publications
-- ============================================================================

CREATE TABLE IF NOT EXISTS analysis_methods (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    version_id TEXT REFERENCES analysis_versions(id) ON DELETE CASCADE,

    -- Methods content
    generated_text TEXT NOT NULL, -- Auto-generated methods section
    edited_text TEXT, -- User's edited version
    is_edited BOOLEAN DEFAULT false,

    -- Template and style
    template_name TEXT NOT NULL, -- Which template was used
    citation_style TEXT NOT NULL DEFAULT 'apa', -- 'apa', 'nature', 'science', 'cell', etc.

    -- Sections
    sections JSONB NOT NULL, -- {study_design, data_processing, statistical_analysis, data_availability}

    -- Citations
    citations JSONB NOT NULL, -- [{type, title, authors, doi, url}]

    -- Metadata
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ,
    edited_by TEXT REFERENCES profiles(id),

    -- Version tracking
    version INTEGER DEFAULT 1,
    parent_methods_id TEXT REFERENCES analysis_methods(id),

    -- Export formats
    export_formats JSONB DEFAULT '{"plain": true, "word": false, "latex": false}'::jsonb
);

CREATE INDEX idx_analysis_methods_analysis_id ON analysis_methods(analysis_id);
CREATE INDEX idx_analysis_methods_version_id ON analysis_methods(version_id);
CREATE INDEX idx_analysis_methods_generated_at ON analysis_methods(generated_at DESC);

-- ============================================================================
-- 4. METHODS TEXT TEMPLATES
-- ============================================================================
-- Reusable templates for different journal styles and analysis types
-- ============================================================================

CREATE TABLE IF NOT EXISTS methods_templates (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

    -- Template identification
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,

    -- Template content
    template_content JSONB NOT NULL, -- {sections: {study_design: {template, variables}, ...}}

    -- Applicability
    analysis_types TEXT[], -- ['screening', 'drug_sensitivity', 'genetic_interaction']
    journal_styles TEXT[], -- ['nature', 'science', 'cell', 'plos']

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT REFERENCES profiles(id),

    -- Versioning
    version TEXT NOT NULL DEFAULT '1.0.0',
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false
);

CREATE INDEX idx_methods_templates_analysis_types ON methods_templates USING GIN(analysis_types);
CREATE INDEX idx_methods_templates_is_active ON methods_templates(is_active) WHERE is_active = true;
CREATE INDEX idx_methods_templates_is_default ON methods_templates(is_default) WHERE is_default = true;

-- ============================================================================
-- 5. REPRODUCIBILITY PACKAGES
-- ============================================================================
-- Tracks exported reproducibility packages for sharing and archiving
-- ============================================================================

CREATE TABLE IF NOT EXISTS reproducibility_packages (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES analysis_versions(id) ON DELETE CASCADE,

    -- Package identification
    package_name TEXT NOT NULL,
    description TEXT,

    -- Package contents
    contents JSONB NOT NULL, -- {manifest, parameters, data_files, results, provenance, methods, readme}

    -- Storage
    storage_location TEXT, -- R2/S3 key or local path
    package_size_bytes BIGINT,
    package_checksum TEXT, -- SHA256 of entire package

    -- Export formats
    export_format TEXT NOT NULL, -- 'zip', 'docker', 'binder', 'zenodo'
    export_url TEXT, -- Direct download URL

    -- Publishing
    doi TEXT, -- Zenodo DOI if published
    published_at TIMESTAMPTZ,
    is_public BOOLEAN DEFAULT false,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT REFERENCES profiles(id),
    downloaded_count INTEGER DEFAULT 0,

    -- Verification
    verification_status TEXT, -- 'unverified', 'verified', 'failed'
    verified_at TIMESTAMPTZ,
    verified_by TEXT REFERENCES profiles(id),
    verification_notes TEXT
);

CREATE INDEX idx_reproducibility_packages_analysis_id ON reproducibility_packages(analysis_id);
CREATE INDEX idx_reproducibility_packages_version_id ON reproducibility_packages(version_id);
CREATE INDEX idx_reproducibility_packages_created_at ON reproducibility_packages(created_at DESC);
CREATE INDEX idx_reproducibility_packages_is_public ON reproducibility_packages(is_public) WHERE is_public = true;
CREATE INDEX idx_reproducibility_packages_doi ON reproducibility_packages(doi) WHERE doi IS NOT NULL;

-- ============================================================================
-- 6. REPRODUCIBILITY SCORES
-- ============================================================================
-- Calculated reproducibility scores with component breakdown
-- ============================================================================

CREATE TABLE IF NOT EXISTS reproducibility_scores (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    analysis_id TEXT NOT NULL UNIQUE REFERENCES analyses(id) ON DELETE CASCADE,
    version_id TEXT REFERENCES analysis_versions(id) ON DELETE CASCADE,

    -- Overall score
    total_score INTEGER NOT NULL DEFAULT 0 CHECK (total_score >= 0 AND total_score <= 100),

    -- Component scores (out of maximum points)
    parameters_documented INTEGER DEFAULT 0 CHECK (parameters_documented >= 0 AND parameters_documented <= 20),
    software_versions_captured INTEGER DEFAULT 0 CHECK (software_versions_captured >= 0 AND software_versions_captured <= 20),
    provenance_tracked INTEGER DEFAULT 0 CHECK (provenance_tracked >= 0 AND provenance_tracked <= 20),
    data_checksums_recorded INTEGER DEFAULT 0 CHECK (data_checksums_recorded >= 0 AND data_checksums_recorded <= 15),
    methods_generated INTEGER DEFAULT 0 CHECK (methods_generated >= 0 AND methods_generated <= 10),
    package_exported INTEGER DEFAULT 0 CHECK (package_exported >= 0 AND package_exported <= 10),
    published_with_doi INTEGER DEFAULT 0 CHECK (published_with_doi >= 0 AND published_with_doi <= 5),

    -- Checklist items
    checklist JSONB NOT NULL DEFAULT '{
        "input_files_checksummed": false,
        "parameters_saved": false,
        "analysis_completed": false,
        "methods_reviewed": false,
        "package_exported": false,
        "shared_or_published": false
    }'::jsonb,

    -- Badge earned
    badge TEXT, -- 'platinum', 'gold', 'silver', 'bronze', null

    -- Metadata
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reproducibility_scores_analysis_id ON reproducibility_scores(analysis_id);
CREATE INDEX idx_reproducibility_scores_total_score ON reproducibility_scores(total_score DESC);
CREATE INDEX idx_reproducibility_scores_badge ON reproducibility_scores(badge);

-- Function to calculate and update reproducibility score
CREATE OR REPLACE FUNCTION calculate_reproducibility_score(p_analysis_id TEXT)
RETURNS TABLE (
    total_score INTEGER,
    parameters_documented INTEGER,
    software_versions_captured INTEGER,
    provenance_tracked INTEGER,
    data_checksums_recorded INTEGER,
    methods_generated INTEGER,
    package_exported INTEGER,
    published_with_doi INTEGER,
    badge TEXT
) AS $$
DECLARE
    v_score_params INTEGER := 0;
    v_score_software INTEGER := 0;
    v_score_prov INTEGER := 0;
    v_score_checksums INTEGER := 0;
    v_score_methods INTEGER := 0;
    v_score_package INTEGER := 0;
    v_score_doi INTEGER := 0;
    v_total INTEGER := 0;
    v_badge TEXT := NULL;
BEGIN
    -- 1. Parameters documented (20 points)
    SELECT CASE
        WHEN parameters IS NOT NULL AND jsonb_typeof(parameters) = 'object' AND jsonb_array_length(jsonb_object_keys(parameters)) > 0
        THEN 20 ELSE 0
    END INTO v_score_params
    FROM analyses WHERE id = p_analysis_id;

    -- 2. Software versions captured (20 points)
    SELECT CASE
        WHEN COUNT(*) > 0 THEN 20 ELSE 0
    END INTO v_score_software
    FROM analysis_versions av
    WHERE av.analysis_id = p_analysis_id
    AND av.software_environment IS NOT NULL
    AND jsonb_typeof(av.software_environment) = 'object';

    -- 3. Provenance tracked (20 points)
    SELECT CASE
        WHEN COUNT(DISTINCT pe.id) >= 3 AND COUNT(DISTINCT pa.id) >= 2 THEN 20
        WHEN COUNT(DISTINCT pe.id) >= 2 AND COUNT(DISTINCT pa.id) >= 1 THEN 15
        WHEN COUNT(DISTINCT pe.id) >= 1 OR COUNT(DISTINCT pa.id) >= 1 THEN 10
        ELSE 0
    END INTO v_score_prov
    FROM prov_entities pe
    FULL OUTER JOIN prov_activities pa ON pa.analysis_id = pe.analysis_id
    WHERE COALESCE(pe.analysis_id, pa.analysis_id) = p_analysis_id;

    -- 4. Data checksums recorded (15 points)
    SELECT CASE
        WHEN COUNT(*) > 0 AND bool_and(checksum IS NOT NULL) THEN 15
        WHEN COUNT(*) > 0 AND bool_or(checksum IS NOT NULL) THEN 10
        ELSE 0
    END INTO v_score_checksums
    FROM prov_entities
    WHERE analysis_id = p_analysis_id AND is_input = true;

    -- 5. Methods generated (10 points)
    SELECT CASE
        WHEN COUNT(*) > 0 AND bool_or(is_edited = true) THEN 10
        WHEN COUNT(*) > 0 THEN 7
        ELSE 0
    END INTO v_score_methods
    FROM analysis_methods
    WHERE analysis_id = p_analysis_id;

    -- 6. Package exported (10 points)
    SELECT CASE
        WHEN COUNT(*) > 0 THEN 10 ELSE 0
    END INTO v_score_package
    FROM reproducibility_packages
    WHERE analysis_id = p_analysis_id;

    -- 7. Published with DOI (5 points)
    SELECT CASE
        WHEN COUNT(*) > 0 AND bool_or(doi IS NOT NULL) THEN 5 ELSE 0
    END INTO v_score_doi
    FROM reproducibility_packages
    WHERE analysis_id = p_analysis_id;

    -- Calculate total
    v_total := v_score_params + v_score_software + v_score_prov +
               v_score_checksums + v_score_methods + v_score_package + v_score_doi;

    -- Assign badge
    IF v_total = 100 AND v_score_doi = 5 THEN
        v_badge := 'platinum';
    ELSIF v_total >= 85 AND v_score_package = 10 THEN
        v_badge := 'gold';
    ELSIF v_total >= 60 THEN
        v_badge := 'silver';
    ELSIF v_total >= 40 THEN
        v_badge := 'bronze';
    END IF;

    -- Return scores
    RETURN QUERY SELECT
        v_total,
        v_score_params,
        v_score_software,
        v_score_prov,
        v_score_checksums,
        v_score_methods,
        v_score_package,
        v_score_doi,
        v_badge;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. REPRODUCIBILITY VERIFICATION ATTEMPTS
-- ============================================================================
-- Track when someone attempts to reproduce an analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS reproducibility_verifications (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    original_analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    original_version_id TEXT NOT NULL REFERENCES analysis_versions(id) ON DELETE CASCADE,
    reproduced_analysis_id TEXT REFERENCES analyses(id) ON DELETE SET NULL,

    -- Verifier information
    verified_by TEXT REFERENCES profiles(id),
    verifier_institution TEXT,
    verifier_notes TEXT,

    -- Verification results
    status TEXT NOT NULL, -- 'in_progress', 'identical', 'minor_differences', 'major_differences', 'failed'
    results_match BOOLEAN,
    differences JSONB, -- Detailed breakdown of differences

    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    -- Metadata
    environment_differences JSONB, -- Software version differences, etc.
    verification_report TEXT -- Detailed report of verification attempt
);

CREATE INDEX idx_reproducibility_verifications_original_analysis ON reproducibility_verifications(original_analysis_id);
CREATE INDEX idx_reproducibility_verifications_verified_by ON reproducibility_verifications(verified_by);
CREATE INDEX idx_reproducibility_verifications_status ON reproducibility_verifications(status);
CREATE INDEX idx_reproducibility_verifications_started_at ON reproducibility_verifications(started_at DESC);

-- ============================================================================
-- 8. ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- Ensure users can only access their own reproducibility data (or shared analyses)
-- ============================================================================

ALTER TABLE analysis_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prov_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE prov_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE prov_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE prov_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE reproducibility_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reproducibility_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE reproducibility_verifications ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own analysis versions
CREATE POLICY analysis_versions_select_policy ON analysis_versions
    FOR SELECT
    USING (
        analysis_id IN (
            SELECT id FROM analyses WHERE user_id = auth.uid()
            UNION
            SELECT analysis_id FROM analysis_shares WHERE email = (SELECT email FROM profiles WHERE id = auth.uid()) AND status = 'accepted'
        )
    );

-- Policy: Users can insert versions for their own analyses
CREATE POLICY analysis_versions_insert_policy ON analysis_versions
    FOR INSERT
    WITH CHECK (
        analysis_id IN (SELECT id FROM analyses WHERE user_id = auth.uid())
    );

-- Similar policies for other tables
CREATE POLICY prov_entities_select_policy ON prov_entities
    FOR SELECT
    USING (
        analysis_id IN (
            SELECT id FROM analyses WHERE user_id = auth.uid()
            UNION
            SELECT analysis_id FROM analysis_shares WHERE email = (SELECT email FROM profiles WHERE id = auth.uid()) AND status = 'accepted'
        )
    );

CREATE POLICY prov_activities_select_policy ON prov_activities
    FOR SELECT
    USING (
        analysis_id IN (
            SELECT id FROM analyses WHERE user_id = auth.uid()
            UNION
            SELECT analysis_id FROM analysis_shares WHERE email = (SELECT email FROM profiles WHERE id = auth.uid()) AND status = 'accepted'
        )
    );

CREATE POLICY prov_relations_select_policy ON prov_relations
    FOR SELECT
    USING (
        analysis_id IN (
            SELECT id FROM analyses WHERE user_id = auth.uid()
            UNION
            SELECT analysis_id FROM analysis_shares WHERE email = (SELECT email FROM profiles WHERE id = auth.uid()) AND status = 'accepted'
        )
    );

CREATE POLICY analysis_methods_select_policy ON analysis_methods
    FOR SELECT
    USING (
        analysis_id IN (
            SELECT id FROM analyses WHERE user_id = auth.uid()
            UNION
            SELECT analysis_id FROM analysis_shares WHERE email = (SELECT email FROM profiles WHERE id = auth.uid()) AND status = 'accepted'
        )
    );

CREATE POLICY reproducibility_packages_select_policy ON reproducibility_packages
    FOR SELECT
    USING (
        is_public = true OR
        analysis_id IN (
            SELECT id FROM analyses WHERE user_id = auth.uid()
            UNION
            SELECT analysis_id FROM analysis_shares WHERE email = (SELECT email FROM profiles WHERE id = auth.uid()) AND status = 'accepted'
        )
    );

CREATE POLICY reproducibility_scores_select_policy ON reproducibility_scores
    FOR SELECT
    USING (
        analysis_id IN (
            SELECT id FROM analyses WHERE user_id = auth.uid()
            UNION
            SELECT analysis_id FROM analysis_shares WHERE email = (SELECT email FROM profiles WHERE id = auth.uid()) AND status = 'accepted'
        )
    );

CREATE POLICY reproducibility_verifications_select_policy ON reproducibility_verifications
    FOR SELECT
    USING (
        verified_by = auth.uid() OR
        original_analysis_id IN (
            SELECT id FROM analyses WHERE user_id = auth.uid()
        )
    );

-- ============================================================================
-- 9. UTILITY FUNCTIONS
-- ============================================================================

-- Function to create initial version when analysis is created
CREATE OR REPLACE FUNCTION create_initial_analysis_version()
RETURNS TRIGGER AS $$
DECLARE
    v_version_number INTEGER;
    v_git_hash TEXT;
BEGIN
    -- Calculate git-style hash
    v_git_hash := encode(digest(
        NEW.id ||
        COALESCE(NEW.parameters::text, '') ||
        COALESCE(array_to_string(NEW.file_names, ','), '') ||
        COALESCE(NEW.library, ''),
        'sha256'
    ), 'hex');

    -- Get next version number
    v_version_number := get_next_version_number(NEW.id);

    -- Create version snapshot
    INSERT INTO analysis_versions (
        analysis_id,
        version_number,
        created_by,
        change_description,
        git_style_hash,
        snapshot_data,
        input_files,
        sample_metadata,
        library_info,
        software_environment,
        is_current
    ) VALUES (
        NEW.id,
        v_version_number,
        NEW.user_id,
        'Initial version',
        v_git_hash,
        jsonb_build_object(
            'name', NEW.name,
            'method', NEW.method,
            'parameters', NEW.parameters,
            'status', NEW.status
        ),
        jsonb_build_object(
            'file_names', NEW.file_names,
            'count_matrix_r2_key', NEW.count_matrix_r2_key
        ),
        COALESCE(NEW.sample_labels, '{}'::jsonb),
        jsonb_build_object(
            'library', NEW.library
        ),
        jsonb_build_object(
            'splicr_version', '1.2.3',
            'created_at', NEW.created_at
        ),
        true
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create initial version
CREATE TRIGGER trigger_create_initial_version
    AFTER INSERT ON analyses
    FOR EACH ROW
    EXECUTE FUNCTION create_initial_analysis_version();

-- Function to create version snapshot on analysis completion
CREATE OR REPLACE FUNCTION create_version_on_completion()
RETURNS TRIGGER AS $$
DECLARE
    v_version_number INTEGER;
    v_git_hash TEXT;
    v_execution_time INTEGER;
BEGIN
    -- Only create version when status changes to 'complete'
    IF NEW.status = 'complete' AND OLD.status != 'complete' THEN
        -- Calculate execution time
        v_execution_time := EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at))::INTEGER;

        -- Calculate git-style hash
        v_git_hash := encode(digest(
            NEW.id ||
            COALESCE(NEW.parameters::text, '') ||
            COALESCE(array_to_string(NEW.file_names, ','), '') ||
            COALESCE(NEW.library, '') ||
            COALESCE(NEW.results::text, ''),
            'sha256'
        ), 'hex');

        -- Get next version number
        v_version_number := get_next_version_number(NEW.id);

        -- Create version snapshot with results
        INSERT INTO analysis_versions (
            analysis_id,
            version_number,
            created_by,
            change_description,
            git_style_hash,
            snapshot_data,
            input_files,
            sample_metadata,
            library_info,
            software_environment,
            results_snapshot,
            execution_time_seconds,
            is_current
        ) VALUES (
            NEW.id,
            v_version_number,
            NEW.user_id,
            'Analysis completed',
            v_git_hash,
            jsonb_build_object(
                'name', NEW.name,
                'method', NEW.method,
                'parameters', NEW.parameters,
                'status', NEW.status,
                'progress', NEW.progress
            ),
            jsonb_build_object(
                'file_names', NEW.file_names,
                'count_matrix_r2_key', NEW.count_matrix_r2_key
            ),
            COALESCE(NEW.sample_labels, '{}'::jsonb),
            jsonb_build_object(
                'library', NEW.library
            ),
            jsonb_build_object(
                'splicr_version', '1.2.3',
                'completed_at', NEW.completed_at
            ),
            NEW.results,
            v_execution_time,
            true
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create version on completion
CREATE TRIGGER trigger_create_version_on_completion
    AFTER UPDATE OF status ON analyses
    FOR EACH ROW
    WHEN (NEW.status = 'complete')
    EXECUTE FUNCTION create_version_on_completion();

-- ============================================================================
-- 10. DEFAULT DATA
-- ============================================================================

-- Insert default methods templates
INSERT INTO methods_templates (
    name,
    display_name,
    description,
    template_content,
    analysis_types,
    journal_styles,
    is_default
) VALUES (
    'crispr_screen_default',
    'CRISPR Screen - Default Template',
    'Standard template for CRISPR screening experiments',
    '{
        "sections": {
            "study_design": {
                "template": "CRISPR screen analysis was performed using SplicR v{{splicr_version}} (https://splicr.org). {{library_name}} sgRNA library containing {{guide_count}} guides targeting {{gene_count}} genes was used. Samples were sequenced on {{platform}}, generating {{read_count}} million reads per sample.",
                "variables": ["splicr_version", "library_name", "guide_count", "gene_count", "platform", "read_count"]
            },
            "data_processing": {
                "template": "Raw FASTQ files were processed using MAGeCK v{{mageck_version}}. Reads were aligned to the sgRNA library with a maximum of {{mismatch_allowed}} mismatch allowed. Samples were normalized using {{normalization_method}}. Quality control metrics included read depth ({{read_depth_range}}), Gini coefficient ({{gini_value}}), and replicate correlation (Pearson r={{correlation}}).",
                "variables": ["mageck_version", "mismatch_allowed", "normalization_method", "read_depth_range", "gini_value", "correlation"]
            },
            "statistical_analysis": {
                "template": "Differential abundance analysis was performed using {{algorithm}} with FDR threshold of {{fdr_threshold}} and log2 fold-change threshold of {{fc_threshold}}. Essential genes were defined using {{essential_gene_list}}. Non-targeting controls were used for normalization.",
                "variables": ["algorithm", "fdr_threshold", "fc_threshold", "essential_gene_list"]
            },
            "data_availability": {
                "template": "Raw sequencing data and analysis results have been deposited at {{repository}} under accession {{accession_id}}. Analysis code and parameters are available at {{url}}. The complete analysis is reproducible using SplicR with analysis ID {{analysis_id}}.",
                "variables": ["repository", "accession_id", "url", "analysis_id"]
            }
        }
    }'::jsonb,
    ARRAY['screening', 'genetic_interaction'],
    ARRAY['nature', 'science', 'cell', 'apa'],
    true
);

-- Insert software agent for SplicR
INSERT INTO prov_agents (
    type,
    label,
    version,
    url,
    attributes
) VALUES (
    'software',
    'SplicR',
    '1.2.3',
    'https://splicr.org',
    '{"description": "CRISPR screening analysis platform", "license": "MIT"}'::jsonb
) ON CONFLICT (type, label, version) DO NOTHING;

-- Insert algorithm agents
INSERT INTO prov_agents (type, label, version, url) VALUES
    ('algorithm', 'MAGeCK-RRA', '0.5.9.4', 'https://sourceforge.net/projects/mageck/'),
    ('algorithm', 'BAGEL2', '2.0', 'https://github.com/hart-lab/bagel'),
    ('algorithm', 'DrugZ', '1.0', 'https://github.com/hart-lab/drugz')
ON CONFLICT (type, label, version) DO NOTHING;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Add helpful comment
COMMENT ON TABLE analysis_versions IS 'Stores complete snapshots of analysis state for versioning and rollback';
COMMENT ON TABLE prov_entities IS 'W3C PROV entities - data objects in provenance graph';
COMMENT ON TABLE prov_activities IS 'W3C PROV activities - processing steps in provenance graph';
COMMENT ON TABLE prov_agents IS 'W3C PROV agents - actors (users, software) in provenance graph';
COMMENT ON TABLE prov_relations IS 'W3C PROV relations - connections in provenance graph';
COMMENT ON TABLE analysis_methods IS 'Auto-generated and user-edited methods sections for publications';
COMMENT ON TABLE methods_templates IS 'Reusable templates for generating methods text';
COMMENT ON TABLE reproducibility_packages IS 'Exported packages for sharing and reproducing analyses';
COMMENT ON TABLE reproducibility_scores IS 'Calculated reproducibility scores with component breakdown';
COMMENT ON TABLE reproducibility_verifications IS 'Independent verification attempts and results';
