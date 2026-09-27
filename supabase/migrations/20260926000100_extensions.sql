-- ============================================================================
-- 0001 · Extensions
-- Supabase keeps extensions in the `extensions` schema. pg_cron and pgmq
-- create their own schemas (`cron`, `pgmq`).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_jsonschema with schema extensions;

-- Scheduling and queues
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create extension if not exists pgmq;
