-- ============================================================================
-- A lab asking SplicR to analyse a public accession.
--
-- WHY THIS TABLE EXISTS
--
-- The autonomous ingest engine already turns an accession into a reanalysed
-- screen: `splicr.ingest.runner.request` records the study, plans it from the
-- deposited metadata and the reads themselves, and the Modal sweep processes it.
-- What it had no way to know was that a particular workspace asked. So the
-- console's "New screen" page said the workspace could not start anything and
-- left the researcher with nowhere to go.
--
-- This is the handover. The console writes a row here, with the organization
-- and the member who asked. The engine drains the queued rows through the same
-- `request` path it already has, and writes back what happened. Nothing here
-- plans, scores or processes anything: it is a request, and its status says
-- where that request got to and nothing more.
--
-- WHAT IT DELIBERATELY DOES NOT CLAIM
--
-- 'queued' means recorded and not yet picked up. It does not mean the study
-- will be analysed: the engine still has to recognise it as a screen and infer
-- its design, and a study whose design is ambiguous goes to human review like
-- any other. The console prints the engine's own words for that rather than a
-- progress bar that implies otherwise.
--
-- The results land in the shared Atlas, where every reanalysed screen lands,
-- not in the requesting workspace's private screen list. The page says so.
-- ============================================================================

create type public.screen_request_status as enum (
  'queued',      -- recorded by the console; the engine has not looked yet
  'accepted',    -- the engine recognised the accession and is working on it
  'needs_review',-- recognised, but its design could not be inferred confidently
  'published',   -- reanalysed and in the Atlas
  'rejected',    -- the engine does not consider this a screen it can process
  'failed'       -- the engine tried and could not finish
);

create table public.screen_requests (
  id            uuid primary key default private.uuid_v7(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  requested_by  uuid references auth.users (id) on delete set null,
  --  GEO series, BioProject or SRA/ENA/DDBJ study, upper-cased on the way in.
  accession     text not null,
  status        public.screen_request_status not null default 'queued',
  --  The engine's own sentence about where this got to. Never a guess, and
  --  never filled in by the console.
  detail        text,
  --  The ingest accession the engine resolved this to, which is not always what
  --  was typed: a GEO series can resolve to the SRA study behind it.
  resolved_accession text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  --  One live request per accession per workspace. A second ask while the first
  --  is queued is the same ask.
  unique (org_id, accession)
);

create index screen_requests_org_ix on public.screen_requests (org_id, created_at desc);
create index screen_requests_queued_ix on public.screen_requests (created_at)
  where status = 'queued';

create trigger screen_requests_touch
  before update on public.screen_requests
  for each row execute function private.set_updated_at();

alter table public.screen_requests enable row level security;

create policy "read screen requests" on public.screen_requests
  for select using (private.is_org_member(org_id));

-- Viewers read the workspace; they do not spend its compute.
create policy "create screen requests" on public.screen_requests
  for insert with check (
    requested_by = (select auth.uid())
    and private.has_org_role(org_id, 'member')
  );

create policy "withdraw screen requests" on public.screen_requests
  for delete using (status = 'queued' and private.has_org_role(org_id, 'member'));

grant select, insert, delete on public.screen_requests to authenticated;

notify pgrst, 'reload schema';
