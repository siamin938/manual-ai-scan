create or replace function public.get_visibility_release_regression_v03()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with base as (
  select public.get_visibility_release_regression_v02() as result
), latest_runs as (
  select distinct on (r.business_id)
    r.org_id,
    r.business_id,
    r.id as run_id,
    r.repetitions
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
  order by r.business_id,coalesce(r.completed_at,r.created_at) desc
), repeat_contract as (
  select
    lr.*,
    (select count(*)::integer
       from public.get_compatible_audit_runs_v01(lr.org_id,lr.business_id,6)) as common_compatible_count,
    coalesce((select min(s.compatible_run_count)
                from public.get_competitor_significance_v02(lr.org_id,lr.business_id,lr.run_id) s),0)::integer as sig_min_count,
    coalesce((select max(s.compatible_run_count)
                from public.get_competitor_significance_v02(lr.org_id,lr.business_id,lr.run_id) s),0)::integer as sig_max_count
  from latest_runs lr
), compatible_count_invalid as (
  select count(*)::integer as n
  from repeat_contract
  where common_compatible_count<>sig_min_count
     or common_compatible_count<>sig_max_count
), repeat_single_repetition_witness as (
  select count(*)::integer as n
  from repeat_contract
  where common_compatible_count>=2
    and repetitions=1
), repeat_sites as (
  select lr.org_id,lr.business_id,o.*
  from latest_runs lr
  cross join lateral public.get_repeat_independent_site_observations_v02(lr.org_id,lr.business_id) o
), repeat_site_identity as (
  select
    rs.*,
    coalesce(jsonb_array_length(rs.linked_competitors),0)::integer as linked_count,
    (
      select count(distinct regexp_replace(lower(x->>'name'),'[^0-9a-z가-힣]','','g'))::integer
      from jsonb_array_elements(coalesce(rs.linked_competitors,'[]'::jsonb)) x
      where coalesce(x->>'name','')<>''
    ) as linked_distinct_name_count
  from repeat_sites rs
), repeat_site_identity_invalid as (
  select count(*)::integer as n
  from repeat_site_identity
  where distinct_competitor_count<>1
     or linked_count<>1
     or linked_distinct_name_count<>1
), counts as (
  select
    (select n from compatible_count_invalid) as compatible_count_invalid_count,
    (select n from repeat_single_repetition_witness) as repeat_single_repetition_witness_count,
    (select n from repeat_site_identity_invalid) as repeat_site_identity_invalid_count
)
select jsonb_build_object(
  'version','0.3',
  'mode','shadow',
  'latestBusinessCount',coalesce((b.result->>'latestBusinessCount')::integer,0),
  'checkedRunCount',coalesce((b.result->>'checkedRunCount')::integer,0),
  'checkedCompetitorRowCount',coalesce((b.result->>'checkedCompetitorRowCount')::integer,0),
  'checkedRepeatIndependentSiteCount',coalesce((b.result->>'checkedRepeatIndependentSiteCount')::integer,0),
  'repeatWithSingleRunRepetitionWitnessCount',c.repeat_single_repetition_witness_count,
  'ok',(
    coalesce((b.result->>'ok')::boolean,false)
    and c.compatible_count_invalid_count=0
    and c.repeat_site_identity_invalid_count=0
  ),
  'checks',coalesce(b.result->'checks','[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('key','compatible_run_count_contract','pass',c.compatible_count_invalid_count=0,'failureCount',c.compatible_count_invalid_count),
    jsonb_build_object('key','repeat_independent_single_entity_payload','pass',c.repeat_site_identity_invalid_count=0,'failureCount',c.repeat_site_identity_invalid_count)
  )
)
from base b
cross join counts c;
$function$;

revoke all on function public.get_visibility_release_regression_v03() from public, anon, authenticated;
grant execute on function public.get_visibility_release_regression_v03() to service_role;
