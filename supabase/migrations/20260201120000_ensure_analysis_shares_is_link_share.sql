-- Ensure analysis_shares has is_link_share (fixes "Could not find the 'is_link_share' column").
-- If running this times out via CLI, run in Supabase Dashboard → SQL Editor (paste all, then Run).

DO $$ BEGIN
  CREATE TYPE share_visibility AS ENUM ('private', 'institution', 'public');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS is_link_share BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS visibility share_visibility NOT NULL DEFAULT 'private';
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) UNIQUE;
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS link_permission TEXT NOT NULL DEFAULT 'view';
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS link_expires_at TIMESTAMPTZ;
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS institution_domain VARCHAR(255);
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS institution_permission TEXT NOT NULL DEFAULT 'view';
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
