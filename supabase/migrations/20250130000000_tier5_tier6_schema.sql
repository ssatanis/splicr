-- Tier 5 & 6: Advanced Analysis + API Access
-- Run this in Supabase SQL Editor to create algorithm_runs, reference_gene_lists,
-- batch_jobs, batch_job_items, api_keys, api_usage_logs, analysis_templates

-- Algorithm runs (BAGEL2/DrugZ executions)
CREATE TABLE IF NOT EXISTS algorithm_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  algorithm_type TEXT NOT NULL CHECK (algorithm_type IN ('bagel2', 'drugz')),
  algorithm_version TEXT DEFAULT '2.0',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input_parameters JSONB DEFAULT '{}',
  results JSONB,
  output_location TEXT,
  error_message TEXT,
  error_traceback TEXT,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_algorithm_runs_analysis_id ON algorithm_runs(analysis_id);
CREATE INDEX IF NOT EXISTS idx_algorithm_runs_user_id ON algorithm_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_algorithm_runs_status ON algorithm_runs(status);

-- Reference gene lists (essential/nonessential for BAGEL2)
CREATE TABLE IF NOT EXISTS reference_gene_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  list_type TEXT NOT NULL CHECK (list_type IN ('essential', 'nonessential')),
  genes TEXT[] NOT NULL,
  library_name TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reference_gene_lists_name ON reference_gene_lists(name);

-- Seed CEGv2 / NEGv1 style lists (representative subsets; full lists can be imported)
INSERT INTO reference_gene_lists (name, list_type, genes, library_name, source)
VALUES
  ('CEGv2', 'essential', ARRAY['RPS19','RPL5','RPL11','RPS14','POLR2A','POLR2B','SF3A1','SF3B1','EIF3A','EIF3B','PSMA1','PSMA2','COPA','COPB1','NUP93','NUP107','MCM2','MCM3','PLK1','AURKB']::TEXT[], 'Brunello', 'BAGEL2 reference'),
  ('NEGv1', 'nonessential', ARRAY['OR2T1','OR2T2','OR4C3','OR4C6','KRTAP1-1','KRTAP1-3','SPRR1A','SPRR1B','DEFB1','DEFB4A','LCE1A','LCE1B','MS4A1','MS4A2','SAGE1','SSX1']::TEXT[], 'Brunello', 'BAGEL2 reference')
ON CONFLICT (name) DO NOTHING;

-- Batch jobs (enterprise batch analysis)
CREATE TABLE IF NOT EXISTS batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  parameters JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_batch_jobs_user_id ON batch_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);

-- Batch job items (one per analysis in a batch)
CREATE TABLE IF NOT EXISTS batch_job_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_job_id UUID NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result_id UUID REFERENCES algorithm_runs(id),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(batch_job_id, position)
);

CREATE INDEX IF NOT EXISTS idx_batch_job_items_batch_job_id ON batch_job_items(batch_job_id);

-- API keys (developer API access)
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT,
  tier TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'pro', 'enterprise')),
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 100,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

-- API usage logs (rate limiting + auditing)
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES api_keys(id),
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_logs_api_key_id ON api_usage_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_created_at ON api_usage_logs(created_at);

-- Analysis templates (workflow presets)
CREATE TABLE IF NOT EXISTS analysis_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  parameters JSONB NOT NULL DEFAULT '{}',
  algorithms TEXT[] DEFAULT ARRAY['mageck']::TEXT[],
  is_public BOOLEAN DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_templates_category ON analysis_templates(category);

-- Optional: link analyses to Supabase if not already present
-- Uncomment if your app uses a separate 'analyses' table in Supabase
-- CREATE TABLE IF NOT EXISTS analyses (
--   id TEXT PRIMARY KEY,
--   user_id TEXT NOT NULL,
--   name TEXT NOT NULL,
--   library_type TEXT,
--   algorithms TEXT[],
--   status TEXT,
--   parameters JSONB,
--   results JSONB,
--   sample_labels JSONB,
--   created_at TIMESTAMPTZ DEFAULT now(),
--   completed_at TIMESTAMPTZ
-- );
