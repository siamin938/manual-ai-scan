create or replace function public.get_visibility_density_shadow_ab_summary_v01()
returns jsonb
language sql
stable
security invoker
set search_path=''
as $function$
with latest as (
  select distinct on (e.business_id)
    e.*
  from public.visibility_density_shadow_evaluations e
  order by e.business_id,e.evaluated_at desc
), counts as (
  select
    count(*)::integer as business_count,
    count(*) filter(where environment='sparse')::integer as sparse_count,
    count(*) filter(where environment='balanced')::integer as balanced_count,
    count(*) filter(where environment='dense')::integer as dense_count,
    count(*) filter(where environment='insufficient')::integer as insufficient_count,
    count(*) filter(where changed)::integer as material_change_count,
    coalesce(sum(jsonb_array_length(added_ids)),0)::integer as added_total,
    coalesce(sum(jsonb_array_length(suppressed_ids)),0)::integer as suppressed_total
  from latest
)
select jsonb_build_object(
  'version','0.1',
  'mode','shadow',
  'customerImpact',false,
  'businessCount',c.business_count,
  'environmentCounts',jsonb_build_object(
    'sparse',c.sparse_count,
    'balanced',c.balanced_count,
    'dense',c.dense_count,
    'insufficient',c.insufficient_count
  ),
  'materialChangeCount',c.material_change_count,
  'addedTotal',c.added_total,
  'suppressedTotal',c.suppressed_total,
  'decision',case when c.material_change_count=0 then 'hold_shadow_no_material_candidate_change' else 'review_material_changes_before_rollout' end,
  'note','현재 요약은 density router가 직접 조절 가능한 source candidate envelope의 shadow 비교이며 고객 Top4 전체 비교는 아닙니다.'
)
from counts c;
$function$;

revoke all on function public.get_visibility_density_shadow_ab_summary_v01() from public,anon,authenticated;
grant execute on function public.get_visibility_density_shadow_ab_summary_v01() to service_role;
