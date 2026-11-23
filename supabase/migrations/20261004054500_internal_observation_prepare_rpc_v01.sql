create or replace function public.prepare_internal_observation_candidate_v01(
  p_candidate_id uuid,
  p_questions jsonb,
  p_question_set_name text,
  p_actor_user_id uuid
)
returns table(
  business_id uuid,
  question_set_id uuid,
  reused_business boolean,
  reused_question_set boolean
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item public.internal_observation_pipeline_items%rowtype;
  v_business_id uuid;
  v_question_set_id uuid;
  v_reused_business boolean := false;
  v_reused_question_set boolean := false;
  v_question_count integer;
  v_intent_count integer;
  v_intent_shape_ok boolean;
begin
  select *
    into v_item
  from public.internal_observation_pipeline_items
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'PIPELINE_ITEM_NOT_FOUND';
  end if;

  if v_item.status <> 'preparing' then
    raise exception 'PIPELINE_ITEM_NOT_PREPARING';
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id = v_item.org_id
      and o.measurement_data_origin = 'internal_observation'
  ) then
    raise exception 'INTERNAL_OBSERVATION_ORG_REQUIRED';
  end if;

  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) <> 24 then
    raise exception 'INVALID_QUESTION_PAYLOAD';
  end if;

  with q as (
    select *
    from jsonb_to_recordset(p_questions)
      as x(prompt_text text, intent_type text, region text, city text)
  ), intent_counts as (
    select intent_type, count(*)::integer as n
    from q
    group by intent_type
  )
  select
    (select count(*)::integer from q),
    (select count(*)::integer from intent_counts),
    coalesce((
      select bool_and(
        intent_type in (
          'local','recommendation','service','review_quality',
          'trust','comparison','price_value','discovery'
        ) and n = 3
      )
      from intent_counts
    ), false)
  into v_question_count, v_intent_count, v_intent_shape_ok;

  if v_question_count <> 24 or v_intent_count <> 8 or not v_intent_shape_ok then
    raise exception 'INVALID_QUESTION_CONTRACT';
  end if;

  select b.id
    into v_business_id
  from public.businesses b
  where b.org_id = v_item.org_id
    and lower(btrim(b.name)) = lower(btrim(v_item.business_name))
  order by b.created_at asc
  limit 1;

  if v_business_id is not null then
    if exists (
      select 1 from public.businesses b
      where b.id = v_business_id and not b.active
    ) then
      raise exception 'EXISTING_BUSINESS_INACTIVE';
    end if;
    v_reused_business := true;
  else
    insert into public.businesses(
      org_id,
      name,
      aliases,
      category,
      website_url,
      naver_place_url,
      google_maps_url,
      address,
      country_code,
      region,
      city,
      is_client_business,
      active,
      metadata
    ) values (
      v_item.org_id,
      btrim(v_item.business_name),
      coalesce(v_item.aliases,'{}'::text[]),
      btrim(v_item.category),
      v_item.website_url,
      v_item.naver_place_url,
      v_item.google_maps_url,
      v_item.address,
      'KR',
      btrim(v_item.region),
      nullif(btrim(coalesce(v_item.city,'')),''),
      true,
      true,
      jsonb_build_object(
        'internal_observation_pipeline', true,
        'pipeline_item_id', v_item.id,
        'source_label', v_item.source_label
      )
    )
    returning id into v_business_id;
  end if;

  select qs.id
    into v_question_set_id
  from public.question_sets qs
  where qs.org_id = v_item.org_id
    and qs.business_id = v_business_id
    and qs.active = true
    and qs.name like 'AI 진단 질문 · %'
  order by qs.created_at desc
  limit 1;

  if v_question_set_id is not null then
    with intent_counts as (
      select q.intent_type, count(*)::integer as n
      from public.questions q
      where q.question_set_id = v_question_set_id
        and q.active = true
      group by q.intent_type
    )
    select
      (
        select count(*)::integer
        from public.questions q
        where q.question_set_id = v_question_set_id
          and q.active = true
      ),
      (select count(*)::integer from intent_counts),
      coalesce((
        select bool_and(
          intent_type in (
            'local','recommendation','service','review_quality',
            'trust','comparison','price_value','discovery'
          ) and n = 3
        )
        from intent_counts
      ), false)
    into v_question_count, v_intent_count, v_intent_shape_ok;

    if v_question_count <> 24 or v_intent_count <> 8 or not v_intent_shape_ok then
      raise exception 'EXISTING_UNIFIED_SET_INVALID';
    end if;

    v_reused_question_set := true;
  else
    insert into public.question_sets(
      org_id,
      business_id,
      name,
      version,
      active,
      created_by
    ) values (
      v_item.org_id,
      v_business_id,
      left(nullif(btrim(p_question_set_name),''), 200),
      1,
      true,
      p_actor_user_id
    )
    returning id into v_question_set_id;

    insert into public.questions(
      org_id,
      question_set_id,
      prompt_text,
      intent_type,
      language,
      country_code,
      region,
      city,
      weight,
      data_class,
      active
    )
    select
      v_item.org_id,
      v_question_set_id,
      btrim(x.prompt_text),
      x.intent_type,
      'ko',
      'KR',
      nullif(btrim(coalesce(x.region,'')),''),
      nullif(btrim(coalesce(x.city,'')),''),
      1,
      'public',
      true
    from jsonb_to_recordset(p_questions)
      as x(prompt_text text, intent_type text, region text, city text);
  end if;

  update public.internal_observation_pipeline_items
  set business_id = v_business_id,
      question_set_id = v_question_set_id,
      prepared_at = now(),
      error_code = null,
      error_message = null,
      updated_at = now()
  where id = p_candidate_id;

  return query
  select v_business_id, v_question_set_id, v_reused_business, v_reused_question_set;
end;
$function$;

revoke all on function public.prepare_internal_observation_candidate_v01(uuid,jsonb,text,uuid) from public;
revoke all on function public.prepare_internal_observation_candidate_v01(uuid,jsonb,text,uuid) from anon;
revoke all on function public.prepare_internal_observation_candidate_v01(uuid,jsonb,text,uuid) from authenticated;
grant execute on function public.prepare_internal_observation_candidate_v01(uuid,jsonb,text,uuid) to service_role;

comment on function public.prepare_internal_observation_candidate_v01(uuid,jsonb,text,uuid)
is 'Atomic internal-observation preparation: reuse/create target business and reuse/create a valid unified 24-question set. Service-role only; called by an authenticated internal-admin server function.';
