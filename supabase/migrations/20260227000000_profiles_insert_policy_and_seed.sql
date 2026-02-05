-- ============================================================================
-- FIX: Add INSERT policy on public.profiles so users can create their own row
-- via upsert from the Settings page. Also seed profiles from handle_new_user()
-- and backfill any existing users who are missing a profiles row.
-- ============================================================================

-- 1. Add the missing INSERT policy (idempotent)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

-- 2. Update handle_new_user() to also create a profiles row alongside the users row.
--    SECURITY DEFINER bypasses RLS so this always works.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create users row (existing behaviour)
  INSERT INTO public.users (id, email, created_at, updated_at, public_profile_id, public_profile_enabled)
  VALUES (NEW.id, NEW.email, now(), now(), encode(gen_random_bytes(12), 'hex'), false)
  ON CONFLICT (id) DO NOTHING;

  -- Seed profiles row so Settings can always UPDATE
  INSERT INTO public.profiles (id, email, created_at, updated_at)
  VALUES (NEW.id, NEW.email, now(), now())
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 3. Backfill: create a profiles row for every auth user that is missing one.
INSERT INTO public.profiles (id, email, created_at, updated_at)
SELECT au.id, au.email, now(), now()
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = au.id
)
ON CONFLICT (id) DO NOTHING;
