create or replace function public.build_measurement_market_portfolio_candidate_v02(p_business_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_profile jsonb;
  v_core jsonb;
  v_adjacent jsonb;
  v_location jsonb;
  v_result jsonb;
begin
  v_profile := public.resolve_measurement_market_profile_candidate_v02(p_business_id);
  v_core := coalesce(v_profile->'coreServices','[]'::jsonb);
  v_adjacent := coalesce(v_profile->'adjacentServices','[]'::jsonb);
  v_location := coalesce(v_profile->'location','{}'::jsonb);

  if jsonb_array_length(v_core)=0 then
    return jsonb_build_object(
      'version','0.2.1','profile',v_profile,'summary',jsonb_build_object('questionCount',0),
      'slots','[]'::jsonb,'status','INSUFFICIENT_PROFILE'
    );
  end if;

  with intents(intent_order,intent_type,intent_label,allow_adjacent) as (
    values
      (1,'local','지역·접근성',true),
      (2,'recommendation','추천',true),
      (3,'service','서비스·작업',false),
      (4,'review_quality','후기·평판',false),
      (5,'trust','전문성·신뢰',false),
      (6,'comparison','비교',true),
      (7,'price_value','가격·가성비',false),
      (8,'discovery','탐색·발견',true)
  ), core_services as (
    select row_number() over(order by ordinality)::integer as rn, value
    from jsonb_array_elements(v_core) with ordinality
  ), adjacent_services as (
    select row_number() over(order by ordinality)::integer as rn, value
    from jsonb_array_elements(v_adjacent) with ordinality
  ), counts as (
    select
      greatest(1,(select count(*) from core_services))::integer as core_count,
      (select count(*) from adjacent_services)::integer as adjacent_count
  ), slots as (
    select
      ((i.intent_order-1)*3)+s.slot_in_intent as position,
      i.intent_order,i.intent_type,i.intent_label,s.slot_in_intent,
      case s.slot_in_intent
        when 1 then 'core_local'
        when 2 then 'core_city'
        when 3 then case when c.adjacent_count>0 and i.allow_adjacent then 'adjacent_city' else 'core_expansion' end
      end as market_layer,
      case s.slot_in_intent
        when 1 then '핵심 전문시장 · 가까운 지역'
        when 2 then '핵심 전문시장 · 넓은 지역'
        when 3 then case when c.adjacent_count>0 and i.allow_adjacent then '인접/일반시장 · 넓은 지역' else '핵심 전문시장 · 추가 탐색' end
      end as market_layer_label,
      case s.slot_in_intent when 1 then 'local' else 'broader' end as location_scope,
      case s.slot_in_intent
        when 1 then coalesce(nullif(v_location->>'localSurface',''),nullif(v_location->>'broaderSurface',''),v_location->>'city')
        else coalesce(nullif(v_location->>'broaderSurface',''),nullif(v_location->>'localSurface',''),v_location->>'city')
      end as location_surface,
      case
        when s.slot_in_intent=3 and c.adjacent_count>0 and i.allow_adjacent then
          (select a.value from adjacent_services a where a.rn=((i.intent_order-1)%c.adjacent_count)+1)
        else
          (select cs.value from core_services cs where cs.rn=(((i.intent_order+s.slot_in_intent-2)%c.core_count)+1))
      end as service
    from intents i
    cross join counts c
    cross join (values (1),(2),(3)) s(slot_in_intent)
  )
  select jsonb_build_object(
    'version','0.2.1',
    'profile',v_profile,
    'summary',jsonb_build_object(
      'questionCount',count(*),
      'intentCount',count(distinct intent_type),
      'slotsPerIntent',3,
      'coreLocalCount',count(*) filter(where market_layer='core_local'),
      'coreCityCount',count(*) filter(where market_layer='core_city'),
      'adjacentCityCount',count(*) filter(where market_layer='adjacent_city'),
      'coreExpansionCount',count(*) filter(where market_layer='core_expansion')
    ),
    'slots',jsonb_agg(jsonb_build_object(
      'position',position,
      'intentType',intent_type,
      'intentLabel',intent_label,
      'marketLayer',market_layer,
      'marketLayerLabel',market_layer_label,
      'locationScope',location_scope,
      'locationSurface',location_surface,
      'serviceKey',service->>'key',
      'serviceLabel',service->>'label',
      'serviceEvidenceStatus',service->>'evidenceStatus'
    ) order by position),
    'status','READY_SHADOW'
  ) into v_result
  from slots;

  return v_result;
end;
$function$;
