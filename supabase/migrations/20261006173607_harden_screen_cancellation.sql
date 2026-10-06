-- Keep privileged implementation outside the exposed API schema.
alter function public.cancel_screen_analysis(uuid, uuid) set schema private;
create function public.cancel_screen_analysis(p_screen_id uuid, p_run_id uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select private.cancel_screen_analysis(p_screen_id, p_run_id);
$$;
revoke all on function public.cancel_screen_analysis(uuid, uuid) from public, anon;
grant execute on function public.cancel_screen_analysis(uuid, uuid) to authenticated;
revoke all on function private.cancel_screen_analysis(uuid, uuid) from public, anon;
grant execute on function private.cancel_screen_analysis(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
