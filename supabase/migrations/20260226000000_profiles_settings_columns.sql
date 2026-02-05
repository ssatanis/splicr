-- Add profile columns used by Settings so all sections can save.
-- Safe to run: uses IF NOT EXISTS.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS orcid_id text,
  ADD COLUMN IF NOT EXISTS research_areas text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS profile_visibility text DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/New_York';

COMMENT ON COLUMN public.profiles.display_name IS 'Display name shown to others';
COMMENT ON COLUMN public.profiles.orcid_id IS 'ORCID iD (e.g. 0000-0000-0000-0000)';
COMMENT ON COLUMN public.profiles.research_areas IS 'Selected research area tags';
COMMENT ON COLUMN public.profiles.profile_visibility IS 'public, team, or private';
COMMENT ON COLUMN public.profiles.timezone IS 'User timezone (e.g. America/New_York)';
