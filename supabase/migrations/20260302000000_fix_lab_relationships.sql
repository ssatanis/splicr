-- 20260302000000_fix_lab_relationships.sql
-- Fix missing foreign keys for PostgREST resource embedding

-- 1. Ensure foreign key from lab_members to profiles exists (on user_id)
-- This allows: select('*, profiles!inner(*)') from lab_members
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'lab_members_user_id_fkey_profiles'
    ) THEN
        ALTER TABLE public.lab_members
        ADD CONSTRAINT lab_members_user_id_fkey_profiles
        FOREIGN KEY (user_id) REFERENCES public.profiles(id)
        ON DELETE CASCADE;
    END IF;
END $$;

-- 2. Ensure foreign key from analyses to profiles exists (on user_id)
-- This allows: select('*, profiles!inner(*)') from analyses
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'analyses_user_id_fkey_profiles'
    ) THEN
        ALTER TABLE public.analyses
        ADD CONSTRAINT analyses_user_id_fkey_profiles
        FOREIGN KEY (user_id) REFERENCES public.profiles(id)
        ON DELETE CASCADE;
    END IF;
END $$;
