-- Migration: Multi-Level Access Control System
-- Extends existing analysis_shares with link-based sharing, institution access, and audit logs
-- Compatible with existing email-based collaboration system

-- =============================================================================
-- 1. CREATE ENUMS
-- =============================================================================

-- Visibility levels for link-based sharing
DO $$ BEGIN
  CREATE TYPE share_visibility AS ENUM ('private', 'institution', 'public');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE share_visibility IS 'private: invite-only | institution: same email domain | public: anyone with link';

-- Access methods for audit trail
DO $$ BEGIN
  CREATE TYPE access_method AS ENUM ('owner', 'collaborator', 'institution', 'public_link');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE access_method IS 'owner: analysis owner | collaborator: invited via email | institution: same domain | public_link: via token';

-- =============================================================================
-- 2. EXTEND ANALYSIS_SHARES TABLE
-- =============================================================================

-- Ensure analysis_shares table exists with base columns
CREATE TABLE IF NOT EXISTS public.analysis_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id TEXT NOT NULL, -- TEXT to match analyses.id type
  email TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit', 'admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  shared_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);

-- Add new columns for link-based sharing (idempotent)
DO $$
BEGIN
  -- Visibility level
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'visibility'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN visibility share_visibility NOT NULL DEFAULT 'private';
  END IF;

  -- Share token for public/institution links
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'share_token'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN share_token VARCHAR(64) UNIQUE;
  END IF;

  -- Link permission (for public/institution access)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'link_permission'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN link_permission TEXT NOT NULL DEFAULT 'view' CHECK (link_permission IN ('view', 'edit'));
  END IF;

  -- Link expiration
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'link_expires_at'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN link_expires_at TIMESTAMPTZ;
  END IF;

  -- Institution domain (extracted from owner email)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'institution_domain'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN institution_domain VARCHAR(255);
  END IF;

  -- Institution permission
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'institution_permission'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN institution_permission TEXT NOT NULL DEFAULT 'view' CHECK (institution_permission IN ('view', 'edit'));
  END IF;

  -- Updated at timestamp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;

  -- Is link share (distinguishes link-based config from email invites)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'is_link_share'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN is_link_share BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

COMMENT ON COLUMN public.analysis_shares.visibility IS 'Link sharing visibility: private (invite-only), institution (same domain), or public (anyone)';
COMMENT ON COLUMN public.analysis_shares.share_token IS 'Cryptographically random token for link-based access';
COMMENT ON COLUMN public.analysis_shares.link_permission IS 'Permission level for public/institution link access';
COMMENT ON COLUMN public.analysis_shares.institution_domain IS 'Email domain extracted from owner email (e.g., cornell.edu)';
COMMENT ON COLUMN public.analysis_shares.is_link_share IS 'True for link share config, false for email invite';

-- Add constraint: token required when visibility is institution or public
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analysis_shares_token_check'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD CONSTRAINT analysis_shares_token_check
        CHECK (
          (is_link_share = false) OR
          (is_link_share = true AND visibility = 'private' AND share_token IS NULL) OR
          (is_link_share = true AND visibility IN ('institution', 'public') AND share_token IS NOT NULL)
        );
  END IF;
END $$;

-- One link-share config per analysis (partial unique index).
-- We do not use UNIQUE(analysis_id, is_link_share) because that would allow only
-- one email invite per analysis; we need multiple (analysis_id, is_link_share = false).
CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_shares_one_link_per_analysis
  ON public.analysis_shares(analysis_id)
  WHERE is_link_share = true;

COMMENT ON INDEX idx_analysis_shares_one_link_per_analysis IS 'Ensures at most one link share config per analysis; email invites are unlimited.';

-- Create indexes for access checks
CREATE INDEX IF NOT EXISTS idx_analysis_shares_token
  ON public.analysis_shares(share_token) WHERE share_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analysis_shares_analysis_id
  ON public.analysis_shares(analysis_id);

CREATE INDEX IF NOT EXISTS idx_analysis_shares_shared_by
  ON public.analysis_shares(shared_by);

CREATE INDEX IF NOT EXISTS idx_analysis_shares_email
  ON public.analysis_shares(email);

CREATE INDEX IF NOT EXISTS idx_analysis_shares_user_id
  ON public.analysis_shares(user_id) WHERE user_id IS NOT NULL;

-- =============================================================================
-- 3. CREATE ACCESS LOG TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.analysis_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id TEXT NOT NULL, -- TEXT to match analyses.id
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Preserve logs if user deleted

  -- Access details
  access_type VARCHAR(50) NOT NULL, -- 'view', 'edit', 'download', 'share', 'delete'
  access_method access_method, -- How they gained access

  -- Security metadata
  ip_address INET,
  user_agent TEXT,

  -- Timestamp
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.analysis_access_log IS 'Audit trail for all analysis access attempts';
COMMENT ON COLUMN public.analysis_access_log.access_type IS 'Type of action: view, edit, download, share, delete';
COMMENT ON COLUMN public.analysis_access_log.access_method IS 'How user accessed: owner, collaborator, institution, public_link';

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_access_log_analysis_time
  ON public.analysis_access_log(analysis_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_access_log_user
  ON public.analysis_access_log(user_id, accessed_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_access_log_time
  ON public.analysis_access_log(accessed_at DESC);

-- =============================================================================
-- 4. HELPER FUNCTIONS
-- =============================================================================

-- Extract domain from email address
CREATE OR REPLACE FUNCTION get_email_domain(email TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN LOWER(SUBSTRING(email FROM '@(.*)$'));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION get_email_domain(TEXT) IS 'Extracts domain from email (e.g., user@cornell.edu → cornell.edu)';

-- Update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for automatic timestamp updates on analysis_shares
DROP TRIGGER IF EXISTS analysis_shares_updated_at ON public.analysis_shares;
CREATE TRIGGER analysis_shares_updated_at
  BEFORE UPDATE ON public.analysis_shares
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE public.analysis_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_access_log ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate with new logic
DROP POLICY IF EXISTS "Owners can manage analysis shares" ON public.analysis_shares;
DROP POLICY IF EXISTS "Collaborators can view their shares" ON public.analysis_shares;
DROP POLICY IF EXISTS "Users can view share configs for accessible analyses" ON public.analysis_shares;
DROP POLICY IF EXISTS "Owners can view access logs" ON public.analysis_access_log;
DROP POLICY IF EXISTS "Service role can insert access logs" ON public.analysis_access_log;

-- Analysis Shares Policies

-- Owners can manage all shares (both link configs and email invites)
CREATE POLICY "Owners can manage analysis shares"
  ON public.analysis_shares FOR ALL
  USING (
    shared_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = analysis_shares.analysis_id
        AND analyses.user_id = auth.uid()
    )
  )
  WITH CHECK (
    shared_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = analysis_shares.analysis_id
        AND analyses.user_id = auth.uid()
    )
  );

-- Collaborators can view their own email invitations
CREATE POLICY "Collaborators can view their shares"
  ON public.analysis_shares FOR SELECT
  USING (
    user_id = auth.uid()
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Anyone can view link share configs (needed for access checks)
CREATE POLICY "Users can view share configs for accessible analyses"
  ON public.analysis_shares FOR SELECT
  USING (is_link_share = true);

-- Access Log Policies

-- Only owners can view access logs for their analyses
CREATE POLICY "Owners can view access logs"
  ON public.analysis_access_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id::text = analysis_access_log.analysis_id
        AND analyses.user_id = auth.uid()
    )
  );

-- Service role can insert access logs (for audit trail)
CREATE POLICY "Service role can insert access logs"
  ON public.analysis_access_log FOR INSERT
  WITH CHECK (true);

-- =============================================================================
-- 6. GRANT PERMISSIONS
-- =============================================================================

GRANT ALL ON public.analysis_shares TO authenticated;
GRANT ALL ON public.analysis_shares TO service_role;

GRANT ALL ON public.analysis_access_log TO authenticated;
GRANT ALL ON public.analysis_access_log TO service_role;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================

-- Verification query (optional - comment out if not needed)
DO $$
BEGIN
  RAISE NOTICE 'Migration complete: Multi-level access control system installed';
  RAISE NOTICE 'Tables: analysis_shares (extended), analysis_access_log (new)';
  RAISE NOTICE 'Enums: share_visibility, access_method';
  RAISE NOTICE 'Functions: get_email_domain, update_updated_at_column';
END $$;
