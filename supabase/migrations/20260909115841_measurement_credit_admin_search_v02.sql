create or replace function public.get_measurement_credit_admin_overview_v02(
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

  with matched_orgs as (
    select o.id
    from public.organizations o
    where o.measurement_data_origin in ('internal_observation','customer_measurement')
      and (
        v_query is null
        or position(v_query in lower(coalesce(o.name,''))) > 0
        or position(v_query in lower(coalesce(o.slug,''))) > 0
        or exists (
          select 1
          from public.organization_members om
          join auth.users u on u.id=om.user_id
          where om.org_id=o.id
            and (
              position(v_query in lower(coalesce(u.email,''))) > 0
              or position(v_query in lower(coalesce(u.raw_user_meta_data->>'display_name',''))) > 0
            )
        )
      )
  ), total as (
    select count(*)::integer as total_matches from matched_orgs
  ), org_rows as (
    select
      o.id as org_id,
      o.name,
      o.slug,
      o.measurement_data_origin as data_origin,
      o.created_at,
      coalesce(a.balance,0)::integer as balance,
      coalesce(a.lifetime_granted,0)::integer as lifetime_granted,
      coalesce(a.lifetime_consumed,0)::integer as lifetime_consumed,
      (
        select count(*)::integer
        from public.businesses b
        where b.org_id=o.id and b.is_client_business=true and b.active=true
      ) as client_business_count,
      (
        select max(l.created_at)
        from public.measurement_credit_ledger l
        where l.org_id=o.id
      ) as latest_ledger_at,
      owner_info.display_name as owner_name,
      owner_info.email as owner_email
    from matched_orgs mo
    join public.organizations o on o.id=mo.id
    left join public.measurement_credit_accounts a on a.org_id=o.id
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
    order by case o.measurement_data_origin when 'customer_measurement' then 1 else 2 end,
             o.created_at desc
    limit v_limit
  )
  select jsonb_build_object(
    'version','0.2',
    'generatedAt',now(),
    'query',coalesce(p_query,''),
    'totalMatches',(select total_matches from total),
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
      'latestLedgerAt',latest_ledger_at,
      'ownerName',owner_name,
      'ownerEmail',owner_email
    ) order by case data_origin when 'customer_measurement' then 1 else 2 end, created_at desc),'[]'::jsonb)
  ) into v_result
  from org_rows;

  return coalesce(
    v_result,
    jsonb_build_object(
      'version','0.2',
      'generatedAt',now(),
      'query',coalesce(p_query,''),
      'totalMatches',0,
      'organizations','[]'::jsonb
    )
  );
end;
$function$;

revoke all on function public.get_measurement_credit_admin_overview_v02(text,integer) from public;
revoke all on function public.get_measurement_credit_admin_overview_v02(text,integer) from anon;
grant execute on function public.get_measurement_credit_admin_overview_v02(text,integer) to authenticated;
grant execute on function public.get_measurement_credit_admin_overview_v02(text,integer) to service_role;

comment on function public.get_measurement_credit_admin_overview_v02(text,integer)
is 'Internal CHABOIM measurement credit admin overview with organization/member search. Access remains gated by can_view_data_asset_admin_v01().';
