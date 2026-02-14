-- =====================================================================
-- TxScore User Data Schema
-- User-specific data for the Therapeutic Research Dashboard
-- =====================================================================

-- 1. SAVED TARGETS
-- Users can save lists of targets (e.g., "My Breast Cancer Targets")
CREATE TABLE IF NOT EXISTS user_saved_targets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    gene_id TEXT NOT NULL REFERENCES tx_genes_master(gene_id) ON DELETE CASCADE,
    list_name TEXT DEFAULT 'Default', -- Organized in lists
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicates in same list
    CONSTRAINT unique_saved_target UNIQUE (user_id, gene_id, list_name)
);

-- Enable RLS
ALTER TABLE user_saved_targets ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own saved targets" 
    ON user_saved_targets FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own saved targets" 
    ON user_saved_targets FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved targets" 
    ON user_saved_targets FOR DELETE 
    USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_user_saved_user_id ON user_saved_targets(user_id);
CREATE INDEX idx_user_saved_gene_id ON user_saved_targets(gene_id);


-- 2. TARGET NOTES
-- Private notes on specific genes
CREATE TABLE IF NOT EXISTS user_target_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    gene_id TEXT NOT NULL REFERENCES tx_genes_master(gene_id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- One note per gene per user (can be long text)
    CONSTRAINT unique_user_gene_note UNIQUE (user_id, gene_id)
);

-- Enable RLS
ALTER TABLE user_target_notes ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own notes" 
    ON user_target_notes FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert/update their own notes" 
    ON user_target_notes FOR ALL
    USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_user_notes_user_id ON user_target_notes(user_id);


-- 3. USER VIEW SETTINGS
-- Persisted dashboard configuration (column visibility, last filters)
CREATE TABLE IF NOT EXISTS user_view_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    dashboard_config JSONB DEFAULT '{}'::jsonb, -- {columns: [], filters: {}, ...}
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE user_view_settings ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can manage their own settings" 
    ON user_view_settings FOR ALL
    USING (auth.uid() = user_id);
