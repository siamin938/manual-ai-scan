create or replace function public.get_measurement_market_generation_eligibility_v01(
  p_org_id uuid,
  p_business_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  v_has_saved_questions boolean := false;
  v_has_measurement_run boolean := false;
begin
  if not exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
      and b.org_id = p_org_id
      and b.is_client_business = true
      and b.active = true
  ) then
    return jsonb_build_object('eligible', false, 'reason', 'business_not_available');
  end if;

  select exists (
    select 1
    from public.question_sets qs
    join public.questions q on q.question_set_id = qs.id
    where qs.org_id = p_org_id
      and qs.business_id = p_business_id
      and q.org_id = p_org_id
  ) into v_has_saved_questions;

  select exists (
    select 1
    from public.measurement_runs mr
    where mr.org_id = p_org_id
      and mr.business_id = p_business_id
  ) into v_has_measurement_run;

  if v_has_saved_questions then
    return jsonb_build_object('eligible', false, 'reason', 'existing_question_set');
  end if;

  if v_has_measurement_run then
    return jsonb_build_object('eligible', false, 'reason', 'existing_measurement_run');
  end if;

  return jsonb_build_object('eligible', true, 'reason', 'first_generation');
end;
$function$;

revoke all on function public.get_measurement_market_generation_eligibility_v01(uuid, uuid) from public;
revoke execute on function public.get_measurement_market_generation_eligibility_v01(uuid, uuid) from anon, authenticated;
grant execute on function public.get_measurement_market_generation_eligibility_v01(uuid, uuid) to service_role;
