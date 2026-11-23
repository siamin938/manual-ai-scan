create or replace function public.get_pilot_ops_admin_overview_v01(
  p_query text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit,100), 200));
  v_query text := lower(nullif(btrim(coalesce(p_query,'')),''));
  v_result jsonb;
begin
  if not public.can_view_data_asset_admin_v01() then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  with business_rows as (
    select
      o.id as org_id,
      o.name as org_name,
      owner_info.display_name as owner_name,
      owner_info.email as owner_email,
      coalesce(c.balance,0)::integer as credit_balance,
      b.id as business_id,
      b.name as business_name,
      b.category,
      b.region,
      b.city,
      b.active as business_active,
      unified_set.id as question_set_id,
      unified_set.name as question_set_name,
      coalesce(question_stats.active_count,0)::integer as active_question_count,
      latest_run.id as latest_run_id,
      latest_run.name as latest_run_name,
      latest_run.status as latest_run_status,
      latest_run.total_jobs,
      latest_run.completed_jobs,
      latest_run.failed_jobs,
      latest_run.created_at as latest_run_created_at,
      latest_run.completed_at as latest_run_completed_at
    from public.organizations o
    join public.businesses b
      on b.org_id=o.id
     and b.is_client_business=true
    left join public.measurement_credit_accounts c
      on c.org_id=o.id
    left join lateral (
      select
        nullif(btrim(u.raw_user_meta_data->>'display_name'),'') as display_name,
        nullif(btrim(u.email),'') as email
      from public.organization_members om
      join auth.users u on u.id=om.user_id
      where om.org_id=o.id
      order by case when om.role::text='owner' then 0 else 1 end, om.created_at asc
      limit 1
    ) owner_info on true
    left join lateral (
      select qs.id, qs.name
      from public.question_sets qs
      where qs.org_id=o.id
        and qs.business_id=b.id
        and qs.active=true
        and qs.name like 'AI 진단 질문 · %'
      order by qs.created_at desc
      limit 1
    ) unified_set on true
    left join lateral (
      select count(*)::integer as active_count
      from public.questions q
      where q.question_set_id=unified_set.id
        and q.active=true
    ) question_stats on true
    left join lateral (
      select
        r.id,
        r.name,
        r.status::text as status,
        r.total_jobs,
        r.completed_jobs,
        r.failed_jobs,
        r.created_at,
        r.completed_at
      from public.measurement_runs r
      where r.org_id=o.id
        and r.business_id=b.id
        and r.question_set_id=unified_set.id
        and r.run_type='audit'
        and r.phase='standalone'
        and r.diagnostic_scope='customer'
        and r.experiment_id is null
      order by coalesce(r.completed_at,r.updated_at,r.created_at) desc
      limit 1
    ) latest_run on true
    where o.measurement_data_origin='customer_measurement'
      and (
        v_query is null
        or position(v_query in lower(coalesce(o.name,''))) > 0
        or position(v_query in lower(coalesce(b.name,''))) > 0
        or position(v_query in lower(coalesce(owner_info.display_name,''))) > 0
        or position(v_query in lower(coalesce(owner_info.email,''))) > 0
      )
  ), staged as (
    select
      *,
      case
        when not business_active then 'inactive'
        when question_set_id is null then 'questions_needed'
        when active_question_count <> 24 then 'questions_review'
        when latest_run_id is null then 'first_measurement_needed'
        when latest_run_status in ('draft','queued','running') then 'measurement_in_progress'
        when latest_run_status='completed'
          and total_jobs=24
          and completed_jobs=24
          and failed_jobs=0
          then 'result_ready'
        else 'measurement_review'
      end as stage,
      case
        when not business_active then '업체 활성 상태 확인'
        when question_set_id is null then '통합 질문 세트 준비'
        when active_question_count <> 24 then '질문 세트 24문항 확인'
        when latest_run_id is null then '첫 측정 준비'
        when latest_run_status in ('draft','queued','running') then '측정 완료 대기'
        when latest_run_status='completed'
          and total_jobs=24
          and completed_jobs=24
          and failed_jobs=0
          then '결과 전달 · 재측정 안내'
        else '측정 상태 확인'
      end as next_action
    from business_rows
  ), total as (
    select count(*)::integer as total_matches from staged
  ), limited as (
    select *
    from staged
    order by
      case stage
        when 'measurement_review' then 1
        when 'questions_review' then 2
        when 'questions_needed' then 3
        when 'first_measurement_needed' then 4
        when 'measurement_in_progress' then 5
        when 'result_ready' then 6
        else 7
      end,
      coalesce(latest_run_completed_at,latest_run_created_at) desc nulls last,
      business_name asc
    limit v_limit
  )
  select jsonb_build_object(
    'version','0.1',
    'generatedAt',now(),
    'query',coalesce(p_query,''),
    'totalMatches',(select total_matches from total),
    'businesses',coalesce(jsonb_agg(jsonb_build_object(
      'orgId',org_id,
      'orgName',org_name,
      'ownerName',owner_name,
      'ownerEmail',owner_email,
      'creditBalance',credit_balance,
      'businessId',business_id,
      'businessName',business_name,
      'category',category,
      'region',region,
      'city',city,
      'businessActive',business_active,
      'questionSetId',question_set_id,
      'questionSetName',question_set_name,
      'activeQuestionCount',active_question_count,
      'latestRunId',latest_run_id,
      'latestRunName',latest_run_name,
      'latestRunStatus',latest_run_status,
      'totalJobs',total_jobs,
      'completedJobs',completed_jobs,
      'failedJobs',failed_jobs,
      'latestRunCreatedAt',latest_run_created_at,
      'latestRunCompletedAt',latest_run_completed_at,
      'stage',stage,
      'nextAction',next_action
    ) order by
      case stage
        when 'measurement_review' then 1
        when 'questions_review' then 2
        when 'questions_needed' then 3
        when 'first_measurement_needed' then 4
        when 'measurement_in_progress' then 5
        when 'result_ready' then 6
        else 7
      end,
      coalesce(latest_run_completed_at,latest_run_created_at) desc nulls last,
      business_name asc),'[]'::jsonb)
  ) into v_result
  from limited;

  return coalesce(
    v_result,
    jsonb_build_object(
      'version','0.1',
      'generatedAt',now(),
      'query',coalesce(p_query,''),
      'totalMatches',0,
      'businesses','[]'::jsonb
    )
  );
end;
$function$;

revoke all on function public.get_pilot_ops_admin_overview_v01(text,integer) from public;
revoke all on function public.get_pilot_ops_admin_overview_v01(text,integer) from anon;
grant execute on function public.get_pilot_ops_admin_overview_v01(text,integer) to authenticated;
grant execute on function public.get_pilot_ops_admin_overview_v01(text,integer) to service_role;

comment on function public.get_pilot_ops_admin_overview_v01(text,integer)
is 'Internal CHABOIM pilot operations overview derived from existing customer org, business, unified question-set, run, and credit data. Read-only and gated by can_view_data_asset_admin_v01().';
