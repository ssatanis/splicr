-- ============================================================================
-- PUBLIC PROFILE: unique profile ID and URL for each user
-- ============================================================================
-- Adds:
-- - public_profile_id (unique, URL-safe) and public_profile_enabled on users
-- - Backfill and trigger so every user has a unique ID
-- - RLS so signed-in users can view public profiles and published analyses
-- ============================================================================

-- Add columns to public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS public_profile_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS public_profile_enabled BOOLEAN NOT NULL DEFAULT false;

-- Index for fast lookup by public_profile_id (unique constraint already creates one; add for clarity)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_profile_id
  ON public.users(public_profile_id)
  WHERE public_profile_id IS NOT NULL;

-- Backfill: give every existing user a unique public_profile_id (24-char hex)
UPDATE public.users
SET public_profile_id = encode(gen_random_bytes(12), 'hex')
WHERE public_profile_id IS NULL;

-- New users: set public_profile_id in handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at, updated_at, public_profile_id, public_profile_enabled)
  VALUES (NEW.id, NEW.email, now(), now(), encode(gen_random_bytes(12), 'hex'), false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- RLS: only allow viewing other users when their profile is public
DROP POLICY IF EXISTS "Users can view other profiles" ON public.users;
CREATE POLICY "Users can view other profiles" ON public.users FOR SELECT
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      id = (SELECT auth.uid())
      OR (public_profile_enabled = true AND public_profile_id IS NOT NULL)
    )
  );

-- Analyses: allow viewing if analysis is published (in public_analyses)
DROP POLICY IF EXISTS "Users can view own analyses" ON public.analyses;
CREATE POLICY "Users can view own analyses" ON public.analyses FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.analysis_shares
      WHERE analysis_shares.analysis_id = analyses.id
        AND analysis_shares.user_id = (SELECT auth.uid())
        AND analysis_shares.status = 'accepted'
      LIMIT 1
    )
    OR EXISTS (
      SELECT 1 FROM public.public_analyses
      WHERE public_analyses.analysis_id = analyses.id
      LIMIT 1
    )
  );

-- Profiles: allow viewing another user's profile if they have public profile enabled
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT
  USING (
    id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = profiles.id
        AND u.public_profile_enabled = true
        AND u.public_profile_id IS NOT NULL
    )
  );

-- public_analyses: allow any authenticated user to read (see published analyses)
ALTER TABLE public.public_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view public analyses" ON public.public_analyses;
DROP POLICY IF EXISTS "Anyone can view public analyses" ON public.public_analyses;
CREATE POLICY "Authenticated users can view public analyses" ON public.public_analyses
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- Owners can manage their published analyses
DROP POLICY IF EXISTS "Owners can manage public analyses" ON public.public_analyses;
CREATE POLICY "Owners can manage public analyses" ON public.public_analyses
  FOR ALL TO authenticated
  USING (published_by = (SELECT auth.uid()))
  WITH CHECK (published_by = (SELECT auth.uid()));
