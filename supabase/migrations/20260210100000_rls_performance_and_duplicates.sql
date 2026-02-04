-- ============================================================================
-- RLS PERFORMANCE FIXES & REMOVE DUPLICATES (Supabase Linter)
-- ============================================================================
-- Fixes:
-- 1. auth_rls_initplan: Wrap auth.uid() and current_setting() in (select ...)
--    so they are evaluated once per query, not per row.
-- 2. multiple_permissive_policies: Drop duplicate policies so one per (table, role, action).
-- 3. duplicate_index: Drop redundant indexes.
-- ============================================================================

-- ============================================================================
-- PART 1: DROP DUPLICATE POLICIES (keep one per table/role/action)
-- ============================================================================

-- analyses: drop alternate-named policies (keep "Users can view/insert/update/delete own analyses")
DROP POLICY IF EXISTS "Users view their own analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users create analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users update their analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users delete their analyses" ON public.analyses;

-- analysis_shares: drop duplicates (keep "Users can view shares for their analyses", "Analysis owners can create/delete shares", etc.)
DROP POLICY IF EXISTS "Users can view shares for own analyses" ON public.analysis_shares;
DROP POLICY IF EXISTS "Users can create shares for own analyses" ON public.analysis_shares;

-- analysis_templates: single SELECT policy (public or own)
-- Table may have user_id (UUID) or created_by (TEXT) depending on schema
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'analysis_templates') THEN
    DROP POLICY IF EXISTS "Users manage their own templates" ON public.analysis_templates;
    DROP POLICY IF EXISTS "Anyone can view public templates" ON public.analysis_templates;
    DROP POLICY IF EXISTS "Users can view public or own templates" ON public.analysis_templates;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analysis_templates' AND column_name = 'user_id') THEN
      CREATE POLICY "Users can view public or own templates" ON public.analysis_templates
        FOR SELECT USING (
          is_public = true OR user_id = (SELECT auth.uid())
        );
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'analysis_templates' AND column_name = 'created_by') THEN
      CREATE POLICY "Users can view public or own templates" ON public.analysis_templates
        FOR SELECT USING (
          is_public = true OR created_by = (SELECT auth.uid())::text
        );
    ELSE
      CREATE POLICY "Users can view public or own templates" ON public.analysis_templates
        FOR SELECT USING (is_public = true);
    END IF;
  END IF;
END $do$;

-- automation_rules: drop "Users can view own" (keep "Users can manage own" which covers SELECT)
DROP POLICY IF EXISTS "Users can view own automation rules" ON public.automation_rules;

-- clinical_trials_cache: add TO role to avoid overlap (if table exists)
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clinical_trials_cache') THEN
    DROP POLICY IF EXISTS "Authenticated users read trials cache" ON public.clinical_trials_cache;
    DROP POLICY IF EXISTS "Service role writes trials cache" ON public.clinical_trials_cache;
    CREATE POLICY "Authenticated users read trials cache" ON public.clinical_trials_cache
      FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
    CREATE POLICY "Service role writes trials cache" ON public.clinical_trials_cache
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $do$;

-- drug_gene_cache: drop duplicate read policy, add TO
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'drug_gene_cache') THEN
    DROP POLICY IF EXISTS "Allow authenticated users to read drug_gene_cache" ON public.drug_gene_cache;
    DROP POLICY IF EXISTS "Authenticated users read drug cache" ON public.drug_gene_cache;
    DROP POLICY IF EXISTS "Service role writes drug cache" ON public.drug_gene_cache;
    CREATE POLICY "Authenticated users read drug cache" ON public.drug_gene_cache
      FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
    CREATE POLICY "Service role writes drug cache" ON public.drug_gene_cache
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $do$;

-- gene_info_cache: add TO
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'gene_info_cache') THEN
    DROP POLICY IF EXISTS "Authenticated users read gene cache" ON public.gene_info_cache;
    DROP POLICY IF EXISTS "Service role writes gene cache" ON public.gene_info_cache;
    CREATE POLICY "Authenticated users read gene cache" ON public.gene_info_cache
      FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
    CREATE POLICY "Service role writes gene cache" ON public.gene_info_cache
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $do$;

-- lab_members: one SELECT policy (Lab members can view), Lab admins FOR INSERT/UPDATE/DELETE only
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lab_members') THEN
    DROP POLICY IF EXISTS "Lab members can view members" ON public.lab_members;
    DROP POLICY IF EXISTS "Lab admins can manage members" ON public.lab_members;
    DROP POLICY IF EXISTS "Lab admins can update members" ON public.lab_members;
    DROP POLICY IF EXISTS "Lab admins can delete members" ON public.lab_members;
    CREATE POLICY "Lab members can view members" ON public.lab_members FOR SELECT
      USING (lab_id IN (SELECT lab_id FROM public.lab_members WHERE user_id = (SELECT auth.uid())));
    CREATE POLICY "Lab admins can manage members" ON public.lab_members FOR INSERT
      WITH CHECK (lab_id IN (SELECT lab_id FROM public.lab_members WHERE user_id = (SELECT auth.uid()) AND role = 'admin'));
    CREATE POLICY "Lab admins can update members" ON public.lab_members FOR UPDATE
      USING (lab_id IN (SELECT lab_id FROM public.lab_members WHERE user_id = (SELECT auth.uid()) AND role = 'admin'));
    CREATE POLICY "Lab admins can delete members" ON public.lab_members FOR DELETE
      USING (lab_id IN (SELECT lab_id FROM public.lab_members WHERE user_id = (SELECT auth.uid()) AND role = 'admin'));
  END IF;
END $do$;

-- pubmed_cache: add TO
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pubmed_cache') THEN
    DROP POLICY IF EXISTS "Authenticated users read pubmed cache" ON public.pubmed_cache;
    DROP POLICY IF EXISTS "Service role writes pubmed cache" ON public.pubmed_cache;
    CREATE POLICY "Authenticated users read pubmed cache" ON public.pubmed_cache
      FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
    CREATE POLICY "Service role writes pubmed cache" ON public.pubmed_cache
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $do$;

-- screen_collaborators: add TO to separate (use user_id for invitee if column exists)
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'screen_collaborators') THEN
    DROP POLICY IF EXISTS "Collaborators can view their own invitation" ON public.screen_collaborators;
    DROP POLICY IF EXISTS "Owners can manage collaborators" ON public.screen_collaborators;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'screen_collaborators' AND column_name = 'invitee_id') THEN
      CREATE POLICY "Collaborators can view their own invitation" ON public.screen_collaborators
        FOR SELECT TO authenticated USING (invitee_id = (SELECT auth.uid()));
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'screen_collaborators' AND column_name = 'user_id') THEN
      CREATE POLICY "Collaborators can view their own invitation" ON public.screen_collaborators
        FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
    END IF;
    CREATE POLICY "Owners can manage collaborators" ON public.screen_collaborators
      FOR ALL TO authenticated USING (
        screen_id IN (SELECT id FROM public.screens WHERE user_id = (SELECT auth.uid()))
      );
  END IF;
END $do$;

-- screens: drop duplicate-named (keep "Users can view/insert/update own screens")
DROP POLICY IF EXISTS "Users view own screens" ON public.screens;
DROP POLICY IF EXISTS "Users insert own screens" ON public.screens;
DROP POLICY IF EXISTS "Users can update their own screens" ON public.screens;
DROP POLICY IF EXISTS "Users can delete their own screens" ON public.screens;

-- sgrna_sequences: drop one of the two read policies
DROP POLICY IF EXISTS "Anyone can view public sequences" ON public.sgrna_sequences;

-- users: fix auth and keep both SELECT policies
DROP POLICY IF EXISTS "Users can view other profiles" ON public.users;
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can view own profile" ON public.users FOR SELECT
  USING ((SELECT auth.uid()) = id);
CREATE POLICY "Users can view other profiles" ON public.users FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE
  USING ((SELECT auth.uid()) = id);

-- ============================================================================
-- PART 2: FIX AUTH RLS INITPLAN (wrap auth.uid() in (select auth.uid()))
-- ============================================================================
-- Policies that still use bare auth.uid() get re-evaluated per row. Recreate with (select auth.uid()).

-- user_settings, notifications, email_logs (from email_notifications migration)
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_settings') THEN
    DROP POLICY IF EXISTS "Users can view own settings" ON public.user_settings;
    CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;
    CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
    CREATE POLICY "Users can insert own settings" ON public.user_settings FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notifications') THEN
    DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
    CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
    CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'email_logs') THEN
    DROP POLICY IF EXISTS "Users can view own email logs" ON public.email_logs;
    CREATE POLICY "Users can view own email logs" ON public.email_logs FOR SELECT USING ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

-- analyses: ensure view policy uses (select auth.uid()) [query_performance_fix may have reverted it]
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
  );

-- production_settings_schema tables: analysis_defaults, analysis_presets, qc_settings, labs, etc.
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'analysis_defaults') THEN
    DROP POLICY IF EXISTS "Users can view own analysis defaults" ON public.analysis_defaults;
    CREATE POLICY "Users can view own analysis defaults" ON public.analysis_defaults FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own analysis defaults" ON public.analysis_defaults;
    CREATE POLICY "Users can update own analysis defaults" ON public.analysis_defaults FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own analysis defaults" ON public.analysis_defaults;
    CREATE POLICY "Users can insert own analysis defaults" ON public.analysis_defaults FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'analysis_presets') THEN
    DROP POLICY IF EXISTS "Users can view own presets" ON public.analysis_presets;
    CREATE POLICY "Users can view own presets" ON public.analysis_presets FOR SELECT USING ((SELECT auth.uid()) = user_id OR is_shared = true);
    DROP POLICY IF EXISTS "Users can update own presets" ON public.analysis_presets;
    CREATE POLICY "Users can update own presets" ON public.analysis_presets FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own presets" ON public.analysis_presets;
    CREATE POLICY "Users can insert own presets" ON public.analysis_presets FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can delete own presets" ON public.analysis_presets;
    CREATE POLICY "Users can delete own presets" ON public.analysis_presets FOR DELETE USING ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'qc_settings') THEN
    DROP POLICY IF EXISTS "Users can view own qc settings" ON public.qc_settings;
    CREATE POLICY "Users can view own qc settings" ON public.qc_settings FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own qc settings" ON public.qc_settings;
    CREATE POLICY "Users can update own qc settings" ON public.qc_settings FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own qc settings" ON public.qc_settings;
    CREATE POLICY "Users can insert own qc settings" ON public.qc_settings FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'labs') THEN
    DROP POLICY IF EXISTS "Lab members can view lab" ON public.labs;
    CREATE POLICY "Lab members can view lab" ON public.labs FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.lab_members WHERE lab_members.lab_id = labs.id AND lab_members.user_id = (SELECT auth.uid())));
    DROP POLICY IF EXISTS "Lab admins can update lab" ON public.labs;
    CREATE POLICY "Lab admins can update lab" ON public.labs FOR UPDATE
      USING (EXISTS (SELECT 1 FROM public.lab_members WHERE lab_members.lab_id = labs.id AND lab_members.user_id = (SELECT auth.uid()) AND lab_members.role = 'admin'));
    DROP POLICY IF EXISTS "Users can create labs" ON public.labs;
    CREATE POLICY "Users can create labs" ON public.labs FOR INSERT WITH CHECK (pi_user_id = (SELECT auth.uid()));
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'data_management_settings') THEN
    DROP POLICY IF EXISTS "Users can view own data management settings" ON public.data_management_settings;
    CREATE POLICY "Users can view own data management settings" ON public.data_management_settings FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own data management settings" ON public.data_management_settings;
    CREATE POLICY "Users can update own data management settings" ON public.data_management_settings FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own data management settings" ON public.data_management_settings;
    CREATE POLICY "Users can insert own data management settings" ON public.data_management_settings FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'collaboration_settings') THEN
    DROP POLICY IF EXISTS "Users can view own collaboration settings" ON public.collaboration_settings;
    CREATE POLICY "Users can view own collaboration settings" ON public.collaboration_settings FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own collaboration settings" ON public.collaboration_settings;
    CREATE POLICY "Users can update own collaboration settings" ON public.collaboration_settings FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own collaboration settings" ON public.collaboration_settings;
    CREATE POLICY "Users can insert own collaboration settings" ON public.collaboration_settings FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'compute_settings') THEN
    DROP POLICY IF EXISTS "Users can view own compute settings" ON public.compute_settings;
    CREATE POLICY "Users can view own compute settings" ON public.compute_settings FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own compute settings" ON public.compute_settings;
    CREATE POLICY "Users can update own compute settings" ON public.compute_settings FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own compute settings" ON public.compute_settings;
    CREATE POLICY "Users can insert own compute settings" ON public.compute_settings FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'two_factor_auth') THEN
    DROP POLICY IF EXISTS "Users can view own 2FA settings" ON public.two_factor_auth;
    CREATE POLICY "Users can view own 2FA settings" ON public.two_factor_auth FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own 2FA settings" ON public.two_factor_auth;
    CREATE POLICY "Users can update own 2FA settings" ON public.two_factor_auth FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own 2FA settings" ON public.two_factor_auth;
    CREATE POLICY "Users can insert own 2FA settings" ON public.two_factor_auth FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_sessions') THEN
    DROP POLICY IF EXISTS "Users can view own sessions" ON public.user_sessions;
    CREATE POLICY "Users can view own sessions" ON public.user_sessions FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can delete own sessions" ON public.user_sessions;
    CREATE POLICY "Users can delete own sessions" ON public.user_sessions FOR DELETE USING ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'reproducibility_settings') THEN
    DROP POLICY IF EXISTS "Users can view own reproducibility settings" ON public.reproducibility_settings;
    CREATE POLICY "Users can view own reproducibility settings" ON public.reproducibility_settings FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own reproducibility settings" ON public.reproducibility_settings;
    CREATE POLICY "Users can update own reproducibility settings" ON public.reproducibility_settings FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own reproducibility settings" ON public.reproducibility_settings;
    CREATE POLICY "Users can insert own reproducibility settings" ON public.reproducibility_settings FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'batch_settings') THEN
    DROP POLICY IF EXISTS "Users can view own batch settings" ON public.batch_settings;
    CREATE POLICY "Users can view own batch settings" ON public.batch_settings FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own batch settings" ON public.batch_settings;
    CREATE POLICY "Users can update own batch settings" ON public.batch_settings FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own batch settings" ON public.batch_settings;
    CREATE POLICY "Users can insert own batch settings" ON public.batch_settings FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'automation_rules') THEN
    DROP POLICY IF EXISTS "Users can manage own automation rules" ON public.automation_rules;
    CREATE POLICY "Users can manage own automation rules" ON public.automation_rules FOR ALL USING ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'compliance_settings') THEN
    DROP POLICY IF EXISTS "Users can view own compliance settings" ON public.compliance_settings;
    CREATE POLICY "Users can view own compliance settings" ON public.compliance_settings FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own compliance settings" ON public.compliance_settings;
    CREATE POLICY "Users can update own compliance settings" ON public.compliance_settings FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own compliance settings" ON public.compliance_settings;
    CREATE POLICY "Users can insert own compliance settings" ON public.compliance_settings FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'backup_settings') THEN
    DROP POLICY IF EXISTS "Users can view own backup settings" ON public.backup_settings;
    CREATE POLICY "Users can view own backup settings" ON public.backup_settings FOR SELECT USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can update own backup settings" ON public.backup_settings;
    CREATE POLICY "Users can update own backup settings" ON public.backup_settings FOR UPDATE USING ((SELECT auth.uid()) = user_id);
    DROP POLICY IF EXISTS "Users can insert own backup settings" ON public.backup_settings;
    CREATE POLICY "Users can insert own backup settings" ON public.backup_settings FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'backup_history') THEN
    DROP POLICY IF EXISTS "Users can view own backup history" ON public.backup_history;
    CREATE POLICY "Users can view own backup history" ON public.backup_history FOR SELECT USING ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'analysis_parameter_versions') THEN
    DROP POLICY IF EXISTS "Users can view own analysis parameter versions" ON public.analysis_parameter_versions;
    CREATE POLICY "Users can view own analysis parameter versions" ON public.analysis_parameter_versions FOR SELECT USING ((SELECT auth.uid()) = user_id);
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
    DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
    CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING ((SELECT auth.uid()) = id);
    CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING ((SELECT auth.uid()) = id);
  END IF;
END $do$;

-- analysis_comments, analysis_activity, activity_logs, comment_reactions (collaboration tables)
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'analysis_comments') THEN
    DROP POLICY IF EXISTS "Users can view comments on accessible analyses" ON public.analysis_comments;
    CREATE POLICY "Users can view comments on accessible analyses" ON public.analysis_comments FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.analyses WHERE analyses.id = analysis_comments.analysis_id AND (analyses.user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.analysis_shares WHERE analysis_shares.analysis_id = analyses.id AND analysis_shares.user_id = (SELECT auth.uid()) AND analysis_shares.status = 'accepted')));
    DROP POLICY IF EXISTS "Users can create comments on accessible analyses" ON public.analysis_comments;
    CREATE POLICY "Users can create comments on accessible analyses" ON public.analysis_comments FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.analyses WHERE analyses.id = analysis_comments.analysis_id AND (analyses.user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.analysis_shares WHERE analysis_shares.analysis_id = analyses.id AND analysis_shares.user_id = (SELECT auth.uid()) AND analysis_shares.status = 'accepted'))));
    DROP POLICY IF EXISTS "Users can update their own comments" ON public.analysis_comments;
    CREATE POLICY "Users can update their own comments" ON public.analysis_comments FOR UPDATE USING (user_id = (SELECT auth.uid()));
    DROP POLICY IF EXISTS "Users can delete their own comments" ON public.analysis_comments;
    CREATE POLICY "Users can delete their own comments" ON public.analysis_comments FOR DELETE USING (user_id = (SELECT auth.uid()));
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'analysis_activity') THEN
    DROP POLICY IF EXISTS "Users can view activity on accessible analyses" ON public.analysis_activity;
    CREATE POLICY "Users can view activity on accessible analyses" ON public.analysis_activity FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.analyses WHERE analyses.id = analysis_activity.analysis_id AND (analyses.user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.analysis_shares WHERE analysis_shares.analysis_id = analyses.id AND analysis_shares.user_id = (SELECT auth.uid()) AND analysis_shares.status = 'accepted'))));
    DROP POLICY IF EXISTS "Users can create activity on accessible analyses" ON public.analysis_activity;
    CREATE POLICY "Users can create activity on accessible analyses" ON public.analysis_activity FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.analyses WHERE analyses.id = analysis_activity.analysis_id AND (analyses.user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.analysis_shares WHERE analysis_shares.analysis_id = analyses.id AND analysis_shares.user_id = (SELECT auth.uid()) AND analysis_shares.status = 'accepted'))));
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'activity_logs') THEN
    DROP POLICY IF EXISTS "Users can view their own activity logs" ON public.activity_logs;
    CREATE POLICY "Users can view their own activity logs" ON public.activity_logs FOR SELECT USING (user_id = (SELECT auth.uid()));
    DROP POLICY IF EXISTS "Users can create activity logs" ON public.activity_logs;
    CREATE POLICY "Users can create activity logs" ON public.activity_logs FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
END $do$;

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'comment_reactions') THEN
    DROP POLICY IF EXISTS "Users can view reactions on accessible comments" ON public.comment_reactions;
    CREATE POLICY "Users can view reactions on accessible comments" ON public.comment_reactions FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.analysis_comments
        WHERE analysis_comments.id = comment_reactions.comment_id
        AND EXISTS (
          SELECT 1 FROM public.analyses
          WHERE analyses.id = analysis_comments.analysis_id
          AND (analyses.user_id = (SELECT auth.uid()) OR EXISTS (
            SELECT 1 FROM public.analysis_shares
            WHERE analysis_shares.analysis_id = analyses.id AND analysis_shares.user_id = (SELECT auth.uid()) AND analysis_shares.status = 'accepted'
          ))
        )
      ));
    DROP POLICY IF EXISTS "Users can add reactions to accessible comments" ON public.comment_reactions;
    CREATE POLICY "Users can add reactions to accessible comments" ON public.comment_reactions FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
    DROP POLICY IF EXISTS "Users can remove their own reactions" ON public.comment_reactions;
    CREATE POLICY "Users can remove their own reactions" ON public.comment_reactions FOR DELETE USING (user_id = (SELECT auth.uid()));
  END IF;
END $do$;

-- ============================================================================
-- PART 3: DROP DUPLICATE INDEXES
-- ============================================================================
-- Linter: identical indexes exist; keep one per (table, columns).

DROP INDEX IF EXISTS public.idx_algorithm_runs_analysis;
DROP INDEX IF EXISTS public.idx_api_keys_user;
DROP INDEX IF EXISTS public.idx_drug_gene_cache_symbol;
DROP INDEX IF EXISTS public.idx_sgrna_sequences_sequence_col;

