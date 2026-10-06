-- Allow the invoker wrapper to reach only the authorized private operation.
-- Internal queue maintenance remains inaccessible to browser roles.
revoke all on function private.enqueue_job(uuid) from public, anon, authenticated;
revoke all on function private.reap_expired_leases() from public, anon, authenticated;
grant usage on schema private to authenticated;
notify pgrst, 'reload schema';
