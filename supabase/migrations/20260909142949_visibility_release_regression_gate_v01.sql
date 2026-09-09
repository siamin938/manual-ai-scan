create or replace function public.get_visibility_release_regression_v01()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with latest_runs as (
  select distinct on (r.business_id)
    r.org_id,
    r.business_id,
    r.id as run_id
  from public.measurement_runs r
  join public.businesses b
    on b.id=r.business_id
   and b.org_id=r.org_id
   and b.is_client_business=true
   and b.active=true
  where r.run_type='audit'::public.run_type
    and r.phase='standalone'::public.run_phase
    and r.status='completed'::public.run_status
    and r.experiment_id is null
    and r.data_origin in ('internal_observation','customer_measurement')
  order by r.business_id, coalesce(r.completed_at,r.created_at) desc
), density_invalid as (
  select count(*)::integer as n
  from latest_runs lr
  cross join lateral (
    select public.get_measurement_evidence_density_v01(lr.org_id,lr.business_id,lr.run_id)->>'environment' as environment
  ) d
  where d.environment is null
     or d.environment not in ('sparse','balanced','dense','insufficient')
), generic_leaks as (
  select count(*)::integer as n
  from latest_runs lr
  cross join lateral public.get_competitor_significance_v01(lr.org_id,lr.business_id,lr.run_id) s
  where regexp_replace(lower(s.name), '\s+', '', 'g') ~
          '(정비소|정비센터|서비스센터|공업사|카센터|카센타|전문점)(추천|추천순위|순위|비교|정리|목록|요약|결론|체크리스트)$'
     or (
       regexp_replace(lower(s.name), '[^0-9a-z가-힣]', '', 'g') ~
         '(체인점|프랜차이즈|카센터|카센타|정비소|정비센터|서비스센터|공업사|정비공장|정비업체|전문업체|업체|전문점)$'
       and regexp_replace(lower(s.name), '[^0-9a-z가-힣]', '', 'g') ~
         '(가장|무난|일반|지역|동네|가까운|저렴|가성비|후기좋|후기많|평점좋|평점높|믿을만|전문적으로|선택지)'
     )
), content_invalid as (
  select count(*)::integer as n
  from latest_runs lr
  cross join lateral public.get_first_run_content_source_observations_v01(lr.org_id,lr.business_id,lr.run_id) o
  where o.competitor_response_count<3
     or o.intent_count<2
     or o.client_response_count<>0
), profile_invalid as (
  select count(*)::integer as n
  from latest_runs lr
  cross join lateral public.get_first_run_profile_source_observations_v01(lr.org_id,lr.business_id,lr.run_id) o
  where o.competitor_response_count<3
     or o.intent_count<2
     or o.client_response_count<>0
), independent_rows as (
  select lr.org_id,lr.business_id,lr.run_id,o.*
  from latest_runs lr
  cross join lateral public.get_first_run_independent_site_observations_v01(lr.org_id,lr.business_id,lr.run_id) o
), independent_invalid as (
  select count(*)::integer as n
  from independent_rows o
  where o.competitor_response_count<2
     or o.intent_count<2
     or o.distinct_competitor_count<>1
     or o.client_response_count<>0
), ownership as (
  select lower(a.domain) as domain,
         count(distinct a.canonical_key)::integer as distinct_entities
  from public.measurement_citation_attributions a
  where a.created_at>=now()-interval '90 days'
    and a.attribution_version='0.1.0'
    and a.domain is not null
    and a.canonical_key is not null
  group by lower(a.domain)
), independent_ownership_invalid as (
  select count(*)::integer as n
  from independent_rows i
  cross join lateral jsonb_array_elements_text(i.domains) d(domain)
  left join ownership o on o.domain=lower(d.domain)
  where coalesce(o.distinct_entities,0)<>1
), repeat_independent_invalid as (
  select count(*)::integer as n
  from latest_runs lr
  cross join lateral public.get_repeat_independent_site_observations_v01(lr.org_id,lr.business_id) o
  where o.compatible_run_count<2
     or o.competitor_run_presence_count<2
     or o.client_run_presence_count<>0
     or o.competitor_response_count<2
     or o.question_count<2
     or o.distinct_competitor_count<>1
     or o.client_response_count<>0
), counts as (
  select
    (select count(*)::integer from latest_runs) as latest_business_count,
    (select n from density_invalid) as density_invalid_count,
    (select n from generic_leaks) as generic_leak_count,
    (select n from content_invalid) as content_invalid_count,
    (select n from profile_invalid) as profile_invalid_count,
    (select n from independent_invalid) as independent_invalid_count,
    (select n from independent_ownership_invalid) as independent_ownership_invalid_count,
    (select n from repeat_independent_invalid) as repeat_independent_invalid_count
)
select jsonb_build_object(
  'version','0.1',
  'mode','shadow',
  'latestBusinessCount',c.latest_business_count,
  'ok',(
    c.density_invalid_count
    + c.generic_leak_count
    + c.content_invalid_count
    + c.profile_invalid_count
    + c.independent_invalid_count
    + c.independent_ownership_invalid_count
    + c.repeat_independent_invalid_count
  )=0,
  'checks',jsonb_build_array(
    jsonb_build_object('key','density_contract','pass',c.density_invalid_count=0,'failureCount',c.density_invalid_count),
    jsonb_build_object('key','generic_competitor_guard','pass',c.generic_leak_count=0,'failureCount',c.generic_leak_count),
    jsonb_build_object('key','first_run_content_contract','pass',c.content_invalid_count=0,'failureCount',c.content_invalid_count),
    jsonb_build_object('key','first_run_profile_contract','pass',c.profile_invalid_count=0,'failureCount',c.profile_invalid_count),
    jsonb_build_object('key','first_run_independent_site_contract','pass',c.independent_invalid_count=0,'failureCount',c.independent_invalid_count),
    jsonb_build_object('key','independent_site_single_entity_ownership','pass',c.independent_ownership_invalid_count=0,'failureCount',c.independent_ownership_invalid_count),
    jsonb_build_object('key','repeat_independent_site_contract','pass',c.repeat_independent_invalid_count=0,'failureCount',c.repeat_independent_invalid_count)
  )
)
from counts c;
$function$;

revoke all on function public.get_visibility_release_regression_v01() from public, anon, authenticated;
grant execute on function public.get_visibility_release_regression_v01() to service_role;
