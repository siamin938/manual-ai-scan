create or replace function public.get_measurement_credit_admin_overview_v01(
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
  v_result jsonb;
begin
  if not public.can_view_data_asset_admin_v01() then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  with org_rows as (
    select
      o.id as org_id,
      o.name,
      o.slug,
      o.measurement_data_origin as data_origin,
      o.created_at,
      coalesce(a.balance,0)::integer as balance,
      coalesce(a.lifetime_granted,0)::integer as lifetime_granted,
      coalesce(a.lifetime_consumed,0)::integer as lifetime_consumed,
      count(distinct b.id) filter (where b.is_client_business=true and b.active=true)::integer as client_business_count,
      max(l.created_at) as latest_ledger_at
    from public.organizations o
    left join public.measurement_credit_accounts a on a.org_id=o.id
    left join public.businesses b on b.org_id=o.id
    left join public.measurement_credit_ledger l on l.org_id=o.id
    where o.measurement_data_origin in ('internal_observation','customer_measurement')
    group by o.id,o.name,o.slug,o.measurement_data_origin,o.created_at,a.balance,a.lifetime_granted,a.lifetime_consumed
    order by case o.measurement_data_origin when 'customer_measurement' then 1 else 2 end,
             o.created_at desc
    limit v_limit
  )
  select jsonb_build_object(
    'version','0.1',
    'generatedAt',now(),
    'organizations',coalesce(jsonb_agg(jsonb_build_object(
      'orgId',org_id,
      'name',name,
      'slug',slug,
      'dataOrigin',data_origin,
      'createdAt',created_at,
      'balance',balance,
      'lifetimeGranted',lifetime_granted,
      'lifetimeConsumed',lifetime_consumed,
      'clientBusinessCount',client_business_count,
      'latestLedgerAt',latest_ledger_at
    ) order by case data_origin when 'customer_measurement' then 1 else 2 end, created_at desc),'[]'::jsonb)
  ) into v_result
  from org_rows;

  return coalesce(v_result,jsonb_build_object('version','0.1','generatedAt',now(),'organizations','[]'::jsonb));
end;
$function$;

create or replace function public.get_measurement_credit_admin_ledger_v01(
  p_org_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit,50), 100));
  v_result jsonb;
begin
  if not public.can_view_data_asset_admin_v01() then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.organizations o
    where o.id=p_org_id
      and o.measurement_data_origin in ('internal_observation','customer_measurement')
  ) then
    raise exception 'ORGANIZATION_NOT_FOUND';
  end if;

  select jsonb_build_object(
    'orgId',p_org_id,
    'entries',coalesce(jsonb_agg(jsonb_build_object(
      'id',x.id,
      'entryType',x.entry_type,
      'amount',x.amount,
      'balanceAfter',x.balance_after,
      'note',x.note,
      'runId',x.run_id,
      'referenceKey',x.reference_key,
      'createdAt',x.created_at
    ) order by x.created_at desc),'[]'::jsonb)
  ) into v_result
  from (
    select l.id,l.entry_type,l.amount,l.balance_after,l.note,l.run_id,l.reference_key,l.created_at
    from public.measurement_credit_ledger l
    where l.org_id=p_org_id
    order by l.created_at desc
    limit v_limit
  ) x;

  return coalesce(v_result,jsonb_build_object('orgId',p_org_id,'entries','[]'::jsonb));
end;
$function$;

create or replace function public.admin_grant_measurement_credits_v01(
  p_org_id uuid,
  p_amount integer,
  p_note text,
  p_reference_key text
)
returns table(balance_after integer,idempotent boolean)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_ref text := nullif(trim(coalesce(p_reference_key,'')),'');
begin
  if v_actor is null or not public.can_view_data_asset_admin_v01() then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  if p_amount is null or p_amount < 1 or p_amount > 100 then
    raise exception 'INVALID_CREDIT_AMOUNT';
  end if;

  if v_ref is null or char_length(v_ref) > 120 then
    raise exception 'INVALID_REFERENCE_KEY';
  end if;

  if not exists (
    select 1 from public.organizations o
    where o.id=p_org_id
      and o.measurement_data_origin in ('internal_observation','customer_measurement')
  ) then
    raise exception 'ORGANIZATION_NOT_FOUND';
  end if;

  return query
  select g.balance_after,g.idempotent
  from public.grant_measurement_credits_v01(
    p_org_id,
    p_amount,
    v_actor,
    left(nullif(trim(coalesce(p_note,'')),''),500),
    v_ref
  ) g;
end;
$function$;

revoke all on function public.get_measurement_credit_admin_overview_v01(integer) from public;
revoke all on function public.get_measurement_credit_admin_ledger_v01(uuid,integer) from public;
revoke all on function public.admin_grant_measurement_credits_v01(uuid,integer,text,text) from public;

grant execute on function public.get_measurement_credit_admin_overview_v01(integer) to authenticated;
grant execute on function public.get_measurement_credit_admin_ledger_v01(uuid,integer) to authenticated;
grant execute on function public.admin_grant_measurement_credits_v01(uuid,integer,text,text) to authenticated;
