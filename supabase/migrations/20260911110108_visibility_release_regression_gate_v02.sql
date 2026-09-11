create or replace function public.get_visibility_release_regression_v02()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with base as (
  select public.get_visibility_release_regression_v01() as result
), all_runs as (
  select
    r.org_id,
    r.business_id,
    r.id as run_id,
    r.question_set_id,
    r.data_origin,
    coalesce(r.completed_at,r.created_at) as measured_at
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
), sig_rows as (
  select
    ar.*,
    s.canonical_key,
    s.compatible_run_count,
    s.prior_run_presence_count,
    s.is_new
  from all_runs ar
  cross join lateral public.get_competitor_significance_v02(ar.org_id,ar.business_id,ar.run_id) s
), history_bounds as (
  select
    sr.*,
    (
      select count(*)::integer
      from public.measurement_runs pr
      where pr.org_id=sr.org_id
        and pr.business_id=sr.business_id
        and pr.question_set_id=sr.question_set_id
        and pr.data_origin=sr.data_origin
        and pr.run_type='audit'::public.run_type
        and pr.phase='standalone'::public.run_phase
        and pr.status='completed'::public.run_status
        and pr.experiment_id is null
        and coalesce(pr.completed_at,pr.created_at)<=sr.measured_at
    ) as historical_run_count,
    (
      select count(*)::integer
      from public.measurement_runs pr
      where pr.org_id=sr.org_id
        and pr.business_id=sr.business_id
        and pr.question_set_id=sr.question_set_id
        and pr.data_origin=sr.data_origin
        and pr.run_type='audit'::public.run_type
        and pr.phase='standalone'::public.run_phase
        and pr.status='completed'::public.run_status
        and pr.experiment_id is null
        and pr.id<>sr.run_id
        and coalesce(pr.completed_at,pr.created_at)<=sr.measured_at
    ) as historical_prior_run_count
  from sig_rows sr
), temporal_invalid as (
  select count(*)::integer as n
  from history_bounds
  where compatible_run_count>historical_run_count
     or prior_run_presence_count>historical_prior_run_count
), repeat_semantic_invalid as (
  select count(*)::integer as n
  from sig_rows sr
  where (
    sr.prior_run_presence_count>0
    and not exists (
      select 1
      from public.measurement_runs pr
      join public.measurement_entity_canonicalizations c
        on c.org_id=sr.org_id
       and c.business_id=sr.business_id
       and c.source_run_id=pr.id
       and c.canonical_key=sr.canonical_key
      join public.measurements m
        on m.id=c.measurement_id
       and m.org_id=sr.org_id
       and m.run_id=pr.id
       and m.valid=true
      join public.measurement_mentions mm
        on mm.id=c.measurement_mention_id
       and mm.org_id=sr.org_id
       and mm.count_as_confirmed_business=true
      where pr.org_id=sr.org_id
        and pr.business_id=sr.business_id
        and pr.question_set_id=sr.question_set_id
        and pr.data_origin=sr.data_origin
        and pr.run_type='audit'::public.run_type
        and pr.phase='standalone'::public.run_phase
        and pr.status='completed'::public.run_status
        and pr.experiment_id is null
        and pr.id<>sr.run_id
        and coalesce(pr.completed_at,pr.created_at)<=sr.measured_at
    )
  )
  or sr.is_new is distinct from (sr.compatible_run_count>1 and sr.prior_run_presence_count=0)
), latest_businesses as (
  select distinct on (r.business_id)
    r.org_id,
    r.business_id
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
), repeat_sites as (
  select
    lb.org_id,
    lb.business_id,
    o.source_name,
    o.compatible_run_count,
    o.competitor_run_presence_count
  from latest_businesses lb
  cross join lateral public.get_repeat_independent_site_observations_v02(lb.org_id,lb.business_id) o
), repeat_site_presence as (
  select
    rs.*,
    count(*) filter(where exists (
      select 1
      from public.measurement_citation_attributions a
      join public.measurements m
        on m.id=a.measurement_id
       and m.org_id=a.org_id
       and m.valid=true
      join lateral public.get_competitor_significance_v01(rs.org_id,rs.business_id,c.run_id) s
        on s.canonical_key=a.canonical_key
       and s.tier in ('core','notable')
      where a.org_id=rs.org_id
        and a.business_id=rs.business_id
        and a.source_run_id=c.run_id
        and lower(a.domain)=lower(rs.source_name)
    ))::integer as raw_competitor_run_presence_count
  from repeat_sites rs
  cross join lateral public.get_compatible_audit_runs_v01(rs.org_id,rs.business_id,6) c
  group by
    rs.org_id,
    rs.business_id,
    rs.source_name,
    rs.compatible_run_count,
    rs.competitor_run_presence_count
), repeat_site_invalid as (
  select count(*)::integer as n
  from repeat_site_presence
  where compatible_run_count<2
     or competitor_run_presence_count<2
     or raw_competitor_run_presence_count<2
     or raw_competitor_run_presence_count<competitor_run_presence_count
), one_run_promoted as (
  select count(*)::integer as n
  from repeat_site_presence
  where raw_competitor_run_presence_count=1
), counts as (
  select
    (select count(*)::integer from all_runs) as checked_run_count,
    (select count(*)::integer from sig_rows) as checked_competitor_row_count,
    (select count(*)::integer from repeat_sites) as checked_repeat_site_count,
    (select n from temporal_invalid) as temporal_invalid_count,
    (select n from repeat_semantic_invalid) as repeat_semantic_invalid_count,
    (select n from repeat_site_invalid) as repeat_site_invalid_count,
    (select n from one_run_promoted) as one_run_promoted_count
)
select jsonb_build_object(
  'version','0.2',
  'mode','shadow',
  'latestBusinessCount',coalesce((b.result->>'latestBusinessCount')::integer,0),
  'checkedRunCount',c.checked_run_count,
  'checkedCompetitorRowCount',c.checked_competitor_row_count,
  'checkedRepeatIndependentSiteCount',c.checked_repeat_site_count,
  'ok',(
    coalesce((b.result->>'ok')::boolean,false)
    and c.temporal_invalid_count=0
    and c.repeat_semantic_invalid_count=0
    and c.repeat_site_invalid_count=0
    and c.one_run_promoted_count=0
  ),
  'checks',coalesce(b.result->'checks','[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('key','temporal_competitor_history','pass',c.temporal_invalid_count=0,'failureCount',c.temporal_invalid_count),
    jsonb_build_object('key','competitor_repeat_evidence','pass',c.repeat_semantic_invalid_count=0,'failureCount',c.repeat_semantic_invalid_count),
    jsonb_build_object('key','repeat_independent_actual_run_presence','pass',c.repeat_site_invalid_count=0,'failureCount',c.repeat_site_invalid_count),
    jsonb_build_object('key','one_run_independent_not_repeated','pass',c.one_run_promoted_count=0,'failureCount',c.one_run_promoted_count)
  )
)
from base b
cross join counts c;
$function$;

revoke all on function public.get_visibility_release_regression_v02() from public, anon, authenticated;
grant execute on function public.get_visibility_release_regression_v02() to service_role;
