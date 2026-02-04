-- ============================================================================
-- COMPREHENSIVE SECURITY LINTER FIXES
-- ============================================================================
-- Fixes all Supabase Database Linter security warnings:
-- 1. Function search_path mutable (11 functions) - SET search_path = public
-- 2. Extension in public - pg_trgm in extensions schema
-- 3. RLS policy always true - Drop service role policies (service_role bypasses RLS)
--
-- Note: auth_leaked_password_protection is configured in Supabase Dashboard:
-- Auth > Providers > Email > Enable "Prevent use of leaked passwords"
-- (Requires Pro plan)
-- ============================================================================

-- ============================================================================
-- PART 1: FIX FUNCTION SEARCH_PATH (11 functions)
-- ============================================================================
-- Later migrations (e.g. 20260207000000) overwrite functions without search_path.
-- Re-apply all functions with SET search_path = public for security.

CREATE OR REPLACE FUNCTION public.get_email_domain(email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN split_part(email, '@', 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_public_analysis_views(analysis_id_param TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.public_analyses
  SET views = COALESCE(views, 0) + 1
  WHERE analysis_id = analysis_id_param::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_user_usage_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at, updated_at)
  VALUES (NEW.id, NEW.email, now(), now())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_cache_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.last_accessed = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_drug_gene_cache_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_batch_job_progress(job_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.batch_jobs
  SET completed_items = (
    SELECT COUNT(*) FROM public.batch_job_items
    WHERE batch_job_id = job_id AND status = 'completed'
  )
  WHERE id = job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_template_usage(template_id_param UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.analysis_templates
  SET usage_count = COALESCE(usage_count, 0) + 1
  WHERE id = template_id_param;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_api_usage(key_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.api_keys
  SET last_used_at = now()
  WHERE id = key_id;

  INSERT INTO public.api_usage_logs (api_key_id, endpoint, method, status_code)
  VALUES (key_id, 'unknown', 'unknown', 200);
END;
$$;

-- Fix update_gene_set_count (from reference_gene_sets migration)
CREATE OR REPLACE FUNCTION public.update_gene_set_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.reference_gene_sets
    SET gene_count = gene_count + 1,
        updated_at = NOW()
    WHERE id = NEW.gene_set_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.reference_gene_sets
    SET gene_count = GREATEST(gene_count - 1, 0),
        updated_at = NOW()
    WHERE id = OLD.gene_set_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- ============================================================================
-- PART 2: MOVE PG_TRGM EXTENSION TO EXTENSIONS SCHEMA
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension
    WHERE extname = 'pg_trgm' AND extnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    DROP EXTENSION IF EXISTS pg_trgm CASCADE;
    CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
    GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
    GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
  END IF;
END
$$;

-- Update search_path for any objects that depend on pg_trgm in public
-- (e.g. indexes using gin_trgm_ops - these reference the extension)
DO $$
BEGIN
  -- If pg_trgm was in public, we need to ensure extensions schema is in search_path
  -- for existing queries. The API already has extra_search_path = ["public", "extensions"]
  NULL;
END
$$;

-- ============================================================================
-- PART 3: FIX RLS POLICIES - DROP PERMISSIVE SERVICE POLICIES
-- ============================================================================
-- Service role bypasses RLS entirely. Policies with WITH CHECK (true) allow
-- ANY role to insert, which is a security risk. Dropping these policies means:
-- - Service role: still can insert (bypasses RLS)
-- - anon/authenticated: denied (no permissive INSERT policy)

DROP POLICY IF EXISTS "Service role can write activity" ON public.activity_log;
DROP POLICY IF EXISTS "Service can insert analysis parameter versions" ON public.analysis_parameter_versions;
DROP POLICY IF EXISTS "Service can insert email logs" ON public.email_logs;
DROP POLICY IF EXISTS "Service can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service role can insert access logs" ON public.screen_access_log;
