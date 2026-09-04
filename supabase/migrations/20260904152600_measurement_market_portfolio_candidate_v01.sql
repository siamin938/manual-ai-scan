create or replace function public.build_measurement_market_portfolio_candidate_v01(
  p_business_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_profile jsonb;
  v_core jsonb;
  v_adjacent jsonb;
  v_location jsonb;
  v_core_count integer;
  v_adjacent_count integer;
  v_result jsonb;
begin
  v_profile := public.resolve_measurement_market_profile_candidate_v01(p_business_id);
  v_core := coalesce(v_profile->'coreServices','[]'::jsonb);
  v_adjacent := coalesce(v_profile->'adjacentServices','[]'::jsonb);
  v_location := coalesce(v_profile->'location','{}'::jsonb);
  v_core_count := jsonb_array_length(v_core);
  v_adjacent_count := jsonb_array_length(v_adjacent);

  if v_core_count=0 then
    return jsonb_build_object('version','0.1','status','insufficient_profile','profile',v_profile,'slots','[]'::jsonb);
  end if;

  with intents(intent_key,intent_label,intent_order) as (
    values
      ('local','지역·접근성',1),('recommendation','추천',2),('service','서비스·작업',3),
      ('review_quality','후기·평판',4),('trust','전문성·신뢰',5),('comparison','비교',6),
      ('price_value','가격·가성비',7),('discovery','탐색·발견',8)
  ), layers(layer_key,layer_label,slot_order) as (
    values
      ('core_local','핵심 전문시장 · 가까운 지역',1),
      ('core_city','핵심 전문시장 · 넓은 지역',2),
      ('adjacent_city','인접/일반시장 · 넓은 지역',3)
  ), expanded as (
    select i.intent_key,i.intent_label,i.intent_order,l.layer_key,l.layer_label,l.slot_order,
      ((i.intent_order-1+l.slot_order-1)%v_core_count) as core_idx,
      case when v_adjacent_count>0 then ((i.intent_order-1)%v_adjacent_count) else null end as adjacent_idx
    from intents i cross join layers l
  ), slots as (
    select row_number() over(order by intent_order,slot_order)::integer as portfolio_position,
      intent_key,intent_label,layer_key,layer_label,
      case when layer_key='adjacent_city' and v_adjacent_count>0 then v_adjacent->adjacent_idx->>'key' else v_core->core_idx->>'key' end as service_key,
      case when layer_key='adjacent_city' and v_adjacent_count>0 then v_adjacent->adjacent_idx->>'label' else v_core->core_idx->>'label' end as service_label,
      case when layer_key='core_local' then 'local' else 'broader' end as location_scope,
      case when layer_key='core_local' then coalesce(v_location->>'localSurface',v_location->>'broaderSurface') else coalesce(v_location->>'broaderSurface',v_location->>'localSurface') end as location_surface,
      (layer_key='adjacent_city' and v_adjacent_count=0) as adjacent_fallback_to_core
    from expanded
  ), summary as (
    select count(*)::integer as question_count,count(distinct intent_key)::integer as intent_count,
      count(*) filter(where layer_key='core_local')::integer as core_local_count,
      count(*) filter(where layer_key='core_city')::integer as core_city_count,
      count(*) filter(where layer_key='adjacent_city')::integer as adjacent_city_count,
      count(*) filter(where adjacent_fallback_to_core)::integer as adjacent_fallback_count
    from slots
  )
  select jsonb_build_object(
    'version','0.1','status','candidate','portfolioType','coverage_balanced_diagnostic',
    'populationWeighted',false,
    'claim','실제 검색 빈도 확률이 아니라 표준화된 시장 커버리지 진단 포트폴리오',
    'profileVersion',v_profile->>'version','taxonomyVersion',v_profile->>'taxonomyVersion','businessIdentityVersion',v_profile->>'businessIdentityVersion',
    'summary',jsonb_build_object('questionCount',s.question_count,'intentCount',s.intent_count,'slotsPerIntent',3,
      'coreLocalCount',s.core_local_count,'coreCityCount',s.core_city_count,'adjacentCityCount',s.adjacent_city_count,'adjacentFallbackCount',s.adjacent_fallback_count),
    'slots',(select jsonb_agg(jsonb_build_object('position',portfolio_position,'intentType',intent_key,'intentLabel',intent_label,
      'marketLayer',layer_key,'marketLayerLabel',layer_label,'serviceKey',service_key,'serviceLabel',service_label,
      'locationScope',location_scope,'locationSurface',location_surface,'adjacentFallbackToCore',adjacent_fallback_to_core) order by portfolio_position) from slots),
    'limitations',jsonb_build_array(
      '현재는 질문 문구를 생성하지 않는 shadow 포트폴리오입니다.',
      '실제 AI 검색 빈도 분포를 추정한 가중치가 아닙니다.',
      '현재 production 질문 Generator에는 연결하지 않습니다.'
    )
  ) into v_result from summary s;
  return v_result;
end;
$function$;

revoke all on function public.build_measurement_market_portfolio_candidate_v01(uuid) from public;
grant execute on function public.build_measurement_market_portfolio_candidate_v01(uuid) to service_role;
