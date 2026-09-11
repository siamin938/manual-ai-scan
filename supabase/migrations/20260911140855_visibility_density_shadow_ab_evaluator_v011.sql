create or replace function public.get_visibility_density_shadow_ab_v01(
  p_org_id uuid,
  p_business_id uuid,
  p_run_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $function$
with router as (
  select public.get_measurement_evidence_density_router_v01(p_org_id,p_business_id,p_run_id) as r
), compat as (
  select count(*)::integer as n
  from public.get_compatible_audit_runs_v01(p_org_id,p_business_id,6)
), prod_first_content as (
  select 'observation:content:'||o.source_key as id, o.source_name as label
  from public.get_first_run_content_source_observations_v01(p_org_id,p_business_id,p_run_id) o
), prod_first_profile as (
  select 'observation:profile:'||o.source_key as id, o.source_name as label
  from public.get_first_run_profile_source_observations_v01(p_org_id,p_business_id,p_run_id) o
), prod_first_independent as (
  select 'observation:'||o.source_key as id, o.source_name as label
  from public.get_first_run_independent_site_observations_v02(p_org_id,p_business_id,p_run_id) o
), prod_repeat_independent as (
  select 'observation:repeat_independent_site:'||o.source_name as id, o.source_name as label
  from public.get_repeat_independent_site_observations_v02(p_org_id,p_business_id) o
), sparse_extra as (
  select
    case when o.candidate_type='content' then 'observation:content:'||o.source_key else 'observation:profile:'||o.source_key end as id,
    o.source_name as label
  from public.get_density_shadow_sparse_source_candidates_v01(p_org_id,p_business_id,p_run_id) o
), production_ids as (
  select id,label from prod_repeat_independent where (select n from compat)>=2
  union all
  select id,label from prod_first_content where (select n from compat)<2
  union all
  select id,label from prod_first_profile where (select n from compat)<2
  union all
  select id,label from prod_first_independent where (select n from compat)<2
), shadow_ids as (
  select p.id,p.label
  from production_ids p, router x
  where x.r->>'environment'<>'insufficient'
  union
  select s.id,s.label
  from sparse_extra s, router x
  where x.r->>'environment'='sparse'
), added as (
  select s.* from shadow_ids s
  where not exists(select 1 from production_ids p where p.id=s.id)
), suppressed as (
  select p.* from production_ids p
  where not exists(select 1 from shadow_ids s where s.id=p.id)
), counts as (
  select
    (select count(*)::integer from production_ids) as production_count,
    (select count(*)::integer from shadow_ids) as shadow_count,
    (select count(*)::integer from added) as added_count,
    (select count(*)::integer from suppressed) as suppressed_count
)
select jsonb_build_object(
  'version','0.1.1',
  'mode','shadow',
  'scope','source_candidate_envelope',
  'exactCustomerTop4',false,
  'customerImpact',false,
  'runId',p_run_id,
  'compatibleRunCount',(select n from compat),
  'environment',(select r->>'environment' from router),
  'routeKey',(select r->>'routeKey' from router),
  'productionEligibleIds',coalesce((select jsonb_agg(id order by id) from production_ids),'[]'::jsonb),
  'shadowEligibleIds',coalesce((select jsonb_agg(id order by id) from shadow_ids),'[]'::jsonb),
  'addedIds',coalesce((select jsonb_agg(id order by id) from added),'[]'::jsonb),
  'suppressedIds',coalesce((select jsonb_agg(id order by id) from suppressed),'[]'::jsonb),
  'productionEligibleCount',c.production_count,
  'shadowEligibleCount',c.shadow_count,
  'addedCount',c.added_count,
  'suppressedCount',c.suppressed_count,
  'materialChange',(c.added_count+c.suppressed_count)>0,
  'rankingPolicy',case (select r->>'environment' from router)
    when 'dense' then 'strong_and_repeated_first_keep_standard_candidates'
    when 'sparse' then 'standard_plus_verified_weak_observation'
    when 'balanced' then 'unchanged'
    else 'hold'
  end,
  'weakSignalDefinition','below_standard_presentation_threshold_only',
  'note','Action v2 전체 고객 Top4를 재현하지 않고, density router가 직접 조절할 수 있는 검증된 source 후보 envelope만 비교합니다. dense는 기존 표준 후보를 제거하지 않고 정렬 우선순위만 강화합니다.'
)
from counts c;
$function$;

revoke all on function public.get_visibility_density_shadow_ab_v01(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_visibility_density_shadow_ab_v01(uuid,uuid,uuid) to service_role;
