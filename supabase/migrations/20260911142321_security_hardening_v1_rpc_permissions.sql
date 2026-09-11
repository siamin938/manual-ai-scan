-- Security Hardening v1: remove unnecessary anonymous/direct execution paths

revoke all on function public.apply_entity_evidence_gate_v01() from public, anon, authenticated;
revoke all on function public.invalidate_stale_entity_canonicalization_on_verification() from public, anon, authenticated;
revoke all on function public.merge_auto_business_alias_by_shared_source_v01() from public, anon, authenticated;
revoke all on function public.set_measurement_run_data_origin_v01() from public, anon, authenticated;
grant execute on function public.apply_entity_evidence_gate_v01() to service_role;
grant execute on function public.invalidate_stale_entity_canonicalization_on_verification() to service_role;
grant execute on function public.merge_auto_business_alias_by_shared_source_v01() to service_role;
grant execute on function public.set_measurement_run_data_origin_v01() to service_role;

revoke execute on function public.admin_grant_measurement_credits_v01(uuid,integer,text,text) from public, anon;
revoke execute on function public.can_view_data_asset_admin_v01() from public, anon;
revoke execute on function public.get_data_asset_admin_overview_v01() from public, anon;
revoke execute on function public.get_high_visibility_source_patterns_v01(uuid,uuid) from public, anon;
revoke execute on function public.get_measurement_credit_admin_ledger_v01(uuid,integer) from public, anon;
revoke execute on function public.get_measurement_credit_admin_overview_v01(integer) from public, anon;
