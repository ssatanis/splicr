-- Preserve the recorded metadata columns when installing from a fresh checkout.
alter table public.screens add column if not exists experiment_date date,
  add column if not exists researcher_name text;
notify pgrst, 'reload schema';
