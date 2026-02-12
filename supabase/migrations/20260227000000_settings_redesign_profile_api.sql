-- Settings redesign: add PI name and department to profiles
-- Safe to run: uses IF NOT EXISTS.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pi_name TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT;

COMMENT ON COLUMN public.profiles.pi_name IS 'Principal Investigator or supervisor name';
COMMENT ON COLUMN public.profiles.department IS 'Department name (separate from lab/group name)';
