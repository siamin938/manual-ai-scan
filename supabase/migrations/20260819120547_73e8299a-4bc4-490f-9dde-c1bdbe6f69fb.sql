-- Revoke broad execute on all public functions from anon/authenticated, then re-grant only what the app needs.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

grant execute on function public.create_organization_with_owner(text, text) to authenticated;
grant execute on function public.get_org_usage(uuid) to authenticated;
grant execute on function public.seed_automotive_question_set(uuid, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.has_org_role(uuid, public.app_role[]) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.storage_object_org_id(text) to authenticated;

-- server-side only
grant execute on function public.claim_measurement_jobs(integer) to service_role;
grant execute on function public.refresh_run_progress(uuid) to service_role;
grant execute on function public.purge_expired_provider_payloads() to service_role;
grant execute on function public.get_org_usage(uuid) to service_role;
grant execute on function public.create_organization_with_owner(text, text) to service_role;
grant execute on function public.seed_automotive_question_set(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.has_org_role(uuid, public.app_role[]) to service_role;
grant execute on function public.is_org_member(uuid) to service_role;
grant execute on function public.storage_object_org_id(text) to service_role;