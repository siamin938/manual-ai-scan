create or replace function public.reconcile_internal_observation_scheduler_v07(
  p_org_id uuid
)
returns table(
  checked integer,
  completed integer,
  postprocessing integer,
  failed integer
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item record;
  v_run record;
  v_checked integer := 0;
  v_completed integer := 0;
  v_postprocessing integer := 0;
  v_failed integer := 0;
  v_now timestamptz := now();
begin
  if not exists (
    select 1
    from public.organizations o
    where o.id=p_org_id
      and o.measurement_data_origin='internal_observation'
  ) then
    return query select 0,0,0,0;
    return;
  end if;

  for v_item in
    select i.*
    from public.internal_observation_pipeline_items i
    where i.org_id=p_org_id
      and i.status in ('measuring','postprocessing')
    order by i.measurement_approved_at asc nulls first, i.created_at asc
    for update skip locked
  loop
    v_checked := v_checked + 1;

    if v_item.run_id is null then
      if v_item.measurement_approved_at is not null
         and v_item.measurement_approved_at <= v_now - interval '5 minutes' then
        update public.internal_observation_pipeline_items
        set status='failed',
            terminal_at=v_now,
            reconciled_at=v_now,
            error_code='SCHEDULER_STALE_CLAIM',
            error_message='자동 실행 claim 이후 Run 연결이 완료되지 않았습니다. 자동 재시도하지 않습니다.',
            updated_at=v_now
        where id=v_item.id;
        v_failed := v_failed + 1;
      else
        update public.internal_observation_pipeline_items
        set reconciled_at=v_now,
            updated_at=v_now
        where id=v_item.id;
      end if;
      continue;
    end if;

    select r.*
      into v_run
    from public.measurement_runs r
    where r.id=v_item.run_id
      and r.org_id=v_item.org_id
      and r.business_id=v_item.business_id
      and r.question_set_id=v_item.question_set_id;

    if not found then
      update public.internal_observation_pipeline_items
      set status='failed',
          terminal_at=v_now,
          reconciled_at=v_now,
          error_code='RUN_NOT_FOUND',
          error_message='연결된 자동 측정 Run을 확인할 수 없습니다. 자동 재시도하지 않습니다.',
          updated_at=v_now
      where id=v_item.id;
      v_failed := v_failed + 1;
      continue;
    end if;

    if v_run.status in ('draft'::public.run_status,'queued'::public.run_status,'running'::public.run_status) then
      update public.internal_observation_pipeline_items
      set status='measuring',
          reconciled_at=v_now,
          error_code=null,
          error_message=null,
          updated_at=v_now
      where id=v_item.id;
      continue;
    end if;

    if v_run.status in ('failed'::public.run_status,'cancelled'::public.run_status,'partial'::public.run_status)
       or v_run.total_jobs <> 24
       or v_run.completed_jobs <> 24
       or v_run.failed_jobs <> 0 then
      update public.internal_observation_pipeline_items
      set status='failed',
          terminal_at=v_now,
          reconciled_at=v_now,
          error_code=case
            when v_run.status='cancelled'::public.run_status then 'RUN_CANCELLED'
            when v_run.status='partial'::public.run_status then 'RUN_PARTIAL'
            when v_run.status='failed'::public.run_status then 'RUN_FAILED'
            else 'RUN_INCOMPLETE'
          end,
          error_message='자동 측정 Run이 24/24 · 실패 0 계약을 충족하지 못했습니다. 자동 재시도하지 않습니다.',
          updated_at=v_now
      where id=v_item.id;
      v_failed := v_failed + 1;
      continue;
    end if;

    if v_run.status='completed'::public.run_status
       and exists (
         select 1
         from public.run_entity_fact_aggregates_v2 a
         where a.org_id=v_item.org_id
           and a.business_id=v_item.business_id
           and a.source_run_id=v_item.run_id
           and a.contract_ok=true
           and a.measurement_count=24
           and a.valid_measurement_count=24
       )
       and exists (
         select 1
         from public.run_observed_source_aggregates_v2 a
         where a.org_id=v_item.org_id
           and a.business_id=v_item.business_id
           and a.source_run_id=v_item.run_id
       )
       and exists (
         select 1
         from public.run_competitor_source_clue_aggregates_v2 a
         where a.org_id=v_item.org_id
           and a.business_id=v_item.business_id
           and a.source_run_id=v_item.run_id
       ) then
      update public.internal_observation_pipeline_items
      set status='completed',
          terminal_at=coalesce(terminal_at,v_now),
          entity_facts_ready_at=coalesce(entity_facts_ready_at,v_now),
          reconciled_at=v_now,
          error_code=null,
          error_message=null,
          updated_at=v_now
      where id=v_item.id;
      v_completed := v_completed + 1;
    else
      update public.internal_observation_pipeline_items
      set status='postprocessing',
          reconciled_at=v_now,
          error_code='ENTITY_FACTS_PENDING',
          error_message='Run 24/24 완료 · Entity Facts v2 후처리를 기다리고 있습니다.',
          updated_at=v_now
      where id=v_item.id;
      v_postprocessing := v_postprocessing + 1;
    end if;
  end loop;

  return query select v_checked,v_completed,v_postprocessing,v_failed;
end;
$function$;

revoke all on function public.reconcile_internal_observation_scheduler_v07(uuid) from public;
revoke all on function public.reconcile_internal_observation_scheduler_v07(uuid) from anon;
revoke all on function public.reconcile_internal_observation_scheduler_v07(uuid) from authenticated;
grant execute on function public.reconcile_internal_observation_scheduler_v07(uuid) to service_role;

create or replace function public.claim_internal_observation_scheduler_candidate_v07(
  p_org_id uuid,
  p_actor_user_id uuid
)
returns table(
  item_id uuid,
  business_id uuid,
  question_set_id uuid,
  business_name text
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_settings record;
  v_org record;
  v_provider record;
  v_usage record;
  v_credit integer;
  v_estimated numeric;
  v_max_cost numeric;
  v_item_id uuid;
begin
  select s.*
    into v_settings
  from public.internal_observation_pipeline_settings s
  where s.org_id=p_org_id
  for update;

  if not found
     or v_settings.execution_enabled is distinct from true
     or v_settings.scheduler_state <> 'running'
     or v_settings.scheduler_executor_ready is distinct from true
     or v_settings.scheduler_actor_user_id is distinct from p_actor_user_id then
    return;
  end if;

  select o.id,o.daily_request_limit,o.monthly_budget_usd,o.measurement_data_origin
    into v_org
  from public.organizations o
  where o.id=p_org_id;

  if not found or v_org.measurement_data_origin <> 'internal_observation' then
    return;
  end if;

  if not exists (
    select 1
    from public.organization_members om
    where om.org_id=p_org_id
      and om.user_id=p_actor_user_id
      and om.role in ('owner'::public.app_role,'admin'::public.app_role,'analyst'::public.app_role)
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.internal_observation_pipeline_items i
    where i.org_id=p_org_id
      and i.status in ('measuring','postprocessing')
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.measurement_runs r
    where r.org_id=p_org_id
      and r.run_type='audit'::public.run_type
      and r.phase='standalone'::public.run_phase
      and r.status in ('draft'::public.run_status,'queued'::public.run_status,'running'::public.run_status)
  ) then
    return;
  end if;

  select p.*
    into v_provider
  from public.provider_settings p
  where p.org_id=p_org_id
    and p.provider='openai'::public.provider_name;

  if not found
     or v_provider.enabled is distinct from true
     or v_provider.paid_account_confirmed is distinct from true
     or v_provider.terms_reviewed is distinct from true
     or v_provider.automated_benchmark_approved is distinct from true then
    return;
  end if;

  select c.balance
    into v_credit
  from public.measurement_credit_accounts c
  where c.org_id=p_org_id;

  if coalesce(v_credit,0) < 1 then
    return;
  end if;

  if (
    select count(*)
    from public.internal_observation_pipeline_items i
    where i.org_id=p_org_id
      and i.measurement_approved_at >=
        (date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
  ) >= v_settings.daily_run_limit then
    return;
  end if;

  select * into v_usage
  from public.get_org_usage(p_org_id);

  v_estimated := round((coalesce(v_provider.estimated_cost_per_request_usd,0) * 24)::numeric,6);
  if v_estimated <= 0 then
    v_max_cost := 0.01;
  else
    v_max_cost := greatest(
      ceil((round((v_estimated * 1.25)::numeric,6) * 100)::numeric) / 100,
      ceil((v_estimated * 100)::numeric) / 100
    );
  end if;

  if coalesce(v_usage.daily_requests,0) + 24 > v_org.daily_request_limit then
    return;
  end if;

  if coalesce(v_usage.monthly_actual_cost_usd,0)
       + coalesce(v_usage.monthly_reserved_cost_usd,0)
       + v_max_cost > v_org.monthly_budget_usd then
    return;
  end if;

  select i.id
    into v_item_id
  from public.internal_observation_pipeline_items i
  join public.businesses b
    on b.id=i.business_id
   and b.org_id=i.org_id
   and b.active=true
   and b.is_client_business=true
  join public.question_sets qs
    on qs.id=i.question_set_id
   and qs.org_id=i.org_id
   and qs.business_id=i.business_id
   and qs.active=true
   and qs.name like 'AI 진단 질문 · %'
  where i.org_id=p_org_id
    and i.status='ready_to_measure'
    and i.business_id is not null
    and i.question_set_id is not null
    and i.question_set_id = (
      select qs2.id
      from public.question_sets qs2
      where qs2.org_id=i.org_id
        and qs2.business_id=i.business_id
        and qs2.active=true
        and qs2.name like 'AI 진단 질문 · %'
      order by qs2.created_at desc
      limit 1
    )
    and (
      select count(*)
      from public.questions q
      where q.question_set_id=i.question_set_id
        and q.org_id=i.org_id
        and q.active=true
        and q.data_class='public'::public.data_class
    ) = 24
    and (
      select count(*)
      from (
        select q.intent_type
        from public.questions q
        where q.question_set_id=i.question_set_id
          and q.org_id=i.org_id
          and q.active=true
          and q.data_class='public'::public.data_class
          and q.intent_type in (
            'local','recommendation','service','review_quality',
            'trust','comparison','price_value','discovery'
          )
        group by q.intent_type
        having count(*)=3
      ) intent_groups
    ) = 8
    and not exists (
      select 1
      from public.measurement_runs r
      where r.org_id=i.org_id
        and r.business_id=i.business_id
        and r.question_set_id=i.question_set_id
        and r.run_type='audit'::public.run_type
        and r.phase='standalone'::public.run_phase
        and r.diagnostic_scope='customer'
        and r.experiment_id is null
        and r.status in ('draft'::public.run_status,'queued'::public.run_status,'running'::public.run_status)
    )
  order by i.prepared_at asc nulls last,i.created_at asc,i.id asc
  for update of i skip locked
  limit 1;

  if v_item_id is null then
    return;
  end if;

  update public.internal_observation_pipeline_items i
  set status='measuring',
      measurement_approved_at=now(),
      measurement_approved_by=p_actor_user_id,
      error_code=null,
      error_message=null,
      updated_at=now()
  where i.id=v_item_id
    and i.status='ready_to_measure';

  return query
  select i.id,i.business_id,i.question_set_id,i.business_name
  from public.internal_observation_pipeline_items i
  where i.id=v_item_id
    and i.status='measuring';
end;
$function$;

revoke all on function public.claim_internal_observation_scheduler_candidate_v07(uuid,uuid) from public;
revoke all on function public.claim_internal_observation_scheduler_candidate_v07(uuid,uuid) from anon;
revoke all on function public.claim_internal_observation_scheduler_candidate_v07(uuid,uuid) from authenticated;
grant execute on function public.claim_internal_observation_scheduler_candidate_v07(uuid,uuid) to service_role;

create or replace function public.create_internal_observation_scheduler_run_v07(
  p_item_id uuid,
  p_actor_user_id uuid
)
returns table(
  run_id uuid,
  org_id uuid,
  business_id uuid,
  question_set_id uuid,
  business_name text
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item record;
  v_settings record;
  v_org record;
  v_provider record;
  v_usage record;
  v_credit integer;
  v_question_count integer;
  v_intent_group_count integer;
  v_estimated numeric;
  v_max_cost numeric;
  v_run_id uuid;
begin
  select i.*
    into v_item
  from public.internal_observation_pipeline_items i
  where i.id=p_item_id
  for update;

  if not found
     or v_item.status <> 'measuring'
     or v_item.run_id is not null
     or v_item.measurement_approved_by is distinct from p_actor_user_id
     or v_item.business_id is null
     or v_item.question_set_id is null then
    raise exception 'SCHEDULER_ITEM_NOT_CLAIMED';
  end if;

  select s.*
    into v_settings
  from public.internal_observation_pipeline_settings s
  where s.org_id=v_item.org_id;

  if not found
     or v_settings.execution_enabled is distinct from true
     or v_settings.scheduler_state <> 'running'
     or v_settings.scheduler_executor_ready is distinct from true
     or v_settings.scheduler_actor_user_id is distinct from p_actor_user_id then
    raise exception 'SCHEDULER_NOT_READY';
  end if;

  if not exists (
    select 1
    from public.organization_members om
    where om.org_id=v_item.org_id
      and om.user_id=p_actor_user_id
      and om.role in ('owner'::public.app_role,'admin'::public.app_role,'analyst'::public.app_role)
  ) then
    raise exception 'SCHEDULER_ACTOR_FORBIDDEN';
  end if;

  select o.*
    into v_org
  from public.organizations o
  where o.id=v_item.org_id;

  if not found or v_org.measurement_data_origin <> 'internal_observation' then
    raise exception 'INTERNAL_OBSERVATION_ORG_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.businesses b
    where b.id=v_item.business_id
      and b.org_id=v_item.org_id
      and b.active=true
      and b.is_client_business=true
  ) then
    raise exception 'BUSINESS_NOT_AVAILABLE';
  end if;

  if not exists (
    select 1
    from public.question_sets qs
    where qs.id=v_item.question_set_id
      and qs.org_id=v_item.org_id
      and qs.business_id=v_item.business_id
      and qs.active=true
      and qs.name like 'AI 진단 질문 · %'
  ) then
    raise exception 'QUESTION_SET_NOT_AVAILABLE';
  end if;

  if v_item.question_set_id is distinct from (
    select qs2.id
    from public.question_sets qs2
    where qs2.org_id=v_item.org_id
      and qs2.business_id=v_item.business_id
      and qs2.active=true
      and qs2.name like 'AI 진단 질문 · %'
    order by qs2.created_at desc
    limit 1
  ) then
    raise exception 'QUESTION_SET_NOT_NEWEST';
  end if;

  select
    count(*)::integer,
    (
      select count(*)::integer
      from (
        select q2.intent_type
        from public.questions q2
        where q2.question_set_id=v_item.question_set_id
          and q2.org_id=v_item.org_id
          and q2.active=true
          and q2.data_class='public'::public.data_class
          and q2.intent_type in (
            'local','recommendation','service','review_quality',
            'trust','comparison','price_value','discovery'
          )
        group by q2.intent_type
        having count(*)=3
      ) g
    )
  into v_question_count,v_intent_group_count
  from public.questions q
  where q.question_set_id=v_item.question_set_id
    and q.org_id=v_item.org_id
    and q.active=true
    and q.data_class='public'::public.data_class;

  if v_question_count <> 24 or v_intent_group_count <> 8 then
    raise exception 'INVALID_QUESTION_CONTRACT';
  end if;

  select p.*
    into v_provider
  from public.provider_settings p
  where p.org_id=v_item.org_id
    and p.provider='openai'::public.provider_name;

  if not found
     or v_provider.enabled is distinct from true
     or v_provider.paid_account_confirmed is distinct from true
     or v_provider.terms_reviewed is distinct from true
     or v_provider.automated_benchmark_approved is distinct from true then
    raise exception 'PROVIDER_NOT_READY';
  end if;

  select c.balance
    into v_credit
  from public.measurement_credit_accounts c
  where c.org_id=v_item.org_id
  for update;

  if coalesce(v_credit,0) < 1 then
    raise exception 'NO_MEASUREMENT_CREDIT';
  end if;

  if exists (
    select 1
    from public.measurement_runs r
    where r.org_id=v_item.org_id
      and r.run_type='audit'::public.run_type
      and r.phase='standalone'::public.run_phase
      and r.status in ('draft'::public.run_status,'queued'::public.run_status,'running'::public.run_status)
  ) then
    raise exception 'CONCURRENT_RUN_LIMIT';
  end if;

  if (
    select count(*)
    from public.internal_observation_pipeline_items i
    where i.org_id=v_item.org_id
      and i.measurement_approved_at >=
        (date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
  ) > v_settings.daily_run_limit then
    raise exception 'DAILY_PIPELINE_RUN_LIMIT';
  end if;

  select * into v_usage
  from public.get_org_usage(v_item.org_id);

  v_estimated := round((coalesce(v_provider.estimated_cost_per_request_usd,0) * 24)::numeric,6);
  if v_estimated <= 0 then
    v_max_cost := 0.01;
  else
    v_max_cost := greatest(
      ceil((round((v_estimated * 1.25)::numeric,6) * 100)::numeric) / 100,
      ceil((v_estimated * 100)::numeric) / 100
    );
  end if;

  if coalesce(v_usage.daily_requests,0) + 24 > v_org.daily_request_limit then
    raise exception 'DAILY_USAGE_LIMIT';
  end if;

  if coalesce(v_usage.monthly_actual_cost_usd,0)
       + coalesce(v_usage.monthly_reserved_cost_usd,0)
       + v_max_cost > v_org.monthly_budget_usd then
    raise exception 'MONTHLY_USAGE_LIMIT';
  end if;

  insert into public.measurement_runs(
    org_id,
    business_id,
    question_set_id,
    data_origin,
    name,
    run_type,
    phase,
    diagnostic_scope,
    status,
    selected_providers,
    repetitions,
    max_cost_usd,
    scheduled_at,
    created_by
  )
  select
    v_item.org_id,
    v_item.business_id,
    v_item.question_set_id,
    'internal_observation',
    '내부 자동 관찰 · ' || b.name || ' · ' ||
      to_char(timezone('Asia/Seoul',now()),'YYYY-MM-DD'),
    'audit'::public.run_type,
    'standalone'::public.run_phase,
    'customer',
    'draft'::public.run_status,
    array['openai'::public.provider_name],
    1,
    v_max_cost,
    now(),
    p_actor_user_id
  from public.businesses b
  where b.id=v_item.business_id
  returning id into v_run_id;

  update public.internal_observation_pipeline_items
  set run_id=v_run_id,
      updated_at=now()
  where id=v_item.id
    and status='measuring'
    and run_id is null;

  if not found then
    raise exception 'PIPELINE_LINK_FAILED';
  end if;

  return query
  select
    v_run_id,
    v_item.org_id,
    v_item.business_id,
    v_item.question_set_id,
    v_item.business_name;
end;
$function$;

revoke all on function public.create_internal_observation_scheduler_run_v07(uuid,uuid) from public;
revoke all on function public.create_internal_observation_scheduler_run_v07(uuid,uuid) from anon;
revoke all on function public.create_internal_observation_scheduler_run_v07(uuid,uuid) from authenticated;
grant execute on function public.create_internal_observation_scheduler_run_v07(uuid,uuid) to service_role;
