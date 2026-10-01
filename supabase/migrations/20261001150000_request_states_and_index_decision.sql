-- ============================================================================
-- What a request's status actually tells a researcher, and one index not added
--
-- 1 · 'accepted' was four different things
--
-- The ingest engine moves a study through discovered, planned, fetching and
-- analyzing. All four mapped to 'accepted', so a researcher watching a request
-- saw the same word for "we are reading the deposit to work out which runs are
-- the treated arm" and "we are downloading 40 GB of reads and counting guides".
-- Those take minutes and hours respectively and warrant different patience.
--
-- They split into two states that correspond to real backend behaviour and
-- nothing else. There is deliberately no 'ready' or 'cancelled': the engine has
-- no such states, and inventing them would put words on the screen that no
-- transition can ever produce.
--
-- 2 · screen_requests.requested_by is deliberately unindexed
--
-- The Supabase advisor flags it as an unindexed foreign key. The application
-- never filters by it: the console lists a workspace's requests by org_id
-- (covered by screen_requests_org_ix), inserts one row at a time, and deletes
-- by primary key. The only scan the column can cause is the ON DELETE SET NULL
-- when an auth user is deleted, against a table that holds one row per
-- accession a lab has ever asked for.
--
-- An index that no query uses is not free: it is written on every insert and it
-- joins the 64 unused indexes this project already carries. The comment below
-- records the decision in the database, so the next person to read the advisor
-- finds the reasoning rather than the finding.
-- ============================================================================

alter type public.screen_request_status add value if not exists 'planning' after 'queued';
alter type public.screen_request_status add value if not exists 'running' after 'planning';

comment on column public.screen_requests.requested_by is
  'Intentionally unindexed. No query filters by it; the console reads by org_id. '
  'The only scan it can cause is ON DELETE SET NULL on a small table.';

comment on column public.screen_requests.status is
  'queued: recorded, the engine has not looked. planning: the engine is inferring '
  'the design. needs_review: the design could not be inferred confidently. '
  'running: reads are being fetched, counted and analysed. published: reanalysed '
  'and in the Atlas. rejected: the engine will not take the accession up. '
  'failed: it started and could not finish. Only the engine moves a request out '
  'of queued.';

notify pgrst, 'reload schema';
