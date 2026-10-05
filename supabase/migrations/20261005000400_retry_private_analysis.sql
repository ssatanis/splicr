-- Retry a terminal failure with its saved design, preserving the previous run.
create or replace function public.retry_screen_analysis(p_screen_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_screen public.screens; v_settings jsonb;
begin
  select * into v_screen from public.screens where id=p_screen_id for update;
  if not found or not private.has_org_role(v_screen.org_id,'member') then raise exception 'This screen is not available to your workspace.'; end if;
  if v_screen.status <> 'failed' then raise exception 'Only a failed analysis can be retried.'; end if;
  if exists(select 1 from public.jobs where run_id=v_screen.current_run_id and status in ('queued','leased','running')) then raise exception 'This analysis already has a retry queued.'; end if;
  select settings into v_settings from public.runs where id=v_screen.current_run_id;
  return public.start_screen_analysis(p_screen_id,v_settings);
end $$;
revoke all on function public.retry_screen_analysis(uuid) from public,anon;
grant execute on function public.retry_screen_analysis(uuid) to authenticated;
